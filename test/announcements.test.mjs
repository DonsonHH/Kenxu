import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {userAnnouncements} from '../src/announcements.mjs';
import {ANNOUNCEMENT_DAY,announcementSnoozed,setAnnouncementSnooze} from '../public/announcement-model.js';
import {openStore} from '../src/store.mjs';
import {createApp} from '../src/app.mjs';
import YAML from 'yaml';

test('announcement suppression expires at 24 hours and is isolated by account and revision',()=>{
 const values=new Map(),storage={getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)},notice={id:'release',revision:'1'},now=100000;
 assert.equal(announcementSnoozed(storage,'alice',notice,now),false);
 assert.equal(setAnnouncementSnooze(storage,'alice',[notice],true,now),true);
 assert.equal(announcementSnoozed(storage,'alice',notice,now+ANNOUNCEMENT_DAY-1),true);
 assert.equal(announcementSnoozed(storage,'alice',notice,now+ANNOUNCEMENT_DAY),false);
 assert.equal(announcementSnoozed(storage,'bobby',notice,now),false);
 assert.equal(announcementSnoozed(storage,'alice',{...notice,revision:'2'},now),false);
 setAnnouncementSnooze(storage,'alice',[notice],false,now);
 assert.equal(announcementSnoozed(storage,'alice',notice,now),false);
 const failing={getItem(){throw Error('blocked');},setItem(){throw Error('blocked');},removeItem(){throw Error('blocked');}};
 assert.equal(announcementSnoozed(failing,'alice',notice,now),false);
 assert.equal(setAnnouncementSnooze(failing,'alice',[notice],true,now),false);
 values.set('kenxu-announcement:'+JSON.stringify(['alice','release','1']),'Infinity');assert.equal(announcementSnoozed(storage,'alice',notice,now),false);
});

test('US3 notice describes shared native capacity and is restricted to ready, authorized users',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'kenxu-announcement-api-')),store=openStore(dir),servers=[];
 try{
  store.importSource('proxies: [{name: "Aether@US3🇺🇸", type: vless, server: fixture.example, port: 443, uuid: fixture-only}]\nrules: ["MATCH,Aether@US3🇺🇸"]');
  const route=store.inventory()[0],registration=store.meter.register(route.id,'US3 fixture');
  const alice=await store.createUser('alice','announcement-alice-password',[route.id]);await store.setPassword(alice,'announcement-alice-password');
  const noGrant=await store.createUser('no_grant','announcement-no-grant-password',[]);await store.setPassword(noGrant,'announcement-no-grant-password');
  const pending=await store.createUser('pending','announcement-pending-password',[route.id]);
  const owner=await store.createUser('owner','announcement-owner-password',[],'admin');
  const origins={};for(const admin of [false,true]){let app;const server=http.createServer((req,res)=>app(req,res));await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));origins[admin?'admin':'user']='http://127.0.0.1:'+server.address().port;app=createApp({store,origin:origins[admin?'admin':'user'],admin});servers.push(server);}
  async function me(id,admin=false){const session=store.session(id),response=await fetch(origins[admin?'admin':'user']+'/api/me',{headers:{Cookie:(admin?'donson_admin':'donson_local')+'='+session.token}});assert.equal(response.status,200);return response.json();}
  assert.equal((await fetch(origins.user+'/api/me')).status,401);
  const notice=(await me(alice)).announcements;assert.equal(notice.length,1);assert.equal(notice[0].quota,'2 TB / 月');assert.match(notice[0].note,/整台服务器每月共享/);assert.match(notice[0].steps[1],/Donson - Proxy/);
  assert.deepEqual((await me(noGrant)).announcements,[]);assert.deepEqual((await me(pending)).announcements,[]);assert.deepEqual((await me(owner,true)).announcements,[]);
  store.db.prepare('DELETE FROM meter_allowlist WHERE user_id=? AND node_id=?').run(alice,registration.id);assert.deepEqual((await me(alice)).announcements,[]);
  assert.deepEqual(userAnnouncements([]),[]);
 }finally{for(const server of servers){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}await store.aiStatus.stop();store.close();await rm(dir,{recursive:true,force:true});}
});

test('adding an existing US3 node to the default selector preserves balances and filters unauthorized accounts',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'kenxu-us3-choice-')),store=openStore(dir);
 try{
  const source={proxies:[{name:'SG fixture',type:'vless',server:'sg.fixture.example',port:443,uuid:'source-sg'},{name:'Aether@US3🇺🇸',type:'vless',server:'us.fixture.example',port:443,uuid:'source-us'}],
   'proxy-groups':[{name:'SG Balance',type:'load-balance',strategy:'sticky-sessions',proxies:['SG fixture']},{name:'US Balance',type:'load-balance',strategy:'sticky-sessions',proxies:['Aether@US3🇺🇸']},{name:'Donson - Proxy',type:'select',proxies:['SG Balance','US Balance']}],rules:['MATCH,Donson - Proxy']};
  store.importSource(YAML.stringify(source));const [sg,us3]=store.inventory();store.meter.register(sg.id,'SG fixture');store.meter.register(us3.id,'US3 fixture');
  const allowed=await store.createUser('allowed','choice-allowed-password',[sg.id,us3.id]),restricted=await store.createUser('restricted','choice-restricted-password',[sg.id]);await store.setPassword(allowed,'choice-allowed-password');await store.setPassword(restricted,'choice-restricted-password');
  const before=YAML.parse(store.config(store.getUser(allowed))),restrictedBefore=store.config(store.getUser(restricted)),identity=store.getUser(allowed),subscription=store.subscription(identity);
  source['proxy-groups'].find(group=>group.name==='Donson - Proxy').proxies.push('Aether@US3🇺🇸');store.importSource(YAML.stringify(source));
  const after=YAML.parse(store.config(store.getUser(allowed))),main=after['proxy-groups'].find(group=>group.name==='Donson - Proxy');assert.deepEqual(main.proxies,['SG Balance','US Balance','Aether@US3🇺🇸']);main.proxies.pop();assert.deepEqual(after,before);
  assert.equal(store.config(store.getUser(restricted)),restrictedBefore);assert.equal(store.subscription(store.getUser(allowed)),subscription);assert.equal(store.getUser(allowed).password,identity.password);
 }finally{await store.aiStatus.stop();store.close();await rm(dir,{recursive:true,force:true});}
});
