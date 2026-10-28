import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'

// Replicates the production topology: the host root composes a sibling fiber
// that provides sessionQuery, and the plugin loads in its own fiber with a
// declared inject list that does NOT include sessionQuery.
describe('cross-fiber service resolution (rc.3 cordis)', () => {
  it('probes accessor / ctx.get / reflect.get paths', async () => {
    const root = new Context() as any
    root.provide('sessionQuery', { observeSession: async () => ({ header: { parentSession: 'root' } }) })
    const probe: Record<string, any> = {}
    await root.plugin((ctx: any) => {
      Object.defineProperty(ctx, 'sessionQuery', { configurable: true, get() { throw new Error('cannot get property "sessionQuery" without inject') } })
      try { probe.accessor = ctx.sessionQuery } catch (e: any) { probe.accessor = `THREW: ${e.message.slice(0, 40)}` }
      try { probe.get = typeof ctx.get === 'function' ? !!ctx.get('sessionQuery') : 'NO ctx.get' } catch (e: any) { probe.get = `THREW: ${e.message.slice(0, 40)}` }
      try { probe.reflect = !!ctx.reflect?.get?.('sessionQuery', false) } catch (e: any) { probe.reflect = `THREW: ${e.message.slice(0, 40)}` }
    })
    console.log('PROBE', JSON.stringify(probe, null, 1))
    expect(probe.get === true || probe.reflect === true).toBe(true)
  }, 15000)
})
