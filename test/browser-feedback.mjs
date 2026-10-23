import {chromium} from 'playwright';
import {mkdtemp,mkdir,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import {openStore} from '../src/store.mjs';
import {createApp} from '../src/app.mjs';

const dir=await mkdtemp(path.join(tmpdir(),'kenxu-feedback-')),store=openStore(dir),servers=[],errors=[],checks=[];
let browser;
try{
 await mkdir('test-output/feedback',{recursive:true});
 await writeFile('test-output/feedback/results.json',JSON.stringify({passed:false,status:'running',generatedAt:new Date().toISOString()},null,2));
 store.importSource('proxies: [{name: Feedback Fixture, type: vless, server: fixture.example, port: 443, uuid: fixture-not-a-real-credential}]\nrules: ["MATCH,Feedback Fixture"]');
 await store.createUser('owner','feedback-owner-password',[],'admin');
 const friend=await store.createUser('friend','feedback-friend-password',store.inventory().map(n=>n.id));await store.setPassword(friend,'feedback-friend-password');
 const registration=store.meter.register(store.inventory()[0].id,'Feedback fixture collector'),collector=store.meter.authenticate(registration.token);store.meter.allowUser(collector.id,friend);const desired=store.meter.desired(collector),client=desired.clients.find(item=>item.email.includes(friend));
 store.meter.report(collector,{epoch:'feedback-fixture',seq:1,at:Date.now(),revision:desired.revision,counters:[{email:client.email,up:3*1024**2,down:17*1024**2}]});
 const origins={};for(const role of ['user','admin']){let app;const server=http.createServer((req,res)=>app(req,res));await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));origins[role]='http://127.0.0.1:'+server.address().port;app=createApp({store,origin:origins[role],admin:role==='admin'});servers.push(server);}
 browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHANNEL?{channel:process.env.PLAYWRIGHT_CHANNEL}:{})});
 const context=await browser.newContext({viewport:{width:1440,height:1000}});
 await context.addInitScript(()=>{
  // Clipboard is an OS boundary. Never read or replace the user's clipboard.
  window.clipboardFixture={value:'',writes:0,fail:false,block:false,release:null};
  Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async value=>{
   window.clipboardFixture.writes++;
   if(window.clipboardFixture.block)await new Promise(resolve=>window.clipboardFixture.release=resolve);
   if(window.clipboardFixture.fail)throw Error('Clipboard fixture denied');
   window.clipboardFixture.value=value;
  }}});
 });
 const user=await context.newPage();user.on('pageerror',error=>errors.push(error.message));user.setDefaultTimeout(6000);
 async function signIn(page,origin,username,password){await page.goto(origin);await page.locator('#login-form [name=username]').fill(username);await page.locator('#login-form [name=password]').fill(password);await page.locator('#login-form .primary').click();await page.locator(username==='owner'?'#admin-view':'#user-view').waitFor();await page.waitForFunction(()=>document.querySelector('#page-sync').textContent.startsWith('更新于'));}
 await signIn(user,origins.user,'friend','feedback-friend-password');
 await user.getByRole('link',{name:'我的订阅',exact:true}).click();
 const originalCopy=await user.locator('#copy-sub').boundingBox(),originalImport=await user.locator('#import-clash').boundingBox();
 await user.locator('#copy-sub').click();await user.waitForFunction(()=>document.querySelector('#copy-sub').textContent.includes('已复制'));
 const copied=await user.locator('#copy-sub').boundingBox(),afterImport=await user.locator('#import-clash').boundingBox();
 assert.ok(Math.abs(copied.width-originalCopy.width)<=1,'Copy confirmation must not resize the button');
 assert.ok(Math.abs(afterImport.x-originalImport.x)<=1,'Copy confirmation must not move the adjacent import action');
 assert.equal(await user.locator('[data-sonner-toast]').filter({hasText:'订阅链接已复制'}).count(),0,'Copy success must not duplicate its inline confirmation as a toast');
 assert.ok(await user.evaluate(()=>window.clipboardFixture.value===document.querySelector('#subscription').value));
 await user.screenshot({path:'test-output/feedback/copy-success-desktop.png',fullPage:true});
 checks.push('Copy success stays in the button, preserves geometry, and copies the selected format without a duplicate toast');

 for(const [role,username,password] of [['user','friend','feedback-friend-password'],['admin','owner','feedback-owner-password']]){
  const loginContext=await browser.newContext({viewport:{width:1440,height:1000}}),page=await loginContext.newPage();page.setDefaultTimeout(6000);page.on('pageerror',error=>errors.push(error.message));
  await page.goto(origins[role]);await page.locator('#login-form [name=username]').fill(username);await page.locator('#login-form [name=password]').fill(password);
  const before=await page.locator('#login-form .primary').boundingBox();let release,observed,attempts=0;
  const gate=new Promise(resolve=>release=resolve),started=new Promise(resolve=>observed=resolve);
  await page.route('**/api/login',async route=>{attempts++;const response=await route.fetch();observed();await gate;await route.fulfill({response});});
  await page.locator('#login-form .primary').click();await started;
  assert.equal(await page.locator('#login-form .primary').getAttribute('aria-busy'),'true','Login must expose its pending state');
  assert.match(await page.locator('#login-form .primary').innerText(),/登录中/);
  assert.ok(Math.abs((await page.locator('#login-form .primary').boundingBox()).width-before.width)<=1,'Pending label must preserve button width');
  await page.screenshot({path:'test-output/feedback/login-'+role+'-pending.png',fullPage:true});
  await page.locator('#login-form').evaluate(form=>form.requestSubmit());assert.equal(attempts,1,'Pending login must not submit twice');
  release();await page.locator(role==='admin'?'#admin-view':'#user-view').waitFor();
  await page.waitForFunction(()=>!document.querySelector('#login-form .primary').disabled);
  assert.notEqual(await page.locator('#login-form .primary').getAttribute('aria-busy'),'true');
  assert.ok(!(await page.locator('#login-form .primary').textContent()).includes('登录中'));
  await loginContext.close();
 }
 checks.push('Both login interfaces expose specific pending labels and aria-busy without resizing or duplicate submission');

 const failedContext=await browser.newContext(),failedLogin=await failedContext.newPage();failedLogin.setDefaultTimeout(6000);
 await failedLogin.goto(origins.user);await failedLogin.locator('#login-form [name=username]').fill('friend');await failedLogin.locator('#login-form [name=password]').fill('wrong-feedback-password');
 await failedLogin.locator('#login-form .primary').click();
 await failedLogin.locator('#login-form [role=alert]:not([hidden])').waitFor();
 assert.ok((await failedLogin.locator('#login-form [role=alert]').innerText()).length>0);
 assert.equal(await failedLogin.locator('#login-form [name=username]').inputValue(),'friend');
 assert.ok(await failedLogin.locator('#login-form .primary').isEnabled());
 assert.notEqual(await failedLogin.locator('#login-form .primary').getAttribute('aria-busy'),'true');
 assert.equal(await failedLogin.locator('[data-sonner-toast][data-type=error]').count(),0,'An inline login error must not also open a duplicate toast');
 await failedLogin.setViewportSize({width:390,height:844});await failedLogin.getByLabel('外观模式').selectOption('dark');
 assert.equal(await failedLogin.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 await failedLogin.screenshot({path:'test-output/feedback/login-error-mobile-dark.png',fullPage:true});
 await failedContext.close();checks.push('Real rejected login reports an inline accessible error and preserves input for retry');

 await context.clearCookies();await signIn(user,origins.user,'friend','feedback-friend-password');
 await user.getByRole('link',{name:'仪表盘',exact:true}).click();
 const existingUsage=await user.locator('#plan-used').innerText();let releaseRefresh,refreshStarted,refreshRequests=0;
 assert.match(existingUsage,/20\.00 MB/,'Retention checks must start from real nonzero fixture usage, not an empty placeholder');
 const refreshGate=new Promise(resolve=>releaseRefresh=resolve),refreshObserved=new Promise(resolve=>refreshStarted=resolve);
 await user.route('**/api/usage',async route=>{refreshRequests++;const response=await route.fetch();assert.equal(response.status(),200);refreshStarted();await refreshGate;await route.fulfill({response});});
 await user.locator('#refresh').click();await refreshObserved;
 assert.equal(await user.locator('#refresh').getAttribute('aria-busy'),'true','Manual refresh needs a local busy state');
 assert.equal(await user.locator('#plan-used').innerText(),existingUsage,'Pending refresh must retain readable data');
 await user.evaluate(()=>{document.activeElement?.blur();window.scrollTo({top:0,behavior:'instant'});});
 await user.screenshot({path:'test-output/feedback/refresh-pending.png',fullPage:true});
 await user.locator('#refresh').evaluate(button=>button.click());assert.equal(refreshRequests,1);
 releaseRefresh();await user.waitForFunction(()=>document.querySelector('#refresh').getAttribute('aria-busy')!=='true');
 assert.ok(await user.locator('#refresh').isEnabled());
 assert.equal(await user.locator('[data-sonner-toast]').filter({hasText:'数据已更新'}).count(),0,'Successful manual refresh should confirm locally');
 await user.unroute('**/api/usage');
 await user.route('**/api/usage',route=>route.fulfill({status:503,contentType:'application/json',body:'{"error":"暂时无法读取统计，请重试。"}'}));
 await user.locator('#refresh').click();await user.locator('[data-sonner-toast][data-type=error]').filter({hasText:'暂时无法读取统计'}).waitFor();
 assert.ok(await user.locator('#refresh').isEnabled());assert.equal(await user.locator('#plan-used').innerText(),existingUsage);
 await user.unroute('**/api/usage');checks.push('Manual refresh exposes busy state, rejects repeated clicks, retains old data, and reports failed reads without false success');

 await user.getByRole('link',{name:'我的订阅',exact:true}).click();
 await user.evaluate(()=>{window.clipboardFixture.block=true;window.clipboardFixture.release=null;});
 const copyWrites=await user.evaluate(()=>window.clipboardFixture.writes);
 await user.locator('#copy-sub').click();await user.waitForFunction(()=>typeof window.clipboardFixture.release==='function');
 assert.equal(await user.locator('#copy-sub').getAttribute('aria-busy'),'true');assert.ok(await user.locator('#copy-sub').isDisabled());
 await user.locator('#copy-sub').evaluate(button=>button.click());assert.equal(await user.evaluate(()=>window.clipboardFixture.writes),copyWrites+1);
 await user.evaluate(()=>{window.clipboardFixture.block=false;window.clipboardFixture.release();});
 await user.waitForFunction(()=>document.querySelector('#copy-sub').textContent.includes('已复制'));
 assert.ok(await user.locator('#copy-sub').isEnabled());
 await user.evaluate(()=>{window.clipboardFixture.block=true;window.clipboardFixture.release=null;});
 await user.locator('#copy-sub').click();await user.waitForFunction(()=>typeof window.clipboardFixture.release==='function');
 await user.locator('#client-choice').selectOption('stash');
 await user.evaluate(()=>{window.clipboardFixture.fail=true;window.clipboardFixture.block=false;window.clipboardFixture.release();});
 await user.waitForFunction(()=>document.querySelector('#copy-sub').disabled===false);
 assert.equal(await user.locator('#subscription').getAttribute('type'),'password','An obsolete copy failure must not reveal the newly selected format');
 assert.equal(await user.locator('[data-sonner-toast]').filter({hasText:'已展开链接'}).count(),0);
 await user.locator('#copy-sub').click();
 await user.waitForFunction(()=>document.querySelector('#subscription').type==='text');
 assert.ok(await user.locator('#copy-sub').isEnabled());
 await user.evaluate(()=>{window.clipboardFixture.fail=false;});
 await user.locator('#show-sub').click();
 checks.push('Slow copy cannot run twice; changing client invalidates old feedback; a current clipboard denial preserves manual-copy fallback');

 const adminContext=await browser.newContext({viewport:{width:1440,height:1000}}),admin=await adminContext.newPage();admin.setDefaultTimeout(6000);admin.on('pageerror',error=>errors.push(error.message));
 await signIn(admin,origins.admin,'owner','feedback-owner-password');
 await admin.getByRole('link',{name:'用户管理',exact:true}).click();
 const row=admin.locator('#users-list .user-row').filter({hasText:'friend'});
 await row.getByRole('button',{name:'编辑账号',exact:true}).click();await admin.locator('#user-form [name=displayName]').fill('Saved fixture');
 let releaseSave,saveStarted,saves=0;const saveGate=new Promise(resolve=>releaseSave=resolve),saveObserved=new Promise(resolve=>saveStarted=resolve);
 await admin.route('**/api/admin/users/'+friend,async route=>{if(route.request().method()!=='PUT')return route.continue();saves++;const response=await route.fetch();assert.equal(response.status(),200);saveStarted();await saveGate;await route.fulfill({response});});
 await admin.locator('#user-form .primary').click();await saveObserved;
 assert.equal(await admin.locator('#user-form .primary').getAttribute('aria-busy'),'true');assert.match(await admin.locator('#user-form .primary').innerText(),/保存中/);
 await admin.screenshot({path:'test-output/feedback/account-save-pending.png',fullPage:true});
 await admin.locator('#user-form').evaluate(form=>form.requestSubmit());assert.equal(saves,1);
 await admin.keyboard.press('Escape');await row.getByRole('button',{name:'编辑账号',exact:true}).click();await admin.locator('#user-form [name=displayName]').fill('Unsaved replacement draft');
 releaseSave();await admin.waitForFunction(()=>document.querySelector('#users-list').textContent.includes('Saved fixture'));
 assert.equal(await admin.locator('#user-form [name=displayName]').inputValue(),'Unsaved replacement draft');assert.ok(await admin.locator('#user-form .primary').isEnabled());assert.notEqual(await admin.locator('#user-form .primary').getAttribute('aria-busy'),'true');
 await admin.keyboard.press('Escape');await admin.unroute('**/api/admin/users/'+friend);
 checks.push('Account save feedback cannot double-submit or overwrite a reopened draft when its response is late');

 await admin.getByRole('link',{name:'系统设置',exact:true}).click();
 let releaseSettings,settingsStarted,settingWrites=0;const settingsGate=new Promise(resolve=>releaseSettings=resolve),settingsObserved=new Promise(resolve=>settingsStarted=resolve);
 await admin.route('**/api/admin/settings',async route=>{if(route.request().method()!=='PUT')return route.continue();settingWrites++;const response=await route.fetch();assert.equal(response.status(),200);settingsStarted();await settingsGate;await route.fulfill({response});});
 await admin.locator('#settings-form [type=submit]').click();await settingsObserved;
 assert.equal(await admin.locator('#settings-form [type=submit]').getAttribute('aria-busy'),'true','System settings must have the same save feedback');
 assert.match(await admin.locator('#settings-form [type=submit]').innerText(),/保存中/);
 await admin.locator('#settings-form').evaluate(form=>form.requestSubmit());assert.equal(settingWrites,1);
 releaseSettings();await admin.waitForFunction(()=>document.querySelector('#settings-form [type=submit]').disabled===false&&document.querySelector('#settings-form [type=submit]').getAttribute('aria-busy')!=='true');
 await admin.unroute('**/api/admin/settings');checks.push('System settings preserve save feedback and single-write ownership through a successful reload');
 await admin.getByRole('link',{name:'规则管理',exact:true}).click();await admin.waitForFunction(()=>!document.querySelector('#rules-save').disabled);
 const ruleWidth=(await admin.locator('#rules-save').boundingBox()).width;let releaseRules,rulesStarted,ruleWrites=0;
 const rulesGate=new Promise(resolve=>releaseRules=resolve),rulesObserved=new Promise(resolve=>rulesStarted=resolve);
 await admin.route('**/api/admin/rules',async route=>{if(route.request().method()!=='PUT')return route.continue();ruleWrites++;const response=await route.fetch();assert.equal(response.status(),200);rulesStarted();await rulesGate;await route.fulfill({response});});
 await admin.locator('#rules-save').click();await rulesObserved;
 assert.equal(await admin.locator('#rules-save').getAttribute('aria-busy'),'true');assert.match(await admin.locator('#rules-save').innerText(),/保存中/);
 assert.ok(Math.abs((await admin.locator('#rules-save').boundingBox()).width-ruleWidth)<=1,'Rule save must keep button width');
 await admin.locator('#rules-form').evaluate(form=>form.requestSubmit());assert.equal(ruleWrites,1);
 releaseRules();await admin.waitForFunction(()=>!document.querySelector('#rules-save').disabled&&document.querySelector('#rules-save').getAttribute('aria-busy')!=='true');await admin.unroute('**/api/admin/rules');
 await admin.locator('#rules-content').fill('DOMAIN-SUFFIX,example.com,DIRECT\nMATCH,Feedback Fixture');
 await admin.route('**/api/admin/rules',route=>route.request().method()==='PUT'?route.fulfill({status:409,contentType:'application/json',body:'{"error":"规则版本已更新，请重新载入后重试。"}'}):route.continue());
 await admin.locator('#rules-save').click();await admin.waitForFunction(()=>!document.querySelector('#rules-save').disabled&&document.querySelector('#rules-status').textContent.includes('版本已更新'));
 assert.match(await admin.locator('#rules-content').inputValue(),/DOMAIN-SUFFIX,example.com,DIRECT/);
 assert.notEqual(await admin.locator('#rules-save').getAttribute('aria-busy'),'true');await admin.unroute('**/api/admin/rules');
 checks.push('Rule saving exposes local pending feedback, keeps its width, prevents duplicate writes, and retains a conflicted draft for retry');
 await adminContext.close();

 await user.evaluate(()=>window.portalToast?.dismiss());await user.waitForFunction(()=>document.querySelectorAll('[data-sonner-toast]').length===0);

 for(const theme of ['light','dark'])for(const width of [390,1440,2560,3840]){
  await user.setViewportSize({width,height:1000});await user.getByLabel('外观模式').selectOption(theme);await user.emulateMedia({reducedMotion:'no-preference'});
  await user.evaluate(()=>{window.clipboardFixture.block=true;window.clipboardFixture.release=null;});
  const before=await user.locator('#copy-sub').boundingBox();await user.locator('#copy-sub').click();await user.waitForFunction(()=>typeof window.clipboardFixture.release==='function');
  assert.ok(Math.abs((await user.locator('#copy-sub').boundingBox()).width-before.width)<=1);
  assert.equal(await user.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  assert.equal(await user.locator('#copy-sub .feedback-mark').evaluate(el=>getComputedStyle(el).animationName),'button-feedback-spin');
  await user.keyboard.press('Tab');assert.equal(await user.locator('#copy-sub .feedback-mark').evaluate(el=>getComputedStyle(el).animationName),'none','Keyboard input must stop loading motion');
  await user.emulateMedia({reducedMotion:'reduce'});await user.locator('#user-view [data-panel=subscription] .section-heading').click();
  assert.equal(await user.locator('#copy-sub .feedback-mark').evaluate(el=>getComputedStyle(el).animationName),'none','Reduced motion must keep the waiting label without rotation');
  if([390,1440].includes(width))await user.screenshot({path:`test-output/feedback/copy-pending-${theme}-${width}.png`,fullPage:true});
  await user.evaluate(()=>{window.clipboardFixture.block=false;window.clipboardFixture.release();});await user.waitForFunction(()=>document.querySelector('#copy-sub').textContent.includes('已复制'));
 }
 checks.push('Eight light/dark 390–3840px busy-state layouts keep geometry and readable data; keyboard/reduced-motion states do not rotate');

 assert.deepEqual(errors,[]);
 await mkdir('test-output/feedback',{recursive:true});
 await writeFile('test-output/feedback/results.json',JSON.stringify({passed:true,checks,generatedAt:new Date().toISOString()},null,2));
 console.log('PASS: '+checks.join('; '));
}catch(error){
 await writeFile('test-output/feedback/results.json',JSON.stringify({passed:false,checks,error:error.message,generatedAt:new Date().toISOString()},null,2));throw error;
}finally{
 await browser?.close();for(const server of servers){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}store.close();
 const resolved=path.resolve(dir),parent=path.resolve(tmpdir());
 if(path.dirname(resolved)!==parent||!path.basename(resolved).startsWith('kenxu-feedback-'))throw Error('Unexpected temporary fixture path');
 await rm(resolved,{recursive:true,force:true});
}
