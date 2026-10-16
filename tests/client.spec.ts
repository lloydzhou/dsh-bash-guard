import { describe, expect, it, vi } from 'vitest'
import { createGuardTransport, decodeGuardState, inject, createPermissionControl, guardRemoteContribution } from '../src/client.js'
import { createGuardEditor } from '../src/GuardEditor.js'

const state = { mode: '0467', active: false, revision: 0 }
const reply = (value: any = state) => ({ ok: true, value })
const React = { Fragment: 'fragment', createElement: (type: any, props: any, ...children: any[]) => ({ type, props: props || {}, children: children.flat().filter(x => x !== null && x !== false) }) }
const walk = (node: any): any[] => typeof node === 'object' && node ? [node, ...(node.children || []).flatMap(walk)] : []
const primitives = Object.fromEntries(['Menu', 'RiskConfirmation', 'PermissionIconReadOnlyRegular', 'PermissionIconWorkspaceWriteRegular', 'PermissionIconFullAccessRegular', 'IconChevronDownOutlineRegular', 'IconShieldOutlineRegular'].map(name => [name, name]))
const catalog = { options: ['read-only', 'workspace-write', 'danger-full-access', 'auto', 'custom-extra'].map(value => ({ value, name: value })) }
const commandReply = { ok: true, value: { matched: true, result: { kind: 'text', text: 'done' } } }

describe('dedicated remote transport', () => {
  it('mounts exact get/update Typert wire descriptors', () => {
    expect(guardRemoteContribution.package).toBe('dsh-bash-guard')
    const [get, update] = guardRemoteContribution.descriptors
    expect(get.id).toBe('dsh-bash-guard#bashGuard/get')
    expect(update.id).toBe('dsh-bash-guard#bashGuard/update')
    expect(get.parameters.map(p => p.wire)).toEqual(['sessionId'])
    expect(update.parameters.map(p => p.wire)).toEqual(['sessionId', 'request'])
    expect(update.parameters[1].codec.create().parse({ action: 'activate', revision: 0 })).toEqual({ action: 'activate', revision: 0 })
    expect(() => update.parameters[1].codec.create().parse({ action: 'mode', revision: 0 })).toThrow()
    expect(get.result.create().parse(state)).toEqual(state)
  })
  it('reads direct RPC state and writes exact session/revision payloads', async () => {
    const get = vi.fn().mockResolvedValue(reply()), update = vi.fn().mockResolvedValue(reply({ ...state, active: true, revision: 1 }))
    const command = vi.fn()
    const api = createGuardTransport({ bashGuard: { get, update } }, 'one', () => ({ command }))
    expect(await api.get()).toEqual(state)
    expect(get).toHaveBeenCalledWith('one')
    await api.write('mode', state, '4467')
    expect(update).toHaveBeenCalledWith('one', { action: 'mode', mode: '4467', revision: 0 })
    await api.write('activate', state)
    expect(update).toHaveBeenLastCalledWith('one', { action: 'activate', revision: 0 })
    expect(command).not.toHaveBeenCalled()
  })
  it('allows custom native presets without guard availability', async () => {
    const command = vi.fn().mockResolvedValue(commandReply)
    const api = createGuardTransport({}, 'one', () => ({ command }))
    await expect(api.get()).rejects.toThrow('不可用')
    await api.preset('custom-extra')
    expect(command.mock.calls).toEqual([['/permission custom-extra']])
    await expect(createGuardTransport({}, 'one', () => undefined).preset('auto')).rejects.toThrow('会话尚未就绪')
  })
  it('uses catalog.options from the remote envelope', async () => {
    const load = vi.fn().mockResolvedValue(reply(catalog))
    expect(await createGuardTransport({ permissionPresets: { catalog: load } }, 'one', () => undefined).catalog()).toEqual(catalog)
    expect(load).toHaveBeenCalledWith()
  })
  it('propagates native errors independently', async () => {
    const command = vi.fn().mockResolvedValue({ ok: false, error: { message: 'denied' } })
    await expect(createGuardTransport({}, 'one', () => ({ command })).preset('auto')).rejects.toThrow('denied')
  })
  it('accepts every four-digit octal bit combination in state and RPC codecs', () => {
    const [get, update] = guardRemoteContribution.descriptors
    const requestCodec = update.parameters[1].codec.create()
    for (let value = 0; value < 4096; value++) {
      const mode = value.toString(8).padStart(4, '0')
      const record = { ...state, mode }
      expect(decodeGuardState(reply(record))).toEqual(record)
      expect(get.result.create().parse(record)).toEqual(record)
      expect(update.result.create().parse(record)).toEqual(record)
      const request = { action: 'mode', revision: 0, mode }
      expect(requestCodec.parse(request)).toEqual(request)
    }
  })
  it.each(['', '046', '04677', '8467', '0469', '-467', '0x67', ' 467', '0467 ', '0467\n'])('rejects malformed mode %j in state and update codecs', mode => {
    expect(() => decodeGuardState(reply({ ...state, mode }))).toThrow()
    expect(() => guardRemoteContribution.descriptors[1].parameters[1].codec.create().parse({ action: 'mode', revision: 0, mode })).toThrow()
  })
  it.each([reply({ ...state, revision: -1 }), reply({ ...state, active: 'yes' }), { ok: false }, { ok: true, value: { matched: true } }])('rejects invalid state %#', value => expect(() => decodeGuardState(value)).toThrow())
  it('does not require guard service to register native choices', () => {
    expect(inject).not.toContain('remote.bashGuard')
    expect(inject).toEqual(['sessions', 'slots', 'locale', 'remote', 'remote.permissionPresets'])
  })
})

