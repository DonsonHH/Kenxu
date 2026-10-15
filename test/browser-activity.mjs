import {chromium} from 'playwright';
import {mkdtemp,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import {openStore} from '../src/store.mjs';
import {createApp} from '../src/app.mjs';
import {createActivity} from '../src/activity.mjs';
import {createIpLocation} from '../src/ip-location.mjs';
const dir=await mkdtemp(path.join(tmpdir(),'activity-ui-')),store=openStore(dir),servers=[];let browser;
try{
 store.importSource('proxies: [{name: Fixture, type: vless, server: example.com, port: 443}]');
 const p=store.inventory()[0],registration=store.meter.register(p.id,'Fixture');await store.createUser('owner','activity-owner-password',[],'admin');
 const id=await store.createUser('friend','activity-friend-password',[p.id]),other=await store.createUser('other','activity-other-password',[p.id]);
 await store.setPassword(id,'activity-friend-password');await store.setPassword(other,'activity-other-password');
 store.activity=createActivity(store,{geoLookup:()=>({country:'测试地区',region:'示例'})});
 const agent=store.meter.authenticate(registration.token),desired=store.meter.desired(agent),email=desired.clients.find(c=>c.email.includes(id)).email;
 store.meter.report(agent,{epoch:'ui-activity',seq:1,at:Date.now(),revision:desired.revision,counters:[{email,up:12582912,down:30408704}],activity:[{email,sources:['8.8.8.8'],targets:[{host:'old-target.example',port:443,network:'tcp'}],connections:2}]});
 // Public fixture IP is sent only to this mock, never to a real provider.
 let providerRequests=0;store.ipLocation=createIpLocation(store,{token:'fixture-provider-token',fetchImpl:async()=>{providerRequests++;return new Response(JSON.stringify({ip:'8.8.8.8',country:'US',region:'California',city:'Mountain View',org:'AS64500 Fixture Network'}));}});
 const origins={};for(const role of ['user','admin']){let app;const s=http.createServer((req,res)=>app(req,res));await new Promise(resolve=>s.listen(0,'127.0.0.1',resolve));origins[role]='http://127.0.0.1:'+s.address().port;app=createApp({store,origin:origins[role],admin:role==='admin'});servers.push(s);}
 browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHANNEL?{channel:process.env.PLAYWRIGHT_CHANNEL}:{})});await mkdir('test-output/review-v1.7',{recursive:true});const errors=[];
 async function login(page,role,username,password){page.on('pageerror',e=>errors.push(e.message));await page.goto(origins[role]);await page.locator('#login-form [name=username]').fill(username);await page.locator('#login-form [name=password]').fill(password);await page.locator('#login-form [type=submit]').click();await page.waitForFunction(()=>document.querySelector('#page-sync').textContent.startsWith('更新于'));}
 const user=await browser.newPage({viewport:{width:1440,height:1000}});await login(user,'user','friend','activity-friend-password');
 await user.getByRole('button',{name:'个人中心',exact:true}).click();await user.locator('#account-last-use-location').filter({hasText:'Mountain View'}).waitFor();
 assert.equal(await user.locator('#account-last-use-ip').innerText(),'8.8.8.8');assert.equal(providerRequests,1);assert.equal(await user.locator('#account-sources').count(),0);
 assert.ok(!(await user.locator('#user-view').innerText()).includes('old-target.example'));
 assert.ok((await user.locator('#account-last-use-location').innerText()).includes('California'));assert.ok(!(await user.locator('#user-view').innerText()).includes('Fixture Network'));
 await user.evaluate(()=>{document.activeElement.blur();window.scrollTo(0,0);});await user.waitForFunction(()=>document.getAnimations().every(a=>a.playState!=='running'));await user.screenshot({path:'test-output/review-v1.7/account-sources.png',fullPage:true});
 await user.getByRole('button',{name:'刷新数据',exact:true}).click();await user.locator('#account-last-use-location').filter({hasText:'Mountain View'}).waitFor();assert.equal(providerRequests,1);
 await user.getByLabel('外观模式').selectOption('dark');await user.setViewportSize({width:390,height:844});assert.equal(await user.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await user.evaluate(()=>{document.activeElement.blur();window.scrollTo(0,0);});await user.waitForFunction(()=>document.getAnimations().every(a=>a.playState!=='running'));await user.screenshot({path:'test-output/review-v1.7/account-mobile.png',fullPage:true});
 await user.getByRole('button',{name:'退出',exact:true}).click();await user.locator('#login-view').waitFor();assert.equal(await user.locator('#account-last-use-location').innerText(),'');
 await user.setViewportSize({width:1440,height:1000});await login(user,'user','other','activity-other-password');await user.getByRole('button',{name:'个人中心',exact:true}).click();await user.getByText('暂无使用记录',{exact:true}).waitFor();assert.ok(!(await user.locator('#user-view [data-panel=account]').innerText()).includes('8.8.8.8'));assert.equal(await user.locator('#account-last-use-location').innerText(),'');
 const admin=await browser.newPage({viewport:{width:1440,height:1000}});let summaries=0,sourceReads=0,nativeReads=0;
 admin.on('request',r=>{const url=new URL(r.url());if(url.pathname.endsWith('/activity-summary'))summaries++;if(url.pathname.endsWith('/sources'))sourceReads++;if(url.pathname.endsWith('/usage/users/'+id))nativeReads++;});
 await login(admin,'admin','owner','activity-owner-password');await admin.getByRole('button',{name:'流量统计',exact:true}).click();
 const row=admin.locator('#admin-usage-list .user-row').filter({hasText:'friend'});assert.equal(await row.getByRole('button').count(),1);await row.getByRole('button',{name:'用量详情',exact:true}).click();
 await admin.locator('#usage-overview-body table').first().waitFor();assert.ok((await admin.locator('#usage-overview-body').innerText()).includes('41.00 MB'));assert.equal(summaries,0);assert.equal(sourceReads,0,'Heavy sections are lazy');
 await admin.getByRole('tab',{name:'流量去向',exact:true}).click();await admin.locator('#usage-summary').waitFor();assert.ok((await admin.locator('#usage-sites').innerText()).includes('尚无连接实际字节'));
 assert.equal(await admin.locator('#usage-flow-view').count(),0);assert.equal(await admin.locator('#usage-log-details').count(),0);assert.ok(!(await admin.locator('#usage-log-dialog').innerText()).includes('old-target.example'));
 const at=Math.floor(Date.now()/60000)*60000,flow=(host,down)=>({id:host,email,at,host,port:443,network:'tcp',source:'8.8.8.8',up:0,down,quality:'actual'});
 store.flows.report(agent,{schema:1,epoch:'browser-fixture',seq:1,at:Date.now(),records:[flow('download.example.net',17*1024**2),flow('equal.example.org',10*1024**2),flow('small.example.com',1024**2)]});
 store.flows.heartbeat(agent,{schema:1,epoch:'browser-fixture',at:Date.now(),scope:'all-managed',users:[],backlog:0});
 await admin.locator('#usage-detail-refresh').click();await admin.locator('#usage-sites .usage-site').waitFor();assert.equal(await admin.locator('#usage-sites .usage-site').count(),1);assert.ok((await admin.locator('#usage-sites').innerText()).includes('example.net'));assert.ok(!(await admin.locator('#usage-sites').innerText()).includes('example.org'));assert.ok((await admin.locator('#usage-summary-stats').innerText()).includes('28.00 MB'));assert.ok((await admin.locator('#usage-site-count').innerText()).includes('11.00 MB'));
 await admin.screenshot({path:'test-output/review-v1.7/usage-sites.png',fullPage:true});
 const siteRequests=summaries;await admin.getByRole('tab',{name:'来源 IP',exact:true}).click();await admin.locator('#usage-sources .usage-source').waitFor();assert.equal(sourceReads,1);assert.ok((await admin.locator('#usage-sources').innerText()).includes('Mountain View'));assert.equal(providerRequests,1);
 await admin.getByRole('tab',{name:'用量总览',exact:true}).focus();await admin.keyboard.press('ArrowRight');assert.equal(await admin.getByRole('tab',{name:'流量去向',exact:true}).getAttribute('aria-selected'),'true');assert.equal(summaries,siteRequests,'Returning to a tab uses its loaded result');
 await admin.getByRole('tab',{name:'用量总览',exact:true}).click();assert.equal(nativeReads,1);await admin.screenshot({path:'test-output/review-v1.7/usage-overview.png',fullPage:true});
 await admin.getByRole('tab',{name:'流量去向',exact:true}).click();await admin.setViewportSize({width:390,height:844});await admin.emulateMedia({colorScheme:'dark'});assert.equal(await admin.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await admin.screenshot({path:'test-output/review-v1.7/usage-mobile.png'});
 await admin.route('**/activity-summary?**',route=>route.fulfill({status:503,contentType:'application/json',body:'{"error":"测试连接失败，请重试"}'}));await admin.locator('#usage-detail-refresh').click();await admin.getByText('测试连接失败，请重试',{exact:true}).waitFor();assert.ok(await admin.locator('#usage-log-hours').isEnabled());assert.ok(await admin.locator('#usage-summary').isHidden(),'A failed filter must not present a stale result as current');await admin.unroute('**/activity-summary?**');await admin.locator('#usage-detail-refresh').click();await admin.locator('#usage-summary').waitFor();
 await admin.keyboard.press('Escape');await admin.setViewportSize({width:1440,height:1000});await admin.waitForFunction(()=>document.querySelector('#usage-overview-body').textContent==='');assert.ok(await row.getByRole('button',{name:'用量详情',exact:true}).evaluate(el=>document.activeElement===el),'Closing the native dialog restores focus to its account entry');
 await admin.getByRole('button',{name:'用户管理',exact:true}).click();await admin.locator('#users-list .user-row').filter({hasText:'other'}).getByRole('button',{name:'用量详情',exact:true}).click();await admin.getByText('other · 用量详情',{exact:true}).waitFor();await admin.getByRole('tab',{name:'来源 IP',exact:true}).click();await admin.getByText('此范围尚无来源 IP 记录。',{exact:true}).waitFor();assert.ok(!(await admin.locator('#usage-sources').innerText()).includes('8.8.8.8'));
 await admin.locator('#usage-log-close').click();assert.deepEqual(errors,[]);
 console.log('PASS: one account detail entry, lazy keyboard-accessible tabs, actual-only >10 MiB sites, total preservation, scoped own city/source UI, cached lookup, error recovery, mobile dark and logout/account isolation');
}finally{await browser?.close();for(const s of servers){s.closeAllConnections();await new Promise(resolve=>s.close(resolve));}store.close();await rm(dir,{recursive:true,force:true});}
