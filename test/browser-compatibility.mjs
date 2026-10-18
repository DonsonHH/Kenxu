import {chromium,firefox,webkit} from 'playwright';
import {existsSync} from 'node:fs';
import {mkdtemp,mkdir,writeFile,rm,readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {gzipSync} from 'node:zlib';
import {tmpdir} from 'node:os';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import {openStore} from '../src/store.mjs';
import {createApp} from '../src/app.mjs';

// No browser download or personal browser profile. Optional engines are run
// only when already installed; every skip is recorded instead of a false pass.
const dir=await mkdtemp(path.join(tmpdir(),'kenxu-compat-')),store=openStore(dir),servers=[];
const report={passed:false,status:'running',engines:[],resources:[],at:new Date().toISOString()};let browser;
try{
 await mkdir('test-output/compatibility',{recursive:true});await writeFile('test-output/compatibility/results.json',JSON.stringify(report,null,2));
 store.importSource('proxies: [{name: Compatibility Fixture, type: vless, server: fixture.example, port: 443, uuid: fixture-only}]\nrules: ["MATCH,Compatibility Fixture"]');
 const owner=await store.createUser('owner','compat-owner-password',[],'admin'),friend=await store.createUser('friend','compat-friend-password',store.inventory().map(node=>node.id));await store.setPassword(friend,'compat-friend-password');
 const registration=store.meter.register(store.inventory()[0].id,'Compatibility fixture collector'),collector=store.meter.authenticate(registration.token);store.meter.allowUser(collector.id,friend);const desired=store.meter.desired(collector);
 store.meter.report(collector,{epoch:'compat-fixture',seq:1,at:Date.now(),revision:desired.revision,counters:desired.clients.map(client=>({email:client.email,up:2*1024**2,down:7*1024**2}))});
 const origins={};for(const role of ['user','admin']){let app;const server=http.createServer((req,res)=>app(req,res));await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));origins[role]='http://127.0.0.1:'+server.address().port;app=createApp({store,origin:origins[role],admin:role==='admin'});servers.push(server);}
 const candidates=[
  {name:'edge',type:chromium,launch:{channel:process.env.PLAYWRIGHT_CHANNEL||'msedge'}},
  ...[['firefox',firefox,'PLAYWRIGHT_FIREFOX_EXECUTABLE'],['webkit',webkit,'PLAYWRIGHT_WEBKIT_EXECUTABLE']].map(([name,type,variable])=>{
   const executablePath=process.env[variable]||type.executablePath();return {name,type,launch:{executablePath},available:existsSync(executablePath)};
  }),
 ];
 const requested=new Set((process.env.PLAYWRIGHT_COMPAT_ENGINES||'edge,firefox,webkit').split(','));
 for(const candidate of candidates.filter(candidate=>requested.has(candidate.name))){
  if(candidate.available===false){report.engines.push({engine:candidate.name,skipped:true,reason:'Matching installed engine not found; no download requested'});continue;}
  browser=await candidate.type.launch({headless:true,timeout:15000,...candidate.launch});
  const outcome={engine:candidate.name,version:browser.version(),checks:[],errors:[],externalRequests:[]};report.engines.push(outcome);
  const context=await browser.newContext({viewport:{width:1440,height:1000},deviceScaleFactor:2});
  await context.addInitScript(()=>{
   // OS clipboard boundary only; internal application handlers remain real.
   window.compatClipboard='';Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async value=>{window.compatClipboard=value;}}});
  });
  const attach=page=>{page.setDefaultTimeout(7000);page.setDefaultNavigationTimeout(20000);page.on('pageerror',error=>outcome.errors.push(error.message));page.on('request',request=>{if(!Object.values(origins).some(origin=>request.url().startsWith(origin+'/'))&&!request.url().startsWith('data:'))outcome.externalRequests.push(new URL(request.url()).origin);});};
  const user=await context.newPage();attach(user);await user.goto(origins.user);await user.locator('#login-form [name=username]').fill('friend');await user.locator('#login-form [name=password]').fill('wrong-fixture-password');await user.locator('#login-form button').click();
  await user.locator('#login-form [role=alert]:not([hidden])').waitFor();assert.ok(await user.locator('#login-form button').isEnabled());
  await user.locator('#login-form [name=password]').fill('compat-friend-password');await user.locator('#login-form [name=password]').press('Enter');await user.waitForFunction(()=>document.querySelector('#page-sync').textContent.startsWith('更新于'));
  const url=await user.locator('#subscription').inputValue(),before=await(await fetch(url)).text();
  await user.locator('[data-chart-days="7"]').focus();await user.keyboard.press('ArrowRight');assert.equal(await user.locator('[data-chart-days="30"]').getAttribute('aria-pressed'),'true');
  await user.getByRole('button',{name:'我的订阅',exact:true}).click();const copyWidth=(await user.locator('#copy-sub').boundingBox()).width;await user.locator('#copy-sub').click();await user.waitForFunction(()=>document.querySelector('#copy-sub').textContent.includes('已复制'));
  assert.ok(Math.abs((await user.locator('#copy-sub').boundingBox()).width-copyWidth)<=1);assert.ok(await user.evaluate(()=>window.compatClipboard===document.querySelector('#subscription').value));
  await user.getByRole('button',{name:'使用文档',exact:true}).click();await user.locator('[data-guide-platform=desktop]').focus();await user.keyboard.press('ArrowRight');assert.equal(await user.locator('[data-guide-platform=android]').getAttribute('aria-pressed'),'true');
  await user.locator('[data-device-guide=android] .guide-step-nav [data-jump-step="3"]').click();assert.equal(await user.locator('[data-device-guide=android] [data-step="3"] h3').evaluate(el=>el===document.activeElement),true);assert.equal(await user.locator('[data-device-guide=android] .guide-checks input:checked').count(),0);
  await user.setViewportSize({width:390,height:844});await user.getByLabel('外观模式').selectOption('dark');await user.locator('#menu-toggle').click();await user.waitForFunction(()=>document.body.classList.contains('nav-open'));
  assert.equal(await user.locator('#content').evaluate(el=>el.inert),true);await user.keyboard.press('Escape');assert.equal(await user.locator('#menu-toggle').getAttribute('aria-expanded'),'false');assert.equal(await user.locator('#menu-toggle').evaluate(el=>el===document.activeElement),true);
  await user.emulateMedia({reducedMotion:'reduce'});await user.locator('#menu-toggle').click();assert.equal(await user.locator('#sidebar').evaluate(el=>el.getAnimations().length),0);await user.locator('#section-nav [data-panel=subscription]').click();
  assert.equal(await user.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await user.evaluate(()=>document.activeElement?.blur());await user.screenshot({path:`test-output/compatibility/${candidate.name}-mobile.png`});
  assert.equal(await(await fetch(url)).text(),before);outcome.checks.push('Login rejection/retry, keyboard choice, copy geometry, guide commands, 2x-DPI mobile dark, drawer focus/reduced-motion and unchanged private export');

  const admin=await context.newPage();attach(admin);await admin.goto(origins.admin);await admin.locator('#login-form [name=username]').fill('owner');await admin.locator('#login-form [name=password]').fill('compat-owner-password');await admin.locator('#login-form button').click();await admin.waitForFunction(()=>document.querySelector('#page-sync').textContent.startsWith('更新于'));
  await admin.getByRole('button',{name:'用户管理',exact:true}).click();const row=admin.locator('#users-list .user-row').filter({hasText:'friend'});
  await row.getByRole('button',{name:'编辑账号',exact:true}).click();
  assert.equal(await admin.locator('#user-dialog').evaluate(el=>el.open&&!el.inert&&el.contains(document.activeElement)),true);await admin.locator('#close-dialog').click();assert.equal(await admin.locator('#user-dialog').evaluate(el=>el.open),false);
  assert.equal(await row.getByRole('button',{name:'编辑账号',exact:true}).evaluate(el=>el===document.activeElement),true);await admin.waitForFunction(()=>document.querySelector('#user-dialog').getAnimations().length===0);
  for(const [name,id,close]of [['重置密码','reset-dialog','close-reset'],['用量详情','usage-log-dialog','usage-log-close']]){
   const opener=row.getByRole('button',{name,exact:true});await opener.click();assert.equal(await admin.locator('#'+id).evaluate(el=>el.open&&!el.inert),true);await admin.locator('#'+close).click();assert.equal(await opener.evaluate(el=>el===document.activeElement),true);await admin.waitForFunction(id=>document.querySelector('#'+id).getAnimations().length===0,id);
  }
  await admin.locator('#new-user').click();await admin.locator('#close-dialog').click();assert.equal(await admin.locator('#new-user').evaluate(el=>el===document.activeElement),true);await admin.waitForFunction(()=>document.querySelector('#user-dialog').getAnimations().length===0);
  await admin.getByRole('button',{name:'节点管理',exact:true}).click();const nodeOpener=admin.locator('#admin-nodes .detail-button').first();await nodeOpener.click();await admin.locator('#close-usage').click();assert.equal(await nodeOpener.evaluate(el=>el===document.activeElement),true);await admin.waitForFunction(()=>document.querySelector('#usage-dialog').getAnimations().length===0);
  await admin.getByRole('button',{name:'用户管理',exact:true}).click();
  await admin.emulateMedia({reducedMotion:'reduce'});await row.getByRole('button',{name:'编辑账号',exact:true}).click();assert.equal(await admin.locator('#user-dialog').evaluate(el=>el.getAnimations().length),0);
  await admin.locator('#user-form [name=displayName]').fill('Unsaved compatibility fixture');store.db.prepare('DELETE FROM sessions WHERE user_id=?').run(owner);await admin.locator('#user-form .primary').click();await admin.locator('#login-view').waitFor();
  assert.equal(await admin.locator('dialog[open]').count(),0);assert.equal(await admin.locator('#user-form [name=displayName]').inputValue(),'');assert.ok(await admin.locator('dialog').evaluateAll(dialogs=>dialogs.every(dialog=>getComputedStyle(dialog).display==='none')));
  outcome.capabilities=await admin.evaluate(()=>({discrete:CSS.supports('transition-behavior','allow-discrete'),overlay:CSS.supports('overlay','auto')}));outcome.checks.push('Every existing dialog invoker returns focus, native logical closing is immediate, reduced motion and actual 401 cleanup preserve privacy');
  assert.deepEqual(outcome.errors,[]);assert.deepEqual(outcome.externalRequests,[]);outcome.passed=true;await context.close();await browser.close();browser=null;
 }
 const baselineRef=process.env.KENXU_UI_BASELINE;
 if(baselineRef&&!/^[a-zA-Z0-9][a-zA-Z0-9_./-]{0,199}$/.test(baselineRef))throw Error('Invalid optional baseline ref');
 for(const file of ['public/client.js','public/portal.css']){
  const current=await readFile(file),resource={file,currentBytes:current.length,currentGzip:gzipSync(current).length};
  // A fresh/shallow checkout can run functional tests without historical Git
  // objects. Comparing a release baseline is an explicit optional measurement.
  if(baselineRef){const baseline=execFileSync('git',['show',baselineRef+':'+file],{encoding:null});Object.assign(resource,{baselineRef,baselineBytes:baseline.length,deltaBytes:current.length-baseline.length,baselineGzip:gzipSync(baseline).length});}
  report.resources.push(resource);
 }
 assert.ok(report.engines.some(engine=>engine.passed));report.passed=true;report.status='complete';report.at=new Date().toISOString();await writeFile('test-output/compatibility/results.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}catch(error){report.passed=false;report.status='failed';report.error=error.message;await writeFile('test-output/compatibility/results.json',JSON.stringify(report,null,2));throw error;}
finally{await browser?.close();for(const server of servers){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}store.close();const resolved=path.resolve(dir);if(path.dirname(resolved)!==path.resolve(tmpdir())||!path.basename(resolved).startsWith('kenxu-compat-'))throw Error('Unexpected fixture path');await rm(resolved,{recursive:true,force:true});}
