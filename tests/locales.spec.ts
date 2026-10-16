import { describe, it, expect, vi } from 'vitest'
import { zh, en } from '../src/locales.js'
import { createGuardEditor } from '../src/GuardEditor.js'
const React = { createElement: (type:any,props:any,...children:any[])=>({type,props,children}) }
const flatten=(n:any):any[]=>n && typeof n==='object'?[n,...n.children.flatMap(flatten)]:[]
describe('host locale dictionaries',()=>{
 it('keeps identical Chinese and English keys',()=>expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort()))
 it.each([['zh',zh],['en',en]])('renders %s labels and restores 4667',(language,dict)=>{
  const t=(key:string,values:any={})=>dict[key].replace(/\{(\w+)\}/g,(match:string,name:string)=>values[name]??match)
  const onModeChange=vi.fn()
  const nodes=flatten(createGuardEditor(React)({mode:'7777',active:true,t,onModeChange}))
  expect(nodes.filter(n=>n.props?.role==='group').map(n=>n.props['aria-label'])).toContain(t('scope.permissions',{scope:t('scope.workspace')}))
  const reset=nodes.find(n=>n.props?.className?.includes('dsh-bg-all-toggle'))
  expect(reset.children[0]).toBe(t('defaults'))
  reset.props.onClick({stopPropagation(){}})
  expect(onModeChange).toHaveBeenCalledWith('4667')
  expect(nodes.filter(n=>n.props?.role==='checkbox')).toHaveLength(12)
 })
})