describe('inline editor', () => {
  const Editor = createGuardEditor(React)
  it('expands only when active and offers four rows of three independent bits', () => {
    expect(Editor({ ...state, onChange: vi.fn() })).toBeNull()
    const nodes = walk(Editor({ ...state, active: true, onChange: vi.fn() }))
    const rows = nodes.filter(n => n.props.role === 'group')
    expect(rows.map(n => n.props['aria-label'])).toEqual(['系统权限', '外部权限', '网络权限', '工作区权限'])
    expect(rows.map(n => n.children.filter((b: any) => b.props.role === 'checkbox').map((b: any) => b.props['data-cell']))).toEqual([
      ['0-0', '0-1', '0-2'], ['1-0', '1-1', '1-2'], ['2-0', '2-1', '2-2'], ['3-0', '3-1', '3-2'],
    ])
    expect(nodes.filter(n => n.props.role === 'checkbox')).toHaveLength(12)
    expect(nodes.filter(n => n.props['aria-checked'])).toHaveLength(6)
  })
  it('stops menu propagation and waits for authoritative props', () => {
    const onChange = vi.fn(), stopPropagation = vi.fn()
    const nodes = walk(Editor({ ...state, active: true, onChange }))
    const button = nodes.find(n => n.props.role === 'checkbox' && n.props['data-cell'] === '0-0')
    button.props.onClick({ stopPropagation })
    expect(onChange).toHaveBeenCalledWith(0, 4)
    expect(button.props['aria-checked']).toBe(false)
    expect(stopPropagation).toHaveBeenCalled()
  })
  it.each([{ pending: true, locked: false }, { pending: false, locked: true }])('blocks unavailable bit edits without native disabling pending cells %#', flags => {
    const onChange = vi.fn()
    const nodes = walk(Editor({ ...state, active: true, ...flags, onChange }))
    const buttons = nodes.filter(n => n.props.role === 'checkbox')
    expect(buttons).toHaveLength(12)
    expect(buttons.every(n => n.props['aria-disabled'] === true)).toBe(true)
    expect(buttons.every(n => n.props.disabled === flags.locked)).toBe(true)
    buttons.forEach(button => button.props.onClick({ stopPropagation() {} }))
    expect(onChange).not.toHaveBeenCalled()
  })
})

