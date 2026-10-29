import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {openStore} from '../src/store.mjs';

test('DNS names containing underscores retain exact flow bytes without blocking ordered delivery or double billing',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'flow-dns-labels-')),s=openStore(dir);
 try{
  s.importSource('proxies: [{name: Fixture, type: vless, server: fixture.example, port: 443}]');
  const proxy=s.inventory()[0],registration=s.meter.register(proxy.id,'Fixture'),id=await s.createUser('friend','fixture-flow-password',[proxy.id]);await s.setPassword(id,'fixture-flow-password');
  const agent=s.meter.authenticate(registration.token),client=s.meter.desired(agent).clients[0],at=Date.now();
  const frame={schema:1,epoch:'dns-label-fixture',seq:1,at,records:[{id:'dns-label-1',email:client.email,at,host:'download_cache.example.com',port:443,network:'tcp',source:'192.0.2.1',up:123,down:456,quality:'actual'}]};
  assert.equal(s.flows.report(agent,frame).ok,true,'A DNS owner name is not restricted to an HTTP hostname');
  assert.equal(s.flows.report(agent,frame).duplicate,true,'Retry of a queued batch remains idempotent');
  assert.equal(s.flows.report(agent,{...frame,seq:2,records:[{...frame.records[0],id:'dns-label-2',host:'_service._tcp.example.com',up:7,down:89}]}).ok,true);
  assert.deepEqual(s.flows.summary(id).total,{up:130,down:545});
  assert.deepEqual(s.meter.totals(id).total,{up:0,down:0},'Classification never changes the native ledger');
  for(const host of ['https://private.example/path','bad label.example','x\n.example','-bad.example','a'.repeat(64)+'.example','example.com/path','example.com?private','example.com#secret','cache%2Eexample.com','name@example.com','example.com\\path','example.com:443']){
   assert.throws(()=>s.flows.report(agent,{...frame,seq:3,records:[{...frame.records[0],host}]}),undefined,'Reject raw URL-like target: '+JSON.stringify(host));
  }
  assert.deepEqual(s.flows.summary(id).total,{up:130,down:545});
  assert.equal(s.flows.report(agent,{...frame,seq:3,records:[{...frame.records[0],host:'2001:db8::1',up:1,down:2}]}).ok,true,'IPv6 colons are literal addresses, not URL delimiters');
  assert.equal(s.flows.report(agent,{...frame,seq:4,records:[{...frame.records[0],host:'例子.测试',up:3,down:4}]}).ok,true,'Unicode DNS names retain ASCII conversion');
  assert.deepEqual(s.flows.summary(id).total,{up:134,down:551});
 }finally{s.close();await rm(dir,{recursive:true,force:true});}
});
