import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import YAML from 'yaml';
import {openStore} from '../src/store.mjs';
test('per-user counters: idempotent samples, restart, isolated reset and persisted history',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'meter-test-'));let store=openStore(dir);
 try{
 store.importSource('proxies: [{name: Test, type: vless, server: example.com, port: 443, uuid: legacy-secret}]\nrules: ["MATCH,Test"]');
 const route=store.inventory()[0].id;
 const a=await store.createUser('meter_a','fixture-user-a-password',[route]),b=await store.createUser('meter_b','fixture-user-b-password',[route]),legacy=await store.createUser('not_pilot','fixture-legacy-password',[route]);
 for(const id of [a,b,legacy])store.db.prepare('UPDATE users SET must_change=0 WHERE id=?').run(id);
 const reg=store.meter.register(route,'Pilot');const node=store.meter.authenticate(reg.token);store.meter.allowUser(node.id,a);store.meter.allowUser(node.id,b);
 const d=store.meter.desired(node);assert.equal(d.clients.length,2);assert.notEqual(d.clients[0].id,d.clients[1].id);
 const aConfig=YAML.parse(store.config(store.getUser(a))),bConfig=YAML.parse(store.config(store.getUser(b)));assert.notEqual(aConfig.proxies[0].uuid,bConfig.proxies[0].uuid);assert.throws(()=>store.config(store.getUser(legacy)),/尚未分配/,'Managed pilot nodes no longer fall back to shared credentials for unenrolled users');
 const ca=d.clients.find(c=>c.email.includes(a)),cb=d.clients.find(c=>c.email.includes(b));
 const at=Date.now();const report=(seq,up,down,epoch='epoch-1')=>({seq,epoch,at:at+seq,revision:d.revision,counters:[{email:ca.email,up,down},{email:cb.email,up:0,down:0}]});
 const r1=report(1,100,500);store.meter.report(node,r1);assert.equal(store.meter.usage(a).total.down,500);assert.equal(store.meter.usage(b).total.down,0);
 assert.equal(store.meter.report(node,r1).duplicate,true);assert.equal(store.meter.usage(a).total.down,500);
 assert.throws(()=>store.meter.report(node,{...r1,at:at+100}));
 store.meter.report(node,report(2,150,700));assert.equal(store.meter.usage(a).total.down,700);
 store.meter.report(node,report(1,10,20,'epoch-2'));assert.equal(store.meter.usage(a).total.down,720);
 store.meter.report(node,report(2,5,10,'epoch-2'));assert.equal(store.meter.usage(a).total.down,730);
 assert.throws(()=>store.meter.report(node,{...report(3,6,11,'epoch-2'),counters:[{email:'kenxu:unknown',up:1,down:2}]}));
 const total=store.meter.usage(a).total.down;store.close();store=openStore(dir);assert.equal(store.meter.usage(a).total.down,total);assert.equal(store.meter.usage(b).total.down,0);
 }finally{store.close();await rm(dir,{recursive:true,force:true});}
});
test('a disabled registered gateway never falls back to shared provider credentials',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'meter-disabled-')),store=openStore(dir);
 try{
 store.importSource('proxies: [{name: Gateway, type: vless, server: provider.example, port: 443, uuid: provider-secret}]');
 const proxy=store.inventory()[0],reg=store.meter.register(proxy.id,'Gateway',{clientTemplate:{server:'relay.example',port:443,network:'ws',tls:true}});
 const user=await store.createUser('gateway_user','fixture-password-gateway',[proxy.id]);await store.setPassword(user,'fixture-updated-gateway');
 assert.ok(!store.config(store.getUser(user)).includes('provider-secret'));
 // Simulate an operator disabling this registration, not a client request.
 store.db.prepare('UPDATE meter_nodes SET enabled=0 WHERE id=?').run(reg.id);
 assert.throws(()=>store.config(store.getUser(user)));
 }finally{store.close();await rm(dir,{recursive:true,force:true});}
});
test('Jetson relay subscriptions hide third-party credentials and remove Reality fields',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'meter-relay-'));const store=openStore(dir);
 try{
 store.importSource('proxies: [{name: Purchased, type: vless, server: upstream.example, port: 443, uuid: private-provider-uuid, network: tcp, flow: xtls-rprx-vision, reality-opts: {public-key: private-provider-key}}]');
 const route=store.inventory()[0].id,reg=store.meter.register(route,'Relay',{outboundTag:'provider',clientTemplate:{server:'portal.example',port:443,tls:true,network:'ws','ws-opts':{path:'/relay/v1'}}});
 const user=await store.createUser('relay_friend','fixture-relay-password',[route]);await store.setPassword(user,'fixture-relay-updated');
 const text=store.config(store.getUser(user)),config=YAML.parse(text).proxies[0];
 assert.equal(config.server,'portal.example');assert.equal(config.network,'ws');assert.equal(config.flow,undefined);assert.equal(config['reality-opts'],undefined);assert.ok(!text.includes('private-provider'));assert.equal(store.meter.desired(store.meter.authenticate(reg.token)).clients[0].flow,undefined);
 }finally{store.close();await rm(dir,{recursive:true,force:true});}
});
test('one physical collector isolates its ordinary and forwarded routes',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'meter-routes-'));const store=openStore(dir);
 try{
 store.importSource('proxies: [{name: SG, type: vless, server: example.com, port: 443, uuid: old}, {name: UK, type: vless, server: example.com, port: 443, uuid: other}]\nrules: ["MATCH,SG"]');
 const [sg,uk]=store.inventory();const user=await store.createUser('route_friend','fixture-route-password',[sg.id,uk.id]);store.db.prepare('UPDATE users SET must_change=0 WHERE id=?').run(user);
 const parent=store.meter.register(sg.id,'SG');const child=store.meter.register(uk.id,'UK',{agentId:parent.id,outboundTag:'uk-gusecure2'});
 store.meter.allowUser(parent.id,user);store.meter.allowUser(child.id,user);
 const agent=store.meter.authenticate(parent.token),desired=store.meter.desired(agent);
 assert.equal(desired.routes.length,2);assert.equal(desired.clients.length,2);assert.equal(desired.routes.find(r=>r.nodeId===child.id).outboundTag,'uk-gusecure2');
 store.meter.report(agent,{epoch:'same-core',seq:1,at:Date.now(),revision:desired.revision,counters:desired.clients.map((c,i)=>({email:c.email,up:10,down:100*(i+1)}))});
 const usage=store.meter.usage(user);assert.equal(usage.total.down,300);assert.equal(usage.routes.length,2);assert.ok(usage.routes.every(r=>r.online));
 const outsider=store.meter.register((store.importSource('proxies: [{name: SG, type: vless, server: example.com, port: 443}, {name: UK, type: vless, server: example.com, port: 443}, {name: Other, type: vless, server: example.com, port: 443}]'),store.inventory()[2].id),'Other');
 store.setAccess(user,true,store.inventory().map(n=>n.id));store.meter.allowUser(outsider.id,user);
 const foreign=store.meter.desired(store.meter.authenticate(outsider.token)).clients[0];assert.throws(()=>store.meter.report(agent,{epoch:'same-core',seq:2,at:Date.now(),revision:desired.revision,counters:[{email:foreign.email,up:1,down:1}]}));
 }finally{store.close();await rm(dir,{recursive:true,force:true});}
});

