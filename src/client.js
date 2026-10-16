import { createGuardEditor } from './GuardEditor.js'

// A missing guard service must never hide the host's native permission choices.
export const inject = ['sessions', 'slots', 'remote', 'remote.permissionPresets']

export function commandResult(reply) {
  if (!reply?.ok) throw new Error(reply?.error?.message || '权限请求失败')
  if (!reply.value?.matched) throw new Error('宿主未提供此权限命令')
  const result = reply.value.result
  if (result?.kind === 'error') throw new Error(result.text || '权限请求失败')
  return result
}

export function decodeGuardState(reply) {
  if (!reply?.ok) throw new Error(reply?.error?.message || 'Bash Guard 不可用')
  const state = reply.value
  if (!/^[0-7]{4}$(?![\s\S])/.test(state?.mode) || typeof state.active !== 'boolean' || !Number.isSafeInteger(state.revision) || state.revision < 0) {
    throw new Error('Bash Guard 返回了无效状态')
  }
  return { mode: state.mode, active: state.active, revision: state.revision }
}

export function createGuardTransport(remote, sessionId, sessionFor) {
  const guard = () => {
    if (!remote.bashGuard) throw new Error('Bash Guard 不可用')
    return remote.bashGuard
  }
  return {
    get: async () => decodeGuardState(await guard().get(sessionId)),
    write: async (action, state, mode) => decodeGuardState(await guard().update(sessionId, {
      action, revision: state.revision, ...(mode === undefined ? {} : { mode }),
    })),
    // Deliberately independent of guard reads, readiness, and failures.
    preset: async id => {
      const live = sessionFor()
      if (!live) throw new Error('会话尚未就绪，请稍后重试')
      return commandResult(await live.command(`/permission ${id}`))
    },
    catalog: async () => {
      const reply = await remote.permissionPresets.catalog()
      if (!reply?.ok) throw new Error(reply?.error?.message || '权限列表不可用')
      if (!Array.isArray(reply.value?.options)) throw new Error('权限列表无效')
      return reply.value
    },
    subscribeCatalog: callback => remote.$on?.('permission-presets/catalog-changed', callback),
  }
}

const copy = {
  'preset.readOnly': '仅可查看', 'preset.workspaceWrite': '工作区内修改', 'preset.fullAccess': '完全权限',
  'close': '关闭', 'confirm.cancel': '取消',
  'confirm.title': '确认启用完全权限？',
  'confirm.description': '启用完全权限后，智能体将减少确认步骤，并且可以直接执行更多操作，包括敏感操作、文件修改或外部命令。仅建议在你信任当前任务时使用。',
  'confirm.acknowledge': '我已了解风险，并愿意继续', 'confirm.enable': '启用完全权限',
  'auto.label': 'Auto review', 'auto.badge': 'EXP',
  'auto.description': '无沙箱运行；每次原生工具调用和 PTC 内层调用前由同一模型进行实验性审查。',
  'auto.confirm.title': '确认启用 Auto review（实验）？',
  'auto.confirm.description': 'Auto review 不使用沙箱。每次原生工具调用和 PTC 内层调用前，都会由与当前 agent 相同的模型进行审查；审查拒绝的调用由你批准或拒绝。此功能仍属实验性，可能误放行或误拒绝，并会消耗额外 token。',
  'auto.confirm.acknowledge': '我已了解这些风险，并愿意继续', 'auto.confirm.enable': '启用 Auto review',
}
const labels = { 'read-only': ['preset.readOnly', 'Read Only'], 'workspace-write': ['preset.workspaceWrite', 'Workspace Write'], 'danger-full-access': ['preset.fullAccess', 'Full access'] }

