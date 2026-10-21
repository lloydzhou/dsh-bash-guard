import { createGuardEditor } from './GuardEditor.js'
import { createJevSettings } from './JevSettings.js'
import { BASH_GUARD_NS, zh, en, defaultT, localeError } from './locales.js'

// A missing guard service must never hide the host's native permission choices.
export const inject = ['sessions', 'slots', 'locale', 'remote', 'remote.permissionPresets']

export function commandResult(reply, t = defaultT) {
  if (!reply?.ok) throw (reply?.error?.message ? new Error(reply?.error?.message) : localeError(t, 'error.permissionRequest'))
  if (!reply.value?.matched) throw localeError(t, 'error.permissionCommand')
  const result = reply.value.result
  if (result?.kind === 'error') throw (result.text ? new Error(result.text) : localeError(t, 'error.permissionRequest'))
  return result
}

export function decodeGuardState(reply, t = defaultT) {
  if (!reply?.ok) throw (reply?.error?.message ? new Error(reply?.error?.message) : localeError(t, 'error.unavailable'))
  const state = reply.value
  if (!/^[0-7]{4}$(?![\s\S])/.test(state?.mode) || typeof state.active !== 'boolean' || !Number.isSafeInteger(state.revision) || state.revision < 0) {
    throw localeError(t, 'error.invalidState')
  }
  const engine = state.engine === undefined ? 'local' : state.engine
  if (!['local', 'jev'].includes(engine)) throw localeError(t, 'error.invalidState')
  const decision = state.decision
  if (decision !== undefined && (!decision || !['local', 'jev'].includes(decision.source) || typeof decision.fallback !== 'boolean' || typeof decision.allowed !== 'boolean')) throw localeError(t, 'error.invalidState')
  return { mode: state.mode, active: state.active, revision: state.revision, engine,
    ...(state.inherited === true ? { inherited: true } : {}),
    ...(decision === undefined ? {} : { decision: { source: decision.source, fallback: decision.fallback, allowed: decision.allowed } }) }
}

export function decodeSettings(reply, t = defaultT) {
  if (!reply?.ok) throw localeError(t, 'error.settingsRequest')
  const value = reply.value
  if (!value || typeof value.endpoint !== 'string' || typeof value.model !== 'string' || !Number.isSafeInteger(value.timeoutMs) || value.timeoutMs <= 0 || typeof value.hasApiKey !== 'boolean' || !Number.isSafeInteger(value.revision) || value.revision < 0) throw localeError(t, 'error.invalidSettings')
  if (value.proxyUrl !== undefined && typeof value.proxyUrl !== 'string') throw localeError(t, 'error.invalidSettings')
  return { endpoint: value.endpoint, model: value.model, timeoutMs: value.timeoutMs, proxyUrl: value.proxyUrl ?? '', hasApiKey: value.hasApiKey, revision: value.revision }
}
export function settingsTestError(cause, t = defaultT) {
  // Host RPC may reject instead of returning an {ok:false} envelope.
  // Expose only whitelisted codes, never arbitrary error text or credentials.
  const text = [cause?.message, cause?.error?.message, cause?.cause?.message].filter(value => typeof value === 'string').join(' ')
  const code = text.match(/\bJEV_(?:HTTP_\d{3}|MISSING_KEY|INPUT_TOO_LARGE|INVALID_RESPONSE|TIMEOUT|NETWORK_OR_RESPONSE|ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ETIMEDOUT|UND_ERR_CONNECT_TIMEOUT|CERT_HAS_EXPIRED|UNABLE_TO_VERIFY_LEAF_SIGNATURE|DEPTH_ZERO_SELF_SIGNED_CERT)\b/)?.[0]
  return Object.assign(localeError(t, 'error.settingsTest'), { diagnostic: code ?? 'JEV_RPC_OR_CONFIG' })
}
export function decodeSettingsTest(reply, t = defaultT) {
  if (!reply?.ok) throw settingsTestError(reply, t)
  if (reply.value?.ok !== true || typeof reply.value.model !== 'string') throw localeError(t, 'error.invalidSettings')
  return { ok: true, model: reply.value.model }
}
export function parseSettingsRequest(value, save = true, t = defaultT) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw localeError(t, 'error.invalidSettings')
  const result = {}
  for (const key of ['endpoint', 'model', 'timeoutMs']) {
    if (value[key] === undefined && !save) continue
    if (key === 'timeoutMs' ? !Number.isSafeInteger(value[key]) || value[key] <= 0 : typeof value[key] !== 'string' || !value[key].trim()) throw localeError(t, 'error.invalidSettings')
    result[key] = value[key]
  }
  if (value.proxyUrl !== undefined) {
    if (typeof value.proxyUrl !== 'string') throw localeError(t, 'error.invalidSettings')
    result.proxyUrl = value.proxyUrl
  }
  if (value.apiKey !== undefined) {
    if (typeof value.apiKey !== 'string') throw localeError(t, 'error.invalidSettings')
    result.apiKey = value.apiKey
  }
  if (save) {
    if (!Number.isSafeInteger(value.revision) || value.revision < 0) throw localeError(t, 'error.invalidSettings')
    result.revision = value.revision
  }
  return result
}

