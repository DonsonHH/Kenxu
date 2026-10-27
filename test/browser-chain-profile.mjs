import {chromium} from 'playwright';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import {openStore} from '../src/store.mjs';
import {createApp} from '../src/app.mjs';
import {createChainProfiles} from '../src/chain-profile.mjs';
const dir=await mkdtemp(path.join(tmpdir(),'kenxu-chain-ui-')),store=openStore(dir),servers=[],errors=[];let browser;
try{
 store.importSource('proxies: [{name: Own SG, type: vless, server: 192.0.2.1, port: 443, uuid: fixture-only}]\nproxy-groups: [{name: Donson - Proxy, type: select, proxies: [Own SG]}]\nrules: ["GEOIP,CN,DIRECT", "MATCH,Donson - Proxy"]');
 const route=store.inventory()[0];store.meter.register(route.id,'Own SG');const owner=await store.createUser('hdc','chain-hdc-browser-password',[route.id]);await store.setPassword(owner,'chain-hdc-browser-password');
 const friend=await store.createUser('friend','chain-friend-browser-password',[route.id]);await store.setPassword(friend,'chain-friend-browser-password');await store.createUser('owner','chain-owner-browser-password',[],'admin');
 const chainProfiles=createChainProfiles(store,{ownerUserId:owner,gateway:{server:'100.64.0.10',port:4465,uuid:'00000000-0000-4000-8000-000000000001'},endpoints:[{server:'192.0.2.1',port:443}]}),origins={};
 for(const role of ['user','admin']){let app;const s=http.createServer((req,res)=>app(req,res));await new Promise(resolve=>s.listen(0,'127.0.0.1',resolve));origins[role]='http://127.0.0.1:'+s.address().port;app=createApp({store,origin:origins[role],admin:role==='admin',chainProfiles});servers.push(s);}
 browser=await chromium.launch({headless:true,channel:process.env.PLAYWRIGHT_CHANNEL||'msedge'});const page=await browser.newPage({viewport:{width:1440,height:1000}});page.setDefaultTimeout(6500);page.on('pageerror',e=>errors.push(e.message));
 async function login(p,role,name){await p.goto(origins[role]);await p.locator('#login-form [name=username]').fill(name);await p.locator('#login-form [name=password]').fill('chain-'+name+'-browser-password');await p.locator('#login-form .primary').click();await p.waitForFunction(()=>document.querySelector('#page-sync').textContent.startsWith('更新于'));}
 await login(page,'user','hdc');await page.getByRole('link',{name:'我的订阅',exact:true}).click();await page.locator('#private-chain-delivery').waitFor();
 assert.equal(await page.getByRole('link',{name:'下载原版 YAML',exact:true}).getAttribute('href'),'/api/config');assert.equal(await page.getByRole('link',{name:'下载 Jetson 链式 YAML',exact:true}).getAttribute('href'),'/api/config?profile=jetson-chain');
 for(const theme of ['dark','light'])for(const width of [320,390,1440]){await page.setViewportSize({width,height:900});await page.getByLabel('外观模式').selectOption(theme);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);}
 await page.setViewportSize({width:1440,height:1000});await page.locator('#logout').click();await page.locator('#login-view').waitFor();assert.equal(await page.locator('#private-chain-delivery').count(),0);
 let forbiddenRequests=0;page.on('request',r=>{if(new URL(r.url()).pathname.startsWith('/api/admin/chain'))forbiddenRequests++;});await login(page,'user','friend');await page.getByRole('link',{name:'我的订阅',exact:true}).click();assert.equal(await page.locator('#private-chain-delivery').count(),0);assert.equal(await page.getByRole('link',{name:'下载 Jetson 链式 YAML',exact:true}).count(),0);assert.equal(forbiddenRequests,0);
 const status=await page.evaluate(async()=>{const me=await(await fetch('/api/me')).json(),r=await fetch('/api/config?profile=jetson-chain');return {status:r.status,capability:Object.hasOwn(me,'privateDelivery')};});assert.deepEqual(status,{status:404,capability:false});
 const admin=await browser.newPage();admin.on('pageerror',e=>errors.push(e.message));await login(admin,'admin','owner');await admin.getByRole('link',{name:'系统设置',exact:true}).click();await admin.locator('#private-chain-delivery').waitFor();assert.match(await admin.locator('#private-chain-delivery h2').innerText(),/hdc/);assert.equal(await admin.getByRole('link',{name:'下载 Jetson 链式 YAML',exact:true}).getAttribute('href'),'/api/admin/chain-config?profile=jetson-chain');await admin.locator('#logout').click();await admin.locator('#login-view').waitFor();assert.equal(await admin.locator('#private-chain-delivery').count(),0);assert.deepEqual(errors,[]);
 await mkdir('test-output/chain',{recursive:true});await writeFile('test-output/chain/results.json',JSON.stringify({passed:true,ownerOnlyUserUI:true,noOtherUserCapabilityOrUI:true,adminPrivateDownloads:true,logoutClears:true,viewportAndThemes:true,errors},null,2));console.log('PASS: only hdc and private administrators see two config downloads; other users have no UI, API capability or private API traffic; logout and 320–1440px themes verified');
}finally{await browser?.close();for(const s of servers){s.closeAllConnections();await new Promise(resolve=>s.close(resolve));}await store.aiStatus.stop();store.close();assert.equal(path.dirname(path.resolve(dir)),path.resolve(tmpdir()));await rm(dir,{recursive:true,force:true});}