export function createPermissionControl(React, primitives) {
  const h = React.createElement
  const { Menu, RiskConfirmation, PermissionIconReadOnlyRegular, PermissionIconWorkspaceWriteRegular,
    PermissionIconFullAccessRegular, IconChevronDownOutlineRegular, IconSettingsOutlineRegular } = primitives
  const icons = { 'read-only': PermissionIconReadOnlyRegular, 'workspace-write': PermissionIconWorkspaceWriteRegular, 'danger-full-access': PermissionIconFullAccessRegular, 'bash-guard': IconSettingsOutlineRegular }
  const GuardEditor = createGuardEditor(React, primitives.IconCheckOutlineRegular)
  return function PermissionControl({ sessionId, transport, locked, useProjection, t = key => copy[key] }) {
    const selection = useProjection('permissions')
    const [state, setState] = React.useState(null)
    const [catalog, setCatalog] = React.useState(null)
    const [open, setOpen] = React.useState(false)
    const [pending, setPending] = React.useState(false)
    const [error, setError] = React.useState('')
    const [nativeError, setNativeError] = React.useState('')
    const [confirmation, setConfirmation] = React.useState(null)
    const [acknowledged, setAcknowledged] = React.useState(false)
    const [picking, setPicking] = React.useState(false)
    const epoch = React.useRef(0), request = React.useRef(0), catalogRequest = React.useRef(0)
    const writing = React.useRef(false), nativeWriting = React.useRef(false)
    const stateRef = React.useRef(null), api = React.useRef(transport)
    api.current = transport
    const publish = next => { stateRef.current = next; setState(next) }
    const message = cause => cause instanceof Error ? cause.message : String(cause)
    const read = async () => {
      if (writing.current) return
      const generation = epoch.current, ticket = ++request.current
      setPending(true)
      try {
        const next = await api.current.get()
        if (generation === epoch.current && ticket === request.current) { publish(next); setError('') }
      } catch (cause) {
        if (generation === epoch.current && ticket === request.current) { publish(null); setError(message(cause)) }
      } finally { if (generation === epoch.current && ticket === request.current) setPending(false) }
    }
    const readCatalog = async () => {
      const generation = epoch.current, ticket = ++catalogRequest.current
      try {
        const next = await api.current.catalog()
        if (generation === epoch.current && ticket === catalogRequest.current) { setCatalog(next); setNativeError('') }
      } catch (cause) { if (generation === epoch.current && ticket === catalogRequest.current) setNativeError(message(cause)) }
    }
    React.useEffect(() => {
      ++epoch.current; writing.current = false; nativeWriting.current = false
      publish(null); setCatalog(null); setOpen(false); setConfirmation(null); setPicking(false)
      readCatalog()
      const stop = api.current.subscribeCatalog?.(() => { setCatalog(null); readCatalog() })
      return () => { ++epoch.current; stop?.() }
    }, [sessionId])
    // No polling: refresh on opening and on authoritative permission projection changes.
    React.useEffect(() => { read(); if (open) readCatalog() }, [open, sessionId, selection])
    React.useEffect(() => {
      if (locked || (confirmation !== null && catalog !== null && !catalog.options.some(option => option.value === confirmation))) {
        setOpen(false); setConfirmation(null); setAcknowledged(false)
      }
    }, [locked, catalog, confirmation])
    const submit = async (action, mode) => {
      if (locked || writing.current || !stateRef.current) return
      const generation = epoch.current
      const focusedSegment = document.activeElement?.matches?.('.dsh-bg-level') ? document.activeElement : null
      ++request.current; writing.current = true; setPending(true); setError('')
      try {
        const next = await api.current.write(action, stateRef.current, mode)
        if (generation === epoch.current) publish(next)
      } catch (cause) {
        if (generation === epoch.current) {
          setError(message(cause))
          try { const next = await api.current.get(); if (generation === epoch.current) publish(next) } catch { if (generation === epoch.current) publish(null) }
        }
      } finally { if (generation === epoch.current) {
        writing.current = false; setPending(false)
        if (focusedSegment) requestAnimationFrame(() => {
          if (generation === epoch.current && focusedSegment.isConnected && !focusedSegment.disabled && document.activeElement === document.body) focusedSegment.focus()
        })
      } }
    }
    const selectPreset = async id => {
      if (locked || nativeWriting.current) return
      const generation = epoch.current
      nativeWriting.current = true; setPicking(true); setNativeError('')
      try {
        await api.current.preset(id)
        if (generation === epoch.current) { publish(null); ++request.current; read() }
      } catch (cause) { if (generation === epoch.current) setNativeError(message(cause)) }
      finally { if (generation === epoch.current) { nativeWriting.current = false; setPicking(false) } }
    }
    const choose = id => {
      if (locked || picking) return
      if (id === 'bash-guard') { if (!pending && !state?.active) submit('activate'); return }
      if (!catalog?.options.some(option => option.value === id)) return
      setOpen(false)
      if (id === selection?.currentValue && !state?.active) return
      if (id === 'danger-full-access' || id === 'auto') { setAcknowledged(false); setConfirmation(id); return }
      selectPreset(id)
    }
    const labelFor = (value, name = value) => {
      if (value === 'auto') return t('auto.label')
      const builtin = labels[value]
      if (builtin && (name === value || name === builtin[1])) return t(builtin[0])
      return /^[a-z0-9]+(-[a-z0-9]+)*$/.test(name) ? name.split('-').map(word => word[0].toUpperCase() + word.slice(1)).join(' ') : name
    }
    const icon = id => icons[id] ? h(icons[id]) : undefined
    const current = state?.active ? 'bash-guard' : selection?.currentValue
    const option = catalog?.options.find(item => item.value === current)
    const label = current === 'bash-guard' ? `bash-guard ${state.mode}` : labelFor(current || '权限', option?.name)
    const items = (catalog?.options || []).map(option => ({
      id: option.value, icon: icon(option.value),
      label: option.value === 'auto' ? h('span', { className: 'dsh-bg-option-label', 'aria-label': `${t('auto.label')} ${t('auto.badge')}` }, t('auto.label'), h('sup', { className: 'dsh-bg-badge' }, t('auto.badge'))) : labelFor(option.value, option.name),
      disabled: !!locked || picking,
    }))
    items.push({ id: 'guard-separator', type: 'separator' }, {
      id: 'bash-guard', icon: icon('bash-guard'), disabled: !!locked || !state,
      label: h('span', null, 'bash-guard 自定义', state && h('span', { className: 'dsh-bg-mode' }, ` ${state.mode}`)),
    })
    const closeConfirmation = () => { setConfirmation(null); setAcknowledged(false) }
    const riskPrefix = confirmation === 'auto' ? 'auto.confirm.' : 'confirm.'
    return h(React.Fragment, null,
      h(Menu, { open, items, selectedId: current, onSelect: choose, onClose: () => setOpen(false), side: 'top', portal: true,
        anchor: h('button', { type: 'button', className: 'dsh-bg-trigger', disabled: !!locked || picking || confirmation !== null,
          'aria-label': `访问模式，当前：${label}`, 'aria-haspopup': 'menu', 'aria-expanded': open,
          title: current === 'auto' ? t('auto.description') : option?.description, onClick: () => setOpen(!open),
        }, icon(current) && h('span', { className: 'dsh-bg-trigger-icon', 'aria-hidden': true }, icon(current)),
        h('span', { className: 'dsh-bg-trigger-label' }, label), current === 'auto' && h('sup', { className: 'dsh-bg-badge' }, t('auto.badge')),
        h('span', { className: `dsh-bg-chevron${open ? ' dsh-bg-chevron-open' : ''}`, 'aria-hidden': true }, h(IconChevronDownOutlineRegular))),
      }, state && h(GuardEditor, { mode: state.mode, active: state.active, pending, locked,
        onModeChange: mode => submit('mode', mode),
        onChange: (row, digit) => submit('mode', stateRef.current.mode.slice(0, row) + digit + stateRef.current.mode.slice(row + 1)),
      }), h('span', { className: 'dsh-bg-sr-only', role: 'status' }, pending ? '正在同步权限' : ''),
      error && h('div', { className: 'dsh-bg-error', role: 'alert' }, error, h('button', { type: 'button', disabled: pending, onClick: read }, '重试')),
      nativeError && h('div', { className: 'dsh-bg-error', role: 'alert' }, nativeError, h('button', { type: 'button', onClick: readCatalog }, '重试'))),
      confirmation !== null && h(RiskConfirmation, { open: true, title: t(`${riskPrefix}title`), description: t(`${riskPrefix}description`),
        acknowledgeLabel: t(`${riskPrefix}acknowledge`), cancelLabel: t('confirm.cancel'), closeLabel: t('close'), confirmLabel: t(`${riskPrefix}enable`),
        acknowledged, disabled: !!locked || picking, onAcknowledgedChange: setAcknowledged, onCancel: closeConfirmation,
        onConfirm: () => { if (!acknowledged || locked || picking) return; const id = confirmation; closeConfirmation(); selectPreset(id) },
      }))
  }
}

