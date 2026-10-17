import { defaultT } from './locales.js'

// Independent permission bits; the host owns React and the check glyph.
const scopes = ['system', 'external', 'network', 'workspace']
const permissions = [{ key: 'read', bit: 4 }, { key: 'write', bit: 2 }, { key: 'execute', bit: 1 }]
export function createGuardEditor(React, CheckIcon) {
  const h = React.createElement
  return function GuardEditor({ mode, active, pending = false, locked = false, error, engine = 'local', decision, onEngineChange, onSettings, onChange, onModeChange, t = defaultT }) {
    if (!active) return null
    const disabled = pending || locked
    const keydown = (event, row, col) => {
      const delta = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }[event.key]
      if (!delta) return
      event.preventDefault(); event.stopPropagation()
      const root = event.currentTarget.closest('[data-guard-editor]')
      root?.querySelector(`[data-cell="${Math.max(0, Math.min(3, row + delta[0]))}-${Math.max(0, Math.min(2, col + delta[1]))}"]`)?.focus()
    }
    return h('div', { className: `dsh-bg-editor${t('scope.workspace') === 'Workspace' ? ' dsh-bg-editor-en' : ''}`, 'data-guard-editor': '', 'aria-busy': pending },
      h('div', { className: 'dsh-bg-scope dsh-bg-head' },
        h('button', {
          type: 'button', className: 'dsh-bg-scope-label dsh-bg-all-toggle dsh-bg-scope-toggle',
          disabled: locked, 'aria-disabled': disabled,
          title: t(mode === '7777' ? 'restoreDefaults' : 'enableAll'),
          onClick: event => { event.stopPropagation(); if (!disabled) onModeChange(mode === '7777' ? '4667' : '7777') },
        }, t(mode === '7777' ? 'defaults' : 'selectAll')),
        ...permissions.map(p => h('span', { className: 'dsh-bg-column', key: p.bit }, t(`bit.${p.key}`)))),
      ...scopes.map(key => t(`scope.${key}`)).map((scope, row) => h('div', { className: 'dsh-bg-scope', key: row, role: 'group', 'aria-label': t('scope.permissions', { scope }) },
        h('button', {
          type: 'button', className: 'dsh-bg-scope-label dsh-bg-scope-toggle',
          disabled: locked, 'aria-disabled': disabled,
          'aria-label': t('scope.toggle', { scope, action: t(mode[row] === '7' ? 'clearAll' : 'selectAll') }),
          title: t(mode[row] === '7' ? 'scope.clearAll' : 'scope.enableAll'),
          onClick: event => { event.stopPropagation(); if (!disabled) onChange(row, mode[row] === '7' ? 0 : 7) },
        }, scope),
        ...permissions.map((permission, col) => {
          const checked = (Number(mode[row]) & permission.bit) !== 0
          return h('button', {
            type: 'button', key: permission.bit, role: 'checkbox', 'aria-checked': checked,
            'aria-label': t('bit.label', { scope, permission: t(`bit.${permission.key}`) }), title: t('bit.status', { scope, permission: t(`bit.${permission.key}`), status: t(checked ? 'enabled' : 'disabled') }),
            'data-cell': `${row}-${col}`, disabled: locked, 'aria-disabled': disabled, className: 'dsh-bg-level',
            onClick: event => { event.stopPropagation(); if (!disabled) onChange(row, Number(mode[row]) ^ permission.bit) },
            onKeyDown: event => keydown(event, row, col),
          }, checked && CheckIcon ? h(CheckIcon, { 'aria-hidden': true }) : null)
        }))),
      h('div', { className: 'dsh-bg-engine', onClick: event => event.stopPropagation(), onKeyDown: event => event.stopPropagation() },
        h('label', null, t('engine.label'), h('select', { value: engine, disabled, 'aria-label': t('engine.label'), onChange: event => { if (!disabled) onEngineChange?.(event.target.value) } },
          h('option', { value: 'local' }, t('engine.local')), h('option', { value: 'jev' }, 'Jev'))),
        h('button', { type: 'button', className: 'dsh-bg-cog', disabled: locked, title: t('settings.title'), 'aria-label': t('settings.title'), onClick: onSettings },
          h('svg', { viewBox: '0 0 24 24', width: 16, height: 16, fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, 'aria-hidden': true },
            h('path', { d: 'm10 3-.6 2.1-2 .9-2-.5-2 3.5 1.5 1.6v2.8L3.4 15l2 3.5 2-.5 2 .9.6 2.1h4l.6-2.1 2-.9 2 .5 2-3.5-1.5-1.6v-2.8L20.6 9l-2-3.5-2 .5-2-.9L14 3Z' }), h('circle', { cx: 12, cy: 12, r: 3 })))),
      decision?.fallback && h('div', { className: 'dsh-bg-fallback', role: 'status' }, t('engine.fallback')),
      error ? h('div', { className: 'dsh-bg-error', role: 'alert' }, error) : null)
  }
}