test('residential IPv6 is distinguished from UK forwarding across route metadata without changing delivery or accounting',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'meter-residential-kind-')),store=openStore(dir);
 try{
  store.importSource('proxies: [{name: Native, type: vless, server: fixture.example, port: 443, uuid: fixture-native}, {name: Residential, type: vless, server: fixture.example, port: 443, uuid: fixture-residential}, {name: UK, type: vless, server: fixture.example, port: 443, uuid: fixture-uk}]\nrules: ["MATCH,Native"]');
  const [native,residential,uk]=store.inventory(),parent=store.meter.register(native.id,'Native'),child=store.meter.register(residential.id,'Residential',{agentId:parent.id,outboundTag:'residential-v6'}),british=store.meter.register(uk.id,'UK',{agentId:parent.id,outboundTag:'uk-gusecure2'});
  const user=await store.createUser('residential_friend','residential-fixture-password',[native.id,residential.id,uk.id]);await store.setPassword(user,'residential-updated-password');
  const exportBefore=store.config(store.getUser(user)),agent=store.meter.authenticate(parent.token),desired=store.meter.desired(agent);assert.equal(desired.clients.length,3);
  store.meter.report(agent,{epoch:'kind-review',seq:1,at:Date.now(),revision:desired.revision,counters:desired.clients.map((c,i)=>({email:c.email,up:i+1,down:100*(i+1)}))});
  const usage=store.meter.usage(user),types=store.meter.nodes();
  assert.equal(types.find(n=>n.id===child.id).kind,'residential-ipv6');
  assert.equal(usage.routes.find(n=>n.meterId===child.id).kind,'residential-ipv6');
  assert.equal(store.meter.nodeUsage(child.id).node.kind,'residential-ipv6');
  assert.equal(types.find(n=>n.id===british.id).kind,'forwarded');
  assert.equal(usage.routes.find(n=>n.meterId===parent.id).kind,'direct');
  assert.deepEqual(store.meter.usage(user).total,{up:6,down:600});assert.equal(store.config(store.getUser(user)),exportBefore);assert.deepEqual(store.meter.desired(agent),desired);
 }finally{store.close();await rm(dir,{recursive:true,force:true});}
});
