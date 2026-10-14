import {test} from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import path from 'node:path';
import {openStore} from '../src/store.mjs';import {createActivity} from '../src/activity.mjs';import {createApp} from '../src/app.mjs';
test('minute-boundary filters cannot reveal expired metadata while accounting stays intact',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'activity-boundary-')),s=openStore(dir),realNow=Date.now;
 try{
  s.importSource('proxies: [{name: Fixture, type: vless, server: example.com, port: 443}]');const p=s.inventory()[0],n=s.meter.register(p.id,'Fixture'),u=await s.createUser('friend','boundary-test-password',[p.id]);
  const now=Math.floor(realNow()/60000)*60000+30000,cutoff=now-30*86400000,bucket=Math.floor(cutoff/60000)*60000;
  s.db.prepare('INSERT INTO usage_events(node_id,user_id,at,up,down) VALUES(?,?,?,?,?)').run(n.id,u,cutoff+1,1,2);
  s.db.prepare('INSERT INTO activity_samples VALUES(?,?,?,?,?,?,?)').run(n.id,u,cutoff-1,bucket,'["192.0.2.1"]','[{"host":"expired.example","port":443,"network":"tcp"}]',1);
  Date.now=()=>now;
  assert.equal(s.activity.page(u,{hours:'720'}).items.length,1);assert.deepEqual(s.activity.page(u,{hours:'720'}).items[0].sources,[]);
  assert.equal(s.activity.page(u,{hours:'720',source:'192.0.2.1'}).items.length,0);assert.equal(s.activity.page(u,{hours:'720',target:'expired.example'}).items.length,0);
  assert.equal(s.activity.latest(u),null);assert.equal(s.activity.prune(),1);assert.deepEqual(s.meter.totals(u).total,{up:1,down:2});
  const summary=s.activity.summary(u,{hours:'720'});assert.equal(summary.siteCount,0);assert.deepEqual(summary.withoutTargets,{up:1,down:2});assert.equal(s.activity.hasSource(u,'192.0.2.1'),false);
 }finally{Date.now=realNow;s.close();await rm(dir,{recursive:true,force:true});}
});
test('usage logs keep truthful window totals, isolate collectors/users, deduplicate, paginate and expire private metadata',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'activity-')),s=openStore(dir);let server;
 try{
  s.importSource('proxies: [{name: SG, type: vless, server: sg.example, port: 443, uuid: old}, {name: UK, type: vless, server: uk.example, port: 443, uuid: other}, {name: Other, type: vless, server: other.example, port: 443}]');
  const [sg,uk,other]=s.inventory(),parent=s.meter.register(sg.id,'SG'),child=s.meter.register(uk.id,'UK',{agentId:parent.id,outboundTag:'uk'}),foreign=s.meter.register(other.id,'Other');
  const alice=await s.createUser('alice','alice-activity-fixture',s.inventory().map(n=>n.id)),bob=await s.createUser('bobby','bobby-activity-fixture',[sg.id]);await s.setPassword(alice,'alice-activity-fixture');await s.setPassword(bob,'bobby-activity-fixture');await s.createUser('owner','owner-activity-fixture',[],'admin');
  s.activity=createActivity(s,{geoLookup:()=>({country:'测试地区',region:''})});const agent=s.meter.authenticate(parent.token),desired=s.meter.desired(agent),client=desired.routes.find(r=>r.nodeId===child.id).clients.find(c=>c.email.includes(alice)),foreignClient=s.meter.desired(s.meter.authenticate(foreign.token)).clients.find(c=>c.email.includes(alice)),at=Date.now();
  const report={epoch:'activity-fixture',seq:1,at,revision:desired.revision,counters:[{email:client.email,up:100,down:900}],activity:[{email:client.email,sources:['2001:db8::1'],targets:[{host:'chatgpt.com',port:443,network:'tcp'}],connections:2}]};
  s.meter.report(agent,report);assert.equal(s.meter.report(agent,report).duplicate,true);assert.equal(s.db.prepare('SELECT count(*) n FROM activity_samples').get().n,1);assert.deepEqual(s.meter.usage(alice).total,{up:100,down:900});
  assert.equal(s.meter.report(agent,{...report,activity:[]}).duplicate,true,'Privacy redaction on a durable retry must not double-count traffic or conflict');
  const page=s.activity.page(alice);assert.equal(page.items[0].up,100);assert.equal(page.items[0].node,'UK');assert.equal(page.items[0].sources[0].country,'测试地区');assert.equal(page.items[0].targets[0].host,'chatgpt.com');assert.equal(page.items[0].scope,'sample-window');assert.equal(s.activity.page(bob).items.length,0);assert.equal(s.activity.latest(alice).ip,'2001:db8::1');
  assert.throws(()=>s.meter.report(agent,{...report,seq:2,activity:[{...report.activity[0],email:foreignClient.email}]}),/collector/);assert.deepEqual(s.meter.usage(alice).total,{up:100,down:900},'Rejected activity rolls back accounting');
  assert.throws(()=>s.meter.report(agent,{...report,seq:2,activity:[{...report.activity[0],targets:[{host:'https://private.example/path?token=secret',port:443,network:'tcp'}]}]}),/destination/);
  assert.throws(()=>s.meter.report(agent,{...report,seq:2,activity:[{...report.activity[0],sources:['not-an-ip']}]}),/IP/);
  assert.throws(()=>s.activity.page(alice,{hours:'100000'}));assert.throws(()=>s.activity.page(alice,{cursor:'garbage'}));assert.equal(s.activity.page(alice,{target:'not-seen.example'}).items.length,0);
  for(let i=0;i<35;i++)s.db.prepare('INSERT INTO usage_events(node_id,user_id,at,up,down) VALUES(?,?,?,?,?)').run(child.id,alice,at-60000*(i+1),1,2);
  const first=s.activity.page(alice),next=s.activity.page(alice,{cursor:first.nextCursor});assert.equal(first.items.length,30);assert.equal(next.items.length,6);assert.ok(next.items.every(row=>row.at<first.items.at(-1).at));
  const old=at-31*86400000;s.db.prepare('INSERT INTO activity_samples VALUES(?,?,?,?,?,?,?)').run(child.id,bob,old,Math.floor(old/60000)*60000,'["192.0.2.1"]','[]',1);assert.equal(s.activity.latest(bob),null);assert.equal(s.activity.prune(),1);
  const app=createApp({store:s,origin:'http://127.0.0.1:4450'});server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));const origin='http://127.0.0.1:'+server.address().port,session=s.session(alice),headers={Cookie:'donson_local='+session.token};
  const me=await(await fetch(origin+'/api/me',{headers})).json();assert.equal(me.lastUseIp,'2001:db8::1');assert.ok(!JSON.stringify(me).includes('chatgpt.com'));assert.equal((await fetch(origin+'/api/admin/usage/users/'+alice+'/logs',{headers})).status,403);assert.ok(!JSON.stringify(await(await fetch(origin+'/api/usage',{headers})).json()).includes('2001:db8::1'));
 }finally{if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}s.close();await rm(dir,{recursive:true,force:true});}
});
