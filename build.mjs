import ts from 'typescript'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
await mkdir(new URL('./lib/', import.meta.url), { recursive: true })
function compile(source, module) {
  const result = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2023, module, allowJs: true }, reportDiagnostics: true })
  const errors = result.diagnostics?.filter(d => d.category === ts.DiagnosticCategory.Error) ?? []
  if (errors.length) throw new Error(ts.formatDiagnosticsWithColorAndContext(errors, { getCanonicalFileName: x => x, getCurrentDirectory: () => process.cwd(), getNewLine: () => '\n' }))
  return result.outputText
}
const factories = []
for (const name of ['client', 'GuardEditor', 'JevSettings', 'locales']) {
  const source = await readFile(new URL(`./src/${name}.js`, import.meta.url), 'utf8')
  factories.push(`${JSON.stringify('./'+name+'.js')}: (module,exports,require) => {\n${compile(source, ts.ModuleKind.CommonJS)}\n}`)
}
const css = await readFile(new URL('./src/GuardEditor.css', import.meta.url), 'utf8')
await writeFile(new URL('./client.js', import.meta.url), `window.__ModuleLoader__.load({id:'dsh-bash-guard',factory:(hostRequire)=>{\nconst factories={${factories.join(',\n')}};const cache={};function require(id){if(!factories[id])return hostRequire(id);if(cache[id])return cache[id].exports;const module={exports:{}};cache[id]=module;factories[id](module,module.exports,require);return module.exports;}\nconst api=require('./client.js');const original=api.apply;api.apply=(ctx)=>{ctx.effect(()=>{const style=document.createElement('style');style.dataset.plugin='dsh-bash-guard';style.textContent=${JSON.stringify(css)};document.head.append(style);return ()=>style.remove()});return original(ctx)};return api;}});\n`)
for (const name of ['index', 'classify', 'jev']) {
  const source = await readFile(new URL(`./src/${name}.ts`, import.meta.url), 'utf8')
  await writeFile(new URL(`./lib/${name}.js`, import.meta.url), compile(source, ts.ModuleKind.ESNext).replaceAll("'./classify.ts'", "'./classify.js'").replaceAll("'./jev.ts'", "'./jev.js'"))
}
