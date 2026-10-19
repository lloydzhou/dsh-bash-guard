import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { allows, classifyTool } from './classify.ts'
import { posix as path } from 'node:path'
import { DEFAULT_JEV_SETTINGS, evaluate, prepareState, publicSettings, settingsSchema, testSettings, validateSettings, type JevSettings, type JevSettingsRequest, type PublicJevSettings } from './jev.ts'

export const name = 'bash-guard'
export const inject = ['storageDomain', 'sessions', 'permissionPresets', 'sandboxPolicy', 'approval']
export const BASH_GUARD_DENIED = 'BASH_GUARD_DENIED'
const BASELINE = 'danger-full-access'
const valid = (value: unknown): value is string => typeof value === 'string' && /^[0-7]{4}$(?![\s\S])/.test(value)
export interface GuardRecord { mode: string; active: boolean; revision: number; presetSeq: number; engine: 'local' | 'jev' }
export interface GuardDecision { source: 'local' | 'jev'; fallback: boolean; allowed: boolean }
export interface GuardUpdate { action: 'activate' | 'mode' | 'deactivate' | 'engine'; mode?: string; engine?: 'local' | 'jev'; revision: number }
export const recordSchema = {
  parse(value: any): GuardRecord {
    if (!value || !valid(value.mode) || typeof value.active !== 'boolean' || !Number.isSafeInteger(value.revision) || value.revision < 0 || !Number.isSafeInteger(value.presetSeq) || value.presetSeq < -1) throw new Error('Invalid stored Bash Guard configuration')
    if (value.engine !== undefined && !['local', 'jev'].includes(value.engine)) throw new Error('Invalid stored Bash Guard engine')
    return { mode: value.mode, active: value.active, revision: value.revision, presetSeq: value.presetSeq, engine: value.engine ?? 'local' }
  },
}
function presetBoundary(session: any): number {
  let boundary = -1
  const permissionRuns = new Set<string>()
  for (const event of session.snapshotEvents()) {
    // Knob edits also invalidate the guard, even without a preset identity change.
    if (['permission/preset', 'sandbox/mode', 'approval/policy'].includes(event.type)) boundary = event.seq
    if (event.type === 'command/run' && event.data.name === 'permission' && event.data.args?.trim()) permissionRuns.add(event.data.commandId)
    if (event.type === 'command/done' && event.data.kind === 'success' && permissionRuns.has(event.data.commandId)) boundary = event.seq
  }
  return boundary
}

/** Standard Cordis service + source-mode Typert descriptors; the gateway supplies
 * the { ok, value } RPC envelope, not these methods. No session command transport. */
export class BashGuardService extends TypertRemoteService {
  constructor(ctx: any, private readonly readState: (id: string) => GuardRecord & { decision?: GuardDecision }, private readonly mutate: (id: string, request: GuardUpdate) => Promise<GuardRecord>, private readonly settings: { get: () => PublicJevSettings; save: (request: JevSettingsRequest & { revision: number }) => Promise<PublicJevSettings>; test: (request: JevSettingsRequest) => Promise<{ ok: true; model: string }> }) {
    super(ctx, 'bashGuard')
    // Invoke the installed standard-decorator API explicitly so both the host
    // transpiler and source-mode test runners discover the same descriptors.
    for (const method of ['get', 'update', 'getSettings', 'saveSettings', 'testSettings'] as const) {
      Remote(method)(this[method] as any, {
        kind: 'method', name: method, static: false, private: false,
        access: { has: (object: any) => method in object, get: (object: any) => object[method] },
        addInitializer: (initialize: (this: BashGuardService) => void) => initialize.call(this),
      } as any)
    }
  }

  get(sessionId: string): GuardRecord & { decision?: GuardDecision } { return this.readState(sessionId) }
  update(sessionId: string, request: GuardUpdate): Promise<GuardRecord> { return this.mutate(sessionId, request) }
  getSettings(): PublicJevSettings { return this.settings.get() }
  saveSettings(request: JevSettingsRequest & { revision: number }): Promise<PublicJevSettings> { return this.settings.save(request) }
  testSettings(request: JevSettingsRequest): Promise<{ ok: true; model: string }> { return this.settings.test(request) }
}

