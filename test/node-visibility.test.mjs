import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import http from 'node:http';
import YAML from 'yaml';
import {openStore} from '../src/store.mjs';
import {parseSource} from '../src/config.mjs';
import {createApp} from '../src/app.mjs';
test('unmetered backup visibility is independent of delivery, grants, history and metering registration',async()=>{
 const directory=await mkdtemp(path.join(tmpdir(),'kenxu-node-visibility-'));let store=openStore(directory);const servers=[];
 try{
  const raw='proxies: [{name: Primary, type: vless, server: primary.example, port: 443, uuid: source-primary}, {name: Emergency, type: vless, server: backup.example, port: 23330, uuid: source-backup}]\nproxy-groups: [{name: Main, type: select, proxies: [Primary]}, {name: Fallback, type: fallback, hidden: true, proxies: [Primary, Emergency]}]\nrules: ["DOMAIN,example.test,Fallback", "MATCH,Main"]';
  store.importSource(raw);const [primary,backup]=store.inventory();store.meter.register(primary.id,'Primary');
  const id=await store.createUser('visible_friend','fixture-visibility-password',[primary.id,backup.id]);await store.setPassword(id,'fixture-visibility-updated');const outsider=await store.createUser('denied_friend','fixture-denied-password',[primary.id]);await store.setPassword(outsider,'fixture-denied-updated');const adminId=await store.createUser('owner','fixture-owner-password',[],'admin');
  const before=store.config(store.getUser(id)),token=store.subscription(store.getUser(id)),source=parseSource(raw);source.proxies[1]['kenxu-user-hidden']=true;store.importSource(YAML.stringify(source));
  assert.equal(store.inventory().find(n=>n.id===backup.id).userHidden,true,'Visibility belongs to inventory, including unmetered nodes');
  assert.equal(store.config(store.getUser(id)),before,'A presentation change must leave the delivered subscription byte-identical');assert.equal(store.subscription(store.getUser(id)),token);assert.equal(store.meter.nodes().length,1,'Do not create a collector registration just to hide a backup');assert.ok(!store.config(store.getUser(outsider)).includes('source-backup'));
  assert.ok(!store.config(store.getUser(id)).includes('kenxu-user-hidden'),'Private presentation metadata must not enter client configuration');assert.ok(store.rulesState(id).targets.includes('Fallback'));
  for(const admin of [false,true]){let app;const server=http.createServer((req,res)=>app(req,res));await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;app=createApp({store,origin,admin});servers.push(server);
   const session=store.session(admin?adminId:id),headers={Cookie:(admin?'donson_admin':'donson_local')+'='+session.token};
   if(admin){const state=await(await fetch(origin+'/api/admin/state',{headers})).json();assert.ok(state.nodes.some(n=>n.name==='Emergency'&&n.userHidden));}
   else{
    const me=await(await fetch(origin+'/api/me',{headers})).json(),health=await(await fetch(origin+'/api/nodes/status',{headers})).json();assert.deepEqual(me.nodes.map(n=>n.name),['Primary']);assert.deepEqual(health.nodes.map(n=>n.name),['Primary']);
    assert.equal(await(await fetch(origin+'/s/'+token+'.yaml')).text(),before,'The automatic fallback is still delivered through the unchanged token');
   }
  }
  source.proxies[1]['kenxu-user-hidden']='true';assert.throws(()=>store.importSource(YAML.stringify(source)),/可见性/);assert.equal(store.config(store.getUser(id)),before,'Invalid metadata cannot replace the saved source');
 }finally{for(const server of servers){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}store.close();await rm(directory,{recursive:true,force:true});}
});
