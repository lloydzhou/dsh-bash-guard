import { describe, expect, it } from 'vitest'
import { activateGuard, applyGuardEvent, changeGuardLevel, foldGuard, GUARD_LEVELS, INITIAL_GUARD_STATE } from '../src/state.ts'

describe('confirmed third-knob interaction contract', () => {
  it('starts collapsed, retaining a sensible default without overriding a preset', () => {
    expect(foldGuard([])).toEqual({ mode: '0467', active: false, preset: null })
  })
  it('activates with whole-value knob and separate intent; no numeric presets', () => {
    const events = activateGuard(INITIAL_GUARD_STATE)
    expect(events).toEqual([
      { type: 'bash-guard/mode', data: { mode: '0467' } },
      { type: 'permission/preset', data: { preset: 'bash-guard' } },
    ])
    expect(foldGuard(events)).toEqual({ mode: '0467', active: true, preset: 'bash-guard' })
  })
  it('changes immediately; preset collapses and preserves digits; reactivation restores', () => {
    const events = activateGuard(INITIAL_GUARD_STATE)
    events.push(changeGuardLevel(foldGuard(events), 0, 4))
    expect(foldGuard(events).mode).toBe('4467')
    events.push({ type: 'permission/preset', data: { preset: 'read-only' } })
    const collapsed = foldGuard(events)
    expect(collapsed).toEqual({ mode: '4467', active: false, preset: 'read-only' })
    events.push(...activateGuard(collapsed))
    expect(foldGuard(events)).toEqual({ mode: '4467', active: true, preset: 'bash-guard' })
    expect(foldGuard(JSON.parse(JSON.stringify(events)))).toEqual(foldGuard(events))
  })
  it('keeps mode and intent independent', () => {
    const state = applyGuardEvent(INITIAL_GUARD_STATE, { type: 'bash-guard/mode', data: { mode: '4444' } })
    expect(state.active).toBe(false)
    expect(state.mode).toBe('4444')
  })
  it('rejects inactive edits and rare write/execute-only UI levels', () => {
    expect(() => changeGuardLevel(INITIAL_GUARD_STATE, 0, 4)).toThrow('not active')
    const state = foldGuard(activateGuard(INITIAL_GUARD_STATE))
    for (let scope = 0; scope < 4; scope++) {
      for (const level of [1, 2, 3, 5]) expect(() => changeGuardLevel(state, scope, level)).toThrow('Unsupported')
    }
    expect(GUARD_LEVELS.map(scope => [...scope.levels])).toEqual([[0,4,7],[0,4,6],[0,4,6],[0,4,6,7]])
  })
  it('fails closed on malformed mode events without changing activation', () => {
    const state = foldGuard([...activateGuard(INITIAL_GUARD_STATE), { type: 'bash-guard/mode', data: { mode: '8888' } }])
    expect(state).toEqual({ mode: '0000', active: true, preset: 'bash-guard' })
  })
  it('isolates session folds and ignores unrelated events', () => {
    const a = foldGuard(activateGuard(INITIAL_GUARD_STATE))
    const b = foldGuard([{ type: 'permission/preset', data: { preset: 'workspace-write' } }])
    expect(a.active).toBe(true)
    expect(b.active).toBe(false)
    expect(applyGuardEvent(a, { type: 'assistant/message', data: {} })).toBe(a)
    expect(INITIAL_GUARD_STATE.mode).toBe('0467')
  })
})
