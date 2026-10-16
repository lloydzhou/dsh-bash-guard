// Independent permission bits; the host owns React and the check glyph.
const scopes = ['系统', '外部', '网络', '工作区']
const permissions = [{ label: '读', bit: 4 }, { label: '写', bit: 2 }, { label: '执行', bit: 1 }]
export function createGuardEditor(React, CheckIcon) {
  const h = React.createElement
  return function GuardEditor({ mode, active, pending = false, locked = false, error, onChange, onModeChange }) {
    if (!active) return null
    const disabled = pending || locked
    const keydown = (event, row, col) => {
      const delta = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }[event.key]
      if (!delta) return
      event.preventDefault(); event.stopPropagation()
      const root = event.currentTarget.closest('[data-guard-editor]')
      root?.querySelector(`[data-cell="${Math.max(0, Math.min(3, row + delta[0]))}-${Math.max(0, Math.min(2, col + delta[1]))}"]`)?.focus()
    }
    return h('div', { className: 'dsh-bg-editor', 'data-guard-editor': '', 'aria-busy': pending },
      h('div', { className: 'dsh-bg-scope dsh-bg-head' },
        h('button', {
          type: 'button', className: 'dsh-bg-scope-label dsh-bg-all-toggle dsh-bg-scope-toggle',
          disabled: locked, 'aria-disabled': disabled,
          title: mode === '7777' ? '恢复默认权限 0477' : '开启全部 Guard 权限',
          onClick: event => { event.stopPropagation(); if (!disabled) onModeChange(mode === '7777' ? '0477' : '7777') },
        }, mode === '7777' ? '默认' : '全选'),
        ...permissions.map(p => h('span', { className: 'dsh-bg-column', key: p.bit }, p.label))),
      ...scopes.map((scope, row) => h('div', { className: 'dsh-bg-scope', key: row, role: 'group', 'aria-label': `${scope}权限` },
        h('button', {
          type: 'button', className: 'dsh-bg-scope-label dsh-bg-scope-toggle',
          disabled: locked, 'aria-disabled': disabled,
          'aria-label': `${scope}：${mode[row] === '7' ? '取消全选' : '全选'}`,
          title: mode[row] === '7' ? '取消该范围全部权限' : '开启该范围全部权限',
          onClick: event => { event.stopPropagation(); if (!disabled) onChange(row, mode[row] === '7' ? 0 : 7) },
        }, scope),
        ...permissions.map((permission, col) => {
          const checked = (Number(mode[row]) & permission.bit) !== 0
          return h('button', {
            type: 'button', key: permission.bit, role: 'checkbox', 'aria-checked': checked,
            'aria-label': `${scope} · ${permission.label}权限`, title: `${scope} · ${permission.label}权限：${checked ? '开启' : '关闭'}`,
            'data-cell': `${row}-${col}`, disabled: locked, 'aria-disabled': disabled, className: 'dsh-bg-level',
            onClick: event => { event.stopPropagation(); if (!disabled) onChange(row, Number(mode[row]) ^ permission.bit) },
            onKeyDown: event => keydown(event, row, col),
          }, checked && CheckIcon ? h(CheckIcon, { 'aria-hidden': true }) : null)
        }))),
      error ? h('div', { className: 'dsh-bg-error', role: 'alert' }, error) : null)
  }
}
