import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import YAML from 'yaml';
import {openStore} from '../src/store.mjs';
import {createApp} from '../src/app.mjs';

test('a personal Cockpit engine bypass precedes AI rules without bypassing Codex or changing other users, nodes or mobile exports',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'kenxu-cockpit-rules-')),store=openStore(dir);let server;
 try{
  const baseRules=['PROCESS-NAME,OneDrive.exe,DIRECT','DOMAIN-SUFFIX,chatgpt.com,AI Policy','MATCH,Donson - Proxy'];
  store.importSource(YAML.stringify({proxies:[{name:'Node A',type:'vless',server:'one.fixture.example',port:443,uuid:'fictional-a'},{name:'Node B',type:'vless',server:'two.fixture.example',port:443,uuid:'fictional-b'}],'proxy-groups':[{name:'Donson - Proxy',type:'select',proxies:['Node A','Node B']},{name:'AI Policy',type:'select',proxies:['Node A','Node B']}],rules:baseRules}));
  await store.createUser('owner','owner-cockpit-fixture',[],'admin');const owner=await store.createUser('hdc','user-cockpit-fixture',[store.inventory()[0].id]),friend=await store.createUser('friend','friend-cockpit-fixture',[store.inventory()[1].id]);await store.setPassword(owner,'user-cockpit-fixture');await store.setPassword(friend,'friend-cockpit-fixture');
  server=createApp({store,origin:'http://127.0.0.1:4451',admin:true}).listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));const base='http://127.0.0.1:'+server.address().port,origin='http://127.0.0.1:4451';
  const login=await fetch(base+'/api/login',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({username:'owner',password:'owner-cockpit-fixture'})}),cookie=login.headers.get('set-cookie').split(';')[0];const me=await(await fetch(base+'/api/me',{headers:{Cookie:cookie}})).json();
  const request=(url,body)=>fetch(base+url,{method:body?'PUT':'GET',headers:{Origin:origin,Cookie:cookie,'X-CSRF-Token':me.csrf,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
  const endpoint='/api/admin/users/'+owner+'/rules';let state=await(await request(endpoint)).json();assert.equal((await request(endpoint,{mode:'prepend',rules:['DOMAIN,personal.fixture.example,DIRECT'],revision:state.revision})).status,200);
  async function downloads(user){const token=store.subscription(store.getUser(user)),out={};for(const format of ['clash','stash','shadowrocket']){const r=await fetch(base+'/s/'+token+'.yaml'+(format==='clash'?'':'?format='+format));assert.equal(r.status,200);out[format]=await r.text();}return out;}
  const before=await downloads(owner),friendBefore=await downloads(friend),source=JSON.stringify(store.source()),users=[owner,friend].map(id=>JSON.stringify(store.getUser(id))),tokens=[owner,friend].map(id=>store.subscription(store.getUser(id)));
  const guards=(await readFile(new URL('../examples/cockpit-windows-direct.rules.txt',import.meta.url),'utf8')).split(/\r?\n/).map(line=>line.trim()).filter(line=>line&&!line.startsWith('#'));assert.equal(guards.length,1);const [type,payload,target]=guards[0].split(',');assert.equal(type,'PROCESS-PATH-REGEX');assert.equal(target,'DIRECT');const matches=new RegExp(payload.replace(/^\(\?i\)/,''),'i');
  for(const executable of [String.raw`C:\Users\Sample\.cockpit_tools\proxy-engine\release-9b8f0691-8199-46b6-b20f-2f67d88c6267\mihomo.exe`,String.raw`D:\Custom Profile\.cockpit_tools\proxy-engine\release-abcd-1234\MIHOMO.EXE`])assert.ok(matches.test(executable),executable);
  for(const executable of [String.raw`C:\Tools\mihomo.exe`,String.raw`C:\ProgramData\clash-verge-service\cores\verge-mihomo.exe`,String.raw`C:\Users\Sample\AppData\Local\OpenAI\Codex\codex.exe`,String.raw`C:\Users\Sample\.cockpit_tools\proxy-engine\release-abcd\codex.exe`,String.raw`C:\Users\Sample\.cockpit_tools_fake\proxy-engine\release-abcd\mihomo.exe`,String.raw`C:\Users\Sample\.cockpit_tools\proxy-engine\release-abcd\mihomo.exe.bak`])assert.ok(!matches.test(executable),executable);
  state=await(await request(endpoint)).json();assert.equal((await request(endpoint,{mode:state.mode,rules:[...guards,...state.rules],revision:state.revision})).status,200);const after=await downloads(owner);
  assert.deepEqual(YAML.parse(after.clash).rules,[...guards,...YAML.parse(before.clash).rules]);assert.deepEqual(YAML.parse(after.clash).proxies,YAML.parse(before.clash).proxies);assert.equal(after.stash,before.stash);assert.equal(after.shadowrocket,before.shadowrocket);assert.deepEqual(await downloads(friend),friendBefore);assert.equal(JSON.stringify(store.source()),source);assert.deepEqual([owner,friend].map(id=>JSON.stringify(store.getUser(id))),users);assert.deepEqual([owner,friend].map(id=>store.subscription(store.getUser(id))),tokens);
  const global=await(await request('/api/admin/rules')).json();assert.equal((await request('/api/admin/rules',{revision:global.revision,rules:['DOMAIN-SUFFIX,new.fixture.example,Donson - Proxy',...baseRules]})).status,200);assert.deepEqual(YAML.parse((await downloads(owner)).clash).rules,[...guards,'DOMAIN,personal.fixture.example,DIRECT','DOMAIN-SUFFIX,new.fixture.example,Donson - Proxy',...baseRules]);assert.ok(!JSON.stringify(await downloads(friend)).includes('cockpit_tools'));
 }finally{if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}store.close();const resolved=path.resolve(dir);assert.equal(path.dirname(resolved),path.resolve(tmpdir()));assert.ok(path.basename(resolved).startsWith('kenxu-cockpit-rules-'));await rm(resolved,{recursive:true,force:true});}
});
