import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {openStore} from '../src/store.mjs';
import {createApp} from '../src/app.mjs';
import {createIpLocation} from '../src/ip-location.mjs';

test('personal sources contain only the signed-in user and cached city details, never destinations or foreign IPs',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'account-sources-')),s=openStore(dir);let server,calls=0;
 try{
  s.importSource('proxies: [{name: Fixture, type: vless, server: example.test, port: 443}]');
  const p=s.inventory()[0],n=s.meter.register(p.id,'Fixture'),ids=[];
  for(const name of ['alice','bobby']){const id=await s.createUser(name,'fixture-account-password',[p.id]);await s.setPassword(id,'fixture-account-password');ids.push(id);}
  const now=Date.now()-1000;
  for(const [i,id]of ids.entries())s.db.prepare('INSERT INTO activity_samples VALUES(?,?,?,?,?,?,?)').run(n.id,id,now,Math.floor(now/60000)*60000,JSON.stringify([i?'1.1.1.1':'8.8.8.8']),'[{"host":"private-destination.example","port":443,"network":"tcp"}]',1);
  s.ipLocation=createIpLocation(s,{token:'fixture-private-provider-token',fetchImpl:async()=>{calls++;return new Response(JSON.stringify({ip:'8.8.8.8',country:'US',region:'California',city:'Mountain View',org:'AS15169 Fixture Network'}));}});
  let app;server=http.createServer((req,res)=>app(req,res));await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;app=createApp({store:s,origin});
  const session=s.session(ids[0]),headers={Cookie:'donson_local='+session.token},endpoint=origin+'/api/account/sources';
  assert.equal((await fetch(endpoint)).status,401);
  const read=await fetch(endpoint+'?userId='+ids[1],{headers});assert.equal(read.status,200);let data=await read.json();
  assert.equal(data.sources[0].ip,'8.8.8.8');assert.equal(data.sourceCount,1);assert.equal(calls,0);
  for(const secret of ['1.1.1.1','private-destination','fixture-private-provider-token',ids[1],n.id])assert.ok(!JSON.stringify(data).includes(secret));
  const request=(ip,csrf=session.csrf)=>fetch(origin+'/api/account/ip-location',{method:'POST',headers:{...headers,Origin:origin,'Content-Type':'application/json','X-CSRF-Token':csrf},body:JSON.stringify({ip})});
  assert.equal((await request('8.8.8.8','wrong')).status,403);
  assert.equal((await request('1.1.1.1')).status,400);assert.equal((await request('127.0.0.1')).status,400);assert.equal(calls,0);
  const lookup=await request('8.8.8.8');assert.equal(lookup.status,200);assert.equal((await lookup.json()).city,'Mountain View');assert.equal(calls,1);
  data=await(await fetch(endpoint,{headers})).json();assert.equal(data.sources[0].enrichment.region,'California');assert.equal(data.sources[0].enrichment.network,'Fixture Network');assert.equal(calls,1,'Reading the personal page never contacts the provider');
  assert.equal((await request('8.8.8.8')).status,200);assert.equal(calls,1);
  assert.equal((await fetch(endpoint+'?hours=1',{headers})).status,400);
  for(let i=0;i<5;i++)await request('8.8.8.8');assert.equal((await request('8.8.8.8')).status,429,'Provider operations have an account rate limit separate from login');
 }finally{if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}s.close();await rm(dir,{recursive:true,force:true});}
});