export function createGuardTransport(remote, sessionId, sessionFor, t = defaultT) {
  const guard = () => {
    if (!remote.bashGuard) throw localeError(t, 'error.unavailable')
    return remote.bashGuard
  }
  return {
    get: async () => decodeGuardState(await guard().get(sessionId), t),
    write: async (action, state, mode) => decodeGuardState(await guard().update(sessionId, {
      action, revision: state.revision, ...(mode === undefined ? {} : action === 'engine' ? { engine: mode } : { mode }),
    }), t),
    getSettings: async () => decodeSettings(await guard().getSettings(), t),
    saveSettings: async request => decodeSettings(await guard().saveSettings(parseSettingsRequest(request, true, t)), t),
    testSettings: async request => {
      try { return decodeSettingsTest(await guard().testSettings(parseSettingsRequest(request, false, t)), t) }
      catch (cause) { if (cause?.diagnostic) throw cause; throw settingsTestError(cause, t) }
    },
    // Deliberately independent of guard reads, readiness, and failures.
    preset: async id => {
      const live = sessionFor()
      if (!live) throw localeError(t, 'error.sessionNotReady')
      return commandResult(await live.command(`/permission ${id}`), t)
    },
    catalog: async () => {
      const reply = await remote.permissionPresets.catalog()
      if (!reply?.ok) throw (reply?.error?.message ? new Error(reply?.error?.message) : localeError(t, 'error.catalogUnavailable'))
      if (!Array.isArray(reply.value?.options)) throw localeError(t, 'error.invalidCatalog')
      return reply.value
    },
    subscribeCatalog: callback => remote.$on?.('permission-presets/catalog-changed', callback),
  }
}

const labels = { 'read-only': ['preset.readOnly', 'Read Only'], 'workspace-write': ['preset.workspaceWrite', 'Workspace Write'], 'danger-full-access': ['preset.fullAccess', 'Full access'] }

