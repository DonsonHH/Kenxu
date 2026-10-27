import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import http from 'node:http';
import YAML from 'yaml';
import {openStore} from '../src/store.mjs';
import {createApp} from '../src/app.mjs';
import {createChainProfiles,CHAIN_PROFILE,JETSON_DIRECT,CHAIN_LOCAL_RULES} from '../src/chain-profile.mjs';

test('private chain exports and capabilities are owner/admin-only; normal delivery remains byte-identical',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'kenxu-chain-')),store=openStore(dir),servers=[];
 try{
  store.importSource(YAML.stringify({proxies:[{name:'Own SG',type:'vless',server:'192.0.2.1',port:443,uuid:'source-sg',tls:true},{name:'Own US',type:'vless',server:'192.0.2.2',port:443,uuid:'source-us',tls:true},{name:'External',type:'vless',server:'192.0.2.3',port:443,uuid:'external-fixture'}],
   'proxy-groups':[{name:'SG Balance',type:'load-balance',strategy:'sticky-sessions',proxies:['Own SG']},{name:'Donson - Proxy',type:'select',proxies:['SG Balance','Own US','External']}],rules:['DOMAIN-SUFFIX,donson.top,DIRECT','PROCESS-NAME,OneDrive.exe,DIRECT','DOMAIN-SUFFIX,foreign.example,Donson - Proxy','GEOIP,CN,DIRECT','MATCH,Donson - Proxy']}));
  for(const p of store.inventory().slice(0,2))store.meter.register(p.id,p.name);
  const owner=await store.createUser('hdc','chain-owner-fixture-password',store.inventory().map(n=>n.id));await store.setPassword(owner,'chain-owner-fixture-password');
  const friend=await store.createUser('friend','chain-friend-fixture-password',store.inventory().map(n=>n.id));await store.setPassword(friend,'chain-friend-fixture-password');
  const admin=await store.createUser('owner','chain-admin-fixture-password',[],'admin');
  const settings={ownerUserId:owner,gateway:{server:'100.64.0.10',port:4465,uuid:'00000000-0000-4000-8000-000000000001'},endpoints:[{server:'192.0.2.1',port:443},{server:'192.0.2.2',port:443}]},profiles=createChainProfiles(store,settings);
  const normal=store.config(store.getUser(owner)),friendNormal=store.config(store.getUser(friend)),userBefore=JSON.stringify(store.getUser(owner)),credentials=JSON.stringify(store.db.prepare('SELECT * FROM meter_credentials ORDER BY email').all());
  const chain=YAML.parse(profiles.config(store.getUser(owner))),original=YAML.parse(normal);
  assert.equal(chain.mode,'rule');assert.deepEqual(chain.rules.slice(0,CHAIN_LOCAL_RULES.length),CHAIN_LOCAL_RULES);
  assert.equal(chain.rules[CHAIN_LOCAL_RULES.length],'DOMAIN-SUFFIX,donson.top,'+JETSON_DIRECT);
  assert.ok(chain.rules.includes('GEOIP,CN,'+JETSON_DIRECT));assert.ok(chain.rules.includes('PROCESS-NAME,OneDrive.exe,'+JETSON_DIRECT));assert.equal(chain.rules.at(-1),'MATCH,Donson - Proxy');
  assert.ok(!chain.proxies.some(p=>p.name==='External'));const hop=chain.proxies.find(p=>p.name===JETSON_DIRECT);assert.equal(hop.type,'vless');assert.equal(hop.uuid,settings.gateway.uuid);assert.equal(hop['dialer-proxy'],'DIRECT');
  for(const p of chain.proxies.filter(p=>p.name!==JETSON_DIRECT)){assert.equal(p['dialer-proxy'],JETSON_DIRECT);assert.equal(p.uuid,original.proxies.find(n=>n.name===p.name).uuid);}
  assert.equal(chain['proxy-groups'].find(g=>g.name==='SG Balance').strategy,'sticky-sessions');assert.deepEqual(chain['proxy-groups'].find(g=>g.name==='GLOBAL').proxies,['Donson - Proxy']);assert.equal(chain['proxy-groups'].find(g=>g.name==='Donson - Proxy').proxies[0],'SG Balance');
  assert.ok(chain.dns.nameserver.every(s=>s.endsWith('#'+JETSON_DIRECT)));assert.throws(()=>profiles.config(store.getUser(friend)));assert.equal(profiles.available(store.getUser(friend)),false);
  const origins={};for(const role of ['user','admin']){let app;const s=http.createServer((req,res)=>app(req,res));await new Promise(resolve=>s.listen(0,'127.0.0.1',resolve));origins[role]='http://127.0.0.1:'+s.address().port;app=createApp({store,origin:origins[role],admin:role==='admin',chainProfiles:profiles});servers.push(s);}
  const session=id=>{const s=store.session(id);return {Cookie:(id===admin?'donson_admin':'donson_local')+'='+s.token};},hdcHeaders=session(owner),friendHeaders=session(friend),adminHeaders=session(admin);
  assert.equal((await fetch(origins.user+'/api/config?profile='+CHAIN_PROFILE)).status,401);
  const me=await(await fetch(origins.user+'/api/me',{headers:hdcHeaders})).json(),other=await(await fetch(origins.user+'/api/me',{headers:friendHeaders})).json();assert.equal(me.privateDelivery.profile,CHAIN_PROFILE);assert.equal(Object.hasOwn(other,'privateDelivery'),false);assert.ok(!JSON.stringify(other).includes(settings.gateway.uuid));
  const plain=await fetch(origins.user+'/api/config',{headers:hdcHeaders});assert.equal(await plain.text(),normal);
  const delivered=await fetch(origins.user+'/api/config?profile='+CHAIN_PROFILE,{headers:hdcHeaders});assert.equal(delivered.status,200);assert.match(delivered.headers.get('content-disposition'),/Kenxu-Jetson.yaml/);assert.deepEqual(YAML.parse(await delivered.text()),chain);
  assert.equal((await fetch(origins.user+'/api/config?profile='+CHAIN_PROFILE,{headers:friendHeaders})).status,404);
  assert.equal((await fetch(origins.user+'/s/'+store.subscription(store.getUser(friend))+'.yaml?profile='+CHAIN_PROFILE)).status,404);
  assert.equal((await fetch(origins.user+'/s/'+store.subscription(store.getUser(owner))+'.yaml?profile='+CHAIN_PROFILE)).status,200);
  assert.equal((await fetch(origins.user+'/api/config?profile='+CHAIN_PROFILE+'&format=shadowrocket',{headers:hdcHeaders})).status,404);
  assert.equal((await fetch(origins.user+'/api/admin/chain-config?profile='+CHAIN_PROFILE,{headers:hdcHeaders})).status,403);
  const adminNormal=await fetch(origins.admin+'/api/admin/chain-config',{headers:adminHeaders});assert.equal(await adminNormal.text(),normal);assert.equal((await fetch(origins.admin+'/api/admin/chain-config?profile='+CHAIN_PROFILE,{headers:adminHeaders})).status,200);
  assert.equal(JSON.stringify(store.getUser(owner)),userBefore);assert.equal(JSON.stringify(store.db.prepare('SELECT * FROM meter_credentials ORDER BY email').all()),credentials);assert.equal(store.config(store.getUser(friend)),friendNormal);
  store.setAccess(owner,false,JSON.parse(store.getUser(owner).grants));assert.equal(profiles.owner(),null);assert.equal(profiles.available(store.getUser(owner)),false);
 }finally{for(const s of servers){s.closeAllConnections();await new Promise(resolve=>s.close(resolve));}await store.aiStatus.stop();store.close();await rm(dir,{recursive:true,force:true});}
});
