import { describe, it, expect, vi } from 'vitest'
import { settingsDraftRequest, createJevSettings } from '../src/JevSettings.js'
import { createGuardTransport, decodeSettings, guardRemoteContribution } from '../src/client.js'
const settings={endpoint:'https://api.typesafe.ai/v1/systemone',model:'jev-latest',timeoutMs:4000,proxyUrl:'http://127.0.0.1:7891',hasApiKey:true,revision:3}
const draft={...settings,apiKey:'',clearKey:false}
const reply=(value:any)=>({ok:true,value})
describe('Jev settings client contract',()=>{
 it('preserves safe diagnostics when host RPC rejects directly',async()=>{
  const api=createGuardTransport({bashGuard:{testSettings:vi.fn().mockRejectedValue(new Error('RPC: JEV_TIMEOUT'))}},'s',()=>null)
  await expect(api.testSettings(settings)).rejects.toMatchObject({diagnostic:'JEV_TIMEOUT'})
 })
 it('preserves blank passwords, clears explicitly, and includes CAS only on save',()=>{
  expect(settingsDraftRequest(draft,settings,true)).toEqual({endpoint:settings.endpoint,model:settings.model,timeoutMs:4000,proxyUrl:settings.proxyUrl,revision:3})
  expect(settingsDraftRequest({...draft,clearKey:true},settings,true).apiKey).toBe('')
  expect(settingsDraftRequest({...draft,apiKey:'new-key'},settings,false).apiKey).toBe('new-key')
  expect(settingsDraftRequest(draft,settings,false)).not.toHaveProperty('revision')
 })
 it('strips secret fields even if unexpectedly returned by server',()=>expect(decodeSettings(reply({...settings,apiKey:'NEVER EXPOSE'}))).toEqual(settings))
 it('defaults legacy public settings to direct and rejects non-string proxies',()=>{
  const {proxyUrl,...legacy}=settings
  expect(decodeSettings(reply(legacy))).toEqual({...legacy,proxyUrl:''})
  expect(decodeSettings(reply({...settings,proxyUrl:''})).proxyUrl).toBe('')
  for(const proxyUrl of [null,123,false,{}]) expect(()=>decodeSettings(reply({...settings,proxyUrl}))).toThrow()
 })
 it('preserves proxy drafts for both save and test, including explicit direct connections',()=>{
  for(const save of [true,false]) {
   expect(settingsDraftRequest(draft,settings,save).proxyUrl).toBe(settings.proxyUrl)
   expect(settingsDraftRequest({...draft,proxyUrl:''},settings,save).proxyUrl).toBe('')
   const {proxyUrl,...legacy}=draft
   expect(settingsDraftRequest(legacy,settings,save)).not.toHaveProperty('proxyUrl')
  }
 })
 it('settings request codecs preserve optional proxy strings without adding omitted fields',()=>{
  for(const method of ['saveSettings','testSettings']) {
   const codec=guardRemoteContribution.descriptors.find((d:any)=>d.method===method).parameters[0].codec.create()
   for(const proxyUrl of [settings.proxyUrl,'']) expect(codec.parse({...settings,proxyUrl}).proxyUrl).toBe(proxyUrl)
   const {proxyUrl,...legacy}=settings
   expect(codec.parse(legacy)).not.toHaveProperty('proxyUrl')
   for(const proxyUrl of [null,123,false,{}]) expect(()=>codec.parse({...settings,proxyUrl})).toThrow()
  }
 })
 it('mounts exact settings RPC names and no session parameter',()=>{
  const descriptors=guardRemoteContribution.descriptors
  expect(descriptors.find((d:any)=>d.method==='getSettings').parameters).toHaveLength(0)
  for(const method of ['saveSettings','testSettings']) expect(descriptors.find((d:any)=>d.method===method).parameters.map((p:any)=>p.name)).toEqual(['request'])
 })
 it('routes settings and engine writes separately',async()=>{
  const getSettings=vi.fn(async()=>reply(settings)),saveSettings=vi.fn(async()=>reply(settings)),testSettings=vi.fn(async()=>reply({ok:true,model:'jev-latest'})),update=vi.fn(async()=>reply({mode:'4667',active:true,engine:'jev',revision:2}))
  const api=createGuardTransport({bashGuard:{getSettings,saveSettings,testSettings,update}},'session',()=>null)
  expect(await api.getSettings()).toEqual(settings)
  await api.saveSettings({...settings,apiKey:'new-key'})
  await api.testSettings(settings)
  await api.write('engine',{revision:1},'jev')
  expect(update).toHaveBeenCalledWith('session',{action:'engine',engine:'jev',revision:1})
  expect(saveSettings.mock.calls[0][0]).not.toHaveProperty('hasApiKey')
  expect(saveSettings.mock.calls[0][0].proxyUrl).toBe(settings.proxyUrl)
  expect(testSettings.mock.calls[0][0].proxyUrl).toBe(settings.proxyUrl)
  await api.saveSettings({...settings,proxyUrl:''})
  await api.testSettings({proxyUrl:''})
  expect(saveSettings.mock.calls[1][0].proxyUrl).toBe('')
  expect(testSettings.mock.calls[1][0]).toEqual({proxyUrl:''})
  const {proxyUrl,...legacy}=settings
  await api.saveSettings(legacy)
  await api.testSettings({})
  expect(saveSettings.mock.calls[2][0]).not.toHaveProperty('proxyUrl')
  expect(testSettings.mock.calls[2][0]).not.toHaveProperty('proxyUrl')
 })
 it('renders the optional proxy field in advanced settings and submits edits',async()=>{
  const states=[settings,draft,'','',false]
  const setDraft=vi.fn(),saveSettings=vi.fn(async()=>settings),testSettings=vi.fn(async()=>({ok:true,model:settings.model}))
  let index=0
  const React={createElement:(type:any,props:any,...children:any[])=>({type,props,children}),useRef:(v:any)=>({current:v}),useState:()=>{const i=index++;return [states[i],i===1?setDraft:vi.fn()]},useEffect:vi.fn(),useId:()=> 'settings-test'}
  const tree=createJevSettings(React)({transport:{saveSettings,testSettings},onClose:vi.fn(),onSaved:vi.fn()})
  const nodes=(node:any):any[]=>node&&typeof node==='object'?[node,...(node.children??[]).flatMap(nodes)]:[]
  const advanced=nodes(tree).find(node=>node.type==='details')
  const proxy=nodes(advanced).find(node=>node.type==='input'&&node.props.placeholder==='http://127.0.0.1:7891')
  expect(proxy.props.value).toBe(settings.proxyUrl)
  expect(proxy.props.required).not.toBe(true)
  expect(proxy.props['aria-describedby']).toBe('settings-test-proxy-note')
  proxy.props.onChange({target:{value:''}})
  expect(setDraft.mock.calls[0][0](draft)).toEqual({...draft,proxyUrl:''})
  await nodes(tree).find(node=>node.type==='form').props.onSubmit({preventDefault:vi.fn()})
  expect(saveSettings).toHaveBeenCalledWith(settingsDraftRequest(draft,settings,true))
 })
 it('loads a saved proxy into the draft without clearing it',async()=>{
  const effects:any[]=[],setDraft=vi.fn(),getSettings=vi.fn(async()=>settings)
  let index=0,refIndex=0
  const dialog={showModal:vi.fn(),querySelector:()=>null}
  const React={createElement:(type:any,props:any,...children:any[])=>({type,props,children}),useRef:(v:any)=>({current:refIndex++===0?dialog:v}),useState:(v:any)=>[v,index++===1?setDraft:vi.fn()],useEffect:(effect:any)=>effects.push(effect),useId:()=> 'settings-test'}
  createJevSettings(React)({transport:{getSettings},onClose:vi.fn(),onSaved:vi.fn()})
  effects[0]()
  await Promise.resolve()
  expect(setDraft).toHaveBeenCalledWith({endpoint:settings.endpoint,model:settings.model,timeoutMs:settings.timeoutMs,proxyUrl:settings.proxyUrl,apiKey:'',clearKey:false})
 })
 it('shows an accessible native dialog with no loaded secret',()=>{
  const React={createElement:(type:any,props:any,...children:any[])=>({type,props,children}),useRef:(v:any)=>({current:v}),useState:(v:any)=>[v,vi.fn()],useEffect:vi.fn(),useId:()=> 'settings-test'}
  const tree=createJevSettings(React)({transport:{},onClose:vi.fn(),onSaved:vi.fn()})
  expect(tree.type).toBe('dialog')
  expect(tree.props['aria-labelledby']).toBe('settings-test-title')
  expect(tree.props.onCancel).toBeTypeOf('function')
  expect(JSON.stringify(tree)).not.toContain('NEVER EXPOSE')
 })
})
