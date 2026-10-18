import {execFileSync} from 'node:child_process'
const git=(...args)=>execFileSync('git',args,{encoding:'utf8',maxBuffer:32*1024*1024})
const revisions=git('rev-list','--all').trim().split('\n')
const rules={personalPath:/\/(?:Users|home)\/(?!test(?:\/|["']|$)|user(?:\/|["']|$)|example(?:\/|["']|$))[^\s/"']+/g,privateKey:/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g,token:/\b(?:ghp_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,}|sk-[A-Za-z0-9]{24,}|AKIA[A-Z0-9]{16})\b/g,credentialURL:/https?:\/\/[^\s/"']+:[^\s/"']+@/g}
let count=0
const seen=new Set()
for(const rev of revisions){
 for(const entry of git('ls-tree','-r',rev).trim().split('\n')){
  const match=entry.match(/^\d+ blob ([a-f0-9]+)\t(.+)$/);if(!match)continue
  const [,id,path]=match;if(seen.has(id))continue;seen.add(id)
  const text=git('cat-file','-p',id)
  text.split('\n').forEach((line,i)=>{for(const [rule,regex]of Object.entries(rules)){regex.lastIndex=0;if(regex.test(line)){console.log(JSON.stringify({revision:rev.slice(0,8),path,line:i+1,rule}));count++}}})
 }
}
console.log(JSON.stringify({revisions:revisions.length,uniqueBlobs:seen.size,findings:count,valuesRedacted:true}))
