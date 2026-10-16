import { describe, expect, it } from 'vitest'
import { GuardController } from '../src/controller.ts'
import { INITIAL_GUARD_STATE } from '../src/state.ts'
const active = { mode: '0467', active: true, preset: 'bash-guard' }
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
describe('projection-confirmed interaction controller', () => {
  it('does not optimistically check guard and suppresses concurrent writes', async () => {
    const pending = deferred<typeof active>(); let calls = 0
    const c = new GuardController('a', INITIAL_GUARD_STATE, async () => { calls++; return pending.promise })
    const result = c.dispatch({ kind: 'activate' })
    expect(c.getSnapshot()).toMatchObject({ pending: true, state: { active: false } })
    expect(await c.dispatch({ kind: 'activate' })).toBe(false)
    expect(calls).toBe(1)
    pending.resolve(active)
    expect(await result).toBe(true)
    expect(c.getSnapshot()).toMatchObject({ pending: false, state: active })
  })
  it('keeps old mode after failure and exposes actionable error', async () => {
    const c = new GuardController('a', active, async () => { throw new Error('Permission update failed') })
    expect(await c.changeLevel(0,4)).toBe(false)
    expect(c.getSnapshot()).toMatchObject({ state: active, pending: false, error: 'Permission update failed' })
  })
  it('ignores late confirmation after switching sessions', async () => {
    const pending = deferred<typeof active>()
    const c = new GuardController('a', INITIAL_GUARD_STATE, () => pending.promise)
    const result = c.dispatch({ kind: 'activate' })
    c.bind('b', INITIAL_GUARD_STATE)
    pending.resolve(active)
    expect(await result).toBe(false)
    expect(c.getSnapshot()).toMatchObject({ sessionId: 'b', state: { active: false }, pending: false })
  })
  it('retains latest authoritative push when a request fails', async () => {
    const pending = deferred<typeof active>()
    const c = new GuardController('a', active, () => pending.promise)
    const result = c.changeLevel(0,4)
    const update = { ...active, mode: '4467' }
    c.observe('a', update)
    pending.reject(new Error('Disconnected'))
    await result
    expect(c.getSnapshot().state).toEqual(update)
  })
  it('disposal revokes in-flight writes and releases listeners', async () => {
    const pending = deferred<typeof active>(); let renders = 0
    const c = new GuardController('a', active, () => pending.promise)
    c.subscribe(() => renders++)
    const result = c.changeLevel(0,4)
    c.dispose()
    pending.resolve({ ...active, mode: '4467' })
    expect(await result).toBe(false)
    expect(renders).toBe(1)
    expect(c.getSnapshot().state.mode).toBe('0467')
  })
})
