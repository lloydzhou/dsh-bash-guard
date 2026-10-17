import { defaultT } from './locales.js'

// Empty password means preserve; clearing a saved credential is an explicit action.
export function settingsDraftRequest(draft, settings, save = false) {
  return { endpoint: draft.endpoint, model: draft.model, timeoutMs: Number(draft.timeoutMs),
    ...(draft.proxyUrl === undefined ? {} : { proxyUrl: draft.proxyUrl }),
    ...(draft.clearKey ? { apiKey: '' } : draft.apiKey ? { apiKey: draft.apiKey } : {}),
    ...(save ? { revision: settings.revision } : {}) }
}

export function createJevSettings(React) {
  const h = React.createElement
  return function JevSettings({ transport, onClose, onSaved, returnFocus, locked = false, enableIntent = false, t = defaultT }) {
    const dialog = React.useRef(null), alive = React.useRef(true), busy = React.useRef(false)
    const callbacks = React.useRef({ onClose, onSaved }); callbacks.current = { onClose, onSaved }
    const [settings, setSettings] = React.useState(null)
    const [draft, setDraft] = React.useState({ endpoint: '', model: '', timeoutMs: 4000, proxyUrl: '', apiKey: '', clearKey: false })
    const [pending, setPending] = React.useState('load')
    const [error, setError] = React.useState('')
    const [tested, setTested] = React.useState(false)
    const uid = React.useId()
    const load = async () => {
      if (busy.current) return
      busy.current = true; setPending('load'); setError('')
      try {
        const value = await transport.getSettings()
        if (!alive.current) return
        setSettings(value)
        setDraft({ endpoint: value.endpoint, model: value.model, timeoutMs: value.timeoutMs, proxyUrl: value.proxyUrl ?? '', apiKey: '', clearKey: false })
        setTested(false)
      } catch { if (alive.current) setError('error.settingsRequest') }
      finally { if (alive.current) { busy.current = false; setPending('') } }
    }
    React.useEffect(() => {
      alive.current = true
      const element = dialog.current
      // The browser top layer supplies background inertness and modal focus containment.
      element.showModal()
      element.querySelector('[data-settings-close]')?.focus()
      load()
      return () => {
        alive.current = false
        element.close()
        const target = returnFocus?.isConnected ? returnFocus : document.querySelector('.dsh-bg-trigger')
        target?.focus()
      }
    }, [])
    const update = (key, value) => { setDraft(previous => ({ ...previous, [key]: value })); setTested(false); setError('') }
    const perform = async save => {
      if (busy.current || !settings || locked) return
      busy.current = true; setPending(save ? 'save' : 'test'); setError(''); setTested(false)
      try {
        const request = settingsDraftRequest(draft, settings, save)
        const result = await (save ? transport.saveSettings(request) : transport.testSettings(request))
        if (!alive.current) return
        if (save) {
          setDraft(previous => ({ ...previous, apiKey: '' }))
          callbacks.current.onSaved(result)
        } else setTested(true)
      } catch (cause) { if (alive.current) setError({ key: save ? 'error.settingsSave' : 'error.settingsTest', diagnostic: /^JEV_[A-Z0-9_]+$/.test(cause?.diagnostic ?? '') ? cause.diagnostic : 'JEV_RPC_OR_CONFIG' }) }
      finally { if (alive.current) { busy.current = false; setPending('') } }
    }
    const field = (key, label, props = {}) => h('label', { className: 'dsh-bg-settings-field' },
      h('span', null, t(label)), h('input', { value: draft[key], onChange: event => update(key, event.target.value), ...props }))
    return h('dialog', { ref: dialog, className: 'dsh-bg-settings', 'aria-labelledby': `${uid}-title`, 'aria-describedby': `${uid}-scope`,
      onCancel: event => { event.preventDefault(); callbacks.current.onClose() },
      onKeyDown: event => {
        event.stopPropagation()
        // Explicit wrapping also keeps focus correct in embedded browser hosts.
        if (event.key !== 'Tab') return
        const items = [...dialog.current.querySelectorAll('button:not(:disabled), input:not(:disabled), summary, [tabindex="0"]')].filter(node => node.getClientRects().length)
        const first = items[0], last = items[items.length - 1]
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
      },
    }, h('header', { className: 'dsh-bg-settings-header' }, h('h2', { id: `${uid}-title` }, t('settings.title')),
      h('button', { type: 'button', 'data-settings-close': '', 'aria-label': t('close'), onClick: () => callbacks.current.onClose() }, '×')),
    h('p', { id: `${uid}-scope`, className: 'dsh-bg-settings-note' }, t('settings.scope')),
    h('form', { onSubmit: event => { event.preventDefault(); perform(true) } },
      !settings && h('div', { role: 'status' }, pending === 'load' ? t('settings.loading') : h('button', { type: 'button', onClick: load }, t('retry'))),
      settings && h('fieldset', { disabled: !!pending || locked, className: 'dsh-bg-settings-fields' },
        field('model', 'settings.model', { required: true, autoComplete: 'off' }),
        field('apiKey', 'settings.apiKey', { type: 'password', autoComplete: 'new-password', spellCheck: false, disabled: draft.clearKey,
          placeholder: t(settings.hasApiKey ? 'settings.keyConfigured' : 'settings.keyMissing'), 'aria-describedby': `${uid}-key-note` }),
        h('p', { id: `${uid}-key-note`, className: 'dsh-bg-settings-note' }, t('settings.keyNote')),
        settings.hasApiKey && h('label', { className: 'dsh-bg-settings-clear' }, h('input', { type: 'checkbox', checked: draft.clearKey, onChange: event => update('clearKey', event.target.checked) }), t('settings.clearKey')),
        h('details', { className: 'dsh-bg-settings-advanced' }, h('summary', null, t('settings.advanced')),
          field('endpoint', 'settings.endpoint', { type: 'url', required: true, autoComplete: 'off' }),
          h('p', { className: 'dsh-bg-settings-note' }, t('settings.endpointNote')),
          field('proxyUrl', 'settings.proxyUrl', { type: 'url', autoComplete: 'off', spellCheck: false, placeholder: 'http://127.0.0.1:7891', 'aria-describedby': `${uid}-proxy-note` }),
          h('p', { id: `${uid}-proxy-note`, className: 'dsh-bg-settings-note' }, t('settings.proxyNote')),
          field('timeoutMs', 'settings.timeout', { type: 'number', min: 100, max: 30000, step: 1, required: true })),
        h('p', { className: 'dsh-bg-settings-note' }, t('settings.disclosure')),
        h('p', { className: 'dsh-bg-settings-note' }, t('settings.fallback'))),
      error && h('p', { role: 'alert', className: 'dsh-bg-settings-message' }, typeof error === 'string' ? t(error) : `${t(error.key)} (${error.diagnostic})`),
      h('p', { role: 'status', 'aria-live': 'polite', className: 'dsh-bg-settings-message' }, pending === 'test' ? t('settings.testing') : pending === 'save' ? t('settings.saving') : tested ? t('settings.testSuccess') : ''),
      h('footer', { className: 'dsh-bg-settings-actions' },
        h('button', { type: 'button', disabled: !!pending || !settings || locked, onClick: () => perform(false) }, t('settings.test')),
        h('span', { className: 'dsh-bg-settings-spacer' }),
        h('button', { type: 'button', onClick: () => callbacks.current.onClose() }, t('confirm.cancel')),
        h('button', { type: 'submit', disabled: !!pending || !settings || locked || (enableIntent && (draft.clearKey || (!draft.apiKey && !settings?.hasApiKey))) }, t(enableIntent ? 'settings.saveEnable' : 'settings.save')))))
  }
}
