import {test} from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import path from 'node:path';
import {openStore} from '../src/store.mjs';
test('actual flow batches are collector/user scoped, additive, retry-safe and never double-count the existing usage ledger',async()=>{
 const directory=await mkdtemp(path.join(tmpdir(),'flow-store-')),s=openStore(directory);
 try{s.importSource('proxies: [{name: SG, type: vless, server: fixture.example, port: 443},{name: UK,type: vless,server: uk.example,port: 443}]');const [sg,uk]=s.inventory(),n=s.meter.register(sg.id,'SG'),u=await s.createUser('friend','fixture-flow-password',[sg.id,uk.id]);await s.setPassword(u,'fixture-flow-password');const agent=s.meter.authenticate(n.token),desired=s.meter.desired(agent),client=desired.clients[0],at=Math.floor(Date.now()/60000)*60000;
  const report={schema:1,epoch:'fixture-core',seq:1,at:Date.now(),records:[{id:'fixture-flow-id',email:client.email,at,host:'api.example.com',port:443,network:'tcp',source:'192.0.2.1',outbound:'direct',up:100,down:900,closed:true,quality:'actual'}]};
  assert.equal(s.flows.report(agent,report).ok,true);assert.equal(s.flows.report(agent,report).duplicate,true);assert.deepEqual(s.meter.totals(u).total,{up:0,down:0},'Observer must not bill the same native bytes again');const summary=s.flows.summary(u,{hours:24});assert.deepEqual(summary.total,{up:100,down:900});assert.equal(summary.sites[0].site,'example.com');assert.equal(summary.additive,true);assert.equal(summary.scope,'actual-flow-bytes');
  assert.equal(s.activity.latest(u)?.ip,'192.0.2.1','Long running connections must refresh the own-IP field without a new access-log entry');assert.ok(s.activity.hasSource(u,'192.0.2.1'));assert.equal(s.activity.summary(u).sources[0].ip,'192.0.2.1');
  assert.throws(()=>s.flows.report(agent,{...report,seq:2,records:[{...report.records[0],email:'kenxu:foreign:node'}]}));assert.deepEqual(s.flows.summary(u,{hours:24}).total,{up:100,down:900});
  assert.throws(()=>s.flows.report(agent,{...report,records:[{...report.records[0],up:200}]}));
  s.flows.heartbeat(agent,{schema:1,epoch:report.epoch,at:Date.now()-60000,scope:'selected',users:[client.email],backlog:0});
  let coverage=s.flows.summary(u).coverage;assert.equal(coverage.nodes,1);const earlier=coverage.since;
  s.flows.heartbeat(agent,{schema:1,epoch:'new-core',at:Date.now(),scope:'selected',users:[client.email],backlog:0});
  coverage=s.flows.summary(u).coverage;assert.ok(coverage.since>earlier,'Core restart must reset coverage, not imply uninterrupted capture');
  s.flows.heartbeat(agent,{schema:1,epoch:'new-core',at:Date.now(),scope:'selected',users:[client.email],backlog:1});assert.equal(s.flows.summary(u).coverage.nodes,0,'Backlog is not complete coverage');
  s.setAccess(u,true,[]);assert.equal(s.flows.summary(u).coverage.totalNodes,0,'Retained historical credentials are not current delivery coverage');
  const old=at-31*86400000;s.db.prepare('INSERT INTO flow_events(agent_id,user_id,node_id,at,host,port,network,source,up,down,quality) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(agent.id,u,n.id,old,'expired.example',443,'tcp','192.0.2.1',1,2,'actual');s.flows.prune();assert.equal(JSON.stringify(s.db.prepare('SELECT host,source FROM flow_events WHERE at<?').all(Date.now()-30*86400000)).includes('192.0.2.1'),false);
 }finally{s.close();await rm(directory,{recursive:true,force:true});}
});
