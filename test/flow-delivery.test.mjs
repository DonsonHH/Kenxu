import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {openStore} from '../src/store.mjs';

test('delta delivery cannot silently skip a batch or the start of an epoch',async()=>{
 const directory=await mkdtemp(path.join(tmpdir(),'flow-delivery-'));let store=openStore(directory);
 try{
  store.importSource('proxies: [{name: Fixture,type: vless,server: fixture.test,port: 443}]');
  const proxy=store.inventory()[0],registration=store.meter.register(proxy.id,'Fixture'),user=await store.createUser('friend','fixture-delivery-password',[proxy.id]);await store.setPassword(user,'fixture-delivery-password');
  const agent=store.meter.authenticate(registration.token),email=store.meter.desired(agent).clients[0].email,reportAt=Date.now(),at=Math.floor(reportAt/60000)*60000;
  const batch=seq=>({schema:1,epoch:'delivery-fixture',seq,at:reportAt,records:[{id:'fixture-'+seq,email,at,host:'example.test',port:443,network:'tcp',source:'192.0.2.1',up:seq,down:seq*10,quality:'actual'}]});
  assert.throws(()=>store.flows.report(agent,{...batch(2),epoch:'missing-first-fixture'}),/sequence|batch|observation/i,'A delta stream cannot begin at seq 2 without the first batch');
  store.flows.report(agent,batch(1));
  const heartbeat={schema:1,epoch:'delivery-fixture',at:Date.now(),scope:'all-managed',users:[],backlog:0};store.flows.heartbeat(agent,heartbeat);
  assert.equal(store.flows.summary(user).coverage.nodes,1);
  assert.throws(()=>store.flows.report(agent,batch(3)),/sequence|batch|observation/i,'Unlike native cumulative reports, flow deltas cannot jump over seq 2');
  assert.equal(store.flows.summary(user).coverage.nodes,0,'A known delivery gap must immediately hide complete-coverage status');
  store.close();store=openStore(directory);
  store.flows.heartbeat(agent,{...heartbeat,at:Date.now()});assert.equal(store.flows.summary(user).coverage.nodes,0,'An empty heartbeat cannot erase a known missing batch');
  assert.deepEqual(store.flows.summary(user).total,{up:1,down:10},'A rejected batch must not partially enter the category ledger');
  store.flows.report(agent,batch(2));store.flows.heartbeat(agent,{...heartbeat,at:Date.now()});assert.equal(store.flows.summary(user).coverage.nodes,0,'The rejected tail still needs replay after the missing batch');
  store.flows.report(agent,batch(3));store.flows.heartbeat(agent,{...heartbeat,at:Date.now()});
  assert.deepEqual(store.flows.summary(user).total,{up:6,down:60});assert.equal(store.flows.summary(user).coverage.nodes,1);
  assert.equal(store.flows.report(agent,batch(1)).duplicate,true,'Older acknowledged retries still succeed after catch-up');
  assert.deepEqual(store.meter.totals(user).total,{up:0,down:0},'Delivery repair never edits the native billing ledger');
 }finally{store.close();await rm(directory,{recursive:true,force:true});}
});
