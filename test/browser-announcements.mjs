import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {openStore} from '../src/store.mjs';
import {createApp} from '../src/app.mjs';

const dir=await mkdtemp(path.join(tmpdir(),'kenxu-announcement-browser-')),store=openStore(dir),servers=[],errors=[],checks=[];
const output=path.resolve('test-output/announcements');let browser;
try{
 await mkdir(output,{recursive:true});
 store.importSource('proxies: [{name: "Aether@US3🇺🇸", type: vless, server: fixture.example, port: 443, uuid: fixture-only}]\nproxy-groups: [{name: "Donson - Proxy", type: select, proxies: ["Aether@US3🇺🇸"]}]\nrules: ["MATCH,Donson - Proxy"]');
 const proxy=store.inventory()[0],registration=store.meter.register(proxy.id,'US3 fixture');
 await store.createUser('owner','announcement-owner-password',[],'admin');
 const ids={};for(const name of ['alice','bobby','pending']){ids[name]=await store.createUser(name,'announcement-'+name+'-password',[proxy.id]);if(name!=='pending')await store.setPassword(ids[name],'announcement-'+name+'-password');}
 const noGrant=await store.createUser('no_grant','announcement-no-grant-password',[]);await store.setPassword(noGrant,'announcement-no-grant-password');
 const agent=store.meter.authenticate(registration.token),desired=store.meter.desired(agent);store.meter.report(agent,{epoch:'notice-fixture',seq:1,at:Date.now(),revision:desired.revision,counters:desired.clients.map(c=>({email:c.email,up:0,down:0}))});
 const origins={};for(const role of ['user','admin']){let app;const server=http.createServer((req,res)=>app(req,res));await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));origins[role]='http://127.0.0.1:'+server.address().port;app=createApp({store,origin:origins[role],admin:role==='admin'});servers.push(server);}
 browser=await chromium.launch({headless:true,channel:process.env.PLAYWRIGHT_CHANNEL||'msedge'});
 const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'}),page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));page.setDefaultTimeout(6500);
 const dialog=page.locator('#announcement-dialog');
 async function login(name){await page.locator('#login-form [name=username]').fill(name);await page.locator('#login-form [name=password]').fill('announcement-'+name+'-password');await page.locator('#login-form .primary').click();}
 async function logout(){await page.locator('#logout').click();await page.locator('#login-view').waitFor();}
 await page.goto(origins.user);await page.waitForFunction(()=>!document.body.classList.contains('booting'));assert.equal(await page.locator('#announcement-open').isVisible(),false);
 await login('alice');await dialog.waitFor();assert.ok(await dialog.evaluate(el=>el.open&&el.matches(':modal')&&!el.inert));assert.match(await dialog.innerText(),/2 TB \/ 月/);assert.match(await dialog.innerText(),/整台服务器每月共享/);assert.equal(await dialog.locator('#announcement-done').evaluate(el=>el===document.activeElement),true);
 await page.keyboard.press('Shift+Tab');assert.ok(await dialog.evaluate(el=>el.contains(document.activeElement)),'Keyboard navigation stays in modal controls');await page.keyboard.press('Tab');assert.equal(await dialog.locator('#announcement-done').evaluate(el=>el===document.activeElement),true);
 await page.keyboard.press('Escape');assert.equal(await dialog.evaluate(el=>el.open),false);assert.equal(await page.locator('#announcement-open').evaluate(el=>el===document.activeElement),true);
 await page.reload();await dialog.waitFor();checks.push('Every entry shows the notice until the user opts out; native dialog traps and restores keyboard focus');
 await page.locator('#announcement-snooze').check();await page.locator('#announcement-done').click();await page.reload();await page.waitForFunction(()=>!document.querySelector('#user-view').hidden);assert.equal(await dialog.evaluate(el=>el.open),false);
 await page.locator('#refresh').click();await page.waitForFunction(()=>!document.querySelector('#refresh').disabled);assert.equal(await dialog.evaluate(el=>el.open),false);
 await page.locator('#announcement-open').click();await dialog.waitFor();assert.equal(await page.locator('#announcement-snooze').isChecked(),true);await page.locator('#announcement-close').click();checks.push('24-hour opt-out survives reload; manual reopen remains available and data refresh does not reopen it');
 await logout();await login('bobby');await dialog.waitFor();assert.equal(await page.locator('#announcement-snooze').isChecked(),false);await page.locator('#announcement-done').click();await logout();await login('alice');await page.locator('#user-view').waitFor();assert.equal(await dialog.evaluate(el=>el.open),false);checks.push('Reminder preferences are isolated between accounts on the same browser');
 await page.clock.install();await page.clock.setSystemTime(new Date(Date.now()+25*3600000));await page.reload();await dialog.waitFor();await page.locator('#announcement-snooze').check();await page.locator('#announcement-done').click();checks.push('The notice reappears after the 24-hour deadline');
 await page.route('**/api/me',async route=>{const response=await route.fetch(),body=await response.json();body.announcements=body.announcements.map(notice=>({...notice,revision:'fixture-next-revision'}));await route.fulfill({response,json:body});});
 await page.reload();await dialog.waitFor();await page.locator('#announcement-close').click();await page.unroute('**/api/me');checks.push('A new announcement revision bypasses an older notice suppression');
 for(const theme of ['light','dark'])for(const [width,height]of [[320,700],[390,844],[1440,1000],[3840,2160]]){
  await page.setViewportSize({width,height});await page.getByLabel('外观模式').selectOption(theme);await page.locator('#announcement-open').click();await dialog.waitFor();
  const geometry=await dialog.evaluate(el=>{const box=el.getBoundingClientRect();return {left:box.left,right:box.right,top:box.top,bottom:box.bottom,overflow:el.scrollWidth>el.clientWidth+1,documentOverflow:document.documentElement.scrollWidth>innerWidth+1,animations:el.getAnimations().length};});
  assert.ok(geometry.left>=0&&geometry.right<=width+1&&geometry.top>=0&&geometry.bottom<=height+1&&!geometry.overflow&&!geometry.documentOverflow,JSON.stringify({theme,width,geometry}));assert.equal(geometry.animations,0);
  if(width===390||width===1440)await page.screenshot({path:path.join(output,`notice-${theme}-${width}.png`)});await page.locator('#announcement-close').click();
 }
 checks.push('Light/dark, 320–3840px layouts, mobile scrolling and reduced motion verified');
 await page.setViewportSize({width:1440,height:1000});await page.locator('#announcement-open').click();await page.locator('#announcement-subscription').click();assert.equal(await dialog.evaluate(el=>el.open),false);assert.equal(new URL(page.url()).hash,'#subscription');assert.equal(await page.locator('#page-heading').evaluate(el=>el===document.activeElement),true);checks.push('Subscription action closes the modal, opens the correct section and keeps focus there');
 await page.locator('#announcement-open').click();store.db.prepare('DELETE FROM sessions WHERE user_id=?').run(ids.alice);await page.evaluate(()=>document.querySelector('#refresh').click());await page.locator('#login-view').waitFor();assert.equal(await dialog.evaluate(el=>el.open),false);assert.equal(await page.locator('#announcement-content').innerText(),'');checks.push('Session expiration immediately clears an open announcement and its content');
 await login('pending');await page.locator('#password-view').waitFor();assert.equal(await dialog.evaluate(el=>el.open),false);assert.equal(await page.locator('#announcement-open').isVisible(),false);await logout();
 await page.locator('#login-form [name=username]').fill('no_grant');await page.locator('#login-form [name=password]').fill('announcement-no-grant-password');await page.locator('#login-form .primary').click();await page.locator('#user-view').waitFor();assert.equal(await page.locator('#announcement-open').isVisible(),false);await logout();
 const admin=await context.newPage();admin.on('pageerror',error=>errors.push(error.message));await admin.goto(origins.admin);await admin.locator('#login-form [name=username]').fill('owner');await admin.locator('#login-form [name=password]').fill('announcement-owner-password');await admin.locator('#login-form .primary').click();await admin.locator('#admin-view').waitFor();assert.equal(await admin.locator('#announcement-open').isVisible(),false);assert.equal(await admin.locator('#announcement-dialog').evaluate(el=>el.open),false);checks.push('Guests, pending-password users, users without US3 and administrators do not receive the US3 prompt');
 const blocked=await browser.newContext();await blocked.addInitScript(()=>Object.defineProperty(window,'localStorage',{get(){throw new DOMException('Blocked','SecurityError');}}));const fallback=await blocked.newPage();fallback.on('pageerror',error=>errors.push(error.message));await fallback.goto(origins.user);await fallback.locator('#login-form [name=username]').fill('bobby');await fallback.locator('#login-form [name=password]').fill('announcement-bobby-password');await fallback.locator('#login-form .primary').click();await fallback.locator('#announcement-dialog').waitFor();await fallback.locator('#announcement-snooze').check();await fallback.locator('#announcement-done').click();assert.equal(await fallback.locator('#announcement-dialog').evaluate(el=>el.open),false);assert.ok(await fallback.locator('#user-view').isVisible());checks.push('Unavailable local storage never breaks login or dismissal');
 assert.deepEqual(errors,[]);await writeFile(path.join(output,'results.json'),JSON.stringify({passed:true,checks,browser:browser.version(),at:new Date().toISOString()},null,2));console.log(JSON.stringify({passed:true,checks}));
}catch(error){await writeFile(path.join(output,'results.json'),JSON.stringify({passed:false,checks,error:error.message},null,2));throw error;}
finally{await browser?.close();for(const server of servers){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}await store.aiStatus.stop();store.close();assert.equal(path.dirname(path.resolve(dir)),path.resolve(tmpdir()));assert.ok(path.basename(dir).startsWith('kenxu-announcement-browser-'));await rm(dir,{recursive:true,force:true});}
