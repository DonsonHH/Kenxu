import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {openStore} from '../src/store.mjs';
import {createApp} from '../src/app.mjs';
import {createIpLocation} from '../src/ip-location.mjs';

test('compact last use returns only the current user latest IP and cached address without loading history or contacting IPinfo on read',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'last-use-')),store=openStore(dir);let server,calls=0;
 try{
  store.importSource('proxies: [{name: Fixture, type: vless, server: example.test, port: 443}]');
  const p=store.inventory()[0],n=store.meter.register(p.id,'Fixture'),alice=await store.createUser('alice','fixture-last-use-password',[p.id]),bob=await store.createUser('bobby','fixture-last-use-password',[p.id]);await store.setPassword(alice,'fixture-last-use-password');await store.setPassword(bob,'fixture-last-use-password');
  const now=Date.now()-1000;for(const [id,at,ip]of [[alice,now-60000,'1.1.1.1'],[alice,now,'8.8.8.8'],[bob,now,'9.9.9.9']])store.db.prepare('INSERT INTO activity_samples VALUES(?,?,?,?,?,?,?)').run(n.id,id,at,Math.floor(at/60000)*60000,JSON.stringify([ip]),'[]',1);
  store.ipLocation=createIpLocation(store,{token:'fixture-secret',fetchImpl:async()=>{calls++;return new Response(JSON.stringify({ip:'8.8.8.8',country:'US',region:'California',city:'Mountain View',org:'AS15169 Fixture Network'}));}});
  let app;server=http.createServer((req,res)=>app(req,res));await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;app=createApp({store,origin});const session=store.session(alice),headers={Cookie:'donson_local='+session.token},url=origin+'/api/account/last-use';
  assert.equal((await fetch(url)).status,401);const response=await fetch(url+'?userId='+bob,{headers});assert.equal(response.status,200);const data=await response.json();assert.equal(data.ip,'8.8.8.8');assert.equal(data.canLookup,true);assert.equal(calls,0);
  for(const value of ['1.1.1.1','9.9.9.9','fixture-secret',bob,'sources','targets','network','asn'])assert.ok(!JSON.stringify(data).includes(value));
  const lookup=await fetch(origin+'/api/account/ip-location',{method:'POST',headers:{...headers,Origin:origin,'X-CSRF-Token':session.csrf,'Content-Type':'application/json'},body:JSON.stringify({ip:data.ip})});assert.equal(lookup.status,200);assert.equal(calls,1);
  const updated=await(await fetch(url,{headers})).json();assert.equal(updated.location.city,'Mountain View');assert.equal(updated.location.region,'California');assert.equal(updated.canLookup,false);assert.equal(calls,1);assert.ok(!JSON.stringify(updated).includes('Fixture Network'));
  store.db.prepare('DELETE FROM activity_samples WHERE user_id=?').run(alice);assert.equal(await(await fetch(url,{headers})).json(),null);
 }finally{if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}store.close();await rm(dir,{recursive:true,force:true});}
});
