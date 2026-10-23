import {chromium} from 'playwright';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import {openStore} from '../src/store.mjs';
import {createApp} from '../src/app.mjs';

const dir=await mkdtemp(path.join(tmpdir(),'kenxu-acceptance-')),store=openStore(dir),servers=[],errors=[],checks=[],observations=[];
let browser;
try{
 await mkdir('test-output/acceptance',{recursive:true});await writeFile('test-output/acceptance/results.json',JSON.stringify({passed:false,status:'running',at:new Date().toISOString()},null,2));
 store.importSource('proxies: [{name: Acceptance Fixture, type: vless, server: fixture.example, port: 443, uuid: fixture-only}]\nrules: ["MATCH,Acceptance Fixture"]');
 await store.createUser('owner','acceptance-owner-password',[],'admin');const friend=await store.createUser('friend','acceptance-friend-password',store.inventory().map(node=>node.id));await store.setPassword(friend,'acceptance-friend-password');
 const origins={};for(const role of ['user','admin']){let app;const server=http.createServer((req,res)=>app(req,res));await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));origins[role]='http://127.0.0.1:'+server.address().port;app=createApp({store,origin:origins[role],admin:role==='admin'});servers.push(server);}
 browser=await chromium.launch({headless:true,channel:process.env.PLAYWRIGHT_CHANNEL||'msedge'});
 async function login(role,options={},setup){
  const page=await browser.newPage({viewport:{width:1440,height:1000},...options});page.setDefaultTimeout(6000);page.on('pageerror',error=>errors.push(error.message));
  if(setup)await page.addInitScript(setup);
  await page.goto(origins[role]);await page.locator('#login-form [name=username]').fill(role==='admin'?'owner':'friend');await page.locator('#login-form [name=password]').fill(role==='admin'?'acceptance-owner-password':'acceptance-friend-password');await page.locator('#login-form .primary').click();await page.waitForFunction(()=>document.querySelector('#page-sync').textContent.startsWith('更新于'));return page;
 }
 const user=await login('user',{forcedColors:'active'},()=>{
  const Native=window.IntersectionObserver;window.readerMetrics=[];
  window.IntersectionObserver=class extends Native{
   constructor(callback,options){super(callback,options);this.metric={targets:new Set()};window.readerMetrics.push(this.metric);}
   observe(element){this.metric.targets.add(element);super.observe(element);}
   unobserve(element){this.metric.targets.delete(element);super.unobserve(element);}
   disconnect(){this.metric.targets.clear();super.disconnect();}
  };
 });await user.locator('#page-heading').click();
 const selected=user.locator('[data-chart-days="7"]');
 const selection=await selected.evaluate(el=>{const style=getComputedStyle(el),other=getComputedStyle(el.nextElementSibling);return {forced:matchMedia('(forced-colors:active)').matches,outlineStyle:style.outlineStyle,outlineWidth:style.outlineWidth,background:style.backgroundColor,shadow:style.boxShadow,otherBackground:other.backgroundColor,color:style.color,otherColor:other.color};});observations.push(selection);
 await user.screenshot({path:'test-output/acceptance/high-contrast-dashboard.png'});
 assert.ok(selection.forced);assert.ok(selection.outlineStyle!=='none'&&parseFloat(selection.outlineWidth)>=1,'Selected range must retain a visible non-color-only marker in forced colors: '+JSON.stringify(selection));
 checks.push('High-contrast range selection remains visible without depending on background colors or shadows');

 await user.getByRole('link',{name:'使用文档',exact:true}).click();const guide=user.locator('[data-panel=knowledge]');await user.waitForFunction(()=>window.readerMetrics.some(metric=>metric.targets.size===4));
 for(const selector of ['.device-switch button[aria-selected=true]','.guide-step-nav button[aria-current=step]']){
  const state=await guide.locator(selector).filter({visible:true}).first().evaluate(el=>({style:getComputedStyle(el).outlineStyle,width:getComputedStyle(el).outlineWidth}));assert.ok(state.style!=='none'&&parseFloat(state.width)>=1);
 }
 const admin=await login('admin',{forcedColors:'active'});await admin.getByRole('link',{name:'用户管理',exact:true}).click();await admin.locator('#users-list .user-row').getByRole('button',{name:'用量详情',exact:true}).click();await admin.locator('#usage-overview-body table').first().waitFor();
 await admin.locator('#usage-log-title').click();const tabState=await admin.locator('[data-usage-tab][aria-selected=true]').evaluate(el=>({style:getComputedStyle(el).outlineStyle,width:getComputedStyle(el).outlineWidth}));assert.ok(tabState.style!=='none'&&parseFloat(tabState.width)>=1);
 await admin.screenshot({path:'test-output/acceptance/high-contrast-admin-tabs.png'});await admin.keyboard.press('Escape');
 await user.emulateMedia({forcedColors:'none',reducedMotion:'reduce'});
 for(let cycle=0;cycle<12;cycle++){
  if(cycle)await user.getByRole('link',{name:'使用文档',exact:true}).click();
  await guide.locator('[data-guide-platform='+['desktop','android','ios'][cycle%3]+']').click();
  await user.waitForFunction(()=>window.readerMetrics.filter(metric=>metric.targets.size>0).length===1);
  assert.equal(await user.evaluate(()=>window.readerMetrics.reduce((sum,metric)=>sum+metric.targets.size,0)),4,'Only four visible-device steps may remain observed');
  await user.getByRole('link',{name:'仪表盘',exact:true}).click();
  assert.equal(await user.evaluate(()=>window.readerMetrics.reduce((sum,metric)=>sum+metric.targets.size,0)),0,'Leaving the guide must disconnect its observer');
 }
 observations.push({guideCycles:12,activeTargetsAfterLeaving:await user.evaluate(()=>window.readerMetrics.reduce((sum,metric)=>sum+metric.targets.size,0))});
 await user.getByRole('link',{name:'使用文档',exact:true}).click();await user.waitForFunction(()=>window.readerMetrics.some(metric=>metric.targets.size===4));
 await user.getByRole('button',{name:'退出',exact:true}).click();await user.locator('#login-view').waitFor();
 assert.equal(await user.evaluate(()=>window.readerMetrics.reduce((sum,metric)=>sum+metric.targets.size,0)),0);assert.equal(await user.locator('#subscription').inputValue(),'');
 checks.push('Twelve combined guide/device cycles keep exactly one four-step observer, disconnect on panel exit and clear private UI on logout');

 const fallback=await login('user',{},()=>{window.IntersectionObserver=undefined;});await fallback.getByRole('link',{name:'使用文档',exact:true}).click();
 const fallbackGuide=fallback.locator('[data-panel=knowledge]');await fallbackGuide.locator('[data-guide-platform=android]').click();await fallbackGuide.locator('[data-device-guide=android] .guide-step-nav [data-jump-step="3"]').click();
 assert.equal(await fallbackGuide.locator('[data-device-guide=android] .guide-step-nav [aria-current=step]').innerText(),'3 选线路');assert.ok(await fallbackGuide.locator('[data-device-guide=android] [data-step="3"] h3').evaluate(el=>el===document.activeElement));
 await fallback.getByRole('link',{name:'我的订阅',exact:true}).click();assert.ok((await fallback.locator('#subscription').inputValue()).startsWith(origins.user));
 checks.push('Without IntersectionObserver, real login, device selection, manual step commands and private subscription navigation still work');

 await fallback.waitForFunction(()=>document.getAnimations().every(animation=>animation.playState!=='running'));let idleUsageReads=0;fallback.on('request',request=>{if(new URL(request.url()).pathname==='/api/usage')idleUsageReads++;});
 await fallback.clock.install();await fallback.clock.fastForward(15000);
 assert.equal(idleUsageReads,0,'Idle feedback must not add a new polling loop below the existing one-minute interval');
 assert.equal(await fallback.evaluate(()=>document.getAnimations().filter(animation=>animation.playState==='running').length),0,'Settled feedback must not leave a continuous decorative animation');
 await fallback.clock.resume();checks.push('Settled feedback has no running animation and adds no usage polling during a 15-second idle window');

 assert.deepEqual(errors,[]);await writeFile('test-output/acceptance/results.json',JSON.stringify({passed:true,checks,observations,at:new Date().toISOString()},null,2));console.log('PASS: '+checks.join('; '));
}catch(error){await writeFile('test-output/acceptance/results.json',JSON.stringify({passed:false,checks,observations,error:error.message,at:new Date().toISOString()},null,2));throw error;}
finally{await browser?.close();for(const server of servers){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}store.close();const resolved=path.resolve(dir);if(path.dirname(resolved)!==path.resolve(tmpdir())||!path.basename(resolved).startsWith('kenxu-acceptance-'))throw Error('Unexpected fixture path');await rm(resolved,{recursive:true,force:true});}