// Client-owned Typert contribution: mount the namespace before rendering the seat.
// Structural schemas keep this artifact on host modules (no bundled Zod/React).
export const guardRemoteContribution = {
  package: 'dsh-bash-guard',
  descriptors: ['get', 'update'].map(method => ({
    id: `dsh-bash-guard#bashGuard/${method}`, service: 'bashGuard', namespace: 'bashGuard', method,
    invocation: { kind: 'direct' },
    parameters: [
      { name: 'sessionId', wire: 'sessionId', source: 'json', codec: { mode: 'strict', typeSymbol: 'dsh-bash-guard#SessionId', create: () => ({ parse(value) {
        if (typeof value !== 'string' || !value.trim()) throw new Error('A session ID is required')
        return value
      } }) } },
      ...(method === 'update' ? [{ name: 'request', wire: 'request', source: 'json', codec: { mode: 'strict', typeSymbol: 'dsh-bash-guard#GuardUpdate', create: () => ({ parse(value) {
        if (!value || !['activate', 'mode', 'deactivate'].includes(value.action) || !Number.isSafeInteger(value.revision) || value.revision < 0 || (value.mode !== undefined && !/^[0-7]{4}$(?![\s\S])/.test(value.mode)) || (value.action === 'mode' && value.mode === undefined)) throw new Error('Invalid Bash Guard update')
        return { action: value.action, revision: value.revision, ...(value.mode === undefined ? {} : { mode: value.mode }) }
      } }) } }] : []),
    ],
    result: { mode: 'strict', typeSymbol: 'dsh-bash-guard#GuardRecord', create: () => ({ parse: value => decodeGuardState({ ok: true, value }) }) },
  })),
}

