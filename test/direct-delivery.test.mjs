import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import YAML from 'yaml';
import {openStore} from '../src/store.mjs';
import {createApp} from '../src/app.mjs';

test('explicit hidden direct delivery bypasses a retired relay, retains history and does not bypass grants',async()=>{
 const directory=await mkdtemp(path.join(tmpdir(),'kenxu-direct-delivery-'));let store=openStore(directory),server;
 try{
  store.importSource('proxies: [{name: Primary, type: vless, server: primary.example, port: 443, uuid: primary-source}, {name: Backup, type: vless, server: provider.example, port: 23330, uuid: provider-source, network: tcp, tls: true, flow: xtls-rprx-vision, reality-opts: {public-key: fixture-key, short-id: "114514"}}]\nproxy-groups: [{name: Main, type: select, proxies: [Primary]}, {name: Internal, type: select, hidden: true, proxies: [Backup]}]\nrules: ["DOMAIN,services.googleapis.cn,Internal", "MATCH,Main"]');
  const [primary,backup]=store.inventory(),main=store.meter.register(primary.id,'Primary'),relay=store.meter.register(backup.id,'Backup',{clientTemplate:{server:'gateway.example',port:443,tls:true,network:'ws','ws-opts':{path:'/relay/backup'}}});
  const userId=await store.createUser('direct_friend','fixture-direct-password',store.inventory().map(n=>n.id));await store.setPassword(userId,'fixture-direct-updated');
  const outsider=await store.createUser('direct_outsider','fixture-outsider-password',[primary.id]);await store.setPassword(outsider,'fixture-outsider-updated');
  const meter=store.meter.authenticate(relay.token),desired=store.meter.desired(meter);
  store.meter.report(meter,{epoch:'direct-fixture',seq:1,at:Date.now(),revision:desired.revision,counters:desired.clients.map(c=>({email:c.email,up:100,down:500}))});
  const oldTotal=store.meter.usage(userId).total,oldToken=store.subscription(store.getUser(userId)),credential=store.db.prepare('SELECT uuid FROM meter_credentials WHERE user_id=? AND node_id=?').get(userId,relay.id).uuid;
  store.db.prepare('UPDATE meter_nodes SET enabled=0,direct_delivery=1,user_hidden=1 WHERE id=?').run(relay.id);
  assert.equal(store.meter.authenticate(relay.token),null,'No live relay collector may continue using this retired registration');
  assert.deepEqual(store.meter.usage(userId).total,oldTotal);assert.ok(store.meter.usage(userId).routes.some(r=>r.name==='Backup'&&r.kind==='direct-unmetered'));
  const config=YAML.parse(store.config(store.getUser(userId))),direct=config.proxies.find(p=>p.name==='Backup');
  assert.equal(direct.server,'provider.example');assert.equal(direct.uuid,'provider-source');assert.equal(direct.network,'tcp');assert.equal(direct['reality-opts']['public-key'],'fixture-key');
  assert.ok(!JSON.stringify(config).includes('gateway.example'));assert.equal(config['proxy-groups'].find(g=>g.name==='Internal').hidden,true);
  assert.equal(store.db.prepare('SELECT uuid FROM meter_credentials WHERE user_id=? AND node_id=?').get(userId,relay.id).uuid,credential);
  assert.equal(store.subscription(store.getUser(userId)),oldToken);assert.ok(!store.config(store.getUser(outsider)).includes('provider-source'));
  const later=await store.createUser('later_friend','fixture-later-password',[primary.id,backup.id]);await store.setPassword(later,'fixture-later-updated');
  assert.ok(store.config(store.getUser(later)).includes('provider-source'),'New authorized accounts retain hidden direct delivery');
  assert.equal(store.db.prepare('SELECT count(*) n FROM meter_credentials WHERE user_id=? AND node_id=?').get(later,relay.id).n,0,'Direct delivery must not create unused metering identities');
  store.setAccess(outsider,true,[primary.id,backup.id]);assert.ok(store.config(store.getUser(outsider)).includes('provider-source'),'An explicit later grant activates direct delivery');
  assert.ok(store.rulesState(userId).targets.includes('Internal'),'Authorized direct rules must remain reachable');
  server=createApp({store,origin:'http://127.0.0.1:4450'}).listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));const origin='http://127.0.0.1:'+server.address().port,session=store.session(userId),headers={Cookie:'donson_local='+session.token};
  const me=await(await fetch(origin+'/api/me',{headers})).json();assert.ok(!me.nodes.some(n=>n.name==='Backup'));
  const health=await(await fetch(origin+'/api/nodes/status',{headers})).json();assert.ok(!health.nodes.some(n=>n.name==='Backup'));
  const usage=await(await fetch(origin+'/api/usage',{headers})).json();assert.ok(!usage.routes.some(r=>r.name==='Backup'));assert.deepEqual(usage.total,oldTotal);
  const delivered=YAML.parse(await(await fetch(origin+'/s/'+oldToken+'.yaml')).text());assert.equal(delivered.proxies.find(p=>p.name==='Backup').server,'provider.example');
  store.db.prepare('DELETE FROM meter_allowlist WHERE user_id=? AND node_id=?').run(userId,relay.id);assert.ok(!store.config(store.getUser(userId)).includes('provider-source'),'Pending enrollment stays fail-closed');
  store.db.prepare('UPDATE meter_nodes SET direct_delivery=0,user_hidden=0 WHERE id=?').run(relay.id);assert.ok(!store.config(store.getUser(userId)).includes('provider-source'),'Ordinary disabled managed gateways never fall back to shared credentials');
  server.closeAllConnections();await new Promise(resolve=>server.close(resolve));server=null;
  store.close();store=openStore(directory);assert.deepEqual(store.meter.usage(userId).total,oldTotal);
 }finally{if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}store.close();await rm(directory,{recursive:true,force:true});}
});