// Inspect actual native primitive props rather than substitute menu markup.
function render(overrides: any = {}, transport: any = {}) {
  const values = [overrides.state === undefined ? state : overrides.state, catalog, true, overrides.pending || false, overrides.error || '', '', overrides.confirmation || null, overrides.acknowledged || false, false]
  const setters: any[] = [], effects: any[] = []
  let index = 0
  const fakeReact = { ...React, useState: () => { const i = index++; const setter = vi.fn(); setters[i] = setter; return [values[i], setter] }, useRef: (value: any) => ({ current: value }), useEffect: (effect: any, deps: any) => effects.push({ effect, deps }) }
  const Control = createPermissionControl(fakeReact, primitives)
  const nodes = walk(Control({ sessionId: 'one', transport, locked: false, useProjection: () => ({ currentValue: 'workspace-write' }) }))
  return { nodes, menu: nodes.find(n => n.type === 'Menu'), setters, effects }
}

describe('native permission composition', () => {
  it('uses all catalog rows and one guard row in the same Menu', () => {
    const { menu, nodes } = render({ state: { ...state, active: true } })
    expect(menu.props.items.map((item: any) => item.id)).toEqual([...catalog.options.map(o => o.value), 'guard-separator', 'bash-guard'])
    expect(menu.props.selectedId).toBe('bash-guard')
    expect(menu.props.items[5].type).toBe('separator')
    expect(menu.props.items[6].icon.type).toBe('IconShieldOutlineRegular')
    expect(menu.props.items[0].icon.type).toBe('PermissionIconReadOnlyRegular')
    expect(menu.props.items[1].icon.type).toBe('PermissionIconWorkspaceWriteRegular')
    expect(menu.props.items[2].icon.type).toBe('PermissionIconFullAccessRegular')
    expect(menu.children.some((n: any) => typeof n.type === 'function' && n.props.active)).toBe(true)
    expect(nodes.some(n => n.props.role === 'menu')).toBe(false)
    expect(menu.props.anchor.type).toBe('button')
    expect(walk(menu.props.anchor).some(n => n.type === 'IconChevronDownOutlineRegular')).toBe(true)
  })
  it.each([{ state: null, pending: true }, { state: null, error: 'offline' }])('native choices stay enabled during guard failure %#', async flags => {
    const preset = vi.fn().mockResolvedValue(undefined), get = vi.fn().mockRejectedValue(new Error('offline'))
    const { menu } = render(flags, { preset, get })
    expect(menu.props.anchor.props.disabled).toBe(false)
    expect(menu.props.items.slice(0, 5).every((item: any) => !item.disabled)).toBe(true)
    expect(menu.props.items[6].disabled).toBe(true)
    menu.props.onSelect('custom-extra')
    expect(preset).toHaveBeenCalledWith('custom-extra')
    await Promise.resolve()
  })
  it.each(['auto', 'danger-full-access'])('gates %s through native RiskConfirmation', id => {
    const preset = vi.fn()
    const { menu, setters } = render({}, { preset })
    menu.props.onSelect(id)
    expect(setters[6]).toHaveBeenCalledWith(id)
    expect(preset).not.toHaveBeenCalled()
    const risk = render({ confirmation: id }, { preset }).nodes.find(n => n.type === 'RiskConfirmation')
    expect(risk.props.acknowledged).toBe(false)
    risk.props.onConfirm()
    expect(preset).not.toHaveBeenCalled()
    expect(risk.props.description).toContain(id === 'auto' ? 'PTC 内层调用' : '敏感操作')
  })
  it('reads directly on open without command polling', () => {
    const get = vi.fn().mockResolvedValue(state), load = vi.fn().mockResolvedValue(catalog)
    const { effects } = render({}, { get, catalog: load })
    effects[1].effect()
    expect(get).toHaveBeenCalledOnce()
    expect(load).toHaveBeenCalledOnce()
  })
})