export async function apply(ctx) {
  // Resolve host modules inside apply: the browser loader owns React and styles.
  const React = require('react')
  const primitives = require('@deepseek-ai/dsh-client-ui-primitives')
  const Control = createPermissionControl(React, primitives)
  const register = (scope, guard) => {
    // Only the injected child may read the guarded Cordis service. The adapter
    // also makes missing-guard reads ordinary errors rather than proxy violations.
    const remote = {
      bashGuard: guard,
      permissionPresets: scope.remote.permissionPresets,
      $on: (event, listener) => scope.remote.$on(event, listener),
    }
    scope.slots.inject('conversation.input.permission', () => scope.slots.register({
      name: 'conversation.input.permission', priority: -100, locale: 'permission.access',
      inject: sessionId => ({ sessionId, transport: createGuardTransport(remote, sessionId, () => scope.sessions.binding(sessionId)?.session) }),
    }, Control))
  }
  // Leave the host seat intact while the injected guard namespace resolves.
  // On mount failure, native choices still work through the guard-free adapter.
  try {
    await ctx.remote.$mount(guardRemoteContribution)
  } catch (error) {
    console.warn('Bash Guard RPC unavailable', error)
    register(ctx, undefined)
    return
  }
  ctx.inject(['remote.bashGuard'], child => register(child, child.remote.bashGuard))
}
