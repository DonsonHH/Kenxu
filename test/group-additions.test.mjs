import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import YAML from 'yaml';
import {openStore} from '../src/store.mjs';
import {createApp} from '../src/app.mjs';

test('personal AI choices add an authorized JP only for that user and group, persist and never change nodes, rules, tokens or friends',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'kenxu-group-choice-'));let store=openStore(dir),server;
 try{
  store.importSource(YAML.stringify({proxies:[{name:'US fixture',type:'vless',server:'one.fixture.example',port:443,uuid:'fictional-one'},{name:'JP fixture',type:'vless',server:'jp.fixture.example',port:443,uuid:'fictional-jp','kenxu-user-hidden':true},{name:'Denied fixture',type:'vless',server:'denied.fixture.example',port:443,uuid:'fictional-denied'}],'proxy-groups':[{name:'Main',type:'select',proxies:['US fixture']},{name:'AI Policy',type:'select',proxies:['US fixture']},{name:'Hidden balancing',type:'load-balance',proxies:['US fixture'],hidden:true}],rules:['DOMAIN-SUFFIX,ai.fixture.example,AI Policy','MATCH,Main']}));
  const grants=store.inventory().slice(0,2).map(node=>node.id),hdc=await store.createUser('hdc','fixture-group-password',grants),friend=await store.createUser('friend','fixture-friend-password',grants);await store.setPassword(hdc,'fixture-group-password');await store.setPassword(friend,'fixture-friend-password');
  server=createApp({store,origin:'http://127.0.0.1:4450'}).listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));const base='http://127.0.0.1:'+server.address().port;
  const token=store.subscription(store.getUser(hdc)),friendToken=store.subscription(store.getUser(friend));const download=async(t,format='')=>{const r=await fetch(base+'/s/'+t+'.yaml'+(format?'?format='+format:''));assert.equal(r.status,200);return r.text();};
  const before=YAML.parse(await download(token)),friendBefore=await download(friendToken),mobileBefore=await download(token,'shadowrocket'),source=JSON.stringify(store.source());
  let state=store.groupAdditionsState(hdc);assert.deepEqual(state.additions,[]);
  store.saveGroupAdditions({revision:state.revision,groupName:'AI Policy',nodes:['JP fixture']},hdc);
  const after=YAML.parse(await download(token));assert.deepEqual(after['proxy-groups'].find(group=>group.name==='AI Policy').proxies,['US fixture','JP fixture']);assert.deepEqual(after['proxy-groups'].find(group=>group.name==='Main'),before['proxy-groups'].find(group=>group.name==='Main'));assert.deepEqual(after.proxies,before.proxies);assert.deepEqual(after.rules,before.rules);assert.equal(await download(friendToken),friendBefore);assert.equal(await download(token,'shadowrocket'),mobileBefore);assert.ok(YAML.parse(await download(token,'stash'))['proxy-groups'].find(group=>group.name==='AI Policy').proxies.includes('JP fixture'));assert.equal(JSON.stringify(store.source()),source);assert.equal(store.subscription(store.getUser(hdc)),token);
  assert.throws(()=>store.saveGroupAdditions({revision:state.revision,groupName:'Main',nodes:['JP fixture']},hdc),/更新|载入/);state=store.groupAdditionsState(hdc);
  for(const patch of [{groupName:'AI Policy',nodes:['Denied fixture']},{groupName:'AI Policy',nodes:['DIRECT']},{groupName:'Unknown',nodes:['JP fixture']},{groupName:'Hidden balancing',nodes:['JP fixture']}])assert.throws(()=>store.saveGroupAdditions({revision:state.revision,...patch},hdc));
  server.closeAllConnections();await new Promise(resolve=>server.close(resolve));server=null;store.close();store=openStore(dir);assert.deepEqual(store.groupAdditionsState(hdc).additions,[{groupName:'AI Policy',nodes:['JP fixture']}]);assert.ok(YAML.parse(store.config(store.getUser(hdc)))['proxy-groups'].find(group=>group.name==='AI Policy').proxies.includes('JP fixture'));
  store.setAccess(hdc,true,[grants[0]]);const restricted=YAML.parse(store.config(store.getUser(hdc)));assert.ok(!restricted.proxies.some(proxy=>proxy.name==='JP fixture'));assert.ok(!restricted['proxy-groups'].find(group=>group.name==='AI Policy').proxies.includes('JP fixture'),'Saved choices must not bypass later grant removal');
  assert.throws(()=>store.groupAdditionsState(null));assert.throws(()=>store.groupAdditionsState('missing-user'));
  state=store.groupAdditionsState(hdc);store.saveGroupAdditions({revision:state.revision,groupName:'AI Policy',nodes:[]},hdc);assert.deepEqual(store.groupAdditionsState(hdc).additions,[]);
 }finally{if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}store.close();const target=path.resolve(dir);assert.equal(path.dirname(target),path.resolve(tmpdir()));assert.ok(path.basename(target).startsWith('kenxu-group-choice-'));await rm(target,{recursive:true,force:true});}
});
