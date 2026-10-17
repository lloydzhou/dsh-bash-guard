import { describe, expect, it } from 'vitest'
import ts from 'typescript'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

describe('packaged client modules', () => {
  it('includes all new client and server artifacts in the build', () => {
    const build = readFileSync(new URL('../build.mjs', import.meta.url), 'utf8')
    expect(build).toContain("'JevSettings'")
    expect(build).toContain("'jev'")
    expect(build).toContain("'./jev.js'")
  })
  it('resolves settings and locale modules without a bundled React copy', () => {
    const factories: Record<string, any> = {}, cache: Record<string, any> = {}
    for (const name of ['client', 'GuardEditor', 'JevSettings', 'locales']) {
      const source = readFileSync(new URL(`../src/${name}.js`, import.meta.url), 'utf8')
      const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2023 } }).outputText
      factories[`./${name}.js`] = vm.runInNewContext(`(function(module,exports,require){${compiled}\n})`)
    }
    const require = (id: string): any => {
      if (cache[id]) return cache[id].exports
      if (!factories[id]) throw new Error(`Unexpected eager host dependency ${id}`)
      const module = cache[id] = { exports: {} }
      factories[id](module, module.exports, require)
      return module.exports
    }
    const client = require('./client.js')
    expect(typeof client.apply).toBe('function')
    expect(client.guardRemoteContribution.descriptors.map((d: any) => d.method)).toEqual(['get','update','getSettings','saveSettings','testSettings'])
  })
})
