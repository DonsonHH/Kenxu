import {chromium} from 'playwright';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import {openStore} from '../src/store.mjs';
import {createApp} from '../src/app.mjs';

const dir=await mkdtemp(path.join(tmpdir(),'kenxu-micro-')),store=openStore(dir),servers=[],errors=[],checks=[];
let browser;
try{
 await mkdir('test-output/microinteractions',{recursive:true});await writeFile('test-output/microinteractions/results.json',JSON.stringify({passed:false,status:'running',at:new Date().toISOString()},null,2));
 store.importSource('proxies: [{name: Micro Fixture, type: vless, server: fixture.example, port: 443, uuid: fixture-only}]\nrules: ["MATCH,Micro Fixture"]');
 await store.createUser('owner','micro-owner-password',[],'admin');const friend=await store.createUser('friend','micro-friend-password',store.inventory().map(n=>n.id));await store.setPassword(friend,'micro-friend-password');
 const registration=store.meter.register(store.inventory()[0].id,'Micro fixture collector'),collector=store.meter.authenticate(registration.token);store.meter.allowUser(collector.id,friend);const desired=store.meter.desired(collector);
 store.meter.report(collector,{epoch:'micro-fixture',seq:1,at:Date.now(),revision:desired.revision,counters:desired.clients.map(client=>({email:client.email,up:2*1024**2,down:9*1024**2}))});
 const origins={};for(const role of ['user','admin']){let app;const server=http.createServer((req,res)=>app(req,res));await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));origins[role]='http://127.0.0.1:'+server.address().port;app=createApp({store,origin:origins[role],admin:role==='admin'});servers.push(server);}
 browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHANNEL?{channel:process.env.PLAYWRIGHT_CHANNEL}:{})});
 async function login(role,username,password){const page=await browser.newPage({viewport:{width:1440,height:1100}});page.setDefaultTimeout(6500);page.on('pageerror',error=>errors.push(error.message));await page.addInitScript(()=>{window.microMotion=[];window.microTransitions=[];document.addEventListener('transitionrun',event=>window.microTransitions.push({property:event.propertyName,pseudo:event.pseudoElement,range:event.target.dataset.chartDays}));const animate=Element.prototype.animate;Element.prototype.animate=function(frames,options){window.microMotion.push({id:this.id,frames,options});return animate.call(this,frames,options);};});await page.goto(origins[role]);await page.locator('#login-form [name=username]').fill(username);await page.locator('#login-form [name=password]').fill(password);await page.locator('#login-form button').click();await page.waitForFunction(()=>document.querySelector('#page-sync').textContent.startsWith('更新于'));return page;}
 const user=await login('user','friend','micro-friend-password');
 const subscription=await user.locator('#subscription').inputValue(),exportBefore=await(await fetch(subscription)).text();
 const range=user.locator('.chart-switch'),beforeMotion=await user.evaluate(()=>window.microMotion.length);let usageReads=0;user.on('request',request=>{if(new URL(request.url()).pathname==='/api/usage')usageReads++;});
 await range.locator('[data-chart-days="7"]').focus();await user.keyboard.press('ArrowRight');
 assert.equal(await range.locator('[data-chart-days="30"]').getAttribute('aria-pressed'),'true','Arrow navigation should activate the next local chart range');
 assert.equal(await range.locator('[data-chart-days="30"]').evaluate(el=>el===document.activeElement),true);
 assert.equal(await range.locator('button[tabindex="0"]').count(),1);
 await user.keyboard.press('Home');assert.equal(await range.locator('[data-chart-days="7"]').getAttribute('aria-pressed'),'true');
 await user.keyboard.press('Control+ArrowRight');assert.equal(await range.locator('[data-chart-days="7"]').getAttribute('aria-pressed'),'true','Modified shortcuts must not be consumed');
 assert.equal(await user.evaluate(()=>window.microMotion.length),beforeMotion);assert.equal(usageReads,0,'Changing chart range is local and does not request usage again');
 checks.push('Range buttons support arrows/Home with one tab stop, preserve modified shortcuts and never animate or fetch data on keyboard use');

 await user.emulateMedia({reducedMotion:'no-preference'});const rangeBox=await range.boundingBox();await range.locator('[data-chart-days="30"]').click();
 await user.waitForFunction(()=>window.microTransitions.some(event=>event.range==='30'&&event.property==='opacity'&&event.pseudo==='::before'),undefined,{timeout:1500});
 const fill=await range.locator('[data-chart-days="30"]').evaluate(el=>{const style=getComputedStyle(el,'::before');return {duration:style.transitionDuration,property:style.transitionProperty,content:style.content};});
 assert.equal(fill.property,'opacity');assert.equal(fill.duration,'0.12s');assert.notEqual(fill.content,'none');
 assert.ok(Math.abs((await range.boundingBox()).width-rangeBox.width)<=1);assert.equal(usageReads,0);
 assert.equal(await range.locator('[data-chart-days="30"]').getAttribute('tabindex'),'0','A native pointer click must also update the roving tab stop');
 checks.push('Pointer selection fades only a 120ms button surface without resizing the group or refetching/animating chart data');

 await user.getByRole('button',{name:'使用文档',exact:true}).click();const guide=user.locator('#user-view [data-panel=knowledge]'),devices=guide.locator('.device-switch');
 const beforeDeviceMotion=await user.evaluate(()=>window.microMotion.length);
 await devices.locator('[data-guide-platform=desktop]').focus();await user.keyboard.press('ArrowRight');
 assert.equal(await devices.locator('[data-guide-platform=android]').getAttribute('aria-pressed'),'true');assert.equal(await devices.locator('button[tabindex="0"]').count(),1);
 const android=guide.locator('[data-device-guide=android]'),steps=android.locator('.guide-step-nav');assert.ok(await android.isVisible());
 await steps.locator('[data-jump-step="1"]').focus();await user.keyboard.press('ArrowRight');
 assert.equal(await steps.locator('[data-jump-step="2"]').evaluate(el=>el===document.activeElement),true);assert.equal(await steps.locator('[data-jump-step="1"]').getAttribute('aria-current'),'step','Arrow focus does not jump the reading position');
 await user.keyboard.press('Enter');assert.equal(await steps.locator('[data-jump-step="2"]').getAttribute('aria-current'),'step');assert.equal(await android.locator('[data-step="2"] h3').evaluate(el=>el===document.activeElement),true);
 assert.equal(await user.evaluate(()=>window.microMotion.length),beforeDeviceMotion,'Keyboard device and step navigation must not animate');
 await devices.locator('[data-guide-platform=android]').focus();await user.keyboard.press('End');assert.ok(await guide.locator('[data-device-guide=ios]').isVisible());await user.keyboard.press('Home');assert.ok(await guide.locator('[data-device-guide=desktop]').isVisible());
 checks.push('Device choices and step commands support keyboard navigation without changing command/heading focus semantics');

 const desktop=guide.locator('[data-device-guide=desktop]');await user.evaluate(()=>window.guideFocusBefore=document.activeElement);
 await desktop.locator('[data-step="3"]').evaluate(el=>el.scrollIntoView({block:'start',behavior:'instant'}));
 await user.waitForFunction(()=>document.querySelector('[data-device-guide=desktop] .guide-reading-status').textContent.includes('3 / 4'),undefined,{timeout:2000});
 assert.equal(await desktop.locator('.guide-step-nav [data-jump-step="3"]').getAttribute('aria-current'),'step');
 assert.equal(await desktop.locator('.guide-next[aria-current=step]').count(),0,'Current-step state belongs to the navigation, not to a continue command');
 assert.equal(await desktop.locator('.guide-checks input:checked').count(),0,'Reading a step must not mark setup complete');
 assert.equal(await user.evaluate(()=>document.activeElement===window.guideFocusBefore),true,'Scrolling must not steal keyboard focus');
 await user.getByRole('button',{name:'我的订阅',exact:true}).click();assert.match(await desktop.locator('.guide-reading-status').innerText(),/3 \/ 4/);
 await user.getByRole('button',{name:'使用文档',exact:true}).click();await user.waitForFunction(()=>document.querySelector('[data-device-guide=desktop] .guide-reading-status').textContent.includes('1 / 4'));
 checks.push('Guide position follows actual reading without checking completion, changing focus, or retaining stale position on panel return');

 const admin=await login('admin','owner','micro-owner-password');await admin.getByRole('button',{name:'用户管理',exact:true}).click();await admin.locator('#users-list .user-row').filter({hasText:'friend'}).getByRole('button',{name:'用量详情',exact:true}).click();await admin.locator('#usage-overview-body table').first().waitFor();
 const sources=admin.getByRole('tab',{name:'来源 IP',exact:true});await sources.click();
 const underline=await sources.evaluate(el=>{const style=getComputedStyle(el,'::after');return {content:style.content,property:style.transitionProperty,duration:style.transitionDuration};});
 assert.notEqual(underline.content,'none','Admin tabs should provide the same local selection feedback');assert.equal(underline.property,'opacity',JSON.stringify(await sources.evaluate(el=>({input:document.body.dataset.input,animate:el.parentElement.hasAttribute('data-choice-animate'),kind:el.parentElement.dataset.choiceKind,focus:document.activeElement.id,pressed:el.getAttribute('aria-selected')}))));assert.equal(underline.duration,'0.12s');
 await admin.keyboard.press('Control+ArrowRight');assert.equal(await sources.getAttribute('aria-selected'),'true','Native tab shortcuts with modifiers must be left alone');
 await admin.keyboard.press('Home');assert.equal(await admin.getByRole('tab',{name:'用量总览',exact:true}).getAttribute('aria-selected'),'true');
 assert.equal(await sources.evaluate(el=>el.getAnimations().length),0,'Keyboard tab selection must not animate');
 await admin.keyboard.press('Escape');checks.push('Admin usage tabs retain their native keyboard/cache behavior, add pointer-only underline feedback and ignore modified shortcuts');

 for(const [page,selector]of [[user,'[data-device-guide=desktop] .guide-download'],[admin,'#new-user']]){
  await page.locator('#page-heading').click();const action=page.locator(selector).first();const box=await action.boundingBox();await action.hover();
  const cue=await action.evaluate(el=>{const style=getComputedStyle(el,'::after');return {content:style.content,property:style.transitionProperty,duration:style.transitionDuration};});
  assert.notEqual(cue.content,'none','Both roles need a restrained fine-pointer action cue');assert.equal(cue.property,'opacity');assert.equal(cue.duration,'0.12s');
  await page.waitForFunction(selector=>Number(getComputedStyle(document.querySelector(selector),'::after').opacity)>.34,selector);
  assert.ok(Math.abs((await action.boundingBox()).width-box.width)<=1);assert.ok(Math.abs((await action.boundingBox()).height-box.height)<=1);
 }
 await admin.locator('#new-user').evaluate(el=>el.disabled=true);await admin.waitForFunction(()=>Number(getComputedStyle(document.querySelector('#new-user'),'::after').opacity)<.01);await admin.locator('#new-user').evaluate(el=>el.disabled=false);
 const touchContext=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true}),touch=await touchContext.newPage();touch.on('pageerror',error=>errors.push(error.message));await touch.goto(origins.user);await touch.waitForFunction(()=>document.body.classList.contains('user-shell')&&!document.body.classList.contains('booting'));
 assert.equal(await touch.locator('#login-form button').evaluate(el=>getComputedStyle(el,'::after').content),'none','Touch-only input must not acquire the hover decoration');await touchContext.close();
 checks.push('User/admin action cues fade only opacity, keep geometry, exclude disabled actions and do not create touch hover decoration');

 await user.evaluate(()=>window.portalToast?.dismiss());
 for(const theme of ['light','dark'])for(const width of [390,1440,3840]){
  await user.setViewportSize({width,height:1000});await user.getByLabel('外观模式').selectOption(theme);await user.emulateMedia({reducedMotion:'reduce'});
  for(const platform of ['desktop','android','ios']){
   await devices.locator('[data-guide-platform='+platform+']').click();const section=guide.locator('[data-device-guide='+platform+']');
   await section.locator('[data-step="3"]').evaluate(el=>el.scrollIntoView({block:'start',behavior:'instant'}));
   await user.waitForFunction(platform=>document.querySelector('[data-device-guide='+platform+'] .guide-reading-status').textContent.includes('3 / 4'),platform);
   assert.equal(await section.locator('.guide-checks input:checked').count(),0);assert.equal(await user.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
   if(platform==='android'&&width!==3840)await user.screenshot({path:`test-output/microinteractions/guide-${theme}-${width}.png`});
  }
 }
 checks.push('Reading position is correct across all device paths and six light/dark 390–3840px layouts without completing checks or overflowing');

 await user.setViewportSize({width:1440,height:1100});await user.getByRole('button',{name:'仪表盘',exact:true}).click();
 await user.emulateMedia({reducedMotion:'reduce'});await range.locator('[data-chart-days="7"]').click();
 assert.equal(await range.locator('button').evaluateAll(buttons=>buttons.flatMap(button=>button.getAnimations()).length),0,'Reduced motion keeps selection feedback instantaneous');
 await user.getByLabel('外观模式').selectOption('dark');await user.screenshot({path:'test-output/microinteractions/dashboard-dark.png',fullPage:true});
 await admin.getByLabel('外观模式').selectOption('dark');await admin.locator('#new-user').hover();await admin.screenshot({path:'test-output/microinteractions/admin-hover-dark.png',fullPage:true});
 await user.getByRole('button',{name:'退出',exact:true}).click();await user.locator('#login-view').waitFor();
 assert.equal(await guide.locator('.guide-checks input:checked').count(),0);assert.equal(await user.locator('#subscription').inputValue(),'');
 assert.equal(await range.locator('[data-chart-days="7"]').getAttribute('tabindex'),'0');assert.equal(await range.locator('[data-chart-days="7"]').getAttribute('aria-pressed'),'true');
 checks.push('Reduced-motion choices are instant and logout resets roving selection and clears private delivery state');

 assert.equal(await(await fetch(subscription)).text(),exportBefore);assert.deepEqual(errors,[]);await writeFile('test-output/microinteractions/results.json',JSON.stringify({passed:true,checks,at:new Date().toISOString()},null,2));console.log('PASS: '+checks.join('; '));
}catch(error){await writeFile('test-output/microinteractions/results.json',JSON.stringify({passed:false,checks,error:error.message,at:new Date().toISOString()},null,2));throw error;}
finally{await browser?.close();for(const server of servers){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}store.close();const resolved=path.resolve(dir);if(path.dirname(resolved)!==path.resolve(tmpdir())||!path.basename(resolved).startsWith('kenxu-micro-'))throw Error('Unexpected fixture path');await rm(resolved,{recursive:true,force:true});}
