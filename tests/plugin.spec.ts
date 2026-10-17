import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_JEV_SETTINGS } from '../src/jev.ts'
import { Context } from '@deepseek-ai/cordis'
import { remoteMethods } from '@deepseek-ai/dsh-typert-protocol'
import { apply, recordSchema } from '../src/index.ts'

const contexts: any[] = []
afterEach(async () => { vi.unstubAllGlobals(); for (const ctx of contexts.splice(0)) await ctx.fiber.dispose() })

// The Cordis/Remote implementation is real. These small service doubles expose
// only the actual installed storage-domain, sessions and permissionPresets APIs.
async function mount(records = new Map<string, any>(), settings = new Map<string, any>()) {
  const ctx: any = new Context()
  contexts.push(ctx)
  const session = { id: 'test-session', header: { cwd: '/Users/test/project' }, events: [] as any[], snapshotEvents() { return [...this.events] } }
  const append = (type: string, data: any) => session.events.push({ type, data, seq: session.events.length })
  let live: any = session, puts = 0, selections = 0
  let beforePut = async () => {}
  ctx.provide('storageDomain', { open: async (options: any) => {
    expect(options.version).toBe(1)
    const map = options.name === 'bash_guard_jev' ? settings : records
    return { table: (name: string) => {
      expect(name).toBe(options.name === 'bash_guard_jev' ? 'settings' : 'sessions')
      return { get: (id: string) => map.get(id), put: async (id: string, value: any) => { if (map === records) { await beforePut(); puts++ }; map.set(id, value) } }
    }, close() {} }
  } })
  ctx.provide('sessions', { get: (id: string) => id === session.id ? live : undefined })
  ctx.provide('permissionPresets', {
    resolve: (name: string) => {
      if (!['workspace-write', 'danger-full-access', 'read-only'].includes(name)) throw new Error('Unknown native preset')
      return { sandbox: name, approval: name === 'danger-full-access' ? 'never' : 'ask' }
    },
    set: (bound: any, preset: string) => { expect(bound).toBe(live); selections++; append('permission/preset', { preset }); append('sandbox/mode', { mode: preset }); append('approval/policy', { policy: preset === 'danger-full-access' ? 'never' : 'ask' }) },
    current: () => [...session.events].reverse().find(event => event.type === 'permission/preset')?.data.preset ?? 'workspace-write',
  })
  ctx.provide('sandboxPolicy', { resolve: ({session: bound}: any) => ({mode: [...bound.events].reverse().find(event=>event.type==='sandbox/mode')?.data.mode ?? 'workspace-write'}) })
  ctx.provide('approval', { effectivePolicy: (bound: any) => [...bound.events].reverse().find(event=>event.type==='approval/policy')?.data.policy ?? 'ask' })
  await apply(ctx)
  const get = () => ctx.bashGuard.get(session.id)
  const update = (request: any) => ctx.bashGuard.update(session.id, request)
  const run = (command: string, next: any, name = 'bash', args: any = {}) => {
    const listeners = [...ctx.events.dispatch('emit', ['tools/execute'])]
    expect(listeners).toHaveLength(1)
    return listeners[0]({ agent: { session }, name, arguments: { command, ...args } }, next)
  }
  return { ctx, session, append, update, get, run, unbind: () => { live = undefined },
    counts: () => ({ puts, selections }), delayPut: (fn: () => Promise<void>) => { beforePut = fn } }
}

