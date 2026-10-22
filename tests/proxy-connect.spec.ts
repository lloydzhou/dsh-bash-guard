import { createServer } from 'node:http'
import { connect } from 'node:net'
import { once } from 'node:events'
import { describe, it, expect } from 'vitest'
import { evaluate, DEFAULT_JEV_SETTINGS } from '../src/jev.ts'

describe('real local HTTP CONNECT proxy',()=>{
 it('routes only the configured Jev request through a proxy tunnel',async()=>{
  const target=createServer((req,res)=>{
   expect(req.headers.authorization).toBe('Bearer fake-local-key')
   res.setHeader('Content-Type','application/json')
   res.end(JSON.stringify({answers:Object.fromEntries(['system','external','network','workspace'].map(s=>[s,{type:'choice',choice:'none',probabilities:{none:0.99}}]))}))
  })
  let tunnels=0
  const proxy=createServer()
  proxy.on('connect',(req,client,head)=>{
   tunnels++
   const upstream=connect((target.address() as any).port,'127.0.0.1',()=>{
    client.write('HTTP/1.1 200 Connection Established\r\n\r\n')
    if(head.length) upstream.write(head)
    upstream.pipe(client);client.pipe(upstream)
   })
   client.on('error',()=>upstream.destroy());upstream.on('error',()=>client.destroy())
   client.on('close',()=>upstream.destroy())
  })
  target.listen(0,'127.0.0.1');await once(target,'listening')
  proxy.listen(0,'127.0.0.1');await once(proxy,'listening')
  try{
   const result=await evaluate({...DEFAULT_JEV_SETTINGS,apiKey:'fake-local-key',endpoint:`http://127.0.0.1:${(target.address() as any).port}/v1/systemone`,proxyUrl:`http://127.0.0.1:${(proxy.address() as any).port}`},'fixed test')
   expect(result.required).toBe('0000');expect(tunnels).toBe(1)
  }finally{target.closeAllConnections();target.close();proxy.close()}
 })
})
