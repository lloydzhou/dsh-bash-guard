import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import vm from 'node:vm'

// Generated artifacts are optional in a source-only checkout; build before release.
describe.skipIf(!existsSync(new URL('../lib/jev.js', import.meta.url)))('built artifact smoke checks', () => {
  it('loads the compiled server with rewritten relative imports', async () => {
    const server = await import('../lib/index.js')
    expect(typeof server.apply).toBe('function')
    expect(server.inject).toContain('approval')
    expect(server.BashGuardService).toBeDefined()
  })
  it('loads the actual client bundle including settings RPC descriptors', () => {
    let api: any
    const context = { window: { __ModuleLoader__: { load: ({ factory }: any) => {
      api = factory((id: string) => { throw new Error(`Unexpected eager host import ${id}`) })
    } } } }
    vm.runInNewContext(readFileSync(new URL('../client.js', import.meta.url), 'utf8'), context)
    expect(typeof api.apply).toBe('function')
    expect(api.guardRemoteContribution.descriptors.map((d: any) => d.method)).toContain('saveSettings')
  })
})
