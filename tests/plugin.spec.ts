import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { remoteMethods } from '@deepseek-ai/dsh-typert-protocol'
import { apply, recordSchema } from '../src/index.ts'

const contexts: any[] = []
afterEach(async () => { for (const ctx of contexts.splice(0)) await ctx.fiber.dispose() })

// The Cordis/Remote implementation is real. These small service doubles expose
// only the actual installed storage-domain, sessions and permissionPresets APIs.
async function mount(records = new Map<string, any>()) {
  const ctx: any = new Context()
  contexts.push(ctx)
  const session = { id: 'test-session', header: { cwd: '/Users/test/project' }, events: [] as any[], snapshotEvents() { return [...this.events] } }
  const append = (type: string, data: any) => session.events.push({ type, data, seq: session.events.length })
  let live: any = session, puts = 0, selections = 0
  let beforePut = async () => {}
  ctx.provide('storageDomain', { open: async () => ({ table: () => ({
    get: (id: string) => records.get(id),
    put: async (id: string, value: any) => { await beforePut(); puts++; records.set(id, value) },
  }), close() {} }) })
  ctx.provide('sessions', { get: (id: string) => id === session.id ? live : undefined })
  ctx.provide('permissionPresets', {
    resolve: (name: string) => {
      if (!['workspace-write', 'danger-full-access', 'read-only'].includes(name)) throw new Error('Unknown native preset')
      return { sandbox: name, approval: name === 'danger-full-access' ? 'never' : 'ask' }
    },
    set: (bound: any, preset: string) => { expect(bound).toBe(live); selections++; append('permission/preset', { preset }); append('sandbox/mode', { mode: preset }); append('approval/policy', { policy: 'ask' }) },
    current: () => [...session.events].reverse().find(event => event.type === 'permission/preset')?.data.preset ?? 'workspace-write',
  })
  await apply(ctx)
  const get = () => ctx.bashGuard.get(session.id)
  const update = (request: any) => ctx.bashGuard.update(session.id, request)
  const run = (command: string, next: any, name = 'bash') => {
    const listeners = [...ctx.events.dispatch('emit', ['tools/execute'])]
    expect(listeners).toHaveLength(1)
    return listeners[0]({ agent: { session }, name, arguments: { command } }, next)
  }
  return { ctx, session, append, update, get, run, unbind: () => { live = undefined },
    counts: () => ({ puts, selections }), delayPut: (fn: () => Promise<void>) => { beforePut = fn } }
}

