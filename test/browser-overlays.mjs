import {chromium} from 'playwright';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import {openStore} from '../src/store.mjs';
import {createApp} from '../src/app.mjs';

const dir=await mkdtemp(path.join(tmpdir(),'kenxu-overlays-')),store=openStore(dir),servers=[],errors=[],checks=[],frames=[];
let browser;
try{
 await mkdir('test-output/overlays',{recursive:true});
 await writeFile('test-output/overlays/results.json',JSON.stringify({passed:false,status:'running',at:new Date().toISOString()},null,2));
 store.importSource('proxies: [{name: Overlay Fixture, type: vless, server: fixture.example, port: 443, uuid: fixture-only}]\nrules: ["MATCH,Overlay Fixture"]');
 await store.createUser('owner','overlay-owner-password',[],'admin');
 const alice=await store.createUser('alice','overlay-alice-password',store.inventory().map(n=>n.id)),bob=await store.createUser('bobby','overlay-bobby-password',store.inventory().map(n=>n.id));
 await store.setPassword(alice,'overlay-alice-password');await store.setPassword(bob,'overlay-bobby-password');
 const registration=store.meter.register(store.inventory()[0].id,'Overlay fixture collector'),collector=store.meter.authenticate(registration.token);for(const id of [alice,bob])store.meter.allowUser(collector.id,id);const desired=store.meter.desired(collector);
 store.meter.report(collector,{epoch:'overlay-fixture',seq:1,at:Date.now(),revision:desired.revision,counters:desired.clients.map(client=>({email:client.email,up:1024,down:8192}))});
 const origins={};for(const role of ['user','admin']){let app;const server=http.createServer((req,res)=>app(req,res));await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));origins[role]='http://127.0.0.1:'+server.address().port;app=createApp({store,origin:origins[role],admin:role==='admin'});servers.push(server);}
 browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHANNEL?{channel:process.env.PLAYWRIGHT_CHANNEL}:{})});
 async function login(role,username,password){const page=await browser.newPage({viewport:{width:1440,height:1000}});page.setDefaultTimeout(6000);page.on('pageerror',error=>errors.push(error.message));await page.addInitScript(()=>{window.overlayTransitions=[];document.addEventListener('transitionrun',event=>window.overlayTransitions.push({id:event.target.id,property:event.propertyName,pseudo:event.pseudoElement}));});await page.goto(origins[role]);await page.locator('#login-form [name=username]').fill(username);await page.locator('#login-form [name=password]').fill(password);await page.locator('#login-form button').click();await page.waitForFunction(()=>document.querySelector('#page-sync').textContent.startsWith('更新于'));return page;}
 const user=await login('user','alice','overlay-alice-password');
 await user.setViewportSize({width:390,height:844});
 await user.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 await user.locator('#menu-toggle').focus();await user.keyboard.press('Shift+Tab');
 assert.equal(await user.locator('#sidebar').evaluate(el=>el.contains(document.activeElement)),false,'Closed mobile navigation must not receive keyboard focus');
 await user.locator('#menu-toggle').focus();
 checks.push('Closed mobile navigation is absent from the keyboard path');

 const admin=await login('admin','owner','overlay-owner-password');await admin.getByRole('button',{name:'用户管理',exact:true}).click();
 const row=name=>admin.locator('#users-list .user-row').filter({hasText:name});
 await admin.emulateMedia({reducedMotion:'no-preference'});
 await row('alice').getByRole('button',{name:'编辑账号',exact:true}).click();
 const entry=await admin.locator('#user-dialog').evaluate(el=>({open:el.open,modal:el.matches(':modal'),focus:el.contains(document.activeElement),properties:el.getAnimations().map(animation=>animation.transitionProperty)}));
 assert.ok(entry.open&&entry.modal&&entry.focus,'Opening keeps native modal and focus semantics');
 await admin.waitForFunction(()=>['opacity','transform'].every(property=>window.overlayTransitions.some(event=>event.id==='user-dialog'&&event.property===property)));
 const frame=await admin.locator('#user-dialog').evaluate(el=>{
  const animations=el.getAnimations();window.overlayFrameAnimations=animations;for(const animation of animations){animation.pause();animation.currentTime=70;}
  const style=getComputedStyle(el);return {opacity:Number(style.opacity),transform:style.transform,duration:style.transitionDuration};
 });frames.push(frame);assert.ok(frame.opacity>0&&frame.opacity<1);assert.match(frame.duration,/0\.2s/);
 await admin.screenshot({path:'test-output/overlays/dialog-entry-frame.png',fullPage:true});
 await admin.evaluate(()=>{for(const animation of window.overlayFrameAnimations)animation.play();});
 checks.push('Pointer modal opening has real compositor-property feedback and retains native focus containment');

 await admin.locator('#close-dialog').click();
 assert.equal(await admin.locator('#user-dialog').evaluate(el=>el.open),false,'Native close is immediate, not animation-delayed');
 assert.equal(await row('alice').getByRole('button',{name:'编辑账号',exact:true}).evaluate(el=>el===document.activeElement),true,'Closing restores focus to the real opener');
 assert.ok(await admin.locator('#user-dialog').evaluate(el=>el.inert),'The visible exit surface cannot accept another edit');
 await admin.waitForFunction(()=>document.querySelector('#user-dialog').getAnimations().length===0);
 await row('alice').getByRole('button',{name:'编辑账号',exact:true}).click();
 await admin.evaluate(()=>{
  document.querySelector('#close-dialog').click();
  const row=[...document.querySelectorAll('#users-list .user-row')].find(el=>el.textContent.includes('bobby'));
  [...row.querySelectorAll('button')].find(el=>el.textContent==='编辑账号').click();
  document.querySelector('#user-form [name=displayName]').value='New draft after immediate reopen';
 });
 await admin.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 assert.equal(await admin.locator('#user-form [name=displayName]').inputValue(),'New draft after immediate reopen');
 assert.equal(await admin.locator('#user-dialog').evaluate(el=>el.open&&!el.inert),true);
 await admin.keyboard.press('Escape');
 assert.equal(await admin.locator('#user-dialog').evaluate(el=>el.open),false);assert.equal(await admin.locator('#user-dialog').evaluate(el=>el.getAnimations().length),0);
 checks.push('Native closing and focus restoration are immediate; rapid reopen preserves its new draft; Escape never animates');

 await user.locator('#menu-toggle').click();
 await user.waitForFunction(()=>document.body.classList.contains('nav-open'));
 assert.equal(await user.locator('#content').evaluate(el=>el.inert),true);
 await user.waitForFunction(()=>window.overlayTransitions.some(event=>event.id==='menu-backdrop'&&event.property==='opacity'),undefined,{timeout:2000});
 await user.waitForFunction(()=>document.querySelector('#sidebar').getAnimations().every(a=>a.playState!=='running'));
 await user.screenshot({path:'test-output/overlays/mobile-menu-light.png',fullPage:true});
 checks.push('Pointer mobile navigation fades its backdrop without blocking the semantic open state');

 await user.locator('#close-menu').click();
 assert.equal(await user.locator('#menu-toggle').getAttribute('aria-expanded'),'false');
 assert.equal(await user.locator('#content').evaluate(el=>el.inert),false);assert.equal(await user.locator('#sidebar').evaluate(el=>el.inert),true);
 assert.equal(await user.locator('#menu-toggle').evaluate(el=>el===document.activeElement),true);
 await user.locator('#menu-toggle').click();
 await user.evaluate(()=>{document.querySelector('#close-menu').click();document.querySelector('#menu-toggle').click();document.querySelector('#close-menu').click();});
 await user.waitForFunction(()=>document.querySelector('#sidebar').getAnimations().every(a=>a.playState!=='running')&&getComputedStyle(document.querySelector('#menu-backdrop')).display==='none');
 assert.equal(await user.locator('#menu-toggle').getAttribute('aria-expanded'),'false');assert.equal(await user.locator('#content').evaluate(el=>el.inert),false);
 await user.locator('#menu-toggle').click();await user.locator('#section-nav [data-panel=subscription]').click();
 assert.equal(await user.locator('#sidebar').evaluate(el=>el.inert),true);assert.equal(await user.locator('#page-heading').evaluate(el=>el===document.activeElement),true);
 await user.locator('#menu-toggle').click();assert.equal(await user.locator('#section-nav [data-panel=subscription]').evaluate(el=>el===document.activeElement),true,'Reopened menu focuses the current page');
 await user.locator('#sidebar a.brand').focus();await user.keyboard.press('Shift+Tab');assert.equal(await user.locator('#section-nav button').last().evaluate(el=>el===document.activeElement),true);
 await user.keyboard.press('Tab');assert.equal(await user.locator('#sidebar a.brand').evaluate(el=>el===document.activeElement),true);
 await user.keyboard.press('Escape');assert.equal(await user.locator('#sidebar').evaluate(el=>el.inert),true);assert.equal(await user.locator('#sidebar').evaluate(el=>el.getAnimations().length),0);
 await user.locator('#menu-toggle').focus();await user.keyboard.press('Enter');
 assert.equal(await user.locator('#sidebar').evaluate(el=>el.getAnimations().length),0,'Keyboard opening must not animate');
 await user.keyboard.press('Escape');
 await user.emulateMedia({reducedMotion:'reduce'});await user.locator('#menu-toggle').click();
 assert.equal(await user.locator('#sidebar').evaluate(el=>el.getAnimations().length),0);assert.equal(await user.locator('#menu-backdrop').evaluate(el=>el.getAnimations().length),0);
 await user.locator('#menu-backdrop').click({position:{x:350,y:300}});assert.equal(await user.locator('#menu-toggle').evaluate(el=>el===document.activeElement),true);
 await user.emulateMedia({reducedMotion:'no-preference'});await user.locator('#menu-toggle').click();await user.setViewportSize({width:1440,height:1000});
 await user.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 assert.equal(await user.locator('#sidebar').evaluate(el=>el.inert),false);assert.equal(await user.locator('#sidebar').getAttribute('aria-hidden'),null);assert.equal(await user.locator('#content').evaluate(el=>el.inert),false);
 await user.setViewportSize({width:390,height:844});await user.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 assert.equal(await user.locator('#sidebar').evaluate(el=>el.inert),true);assert.equal(await user.locator('#menu-toggle').evaluate(el=>el===document.activeElement),true);
 checks.push('Mobile close restores focus immediately; interrupted toggles, selected-page focus, focus trapping, keyboard/reduced motion and desktop breakpoints stay coherent');

 await admin.emulateMedia({reducedMotion:'reduce'});await row('alice').getByRole('button',{name:'编辑账号',exact:true}).click();
 assert.equal(await admin.locator('#user-dialog').evaluate(el=>el.getAnimations().length),0);await admin.locator('#close-dialog').click();
 assert.equal(await admin.locator('#user-dialog').evaluate(el=>getComputedStyle(el).display),'none');
 await admin.emulateMedia({reducedMotion:'no-preference'});await row('alice').getByRole('button',{name:'编辑账号',exact:true}).focus();await admin.keyboard.press('Enter');
 assert.equal(await admin.locator('#user-dialog').evaluate(el=>el.getAnimations().length),0);await admin.keyboard.press('Escape');
 for(const [name,id,close]of [['重置密码','reset-dialog','close-reset'],['用量详情','usage-log-dialog','usage-log-close']]){
  const opener=row('alice').getByRole('button',{name,exact:true});await opener.click();await admin.locator('#'+id).waitFor();
  assert.equal(await admin.locator('#'+id).evaluate(el=>el.open&&el.matches(':modal')&&!el.inert&&el.contains(document.activeElement)),true);
  if(id==='reset-dialog')await admin.locator('#reset-form [name=password]').fill('unsaved-fixture-only');
  await admin.locator('#'+close).click();assert.equal(await admin.locator('#'+id).evaluate(el=>el.open),false);
  assert.equal(await opener.evaluate(el=>el===document.activeElement),true);await admin.waitForFunction(id=>document.querySelector('#'+id).getAnimations().length===0,id);
 }
 assert.equal(await admin.locator('#reset-form [name=password]').inputValue(),'');
 await admin.getByRole('button',{name:'节点管理',exact:true}).click();await admin.locator('#admin-nodes .detail-button').first().click();await admin.locator('#usage-dialog').waitFor();
 assert.equal(await admin.locator('#usage-dialog').evaluate(el=>el.open&&el.matches(':modal')&&!el.inert),true);await admin.locator('#close-usage').click();
 assert.equal(await admin.locator('#usage-dialog').evaluate(el=>el.open),false);await admin.waitForFunction(()=>document.querySelector('#usage-dialog').getAnimations().length===0);
 checks.push('All four existing native dialogs retain focus, close controls and cleanup; reduced-motion and keyboard modal actions are instant');

 await admin.getByRole('button',{name:'用户管理',exact:true}).click();await row('alice').getByRole('button',{name:'编辑账号',exact:true}).click();
 await admin.locator('#user-form [name=displayName]').fill('Saved alice fixture');await admin.locator('#user-form .primary').click();
 await admin.waitForFunction(()=>!document.querySelector('#user-dialog').open&&document.querySelector('#users-list').textContent.includes('Saved alice fixture'));
 assert.equal(await row('alice').getByRole('button',{name:'编辑账号',exact:true}).evaluate(el=>el===document.activeElement),true,'Successful save must preserve its return point when the account list is rebuilt');
 checks.push('Saving an account returns focus to its replacement entry after the list is rebuilt');

 await admin.locator('#new-user').click();await admin.locator('#user-form [name=username]').fill('charlie');await admin.locator('#user-form [name=password]').fill('overlay-charlie-password');await admin.locator('#user-form .primary').click();
 await admin.waitForFunction(()=>!document.querySelector('#user-dialog').open&&document.querySelector('#users-list').textContent.includes('charlie')&&!document.querySelector('#new-user').disabled);
 await admin.waitForFunction(()=>document.querySelector('#new-user')===document.activeElement,undefined,{timeout:1000});
 checks.push('Creating an account preserves the return point while its opener is temporarily disabled for reload');

 await admin.setViewportSize({width:390,height:844});await admin.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));await admin.locator('#menu-toggle').click();
 assert.equal(await admin.locator('#sidebar').getAttribute('role'),'dialog');assert.equal(await admin.locator('#content').evaluate(el=>el.inert),true);
 await admin.locator('#section-nav [data-panel=accounts]').click();assert.equal(await admin.locator('#sidebar').evaluate(el=>el.inert),true);assert.equal(await admin.locator('#page-heading').evaluate(el=>el===document.activeElement),true);
 await admin.setViewportSize({width:1440,height:1000});await admin.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 assert.equal(await admin.locator('#sidebar').evaluate(el=>el.inert),false);
 checks.push('Administrator mobile navigation uses the same focus and logical-state rules without affecting desktop navigation');

 for(const theme of ['light','dark'])for(const width of [390,1440,3840]){
  await admin.setViewportSize({width,height:width===390?844:1080});await admin.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));await admin.getByLabel('外观模式').selectOption(theme);
  await row('alice').getByRole('button',{name:'编辑账号',exact:true}).click();await admin.waitForFunction(()=>document.querySelector('#user-dialog').getAnimations().length===0);
  const dimensions=await admin.locator('#user-dialog').evaluate(el=>{const box=el.getBoundingClientRect();return {left:box.left,right:box.right,viewport:innerWidth,overflow:el.scrollWidth>el.clientWidth+1};});
  assert.ok(dimensions.left>=0&&dimensions.right<=width+1&&!dimensions.overflow);
  if(width!==3840)await admin.screenshot({path:`test-output/overlays/dialog-${theme}-${width}.png`,fullPage:true});
  await admin.keyboard.press('Escape');
  if(width===390){await admin.locator('#menu-toggle').click();await admin.waitForFunction(()=>document.querySelector('#sidebar').getAnimations().length===0);await admin.screenshot({path:`test-output/overlays/mobile-menu-${theme}-admin.png`,fullPage:true});await admin.keyboard.press('Escape');}
 }
 await admin.setViewportSize({width:1440,height:1000});await admin.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 checks.push('Light/dark native dialogs and mobile navigation fit 390, 1440 and 3840px layouts; an actual entry frame was inspected at 70ms');

 // A real server-side session expiration must erase the native top-layer surface,
 // not merely set open=false and leave a CSS exit painting sensitive fields.
 await row('alice').getByRole('button',{name:'编辑账号',exact:true}).click();await admin.locator('#user-form [name=displayName]').fill('Private unsaved fixture');
 store.db.prepare('DELETE FROM sessions WHERE user_id=(SELECT id FROM users WHERE username=?)').run('owner');
 await admin.locator('#user-form .primary').click();await admin.locator('#login-view').waitFor();
 assert.equal(await admin.locator('dialog[open]').count(),0);assert.equal(await admin.locator('#user-form [name=displayName]').inputValue(),'');
 assert.ok(await admin.locator('dialog').evaluateAll(dialogs=>dialogs.every(dialog=>getComputedStyle(dialog).display==='none'&&dialog.getAnimations().length===0)));
 assert.equal(await admin.locator('#grant-options').innerText(),'');
 checks.push('Actual session expiration immediately clears private forms and every closing top-layer animation');

 assert.deepEqual(errors,[]);await writeFile('test-output/overlays/results.json',JSON.stringify({passed:true,checks,frames,at:new Date().toISOString()},null,2));console.log('PASS: '+checks.join('; '));
}catch(error){await writeFile('test-output/overlays/results.json',JSON.stringify({passed:false,checks,error:error.message,at:new Date().toISOString()},null,2));throw error;}
finally{await browser?.close();for(const server of servers){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}store.close();const resolved=path.resolve(dir);if(path.dirname(resolved)!==path.resolve(tmpdir())||!path.basename(resolved).startsWith('kenxu-overlays-'))throw Error('Unexpected fixture path');await rm(resolved,{recursive:true,force:true});}
