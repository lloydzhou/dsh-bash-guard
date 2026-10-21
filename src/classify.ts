/**
 * Conservative, lexical bash-agent policy scanner, NOT an OS sandbox or a full
 * shell parser. Requirements are four octal digits: system/external/network/
 * workspace, each with read=4, write=2, execute=1. Compound calls accumulate
 * every requirement; callers must grant ALL bits. Real filesystem confinement,
 * symlink resolution and runtime/network isolation belong to the sandbox.
 *
 * Mirrors docs/bash-tool-policy.md and the Go/Rust/bash scanners in bash-agent.
 * Unlike their whitespace scanner, quoted paths and stderr redirections are
 * retained. Unresolved shell expansion fails closed rather than guessing a path.
 */
import { posix as path } from 'node:path'

export type BashGuardScope = 'system' | 'external' | 'network' | 'workspace'
export type BashGuardOp = 'read' | 'write' | 'exec'
/** A required mode, not one winning (scope, op) pair. */
export type Requirement = string
export interface ClassificationContext {
  /** Effective working directory; relative arguments resolve here. */
  cwd?: string
  /** Stable workspace root, independent of bash's workdir or a script's cd. */
  workspace?: string
  /** Used only for ~ / $HOME and trusted bash-agent session paths. */
  home?: string
}
type ContextInput = ClassificationContext | string
interface ResolvedContext { cwd: string; workspace: string; home: string }
const SCOPES: readonly BashGuardScope[] = ['system', 'external', 'network', 'workspace']
const VALID_MODE = /^[0-7]{4}$(?![\s\S])/
const SYSTEM = /^\/(?:etc|usr|bin|sbin|var|library|system|dev|boot|proc|sys|root)(?:\/|$)/i
const SENSITIVE = /(?:^|\/)(?:\.ssh|\.gnupg|\.aws|\.docker)(?:\/|$)|(?:\.env|\.pem|\.key)(?:$|\/)|token|credential|secret/i
const READERS = new Set(['cat', 'ls', 'head', 'tail', 'less', 'more', 'grep', 'egrep', 'fgrep', 'rg', 'find', 'stat', 'wc', 'file', 'du', 'readlink', 'realpath', 'sort', 'uniq', 'cut', 'diff', 'cmp', 'sed', 'awk'])
const MUTATORS = new Set(['mkdir', 'touch', 'cp', 'mv', 'rm', 'rmdir', 'tee', 'chmod', 'chown', 'chgrp', 'truncate', 'install', 'ln', 'dd'])
const INTERPRETERS = /^(?:ba|z|da|k)?sh$|^(?:python\d*(?:\.\d+)?|node|ruby|perl|php|lua|eval|source|\.)$/
const NETWORK = /^(?:curl|wget|http|https|ssh|scp|sftp|rsync|nc|ncat|netcat|telnet|ftp|ping|gh)$/
const GIT_WRITE = /^(?:fetch|pull|clone|commit|add|checkout|switch|restore|merge|rebase|stash|cherry-pick|reset|clean|init)$/
const GIT_EXEC = /^(?:commit|add|checkout|switch|restore|merge|rebase|stash|cherry-pick)$/
const within = (target: string, root: string): boolean => target === root || target.startsWith(root === '/' ? '/' : `${root}/`)
const format = (mask: number): Requirement => mask.toString(8).padStart(4, '0')
const bit = (scope: BashGuardScope, permissions: number): number => permissions << ((3 - SCOPES.indexOf(scope)) * 3)

function context(input?: ContextInput): ResolvedContext {
  const options = typeof input === 'string' ? { cwd: input, workspace: input } : input ?? {}
  const cwd = path.resolve(options.cwd ?? options.workspace ?? process.cwd())
  return { cwd, workspace: path.resolve(options.workspace ?? cwd), home: options.home ?? process.env.BASH_AGENT_HOME ?? process.env.HOME ?? '' }
}

