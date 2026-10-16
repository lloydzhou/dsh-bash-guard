import { describe, expect, it, vi } from 'vitest'
import { createGuardEditor } from '../src/GuardEditor.js'
const React = { createElement: (type: any, props: any, ...children: any[]) => ({ type, props, children }) }
const Editor = createGuardEditor(React)
const flatten = (node: any): any[] => node && typeof node === 'object' ? [node, ...node.children.flatMap(flatten)] : []
const checkboxes = (tree: any) => flatten(tree).filter(n => n.props?.role === 'checkbox')
describe('confirmed inline scope editor', () => {
  it.each(['0000', '0477', '7077', '7777'])('global action labels and atomically updates %s', mode => {
    const onModeChange = vi.fn()
    const button = flatten(Editor({mode, active:true, onModeChange})).find(n => n.props?.className?.includes('dsh-bg-all-toggle'))
    expect(button.children[0]).toBe(mode === '7777' ? '默认' : '全选')
    const stopPropagation = vi.fn()
    button.props.onClick({stopPropagation})
    expect(stopPropagation).toHaveBeenCalledOnce()
    expect(onModeChange).toHaveBeenCalledExactlyOnceWith(mode === '7777' ? '0477' : '7777')
    for (const status of [{pending:true}, {locked:true}]) {
      flatten(Editor({mode,active:true,...status,onModeChange})).find(n => n.props?.className?.includes('dsh-bg-all-toggle')).props.onClick({stopPropagation(){}})
    }
    expect(onModeChange).toHaveBeenCalledOnce()
  })
  it.each([0,1,2,3,4,5,6,7])('scope labels toggle whole row from %i with one write', digit => {
    const onChange = vi.fn()
    const buttons = flatten(Editor({ mode: String(digit).repeat(4), active: true, onChange })).filter(n => n.props?.className === 'dsh-bg-scope-label dsh-bg-scope-toggle')
    expect(buttons.map(n => n.children[0])).toEqual(['系统','外部','网络','工作区'])
    buttons.forEach((button, row) => {
      const stopPropagation = vi.fn()
      button.props.onClick({ stopPropagation })
      expect(stopPropagation).toHaveBeenCalledOnce()
      expect(onChange).toHaveBeenLastCalledWith(row, digit === 7 ? 0 : 7)
    })
    expect(onChange).toHaveBeenCalledTimes(4)
    for (const status of [{pending:true}, {locked:true}]) {
      const blocked = flatten(Editor({mode:'7777',active:true,...status,onChange})).filter(n => n.props?.className === 'dsh-bg-scope-label dsh-bg-scope-toggle')
      blocked.forEach(button => button.props.onClick({stopPropagation(){}}))
    }
    expect(onChange).toHaveBeenCalledTimes(4)
  })
  it('has no editor subtree while guard is inactive', () => {
    expect(Editor({ mode: '0467', active: false, onChange() {} })).toBeNull()
  })
  it('renders four labeled groups of three independent bit checkboxes and no save control', () => {
    const nodes = flatten(Editor({ mode: '0467', active: true, onChange() {} }))
    const groups = nodes.filter(n => n.props?.role === 'group')
    expect(groups.map(n => n.props['aria-label'])).toEqual(['系统权限', '外部权限', '网络权限', '工作区权限'])
    expect(groups.map(n => checkboxes(n).map(b => b.props['data-cell']))).toEqual([
      ['0-0', '0-1', '0-2'], ['1-0', '1-1', '1-2'], ['2-0', '2-1', '2-2'], ['3-0', '3-1', '3-2'],
    ])
    const buttons = nodes.filter(n => n.props?.role === 'checkbox')
    expect(buttons).toHaveLength(12)
    expect(buttons.every(n => n.props.role === 'checkbox' && n.props.type === 'button')).toBe(true)
    expect(buttons.map(n => n.props['aria-label'])).toEqual(
      ['系统', '外部', '网络', '工作区'].flatMap(scope => ['读', '写', '执行'].map(label => `${scope} · ${label}权限`)),
    )
    expect(buttons.map(n => n.props['aria-checked'])).toEqual([
      false, false, false, true, false, false, true, true, false, true, true, true,
    ])
    expect(buttons.every(n => !n.props.disabled && !n.props['aria-disabled'])).toBe(true)
    expect(nodes.some(n => ['radio', 'radiogroup'].includes(n.props?.role))).toBe(false)
  })
  it.each([0, 1, 2, 3, 4, 5, 6, 7])('XOR toggles each bit independently for digit %i without optimistic mutation', digit => {
    const onChange = vi.fn()
    const buttons = checkboxes(Editor({ mode: String(digit).repeat(4), active: true, onChange }))
    buttons.forEach((button, index) => {
      const row = Math.floor(index / 3), bit = [4, 2, 1][index % 3]
      const stopPropagation = vi.fn()
      expect(button.props['aria-checked']).toBe((digit & bit) !== 0)
      button.props.onClick({ stopPropagation })
      expect(stopPropagation).toHaveBeenCalledOnce()
      expect(onChange).toHaveBeenLastCalledWith(row, digit ^ bit)
      expect(button.props['aria-checked']).toBe((digit & bit) !== 0)
      const confirmed = checkboxes(Editor({ mode: String(digit ^ bit).repeat(4), active: true, onChange }))[index]
      expect(confirmed.props['aria-checked']).toBe((digit & bit) === 0)
    })
    expect(onChange).toHaveBeenCalledTimes(12)
  })
  it.each([
    { pending: true, locked: false },
    { pending: false, locked: true },
    { pending: true, locked: true },
  ])('blocks edits but uses native disabled only for lock: %j', status => {
    const onChange = vi.fn()
    const tree = Editor({ mode: '0467', active: true, ...status, onChange })
    expect(tree.props['aria-busy']).toBe(status.pending)
    const buttons = checkboxes(tree)
    expect(buttons.every(n => n.props['aria-disabled'] === true)).toBe(true)
    expect(buttons.every(n => n.props.disabled === status.locked)).toBe(true)
    buttons.forEach(button => {
      const stopPropagation = vi.fn()
      button.props.onClick({ stopPropagation })
      expect(stopPropagation).toHaveBeenCalledOnce()
    })
    expect(onChange).not.toHaveBeenCalled()
  })
  it.each([false, true])('arrows move focus across the matrix, clamp at edges, and never change bits (pending=%s)', pending => {
    const onChange = vi.fn()
    const buttons = checkboxes(Editor({ mode: '1235', active: true, pending, onChange }))
    const focus = vi.fn(), querySelector = vi.fn(() => ({ focus }))
    const closest = vi.fn(() => ({ querySelector }))
    const directions: [string, number, number][] = [['ArrowUp', -1, 0], ['ArrowDown', 1, 0], ['ArrowLeft', 0, -1], ['ArrowRight', 0, 1]]
    buttons.forEach((button, index) => {
      const row = Math.floor(index / 3), col = index % 3
      directions.forEach(([key, dr, dc]) => {
        const preventDefault = vi.fn(), stopPropagation = vi.fn()
        button.props.onKeyDown({ key, currentTarget: { closest }, preventDefault, stopPropagation })
        expect(preventDefault).toHaveBeenCalledOnce()
        expect(stopPropagation).toHaveBeenCalledOnce()
        expect(closest).toHaveBeenLastCalledWith('[data-guard-editor]')
        expect(querySelector).toHaveBeenLastCalledWith(`[data-cell="${Math.max(0, Math.min(3, row + dr))}-${Math.max(0, Math.min(2, col + dc))}"]`)
      })
    })
    expect(focus).toHaveBeenCalledTimes(48)
    expect(onChange).not.toHaveBeenCalled()
  })
  it.each(['Enter', ' ', 'Tab', 'Escape'])('leaves %j to native keyboard behavior', key => {
    const onChange = vi.fn(), preventDefault = vi.fn(), stopPropagation = vi.fn(), closest = vi.fn()
    const button = checkboxes(Editor({ mode: '0467', active: true, onChange }))[0]
    button.props.onKeyDown({ key, currentTarget: { closest }, preventDefault, stopPropagation })
    expect(preventDefault).not.toHaveBeenCalled()
    expect(stopPropagation).not.toHaveBeenCalled()
    expect(closest).not.toHaveBeenCalled()
    expect(onChange).not.toHaveBeenCalled()
  })
})