export function createPermissionControl(React, primitives) {
  const h = React.createElement
  const { Menu, RiskConfirmation, PermissionIconReadOnlyRegular, PermissionIconWorkspaceWriteRegular,
    PermissionIconFullAccessRegular, IconChevronDownOutlineRegular, IconShieldOutlineRegular } = primitives
  // Keep the host shield artwork; only the inner adjustment marks are plugin-owned.
  function GuardPermissionIcon() {
    return h('span', { className: 'dsh-bg-guard-icon', 'aria-hidden': true },
      h(IconShieldOutlineRegular),
      h('svg', { className: 'dsh-bg-guard-marks', viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1 },
        h('path', { d: 'M5 6.5h6M5 9.5h6M7 5.5v2M9.5 8.5v2', strokeLinecap: 'round' })))
  }
  const icons = { 'read-only': PermissionIconReadOnlyRegular, 'workspace-write': PermissionIconWorkspaceWriteRegular, 'danger-full-access': PermissionIconFullAccessRegular, 'bash-guard': GuardPermissionIcon }
  const GuardEditor = createGuardEditor(React, primitives.IconCheckOutlineRegular)
  const JevSettings = createJevSettings(React)
  return function PermissionControl({ sessionId, transport, locked, useProjection, t = defaultT }) {
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
    const [settingsOpen, setSettingsOpen] = React.useState(false)
    const settingsIntent = React.useRef(false), settingsReturnFocus = React.useRef(null), settingsChecking = React.useRef(false)
    const epoch = React.useRef(0), request = React.useRef(0), catalogRequest = React.useRef(0)
    const writing = React.useRef(false), nativeWriting = React.useRef(false)
    const stateRef = React.useRef(null), api = React.useRef(transport)
    api.current = transport
    const publish = next => { stateRef.current = next; setState(next) }
    const message = cause => cause?.localeKey ? t(cause.localeKey) : cause instanceof Error ? cause.message : String(cause)
    const read = async () => {
      if (writing.current) return
      const generation = epoch.current, ticket = ++request.current
      setPending(true)
      try {
        const next = await api.current.get()
        if (generation === epoch.current && ticket === request.current) { publish(next); setError('') }
      } catch (cause) {
        if (generation === epoch.current && ticket === request.current) { publish(null); setError(cause) }
      } finally { if (generation === epoch.current && ticket === request.current) setPending(false) }
    }
    const readCatalog = async () => {
      const generation = epoch.current, ticket = ++catalogRequest.current
      try {
        const next = await api.current.catalog()
        if (generation === epoch.current && ticket === catalogRequest.current) { setCatalog(next); setNativeError('') }
      } catch (cause) { if (generation === epoch.current && ticket === catalogRequest.current) setNativeError(cause) }
    }
    React.useEffect(() => {
      ++epoch.current; writing.current = false; nativeWriting.current = false
      publish(null); setCatalog(null); setOpen(false); setConfirmation(null); setPicking(false)
      setSettingsOpen(false); settingsIntent.current = false; settingsChecking.current = false
      readCatalog()
      const stop = api.current.subscribeCatalog?.(() => { setCatalog(null); readCatalog() })
      return () => { ++epoch.current; stop?.() }
    }, [sessionId])
    // No polling: refresh on opening and on authoritative permission projection changes.
    React.useEffect(() => { read(); if (open) readCatalog() }, [open, sessionId, selection])
    React.useEffect(() => {
      if (locked || (confirmation !== null && confirmation !== 'bash-guard' && catalog !== null && !catalog.options.some(option => option.value === confirmation))) {
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
          setError(cause)
          try { const next = await api.current.get(); if (generation === epoch.current) publish(next) } catch { if (generation === epoch.current) publish(null) }
        }
      } finally { if (generation === epoch.current) {
        writing.current = false; setPending(false)
        if (focusedSegment) requestAnimationFrame(() => {
          if (generation === epoch.current && focusedSegment.isConnected && !focusedSegment.disabled && document.activeElement === document.body) focusedSegment.focus()
        })
      } }
    }
    const showSettings = (intent = false) => {
      settingsIntent.current = intent
      settingsReturnFocus.current = document.activeElement
      setOpen(false); setSettingsOpen(true)
    }
    const chooseEngine = async engine => {
      if (locked || pending || settingsChecking.current) return
      if (engine === 'local') { submit('engine', engine); return }
      const generation = epoch.current
      settingsChecking.current = true
      try {
        const settings = await api.current.getSettings()
        if (generation !== epoch.current) return
        // Every new session opt-in sees the external-data disclosure before enabling.
        showSettings(true)
      } catch (cause) { if (generation === epoch.current) setError(cause) }
      finally { if (generation === epoch.current) settingsChecking.current = false }
    }
    const selectPreset = async id => {
      if (locked || nativeWriting.current) return
      const generation = epoch.current
      nativeWriting.current = true; setPicking(true); setNativeError('')
      try {
        await api.current.preset(id)
        if (generation === epoch.current) { publish(null); ++request.current; read() }
      } catch (cause) { if (generation === epoch.current) setNativeError(cause) }
      finally { if (generation === epoch.current) { nativeWriting.current = false; setPicking(false) } }
    }
    const choose = id => {
      if (locked || picking) return
      if (id === 'bash-guard') {
        if (!pending && state && !state.active) { setOpen(false); setAcknowledged(false); setConfirmation('bash-guard') }
        return
      }
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
    const label = current === 'bash-guard' ? `Bash Guard ${state.mode}` : (current ? labelFor(current, option?.name) : t('permission'))
    const items = (catalog?.options || []).map(option => ({
      id: option.value, icon: icon(option.value),
      label: option.value === 'auto' ? h('span', { className: 'dsh-bg-option-label', 'aria-label': `${t('auto.label')} ${t('auto.badge')}` }, t('auto.label'), h('sup', { className: 'dsh-bg-badge' }, t('auto.badge'))) : labelFor(option.value, option.name),
      disabled: !!locked || picking,
    }))
    items.push({ id: 'guard-separator', type: 'separator' }, {
      id: 'bash-guard', icon: icon('bash-guard'), disabled: !!locked || !state,
      label: h('span', null, t('guard.custom'), state && h('span', { className: 'dsh-bg-mode' }, ` ${state.mode}`)),
    })
    const closeConfirmation = () => { setConfirmation(null); setAcknowledged(false) }
    const riskPrefix = confirmation === 'bash-guard' ? 'guard.confirm.' : confirmation === 'auto' ? 'auto.confirm.' : 'confirm.'
    return h(React.Fragment, null,
      h(Menu, { open, items, selectedId: current, onSelect: choose, onClose: () => setOpen(false), side: 'top', portal: true,
        anchor: h('button', { type: 'button', className: 'dsh-bg-trigger', disabled: !!locked || picking || confirmation !== null,
          'aria-label': t('mode', { name: label }), 'aria-haspopup': 'menu', 'aria-expanded': open,
          title: current === 'auto' ? t('auto.description') : option?.description, onClick: () => setOpen(!open),
        }, icon(current) && h('span', { className: 'dsh-bg-trigger-icon', 'aria-hidden': true }, icon(current)),
        h('span', { className: 'dsh-bg-trigger-label' }, label), current === 'auto' && h('sup', { className: 'dsh-bg-badge' }, t('auto.badge')),
        h('span', { className: `dsh-bg-chevron${open ? ' dsh-bg-chevron-open' : ''}`, 'aria-hidden': true }, h(IconChevronDownOutlineRegular))),
      }, state && h(GuardEditor, { mode: state.mode, active: state.active, engine: state.engine, decision: state.decision, pending, locked, inherited: state.inherited === true, t,
        onEngineChange: chooseEngine, onSettings: () => showSettings(false),
        onModeChange: mode => submit('mode', mode),
        onChange: (row, digit) => submit('mode', stateRef.current.mode.slice(0, row) + digit + stateRef.current.mode.slice(row + 1)),
      }), h('span', { className: 'dsh-bg-sr-only', role: 'status' }, pending ? t('syncing') : ''),
      error && h('div', { className: 'dsh-bg-error', role: 'alert' }, message(error), h('button', { type: 'button', disabled: pending, onClick: read }, t('retry'))),
      nativeError && h('div', { className: 'dsh-bg-error', role: 'alert' }, message(nativeError), h('button', { type: 'button', onClick: readCatalog }, t('retry')))),
      settingsOpen && h(JevSettings, { key: sessionId, transport, t, locked, enableIntent: settingsIntent.current, returnFocus: settingsReturnFocus.current,
        onClose: () => { settingsIntent.current = false; setSettingsOpen(false) },
        onSaved: settings => {
          const enable = settingsIntent.current && settings.hasApiKey
          settingsIntent.current = false; setSettingsOpen(false)
          if (enable && stateRef.current?.active) submit('engine', 'jev')
        },
      }),
      confirmation !== null && h(RiskConfirmation, { open: true, title: t(`${riskPrefix}title`), description: t(`${riskPrefix}description`),
        acknowledgeLabel: t(`${riskPrefix}acknowledge`), cancelLabel: t('confirm.cancel'), closeLabel: t('close'), confirmLabel: t(`${riskPrefix}enable`),
        acknowledged, disabled: !!locked || picking, onAcknowledgedChange: setAcknowledged, onCancel: closeConfirmation,
        onConfirm: () => {
          if (!acknowledged || locked || picking || pending) return
          const id = confirmation; closeConfirmation()
          if (id === 'bash-guard') { setOpen(true); submit('activate') } else selectPreset(id)
        },
      }))
  }
}

// Client-owned Typert contribution: mount the namespace before rendering the seat.
// Structural schemas keep this artifact on host modules (no bundled Zod/React).
export function createGuardRemoteContribution(t = key => key === 'error.sessionId' || key === 'error.invalidUpdate' ? en[key] : defaultT(key)) {
  return {
    package: 'dsh-bash-guard',
    descriptors: ['get', 'update'].map(method => ({
      id: `dsh-bash-guard#bashGuard/${method}`, service: 'bashGuard', namespace: 'bashGuard', method,
      invocation: { kind: 'direct' },
      parameters: [
        { name: 'sessionId', wire: 'sessionId', source: 'json', codec: { mode: 'strict', typeSymbol: 'dsh-bash-guard#SessionId', create: () => ({ parse(value) {
          if (typeof value !== 'string' || !value.trim()) throw localeError(t, 'error.sessionId')
          return value
        } }) } },
        ...(method === 'update' ? [{ name: 'request', wire: 'request', source: 'json', codec: { mode: 'strict', typeSymbol: 'dsh-bash-guard#GuardUpdate', create: () => ({ parse(value) {
          if (!value || !['activate', 'mode', 'deactivate', 'engine'].includes(value.action) || !Number.isSafeInteger(value.revision) || value.revision < 0 || (value.mode !== undefined && !/^[0-7]{4}$(?![\s\S])/.test(value.mode)) || (value.action === 'mode' && value.mode === undefined) || (value.engine !== undefined && !['local', 'jev'].includes(value.engine)) || (value.action === 'engine' && value.engine === undefined)) throw localeError(t, 'error.invalidUpdate')
          return { action: value.action, revision: value.revision, ...(value.mode === undefined ? {} : { mode: value.mode }), ...(value.engine === undefined ? {} : { engine: value.engine }) }
        } }) } }] : []),
      ],
      result: { mode: 'strict', typeSymbol: 'dsh-bash-guard#GuardRecord', create: () => ({ parse: value => decodeGuardState({ ok: true, value }, t) }) },
    })).concat(['getSettings', 'saveSettings', 'testSettings'].map(method => ({
      id: `dsh-bash-guard#bashGuard/${method}`, service: 'bashGuard', namespace: 'bashGuard', method,
      invocation: { kind: 'direct' },
      parameters: method === 'getSettings' ? [] : [{ name: 'request', wire: 'request', source: 'json', codec: {
        mode: 'strict', typeSymbol: `dsh-bash-guard#${method === 'saveSettings' ? 'SaveSettingsRequest' : 'TestSettingsRequest'}`,
        create: () => ({ parse: value => parseSettingsRequest(value, method === 'saveSettings', t) }),
      } }],
      result: { mode: 'strict', typeSymbol: `dsh-bash-guard#${method === 'testSettings' ? 'TestSettingsResult' : 'PublicSettings'}`,
        create: () => ({ parse: value => (method === 'testSettings' ? decodeSettingsTest : decodeSettings)({ ok: true, value }, t) }),
      },
    }))),
  }
}
export const guardRemoteContribution = createGuardRemoteContribution()

export async function apply(ctx) {
  ctx.effect(() => ctx.locale.register(BASH_GUARD_NS, { zh, en }), 'bash-guard: dictionaries')
  const t = ctx.locale.bind(BASH_GUARD_NS)
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
      name: 'conversation.input.permission', priority: -100, locale: BASH_GUARD_NS,
      inject: sessionId => ({ sessionId, transport: createGuardTransport(remote, sessionId, () => scope.sessions.binding(sessionId)?.session, t) }),
    }, Control))
  }
  // Leave the host seat intact while the injected guard namespace resolves.
  // On mount failure, native choices still work through the guard-free adapter.
  try {
    await ctx.remote.$mount(createGuardRemoteContribution(t))
  } catch (error) {
    console.warn(t('error.rpcUnavailable'), error)
    register(ctx, undefined)
    return
  }
  ctx.inject(['remote.bashGuard'], child => register(child, child.remote.bashGuard))
}
