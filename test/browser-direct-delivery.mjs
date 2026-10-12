import {chromium} from 'playwright';
import {mkdtemp,mkdir,rm} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import http from 'node:http';
import assert from 'node:assert/strict';
import {openStore} from '../src/store.mjs';
import {createApp} from '../src/app.mjs';
const directory=await mkdtemp(path.join(tmpdir(),'kenxu-direct-ui-')),store=openStore(directory),servers=[];let browser;
try{
 store.importSource('proxies: [{name: Primary, type: vless, server: primary.example, port: 443}, {name: HiddenBackup, type: vless, server: backup.example, port: 443, uuid: fixture-provider}]\nproxy-groups: [{name: Main, type: select, proxies: [Primary]}, {name: Internal, type: select, hidden: true, proxies: [HiddenBackup]}]\nrules: ["MATCH,Main"]');
 const [primary,backup]=store.inventory(),main=store.meter.register(primary.id,'Primary'),relay=store.meter.register(backup.id,'HiddenBackup',{clientTemplate:{server:'gateway.example',port:443,network:'ws',tls:true}});
 await store.createUser('owner','owner-direct-fixture',[],'admin');const id=await store.createUser('friend','friend-direct-fixture',store.inventory().map(n=>n.id));await store.setPassword(id,'friend-direct-fixture');
 for(const registration of [main,relay]){const meter=store.meter.authenticate(registration.token),desired=store.meter.desired(meter);store.meter.report(meter,{epoch:'direct-ui',seq:1,at:Date.now(),revision:desired.revision,counters:desired.clients.map(c=>({email:c.email,up:100,down:1000}))});}
 store.db.prepare('UPDATE meter_nodes SET enabled=0,direct_delivery=1,user_hidden=1 WHERE id=?').run(relay.id);
 const origins={};
 for(const role of ['admin','user']){let app;const server=http.createServer((req,res)=>app(req,res));await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;origins[role]=origin;app=createApp({store,origin,admin:role==='admin'});servers.push(server);}
 browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHANNEL?{channel:process.env.PLAYWRIGHT_CHANNEL}:{})});await mkdir('test-output',{recursive:true});const errors=[];
 for(const [role,username,password]of [['admin','owner','owner-direct-fixture'],['user','friend','friend-direct-fixture']]){
  const page=await browser.newPage({viewport:{width:1280,height:900}});page.setDefaultTimeout(6000);page.on('pageerror',error=>errors.push(error.message));await page.goto(origins[role]);
  await page.locator('#login-form [name=username]').fill(username);await page.locator('#login-form [name=password]').fill(password);await page.locator('#login-form [type=submit]').click();await page.waitForFunction(()=>document.querySelector('#page-sync').textContent.startsWith('更新于'));
  if(role==='admin'){
   await page.getByRole('button',{name:'节点管理',exact:true}).click();const card=page.locator('#admin-nodes .route-card').filter({hasText:'HiddenBackup'});assert.match(await card.innerText(),/直连 · 不计量/);assert.match(await card.innerText(),/用户端隐藏/);assert.ok(!(await card.innerText()).includes('采集暂离线'));assert.equal(await page.locator('#fresh-routes').innerText(),'1 / 1');await page.screenshot({path:'test-output/direct-delivery-admin.png',fullPage:true});
  }else{
   await page.getByRole('button',{name:'节点状态',exact:true}).click();assert.equal(await page.locator('#node-list .route-card').count(),1);assert.ok(!(await page.locator('#user-view').innerText()).includes('HiddenBackup'));assert.ok(!(await page.locator('#usage-routes').innerText()).includes('HiddenBackup'));assert.equal(await page.locator('#node-count').innerText(),'1 条线路');await page.screenshot({path:'test-output/direct-delivery-user.png',fullPage:true});
   await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.screenshot({path:'test-output/direct-delivery-user-mobile.png',fullPage:true});
  }
  await page.close();
 }
 assert.deepEqual(errors,[]);console.log('PASS: hidden direct backup stays out of user nodes/history, admin clearly labels it unmetered, active collectors and mobile layout are correct');
}finally{await browser?.close();for(const server of servers){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}store.close();await rm(directory,{recursive:true,force:true});}