describe('plugin Remote service, persistence and native baseline', () => {
  it('publishes a real Cordis Remote get/update pair, without any commands dependency', async () => {
    const h = await mount()
    expect(h.ctx.bashGuard.typertRemote).toMatchObject({ serviceKey: 'bashGuard', namespace: 'bashGuard' })
    expect(remoteMethods(h.ctx.bashGuard)).toEqual([
      { method: 'get', invocation: { kind: 'direct' } }, { method: 'update', invocation: { kind: 'direct' } },
    ])
    // The installed gateway reads this versioned descriptor across module
    // copies. Older npm protocol releases used a private WeakMap: same-copy
    // remoteMethods tests passed while the real host returned 404.
    expect(Object.getOwnPropertyDescriptor(Object.getPrototypeOf(h.ctx.bashGuard), '@deepseek-ai/dsh-typert-protocol/remote-methods')?.value).toMatchObject({
      version: 1, methods: [{ method: 'get' }, { method: 'update' }],
    })
    expect(h.get()).toMatchObject({ active: false, revision: 0 })
    expect(h.counts()).toEqual({ puts: 0, selections: 0 })
  })
  it('is inactive by default; activation pins full-access baseline and enforces guard', async () => {
    const h = await mount(); let executed = 0
    const next = async () => { executed++; return { isError: false } }
    expect((await h.run('cat /etc/hosts', next)).isError).toBe(false)
    expect(await h.update({ action: 'activate', revision: 0 })).toMatchObject({ active: true, revision: 1 })
    expect(h.session.events[0].data.preset).toBe('danger-full-access')
    expect(await h.run('touch /etc/bash-guard-test', next)).toMatchObject({ isError: true, error: { info: { code: 'BASH_GUARD_DENIED' } } })
    expect(executed).toBe(1)
    await h.update({ action: 'mode', mode: '4467', revision: 1 })
    expect((await h.run('cat /etc/hosts', next)).isError).toBe(false)
    expect((await h.run('', next, 'unhooked-tool')).isError).toBe(false)
  })
  it('persists by session; native changes invalidate active state and its revision without polling writes', async () => {
    const records = new Map<string, any>(); const h = await mount(records)
    await h.update({ action: 'activate', revision: 0 })
    await h.update({ action: 'mode', mode: '4444', revision: 1 })
    const reopened = await mount(records)
    reopened.session.events.push(...h.session.events)
    expect(reopened.get()).toMatchObject({ mode: '4444', active: true, revision: 2 })
    reopened.append('permission/preset', { preset: 'read-only' })
    expect(reopened.get()).toMatchObject({ mode: '4444', active: false, revision: 3 })
    expect(reopened.get()).toMatchObject({ revision: 3 })
    expect(reopened.counts().puts).toBe(0)
    await expect(reopened.update({ action: 'activate', revision: 2 })).rejects.toThrow('changed')
    await reopened.update({ action: 'activate', revision: 3 })
    expect(reopened.get()).toMatchObject({ mode: '4444', active: true, revision: 4 })
  })
  it.each(['sandbox/mode', 'approval/policy'])('invalidates after native %s changes', async (type) => {
    const h = await mount()
    await h.update({ action: 'activate', revision: 0 })
    h.append(type, { mode: 'danger-full-access', policy: 'never' })
    expect(h.get()).toMatchObject({ active: false, revision: 2 })
    await expect(h.update({ action: 'mode', mode: '7777', revision: 1 })).rejects.toThrow('changed')
  })
  it('invalidates on successful same-preset native command too', async () => {
    const h = await mount()
    await h.update({ action: 'activate', revision: 0 })
    h.append('command/run', { name: 'permission', args: 'danger-full-access', commandId: 'native' })
    h.append('command/done', { kind: 'success', commandId: 'native' })
    expect(h.get()).toMatchObject({ active: false, revision: 2 })
  })
  it('rejects stale and invalid writes and isolates session IDs', async () => {
    const h = await mount()
    await h.update({ action: 'activate', revision: 0 })
    await expect(h.update({ action: 'mode', mode: '7777', revision: 0 })).rejects.toThrow('changed')
    await expect(h.update({ action: 'mode', mode: '8888', revision: 1 })).rejects.toThrow('four octal')
    await expect(h.update({ action: 'get', revision: 1 })).rejects.toThrow('Unknown')
    expect(h.get()).toMatchObject({ mode: '4667', revision: 1 })
    expect(h.ctx.bashGuard.get('other-session')).toMatchObject({ active: false, revision: 0 })
    expect(() => recordSchema.parse({ mode: 467 })).toThrow()
  })
  it('never resumes/acquires writers when polling; cold mutation refuses rather than stealing a binding', async () => {
    const h = await mount()
    await h.update({ action: 'activate', revision: 0 })
    h.unbind()
    expect(h.get()).toMatchObject({ mode: '4667', active: false })
    await expect(h.update({ action: 'deactivate', revision: h.get().revision })).rejects.toThrow('not live')
    expect(h.counts()).toEqual({ puts: 1, selections: 1 })
  })
  it('invalidates legacy workspace-write records on read without elevating or writing', async () => {
    const records = new Map([['test-session', { mode: '4444', active: true, revision: 5, presetSeq: -1 }]])
    const h = await mount(records)
    expect(h.get()).toMatchObject({ active: false, mode: '4444', revision: 6 })
    expect(h.get().revision).toBe(6)
    expect(h.counts()).toEqual({ puts: 0, selections: 0 })
    expect(h.session.events).toEqual([])
    await expect(h.update({ action: 'mode', mode: '7777', revision: 5 })).rejects.toThrow('changed')
    expect(await h.update({ action: 'activate', revision: 6 })).toMatchObject({ active: true, revision: 7 })
  })
  it('invalidates a current preset mismatch even without newer events', async () => {
    const h = await mount()
    await h.update({ action: 'activate', revision: 0 })
    h.ctx.permissionPresets.current = () => 'custom'
    expect(h.get()).toMatchObject({ active: false, revision: 2 })
    expect(h.counts()).toEqual({ puts: 1, selections: 1 })
  })
  it('validates the full-access sandbox before making native changes', async () => {
    const h = await mount()
    h.ctx.permissionPresets.resolve = () => ({ sandbox: 'workspace-write', approval: 'never' })
    await expect(h.update({ action: 'activate', revision: 0 })).rejects.toThrow('danger-full-access sandbox')
    expect(h.counts()).toEqual({ puts: 0, selections: 0 })
  })
  it.each(['custom', undefined, 'unavailable'])('refuses an unrestorable previous preset %s before elevation', async (preset) => {
    const h = await mount()
    h.ctx.permissionPresets.current = () => preset
    await expect(h.update({ action: 'activate', revision: 0 })).rejects.toThrow()
    expect(h.counts()).toEqual({ puts: 0, selections: 0 })
  })
  it('rolls back the previous native preset if activation persistence fails, then permits retry', async () => {
    const h = await mount()
    h.append('permission/preset', { preset: 'read-only' })
    h.delayPut(async () => { throw new Error('disk full') })
    await expect(h.update({ action: 'activate', revision: 0 })).rejects.toThrow('disk full')
    expect(h.ctx.permissionPresets.current(h.session)).toBe('read-only')
    expect(h.get()).toMatchObject({ active: false, revision: 0 })
    expect(h.counts()).toEqual({ puts: 0, selections: 2 })
    h.delayPut(async () => {})
    expect(await h.update({ action: 'activate', revision: 0 })).toMatchObject({ active: true, revision: 1 })
  })
  it('reports rollback failure explicitly instead of silently leaving full access', async () => {
    const h = await mount()
    const set = h.ctx.permissionPresets.set
    h.ctx.permissionPresets.set = (session: any, preset: string) => {
      if (preset === 'workspace-write') throw new Error('rollback unavailable')
      set(session, preset)
    }
    h.delayPut(async () => { throw new Error('disk full') })
    await expect(h.update({ action: 'activate', revision: 0 })).rejects.toThrow('full access may remain enabled')
    expect(h.get()).toMatchObject({ active: false, revision: 0 })
  })
  it('rolls back when setting the full-access baseline fails partway through', async () => {
    const h = await mount()
    const set = h.ctx.permissionPresets.set
    h.ctx.permissionPresets.set = (session: any, preset: string) => {
      set(session, preset)
      if (preset === 'danger-full-access') throw new Error('native set failed')
    }
    await expect(h.update({ action: 'activate', revision: 0 })).rejects.toThrow('native set failed')
    expect(h.ctx.permissionPresets.current(h.session)).toBe('workspace-write')
    expect(h.counts()).toEqual({ puts: 0, selections: 2 })
  })
  it('requires the native current preset to confirm activation', async () => {
    const h = await mount()
    h.ctx.permissionPresets.current = () => 'workspace-write'
    await expect(h.update({ action: 'activate', revision: 0 })).rejects.toThrow('Cannot activate danger-full-access baseline')
    expect(h.counts()).toEqual({ puts: 0, selections: 2 })
  })
  it('reports rollback that silently fails to restore the previous preset', async () => {
    const h = await mount()
    const set = h.ctx.permissionPresets.set
    h.ctx.permissionPresets.set = (session: any, preset: string) => {
      if (preset !== 'workspace-write') set(session, preset)
    }
    h.delayPut(async () => { throw new Error('disk full') })
    await expect(h.update({ action: 'activate', revision: 0 })).rejects.toThrow('native preset rollback failed')
  })
  it('preserves invalidation if native permissions change during activation persistence', async () => {
    const h = await mount()
    h.delayPut(async () => { h.append('permission/preset', { preset: 'read-only' }) })
    expect(await h.update({ action: 'activate', revision: 0 })).toMatchObject({ active: false, revision: 2 })
    await expect(h.update({ action: 'mode', mode: '7777', revision: 1 })).rejects.toThrow('changed')
    expect(h.ctx.permissionPresets.current(h.session)).toBe('read-only')
  })
  it('keeps tools queued until failed activation has restored native permissions', async () => {
    const h = await mount()
    let release!: () => void, entered!: () => void
    const started = new Promise<void>(resolve => { entered = resolve })
    h.delayPut(() => { entered(); return new Promise<void>((_, reject) => { release = () => reject(new Error('disk full')) }) })
    const update = h.update({ action: 'activate', revision: 0 })
    await started
    let executed = false
    const execution = h.run('cat /etc/hosts', async () => { executed = true })
    const failedUpdate = expect(update).rejects.toThrow('disk full')
    const failedExecution = expect(execution).rejects.toThrow('disk full')
    release()
    await Promise.all([failedUpdate, failedExecution])
    expect(executed).toBe(false)
    expect(h.ctx.permissionPresets.current(h.session)).toBe('workspace-write')
  })
  it('serializes concurrent revisions and tools wait for persisted policy', async () => {
    const h = await mount()
    await h.update({ action: 'activate', revision: 0 })
    const results = await Promise.allSettled([
      h.update({ action: 'mode', mode: '4444', revision: 1 }),
      h.update({ action: 'mode', mode: '7777', revision: 1 }),
    ])
    expect(results.map(result => result.status)).toEqual(['fulfilled', 'rejected'])
    let release!: () => void, entered!: () => void
    const started = new Promise<void>(resolve => { entered = resolve })
    h.delayPut(() => { entered(); return new Promise<void>(resolve => { release = resolve }) })
    const update = h.update({ action: 'mode', mode: '0467', revision: 2 })
    await started
    let executed = false
    const execution = h.run('cat /etc/hosts', async () => { executed = true })
    expect(h.get().mode).toBe('4444')
    release(); await update
    expect((await execution).isError).toBe(true)
    expect(executed).toBe(false)
  })
})