export async function apply(ctx: any, config: { mode?: string } = {}): Promise<void> {
  const fallback = config.mode ?? '4667'
  if (!valid(fallback)) throw new Error('bash-guard: expected four octal digits')
  const domain = await ctx.storageDomain.open({ name: 'bash_guard', version: 1, layout: 'per-record', tables: { sessions: { valueSchema: recordSchema } } })
  ctx.effect(() => () => domain.close())
  const records = domain.table('sessions')
  const settingsDomain = await ctx.storageDomain.open({ name: 'bash_guard_jev', version: 1, layout: 'per-record', tables: { settings: { valueSchema: settingsSchema } } })
  ctx.effect(() => () => settingsDomain.close())
  const settingsTable = settingsDomain.table('settings')
  const readSettings = (): JevSettings => { const value = settingsTable.get('profile'); return value === undefined ? { ...DEFAULT_JEV_SETTINGS } : settingsSchema.parse(value) }
  let settingsQueue: Promise<unknown> = Promise.resolve()
  const decisions = new Map<string, GuardDecision>()
  const queues = new Map<string, Promise<unknown>>()
  const sessionId = (id: string) => {
    if (typeof id !== 'string' || !id.trim()) throw new Error('A session ID is required')
    return id
  }
  const baselineEffective = (session: any): boolean =>
    ctx.permissionPresets.current(session) === BASELINE &&
    ctx.sandboxPolicy.resolve({ session }).mode === BASELINE &&
    ctx.approval.effectivePolicy(session) === 'never'
  const read = (id: string, session = ctx.sessions.get(sessionId(id))): GuardRecord => {
    const stored = records.get(id)
    const state: GuardRecord = stored === undefined ? { mode: fallback, active: false, revision: 0, presetSeq: -1, engine: 'local' } : recordSchema.parse(stored)
    // A read never resumes a session or acquires its persistence writer. An
    // unbound session cannot establish that its saved baseline still applies.
    if (!session) return state.active ? { ...state, active: false, revision: state.revision + 1 } : state
    const boundary = presetBoundary(session)
    return state.active && (boundary > state.presetSeq || !baselineEffective(session))
      ? { ...state, active: false, revision: state.revision + 1, presetSeq: boundary }
      : state
  }
  const serialized = <T>(id: string, action: () => Promise<T>): Promise<T> => {
    const pending = (queues.get(id) ?? Promise.resolve()).catch(() => {}).then(action)
    queues.set(id, pending)
    void pending.finally(() => { if (queues.get(id) === pending) queues.delete(id) }).catch(() => {})
    return pending
  }
  new BashGuardService(ctx, (id) => ({ ...read(id), ...(decisions.has(id) ? { decision: decisions.get(id)! } : {}) }), (id, request) => serialized(sessionId(id), async () => {
    // Resolve inside the queue: never retain a stale binding across mutations.
    const session = ctx.sessions.get(id)
    if (!session) throw new Error('Session is not live; open the session before changing Bash Guard')
    const state = read(id, session)
    if (!request || !['activate', 'mode', 'deactivate', 'engine'].includes(request.action)) throw new Error('Unknown guard operation')
    if (!Number.isSafeInteger(request.revision) || request.revision !== state.revision) throw new Error('Guard configuration changed; reopen the permission menu')
    if (state.revision >= Number.MAX_SAFE_INTEGER) throw new Error('Guard revision exhausted')
    if (request.action === 'mode' && (!state.active || !valid(request.mode))) throw new Error('An active guard and four octal digits are required')
    if (request.action === 'engine') {
      if (!['local', 'jev'].includes(request.engine!)) throw new Error('Invalid guard engine')
      await settingsQueue
      if (read(id).revision !== state.revision || ctx.sessions.get(id) !== session) throw new Error('Guard configuration changed; reopen the permission menu')
      if (request.engine === 'jev' && !readSettings().apiKey) throw new Error('Configure a Jev API key before selecting Jev')
    }
    let previousPreset: string | undefined
    if (request.action === 'activate') {
      const baseline = ctx.permissionPresets.resolve(BASELINE)
      if (baseline.sandbox !== BASELINE) throw new Error('Full-access baseline must use danger-full-access sandbox')
      if (baseline.approval !== 'never') throw new Error('Bash Guard requires Full access with approval=never; the configured preset still requests approval')
      previousPreset = ctx.permissionPresets.current(session)
      // A custom/unavailable baseline cannot be restored through the preset API.
      // Refuse before elevating instead of risking an unguarded full-access session.
      if (!previousPreset || previousPreset === 'custom') throw new Error('Cannot activate Bash Guard without a restorable native preset')
      ctx.permissionPresets.resolve(previousPreset)
    }
    try {
      if (previousPreset !== undefined) {
        // Canonical native setters; never recursively execute a session command.
        ctx.permissionPresets.set(session, BASELINE)
        if (!baselineEffective(session)) throw new Error('Cannot activate danger-full-access baseline with effective approval=never')
      }
      const next = recordSchema.parse({
        mode: request.action === 'mode' ? request.mode : state.mode,
        active: request.action === 'engine' ? state.active : request.action !== 'deactivate', revision: state.revision + 1,
        engine: request.action === 'engine' ? request.engine : state.engine,
        presetSeq: presetBoundary(session),
      })
      await records.put(id, next)
      decisions.delete(id)
    } catch (error) {
      if (previousPreset !== undefined) {
        try {
          ctx.permissionPresets.set(session, previousPreset)
          if (ctx.permissionPresets.current(session) !== previousPreset) throw new Error('Native preset restoration did not take effect')
        } catch (rollbackError) {
          throw new AggregateError([error, rollbackError], 'Bash Guard activation failed and native preset rollback failed; full access may remain enabled. Restore native permissions immediately.')
        }
      }
      throw error
    }
    return read(id)
  }), {
    get: () => publicSettings(readSettings()),
    save: (request) => {
      const pending = settingsQueue.catch(() => {}).then(async () => {
        const previous = readSettings()
        if (!request || !Number.isSafeInteger(request.revision) || request.revision !== previous.revision) throw new Error('Jev settings changed; reopen settings')
        if (previous.revision >= Number.MAX_SAFE_INTEGER) throw new Error('Jev settings revision exhausted')
        const next = { ...validateSettings(request, previous), revision: previous.revision + 1 }
        await settingsTable.put('profile', next)
        return publicSettings(next)
      })
      settingsQueue = pending.catch(() => {})
      return pending
    },
    test: async (request) => testSettings(validateSettings(request, readSettings())),
  })
  ctx.on('tools/execute', async (exec: any, next: () => Promise<any>) => {
    const session = exec.agent?.session
    if (!session) return next()
    // Observe writes already in flight before making a permission decision.
    await queues.get(session.id)
    let state = read(session.id, session)
    // Subagent executions share this listener with their own session id, which
    // never has a stored record. Walk header.parentSession to the nearest
    // active ancestor guard and apply it read-only: inherited state is never
    // persisted and carries no revision of its own.
    let inherited: { parentId: string; revision: number; mode: string; engine: 'local' | 'jev' } | undefined
    if (!state.active) {
      let header = session.header
      for (let depth = 0; header && depth < 16; depth += 1) {
        const parentId: unknown = header.parentSession
        if (typeof parentId !== 'string' || !parentId) break
        const parent = ctx.sessions.get(parentId)
        if (!parent) break
        const parentState = read(parentId, parent)
        if (parentState.active) {
          state = parentState
          inherited = { parentId, revision: parentState.revision, mode: parentState.mode, engine: parentState.engine }
          break
        }
        header = parent.header
      }
    }
    if (!state.active) return next()
    const workspace = session.header.cwd ?? process.cwd()
    const args = exec.arguments && typeof exec.arguments === 'object' ? exec.arguments : {}
    const required = classifyTool(exec.name, args, { workspace, cwd: workspace })
    if (required === undefined) return next()
    const denied = (message: string) => ({ content: [{ type: 'text', text: `Error: ${message}` }], isError: true, error: { message, info: { name: 'BashGuardError', code: BASH_GUARD_DENIED } } })
    const policyStillCurrent = (): boolean => {
      if (!inherited) {
        const current = read(session.id)
        return ctx.sessions.get(session.id) === session && current.revision === state.revision && current.active
      }
      let header = session.header
      for (let depth = 0; header && depth < 16; depth += 1) {
        const parentId: unknown = header.parentSession
        if (typeof parentId !== 'string' || !parentId) return false
        const parent = ctx.sessions.get(parentId)
        if (!parent) return false
        const parentState = read(parentId, parent)
        if (parentState.active) {
          return parentState.revision === inherited.revision
            && parentState.mode === inherited.mode && parentState.engine === inherited.engine
        }
        header = parent.header
      }
      return false
    }
    // 7777 grants every bit: fully allow without any review, Jev or local.
    if (state.mode === '7777') return next()
    const localAllowed = allows(state.mode, required)
    let finalRequired = required
    let decision: GuardDecision = { source: 'local', fallback: false, allowed: localAllowed }
    if (state.engine === 'jev') {
      await settingsQueue
      await queues.get(session.id)
      if (!policyStillCurrent()) {
        return denied('Bash Guard configuration changed before evaluation; retry with the current policy.')
      }
      const settings = readSettings()
      const cwd = exec.name.toLowerCase() === 'bash' && typeof args.workdir === 'string' ? path.resolve(workspace, args.workdir) : workspace
      const input = prepareState({ tool: exec.name, workspace, cwd, arguments: args })
      // Suppressed input (secrets, oversized, unparseable) never leaves the
      // machine: like any Jev outage, the local bit rules decide.
      decision = input === undefined
        ? { source: 'local', fallback: true, allowed: localAllowed }
        : await evaluate(settings, input).then(
            result => { finalRequired = result.required; return { source: 'jev', fallback: false, allowed: allows(state.mode, result.required) } },
            () => ({ source: 'local', fallback: true, allowed: localAllowed }))
      // Wait for mutations begun during the request, then re-resolve the whole
      // policy synchronously immediately before next(): own revision for top
      // level sessions, the inherited ancestor chain for delegated children.
      await queues.get(session.id)
      await settingsQueue
      if (!policyStillCurrent() || readSettings().revision !== settings.revision) {
        decisions.set(session.id, { ...decision, allowed: false })
        return denied('Bash Guard configuration changed during evaluation; retry the operation with the current policy.')
      }
    }
    decisions.set(session.id, decision)
    if (decision.allowed) return next() // Never replace or override downstream denials.
    // Both engines report the same artifact: a required-mode number that the
    // shared bit comparison evaluated against the configured mode.
    const detail = decision.fallback ? ', fallback=local' : decision.source === 'jev' ? ', decision=deny' : ''
    return denied(`command blocked by bash safety policy (source=${decision.source}${detail}; required=${finalRequired} allowed=${state.mode}; mode=system/external/network/workspace bits=4:read,2:write,1:execute). Adjust Bash Guard in the permission menu; do not bypass this policy.`)
  })
}