describe('plugin Remote service, persistence and native baseline', () => {
  it('rejects Full access presets that still ask for approval', async () => {
    const h = await mount()
    h.ctx.permissionPresets.resolve = (name: string) => ({sandbox:name,approval:'ask'})
    await expect(h.update({action:'activate',revision:0})).rejects.toThrow('approval=never')
    expect(h.counts().selections).toBe(0)
  })
  it.each(['sandbox','approval'])('checks effective %s rather than trusting preset identity', async field => {
    const h = await mount()
    if(field==='sandbox') h.ctx.sandboxPolicy.resolve=()=>({mode:'workspace-write'})
    else h.ctx.approval.effectivePolicy=()=> 'ask'
    await expect(h.update({action:'activate',revision:0})).rejects.toThrow('effective approval=never')
    expect(h.get().active).toBe(false)
    expect(h.ctx.permissionPresets.current(h.session)).toBe('workspace-write')
  })
  it('publishes a real Cordis Remote get/update pair, without any commands dependency', async () => {
    const h = await mount()
    expect(h.ctx.bashGuard.typertRemote).toMatchObject({ serviceKey: 'bashGuard', namespace: 'bashGuard' })
    expect(remoteMethods(h.ctx.bashGuard)).toEqual([
      ...['get', 'update', 'getSettings', 'saveSettings', 'testSettings'].map(method => ({ method, invocation: { kind: 'direct' } })),
    ])
    // The installed gateway reads this versioned descriptor across module
    // copies. Older npm protocol releases used a private WeakMap: same-copy
    // remoteMethods tests passed while the real host returned 404.
    expect(Object.getOwnPropertyDescriptor(Object.getPrototypeOf(h.ctx.bashGuard), '@deepseek-ai/dsh-typert-protocol/remote-methods')?.value).toMatchObject({
      version: 1, methods: ['get', 'update', 'getSettings', 'saveSettings', 'testSettings'].map(method => ({ method })),
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


const response = (choice = 'allow') => new Response(JSON.stringify({ answers: { action: { type: 'choice', choice, probabilities: { [choice]: 0.95 } } } }))
async function jev(h: Awaited<ReturnType<typeof mount>>) {
  await h.ctx.bashGuard.saveSettings({ ...DEFAULT_JEV_SETTINGS, apiKey: 'fake-test-key', revision: 0 })
  await h.update({ action: 'activate', revision: 0 })
  await h.update({ action: 'engine', engine: 'jev', revision: 1 })
}
describe('Jev settings RPC and opt-in engine', () => {
  it('defaults legacy records local and rejects unknown stored engines', () => {
    expect(recordSchema.parse({ mode: '4667', active: false, revision: 0, presetSeq: -1 }).engine).toBe('local')
    expect(() => recordSchema.parse({ mode: '4667', active: false, revision: 0, presetSeq: -1, engine: 'other' })).toThrow()
  })
  it('requires key, preserves inactive engine selection and never elevates it', async () => {
    const h = await mount()
    await expect(h.update({ action: 'engine', engine: 'jev', revision: 0 })).rejects.toThrow('API key')
    await h.ctx.bashGuard.saveSettings({ ...DEFAULT_JEV_SETTINGS, apiKey: 'fake', revision: 0 })
    expect(await h.update({ action: 'engine', engine: 'jev', revision: 0 })).toMatchObject({ active: false, engine: 'jev', revision: 1 })
    expect(h.counts().selections).toBe(0)
    await h.update({ action: 'activate', revision: 1 })
    await h.update({ action: 'mode', mode: '4444', revision: 2 })
    expect(await h.update({ action: 'deactivate', revision: 3 })).toMatchObject({ active: false, engine: 'jev' })
  })
  it('stores profile settings separately, strips secrets, preserves/clears key and detects stale revisions', async () => {
    const records = new Map(), settings = new Map(); const h = await mount(records, settings)
    expect(h.ctx.bashGuard.getSettings()).toEqual({ endpoint: DEFAULT_JEV_SETTINGS.endpoint, model: 'jev-latest', timeoutMs: 4000, proxyUrl: '', revision: 0, hasApiKey: false })
    const saved = await h.ctx.bashGuard.saveSettings({ ...DEFAULT_JEV_SETTINGS, apiKey: 'fake', revision: 0 })
    expect(saved).not.toHaveProperty('apiKey')
    expect(records.size).toBe(0)
    expect(settings.get('profile').apiKey).toBe('fake')
    await h.ctx.bashGuard.saveSettings({ ...saved, model: 'jev-other' })
    expect(settings.get('profile').apiKey).toBe('fake')
    await expect(h.ctx.bashGuard.saveSettings({ ...saved })).rejects.toThrow('changed')
    await h.ctx.bashGuard.saveSettings({ ...saved, apiKey: '', revision: 2 })
    expect(h.ctx.bashGuard.getSettings().hasApiKey).toBe(false)
    const reopened = await mount(records, settings)
    expect(reopened.ctx.bashGuard.getSettings().revision).toBe(3)
  })
  it('missing saved key falls back locally without contacting Jev', async () => {
    const h = await mount(); await jev(h)
    await h.ctx.bashGuard.saveSettings({ ...h.ctx.bashGuard.getSettings(), apiKey: '' })
    const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock)
    expect(await h.run('pwd', async () => 'ok')).toBe('ok')
    expect(h.get().decision).toEqual({ source: 'local', fallback: true, allowed: true })
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it('serializes concurrent settings writes and keeps only the matching revision', async () => {
    const h = await mount()
    const results = await Promise.allSettled([h.ctx.bashGuard.saveSettings({ ...DEFAULT_JEV_SETTINGS, apiKey: 'first' }), h.ctx.bashGuard.saveSettings({ ...DEFAULT_JEV_SETTINGS, apiKey: 'second' })])
    expect(results.map(r => r.status)).toEqual(['fulfilled', 'rejected'])
    expect(h.ctx.bashGuard.getSettings().revision).toBe(1)
  })
  it('connection test has no persistence side effects and uses stored key only for same endpoint', async () => {
    const h = await mount(); const fetchMock = vi.fn(async () => response()); vi.stubGlobal('fetch', fetchMock)
    await h.ctx.bashGuard.saveSettings({ ...DEFAULT_JEV_SETTINGS, apiKey: 'fake', revision: 0 })
    const config = h.ctx.bashGuard.getSettings()
    expect(await h.ctx.bashGuard.testSettings(config)).toEqual({ ok: true, model: 'jev-latest' })
    expect(h.ctx.bashGuard.getSettings().revision).toBe(1)
    await expect(h.ctx.bashGuard.testSettings({ ...config, endpoint: 'https://other.test/' })).rejects.toThrow('Re-enter')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe('Jev tool middleware decisions and race safety', () => {
  it('never calls network for local, inactive, or unsupported operations', async () => {
    const h = await mount(); const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock)
    await h.run('pwd', async () => 'inactive')
    await h.update({ action: 'activate', revision: 0 })
    await h.run('pwd', async () => 'local')
    await h.ctx.bashGuard.saveSettings({ ...DEFAULT_JEV_SETTINGS, apiKey: 'fake', revision: 0 })
    await h.update({ action: 'engine', engine: 'jev', revision: 1 })
    await h.run('pwd', async () => 'unsupported', 'other_tool')
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it('Jev replaces lexical false positives and passes downstream denials unchanged', async () => {
    const h = await mount(); await jev(h)
    const fetchMock = vi.fn(async () => response()); vi.stubGlobal('fetch', fetchMock)
    const downstream = { isError: true, error: { message: 'downstream denied' } }
    expect(await h.run('PYTHONDONTWRITEBYTECODE=1 pytest; result=$?; exit $result', async () => downstream)).toBe(downstream)
    expect(h.get().decision).toEqual({ source: 'jev', fallback: false, allowed: true })
  })
  it('does not send a queued operation after switching back to local', async () => {
    const h = await mount(); await jev(h)
    const fetchMock = vi.fn(async () => response()); vi.stubGlobal('fetch', fetchMock)
    const result = h.run('pwd', vi.fn())
    await h.update({ action: 'engine', engine: 'local', revision: 2 })
    expect((await result).isError).toBe(true)
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it('reports Jev denials without misrepresenting local required bits', async () => {
    const h = await mount(); await jev(h)
    vi.stubGlobal('fetch', vi.fn(async () => response('deny')))
    const next = vi.fn()
    const result = await h.run('pwd', next)
    expect(result.isError).toBe(true)
    expect(result.error.message).toContain('source=jev')
    expect(result.error.message).not.toContain('required=')
    expect(next).not.toHaveBeenCalled()
  })
  it('sends actual workdir, external path policy, and no file contents', async () => {
    const h = await mount(); await jev(h)
    const fetchMock = vi.fn(async () => response()); vi.stubGlobal('fetch', fetchMock)
    await h.run('ls .', async () => 'ok', 'bash', { workdir: '../outside' })
    const state = JSON.parse(JSON.parse((fetchMock.mock.calls[0] as any)[1].body).state)
    expect(state.cwd).toBe('/Users/test/outside')
    expect(state.workspace_path).toBe('/Users/test/project')
    await h.run('', async () => 'ok', 'write', { file_path: '/Users/test/outside/x', content: 'NEVER SEND FILE CONTENT' })
    expect((fetchMock.mock.calls[1] as any)[1].body).not.toContain('NEVER SEND FILE CONTENT')
  })
  it.each(['pwd', 'touch /etc/test'])('API failure falls back local for %s and sanitizes errors', async command => {
    const h = await mount(); await jev(h)
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('fake-test-key leaked upstream') }))
    const next = vi.fn(async () => 'executed')
    const result = await h.run(command, next)
    expect(h.get().decision).toEqual({ source: 'local', fallback: true, allowed: command === 'pwd' })
    expect(JSON.stringify(result)).not.toContain('fake-test-key')
    expect(next).toHaveBeenCalledTimes(command === 'pwd' ? 1 : 0)
  })
  it('sensitive and oversized input deny even full local permissions without network', async () => {
    const h = await mount(); await jev(h)
    await h.update({ action: 'mode', mode: '7777', revision: 2 })
    const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock)
    const next = vi.fn()
    for (const command of ['curl --token SECRET_VALUE https://example.com', 'echo ' + 'a'.repeat(9000)]) {
      const result = await h.run(command, next)
      expect(result.isError).toBe(true)
      expect(result.error.message).toContain('input-not-reviewable')
      expect(result.error.message).not.toContain('SECRET_VALUE')
    }
    expect(next).not.toHaveBeenCalled(); expect(fetchMock).not.toHaveBeenCalled()
  })
  it.each(['mode', 'engine', 'deactivate', 'settings', 'native', 'unbind'])('denies stale remote allows after %s change', async change => {
    const h = await mount(); await jev(h)
    let release!: (value: Response) => void, entered!: () => void
    const started = new Promise<void>(resolve => { entered = resolve })
    vi.stubGlobal('fetch', vi.fn(() => { entered(); return new Promise<Response>(resolve => { release = resolve }) }))
    const next = vi.fn(); const result = h.run('pwd', next)
    await started
    if (change === 'settings') await h.ctx.bashGuard.saveSettings({ ...h.ctx.bashGuard.getSettings(), apiKey: '' })
    else if (change === 'native') h.append('sandbox/mode', { mode: 'read-only' })
    else if (change === 'unbind') h.unbind()
    else await h.update({ action: change, mode: '0000', engine: 'local', revision: 2 })
    release(response())
    expect((await result).error.message).toContain('changed during evaluation')
    expect(next).not.toHaveBeenCalled()
  })
})