/** Pure lexical classification: never follows symlinks or touches the filesystem. */
function pathMask(value: string, permissions: number, ctx: ResolvedContext): number {
  if (!value || /^&\d+$/.test(value) || value === '-') return 0
  const original = value
  value = value.replace(/^~(?=\/|$)|^\$(?:HOME|\{HOME\})(?=\/|$)/, ctx.home || '$UNKNOWN_HOME')
  if (/[\x00\r\n]/.test(value) || /\$|`|~/.test(value)) return bit('system', permissions) | bit('external', permissions) | bit('network', permissions) | bit('workspace', permissions)
  // /private/tmp is the real path of /tmp on macOS and equally trusted.
  const trusted = ['/tmp', '/private/tmp', ...(ctx.home ? [path.join(ctx.home, '.bash-agent/projects')] : [])]
  // Check BEFORE normalization: /tmp/../etc is explicitly never trusted.
  if (trusted.some(root => within(value, root)) && value.split('/').includes('..')) return bit('system', permissions)
  const resolved = path.resolve(ctx.cwd, value)
  if (resolved === '/dev/null') return 0
  if (within(resolved, '/dev/tcp') || within(resolved, '/dev/udp')) return bit('network', permissions)
  if (trusted.some(root => within(resolved, root))) return bit(value.split('/').includes('..') ? 'system' : 'workspace', permissions)
  if (resolved === '/' || /^\/[?*\[]/.test(resolved) || SYSTEM.test(resolved) || SENSITIVE.test(original)) return bit('system', permissions)
  return bit(within(resolved, ctx.workspace) ? 'workspace' : 'external', permissions)
}

/** One scope's Unix-style permission bit. */
export function opBit(op: BashGuardOp): number { return op === 'read' ? 4 : op === 'write' ? 2 : 1 }
/** Invalid modes/scopes never accidentally become an allowed digit. */
export function scopeDigit(mode: string, scope: BashGuardScope): number {
  return VALID_MODE.test(mode) && SCOPES.includes(scope) ? Number(mode[SCOPES.indexOf(scope)]) : -1
}
export function allows(mode: string, required: Requirement): boolean {
  if (!VALID_MODE.test(mode) || !VALID_MODE.test(required)) return false
  const allowedMask = Number.parseInt(mode, 8)
  const requiredMask = Number.parseInt(required, 8)
  return (allowedMask & requiredMask) === requiredMask
}

/** Actual DSH names/arguments; legacy casing is accepted, not required. */
export function classifyTool(tool: string, args: Record<string, unknown> = {}, input?: ContextInput): Requirement | undefined {
  const name = tool.toLowerCase()
  const ctx = context(input)
  if (name === 'bash') {
    if (typeof args.command !== 'string') return '7777'
    const cwd = typeof args.workdir === 'string' ? path.resolve(ctx.cwd, args.workdir) : ctx.cwd
    return classifyCommand(args.command, { ...ctx, cwd })
  }
  const read = ['read', 'read_image', 'grep', 'glob', 'ls'].includes(name)
  const write = ['write', 'edit', 'multiedit', 'notebookedit'].includes(name)
  if (!read && !write) return undefined
  const value = args.file_path ?? args.path ?? args.notebook_path
  if (value !== undefined && typeof value !== 'string') return '7777'
  if (name === 'glob' && value === undefined && typeof args.pattern === 'string' && (path.isAbsolute(args.pattern) || args.pattern.split('/').includes('..'))) return '4000'
  return format(pathMask(typeof value === 'string' && value ? value : '.', write ? 2 : 4, ctx))
}

interface Token { text: string; operator: boolean }
/** Quotes group literal paths. Operators are recognized even without whitespace. */
function tokenize(script: string): Token[] | undefined {
  const result: Token[] = []
  let word = '', active = false, quote = ''
  const flush = (): void => { if (active) result.push({ text: word, operator: false }); word = ''; active = false }
  for (let i = 0; i < script.length; i += 1) {
    const ch = script[i]!
    if (ch === '\\' && quote !== "'") {
      if (i + 1 >= script.length) return undefined
      const next = script[++i]!
      if (next !== '\n') { word += next; active = true }
      continue
    }
    if (quote) { if (ch === quote) quote = ''; else word += ch; continue }
    if (ch === '"' || ch === "'") { quote = ch; active = true; continue }
    if (ch === '#' && !active) { while (i < script.length && script[i] !== '\n') i += 1; flush(); result.push({ text: ';', operator: true }); continue }
    if (ch === '\n' || /\s/.test(ch)) { flush(); if (ch === '\n') result.push({ text: ';', operator: true }); continue }
    if (';&|<>()'.includes(ch)) {
      // A numeric word immediately before >/< is an fd, not a path.
      let fd = ''
      if ((ch === '>' || ch === '<') && /^\d+$/.test(word)) { fd = word; word = ''; active = false }
      flush()
      let op = ch
      if (script[i + 1] === ch || (ch === '<' && script[i + 1] === '>') || ('<>'.includes(ch) && script[i + 1] === '&') || (ch === '>' && script[i + 1] === '|')) op += script[++i]
      result.push({ text: fd + op, operator: true }); continue
    }
    word += ch; active = true
  }
  if (quote) return undefined
  flush()
  return result
}

/**
 * Quote-aware syntax prescan. Single quotes are fully literal; double quotes
 * suppress keywords/braces but the shell still expands `$` and backticks
 * inside them. `literal` drops quote contents and backslash-escaped chars
 * (keyword/brace checks); `expansible` keeps double-quote contents (expansion
 * checks). Unterminated quotes are rejected later by tokenize().
 */
function quoteStrip(command: string): { literal: string; expansible: string } {
  let literal = '', expansible = '', quote = ''
  for (let i = 0; i < command.length; i += 1) {
    const ch = command[i]!
    if (quote) {
      if (quote === '"' && ch === '\\') { literal += ' '; expansible += ' '; i += 1; continue }
      if (ch === quote) { quote = ''; literal += ch; expansible += ch; continue }
      if (quote === '"') { literal += ' '; expansible += ch; continue }
      continue
    }
    if (ch === '\\') { literal += ' '; expansible += ' '; i += 1; continue }
    if (ch === '"' || ch === "'") { quote = ch; literal += ch; expansible += ch; continue }
    literal += ch; expansible += ch
  }
  return { literal, expansible }
}

/**
 * Accumulate command segments, pipelines, path scopes, redirections and execution.
 * Opaque substitutions/heredocs/dynamic command names fail closed. This cannot
 * prove the effects of arbitrary programs, aliases, symlinks or shell functions.
 */
export function classifyCommand(command: string, input?: ContextInput): Requirement {
  if (!command.trim()) return '0000'
  const ctx = context(input)
  // Quoted segments are data, not syntax: single-quoted text never expands,
  // double-quoted text cannot contain control flow but still expands $/backticks.
  const { literal, expansible } = quoteStrip(command)
  // Do not pretend to expand arbitrary shell code, variables, or process substitution.
  if (/\$\(|`|[<>]\(|<<|\$\{|\$(?!HOME(?:\W|$))[A-Za-z_]/.test(expansible)) return '7777'
  // Branch-dependent shell control flow cannot be resolved by this scanner.
  if (/\b(?:if|then|else|elif|fi|for|while|until|case|esac|function)\b|[{}]/.test(literal)) return '7777'
  const tokens = tokenize(command)
  if (!tokens) return '7777'
  // cd only pins the cwd reliably when it leads the chain: a cd that runs
  // after another segment may never execute (&&/||), making later cwd
  // unknowable. A leading cd is deterministic and tracked segment by segment.
  {
    let segmentIndex = 0
    for (const token of tokens) {
      if (token.operator) {
        if (/[;&|()]/.test(token.text)) segmentIndex += 1
        continue
      }
      if (token.text === 'cd' && segmentIndex > 0) return '7777'
    }
  }
  let mask = 0
  let segment: Token[] = []
  let networkSeen = false, networkExecution = false
  let cwd = ctx.cwd
  const scan = (): void => {
    if (!segment.length) return
    const local = { ...ctx, cwd }
    const words: string[] = []
    for (let i = 0; i < segment.length; i += 1) {
      const token = segment[i]!
      if (token.operator && /[<>]/.test(token.text)) {
        const next = segment[++i]
        if (!next || next.operator) { mask |= 0o7777; continue }
        if (token.text.endsWith('&') && /^(?:\d+|-)$/.test(next.text)) continue
        const permissions = token.text.includes('<>') ? 6 : token.text.includes('>') ? 2 : 4
        mask |= pathMask(next.text, permissions, local)
      } else if (!token.operator) words.push(token.text)
    }
    segment = []
    while (words[0] && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[0])) {
      // Environment overrides can change executable lookup / shell startup semantics.
      if (/^(?:PATH|BASH_ENV|ENV|SHELLOPTS|LD_|DYLD_)/.test(words[0])) mask |= 0o7777
      words.shift()
    }
    while (['command', 'builtin', 'exec', 'env', 'nohup', 'timeout'].includes(words[0] ?? '')) {
      words.shift()
      while (words[0]?.startsWith('-') || /^\d+$/.test(words[0] ?? '') || /^[A-Za-z_]\w*=/.test(words[0] ?? '')) words.shift()
    }
    if (!words.length) return
    if (words[0]!.startsWith('-') || /[?*\[\]$]/.test(words[0]!)) { mask |= 0o7777; return }
    const executable = words[0]!
    const cmd = path.basename(executable).toLowerCase()
    const args = words.slice(1)
    const sub = args.find(arg => !arg.startsWith('-'))?.toLowerCase() ?? ''
    const git = cmd === 'git'
    const network = NETWORK.test(cmd) || git && /^(?:clone|fetch|pull|ls-remote|push)$/.test(sub) || args.some(arg => /^https?:\/\//i.test(arg))
    if (network) {
      networkSeen = true
      if (!(git && sub === 'push')) mask |= bit('network', 4)
      if (['ssh', 'scp', 'sftp', 'rsync', 'ftp', 'nc', 'ncat', 'netcat', 'telnet'].includes(cmd)) mask |= bit('network', 2)
      if (cmd === 'ssh') { mask |= bit('network', 1); networkExecution = true }
      if (git && sub === 'push' || cmd === 'curl' && args.some(arg => /^(?:-[dFTX]|--(?:data|json|form|upload-file|request))(?:$|[=A-Z])/.test(arg))) mask |= bit('network', 2)
    }
    if (/^(?:sudo|su|doas|shutdown|reboot|halt|poweroff)$/.test(cmd)) mask |= bit('system', 1)
    if (['sudo', 'su', 'doas'].includes(cmd) && args.length && !['echo', 'printf', 'true', 'false', ':', 'pwd'].includes(args[0]!)) {
      // Options such as sudo -u require command-specific parsing; do not guess.
      mask |= args[0]!.startsWith('-') ? 0o7777 : Number.parseInt(classifyCommand(args.map(arg => JSON.stringify(arg)).join(' '), local), 8)
    }
    if (/^(?:mkfs.*|fdisk|diskutil|mount|umount)$/.test(cmd)) mask |= bit('system', 2)
    const interpreter = INTERPRETERS.test(cmd)
    if (interpreter) {
      mask |= pathMask('.', 1, local)
      networkExecution = true
      const inline = args.findIndex(arg => /^-[^-]*c/.test(arg))
      if (inline >= 0 && args[inline + 1] !== undefined && /^(?:ba|z|da|k)?sh$|^eval$/.test(cmd)) mask |= Number.parseInt(classifyCommand(args[inline + 1]!, local), 8)
      if (['eval', 'source', '.'].includes(cmd) && args.length) mask |= cmd === 'eval' ? Number.parseInt(classifyCommand(args.join(' '), local), 8) : pathMask(args[0]!, 1, local)
    }
    const build = /^(?:make|gmake|cmake|ninja)$/.test(cmd) || /^(?:npm|pnpm|yarn|bun)$/.test(cmd) && /^(?:run|test|exec|dlx|install|add|publish)$/.test(sub) || /^(?:cargo|go)$/.test(cmd) && /^(?:test|build|run|install)$/.test(sub)
    const mutation = MUTATORS.has(cmd) || git && GIT_WRITE.test(sub) || build && !/^(?:make|gmake|cmake|ninja)$/.test(cmd) && /^(?:test|build|install|add)$/.test(sub) || cmd === 'sed' && args.some(arg => /^-i|^--in-place/.test(arg)) || cmd === 'find' && args.includes('-delete')
    if (build || git && GIT_EXEC.test(sub)) mask |= pathMask('.', 1, local)
    if (/^(?:npm|pnpm|yarn|bun|pip\d*|brew|apt(?:-get)?)$/.test(cmd) && /^(?:install|add|publish)$/.test(sub)) mask |= bit('network', sub === 'publish' ? 2 : 4)
    let pathSeen = false
    if (executable.includes('/')) { mask |= pathMask(executable, 1, local); pathSeen = true }
    // Read/write tools conservatively require both operations on explicit operands,
    // as in the reference scanner. Redirection destinations are write-only.
    const permissions = mutation ? 6 : 4
    for (let i = 0; i < args.length; i += 1) {
      let arg = args[i]!
      if (/^https?:\/\//i.test(arg)) continue
      if ((cmd === 'curl' && /^(?:-o|--output|-T|--upload-file)$/.test(arg)) || cmd === 'wget' && /^(?:-O|--output-document)$/.test(arg)) {
        const target = args[++i]
        if (target) mask |= pathMask(target, /^(?:-T|--upload-file)$/.test(arg) ? 4 : 2, local)
        continue
      }
      if (arg.startsWith('-')) {
        const optionPath = arg.match(/=(\/[^\s]*|\.\.?\/[^\s]*)$/)?.[1]
        if (!optionPath) continue
        arg = optionPath
      }
      if (/^of=/.test(arg)) { mask |= pathMask(arg.slice(3), 2, local); pathSeen = true; continue }
      if (/^if=/.test(arg)) { mask |= pathMask(arg.slice(3), 4, local); pathSeen = true; continue }
      const explicit = /^(?:\/|\.\.?\/|~|\$HOME)/.test(arg) || SENSITIVE.test(arg)
      if (explicit || READERS.has(cmd) || MUTATORS.has(cmd)) {
        // Search expressions without path syntax are not filesystem targets.
        if (['grep', 'egrep', 'fgrep', 'rg', 'sed', 'awk'].includes(cmd) && i === 0 && !explicit) continue
        mask |= pathMask(arg, permissions, local); pathSeen = true
      }
      if (interpreter && i === 0 && !arg.startsWith('-') && !explicit) mask |= pathMask(arg, 1, local)
    }
    if (mutation && !pathSeen) mask |= pathMask('.', 2, local)
    if (cmd === 'cd') {
      const target = args[0] ?? ctx.home
      mask |= pathMask(target || '$UNKNOWN_HOME', 4, local)
      if (!/[$~*?\[\]]/.test(target)) cwd = path.resolve(cwd, target)
      else mask |= 0o7777
    }
    // Unknown local programs can execute code; never classify them as mere reads.
    if (!executable.includes('/') && !READERS.has(cmd) && !MUTATORS.has(cmd) && !interpreter && !build && !git && !NETWORK.test(cmd) && !['echo', 'printf', 'pwd', 'true', 'false', ':', 'test', '[', 'cd'].includes(cmd) && !/^(?:sudo|su|doas|shutdown|reboot|halt|poweroff|mkfs.*|fdisk|diskutil|mount|umount)$/.test(cmd)) mask |= pathMask('.', 1, local)
  }
  for (const token of tokens) {
    if (token.operator && /^[;&|()]$|^&&$|^\|\|$/.test(token.text)) scan()
    else segment.push(token)
  }
  scan()
  if (networkSeen && networkExecution) mask |= bit('network', 1)
  return format(mask || bit('workspace', 4))
}
