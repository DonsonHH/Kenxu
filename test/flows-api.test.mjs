import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {openStore} from '../src/store.mjs';
import {createApp} from '../src/app.mjs';

test('flow delivery requires collector bearer, isolates SG2/UK identities, and exposes destination bytes only to administration',async()=>{
 const directory=await mkdtemp(path.join(tmpdir(),'flow-api-')),store=openStore(directory),servers=[];
 try{
  store.importSource('proxies: [{name: SG, type: vless, server: example.test, port: 443}, {name: UK, type: vless, server: example.test, port: 443}]');
  const [sg,uk]=store.inventory(),parent=store.meter.register(sg.id,'SG'),child=store.meter.register(uk.id,'UK',{agentId:parent.id,outboundTag:'uk-gusecure2'}),user=await store.createUser('friend','fixture-api-friend',[sg.id,uk.id]),owner=await store.createUser('owner','fixture-api-owner',[],'admin');await store.setPassword(user,'fixture-api-friend');
  const agent=store.meter.authenticate(parent.token),desired=store.meter.desired(agent),origins={};
  for(const role of ['user','admin']){let app;const server=http.createServer((req,res)=>app(req,res));await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));origins[role]='http://127.0.0.1:'+server.address().port;app=createApp({store,origin:origins[role],admin:role==='admin'});servers.push(server);}
  const at=Math.floor(Date.now()/60000)*60000,records=desired.routes.map((r,i)=>({id:'fixture-'+i,email:r.clients[0].email,at,host:r.nodeId===child.id?'uk.example.net':'sg.example.org',port:443,network:'tcp',source:'192.0.2.1',up:10,down:r.nodeId===child.id?200:100,quality:'actual'})),body={schema:1,epoch:'fixture',seq:1,at:Date.now(),records};
  const send=(payload,token)=>fetch(origins.user+'/api/meter/flows',{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:JSON.stringify(payload)});
  assert.equal((await send(body)).status,401);assert.equal((await send(body,'invalid-bearer-token-that-is-long')).status,401);
  assert.equal((await send({...body,records:[{...records[0],email:'kenxu:another-user:another-agent'}]},parent.token)).status,409);
  assert.equal((await send(body,parent.token)).status,200);assert.equal((await(await send(body,parent.token)).json()).duplicate,true);
  assert.deepEqual(store.meter.totals(user).total,{up:0,down:0});
  store.meter.report(agent,{epoch:'native',seq:1,at:Date.now(),revision:desired.revision,counters:records.map(r=>({email:r.email,up:r.up,down:r.down}))});
  const adminSession=store.session(owner),userSession=store.session(user),endpoint='/api/admin/usage/users/'+user+'/activity-summary';
  const response=await fetch(origins.admin+endpoint,{headers:{Cookie:'donson_admin='+adminSession.token}});assert.equal(response.status,200);const summary=await response.json();assert.deepEqual(summary.actual.total,{up:20,down:300});assert.equal(summary.actual.sites.length,2);assert.deepEqual(store.meter.totals(user,child.id).total,{up:10,down:200});
  assert.equal((await fetch(origins.user+endpoint,{headers:{Cookie:'donson_local='+userSession.token}})).status,403);
  const me=await(await fetch(origins.user+'/api/me',{headers:{Cookie:'donson_local='+userSession.token}})).json();assert.equal(me.lastUseIp,'192.0.2.1');assert.ok(!JSON.stringify(me).includes('uk.example.net'));
 }finally{for(const server of servers){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}store.close();await rm(directory,{recursive:true,force:true});}
});
