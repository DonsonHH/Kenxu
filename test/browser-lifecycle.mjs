import {chromium} from 'playwright';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import {openStore} from '../src/store.mjs';
import {createApp} from '../src/app.mjs';

const dir=await mkdtemp(path.join(tmpdir(),'portal-lifecycle-')),store=openStore(dir),servers=[],errors=[];let browser;
try{
 store.importSource('proxies: [{name: Fixture, type: vless, server: example.test, port: 443}]');
 const proxy=store.inventory()[0],meter=store.meter.register(proxy.id,'Fixture');
 const owner=await store.createUser('owner','lifecycle-owner-password',[],'admin');
 const alice=await store.createUser('alice','lifecycle-alice-password',[proxy.id]),bob=await store.createUser('bobby','lifecycle-bobby-password',[proxy.id]);
 await store.setPassword(alice,'lifecycle-alice-password');await store.setPassword(bob,'lifecycle-bobby-password');
 const now=Date.now()-1000;store.db.prepare('INSERT INTO activity_samples VALUES(?,?,?,?,?,?,?)').run(meter.id,alice,now,Math.floor(now/60000)*60000,'["192.0.2.10"]','[]',1);
 const origins={};for(const role of ['user','admin']){let app;const server=http.createServer((req,res)=>app(req,res));await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));origins[role]='http://127.0.0.1:'+server.address().port;app=createApp({store,origin:origins[role],admin:role==='admin'});servers.push(server);}
 browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHANNEL?{channel:process.env.PLAYWRIGHT_CHANNEL}:{})});
 async function signIn(page,username,password){await page.locator('#login-form [name=username]').fill(username);await page.locator('#login-form [name=password]').fill(password);await page.locator('#login-form button').click();await page.waitForFunction(()=>document.querySelector('#page-sync').textContent.startsWith('更新于'));}
 async function login(role,username,password){const page=await browser.newPage({viewport:{width:1440,height:1000}});page.setDefaultTimeout(5000);page.on('pageerror',e=>errors.push(e.message));await page.goto(origins[role]);await signIn(page,username,password);return page;}
 let user=await login('user','alice','lifecycle-alice-password');
 store.db.prepare('DELETE FROM sessions WHERE user_id=?').run(alice);
 const rejection=user.waitForResponse(r=>new URL(r.url()).pathname==='/api/account/last-use');
 await user.getByRole('button',{name:'个人中心',exact:true}).click();
 assert.equal((await rejection).status(),401,'The real server must reject the expired session');
 await user.waitForFunction(()=>!document.querySelector('#login-view').hidden,undefined,{timeout:2000});
 assert.equal(await user.locator('#subscription').inputValue(),'');assert.equal(await user.locator('#account-last-use-ip').innerText(),'');assert.equal(await user.locator('#account-last-use-location').innerText(),'');
 await user.close();user=await login('user','alice','lifecycle-alice-password');
 let releaseOld,observedOld,capturedOld=false;const oldGate=new Promise(resolve=>releaseOld=resolve),oldRejected=new Promise(resolve=>observedOld=resolve);
 await user.route('**/api/account/last-use',async route=>{if(capturedOld)return route.continue();capturedOld=true;const response=await route.fetch();assert.equal(response.status(),401);observedOld();await oldGate;await route.fulfill({response});});
 store.db.prepare('DELETE FROM sessions WHERE user_id=?').run(alice);await user.getByRole('button',{name:'个人中心',exact:true}).click();await oldRejected;
 await user.getByRole('button',{name:'退出',exact:true}).click();await user.locator('#login-view').waitFor();await signIn(user,'bobby','lifecycle-bobby-password');
 const oldResponse=user.waitForResponse(r=>new URL(r.url()).pathname==='/api/account/last-use'&&r.status()===401);releaseOld();await oldResponse;
 await user.waitForFunction(()=>document.querySelector('#logout').disabled===false);assert.ok(await user.locator('#user-view').isVisible());assert.equal(await user.locator('#identity').innerText(),'bobby','An old 401 must not evict the replacement account');await user.unroute('**/api/account/last-use');
 await user.close();
 const admin=await login('admin','owner','lifecycle-owner-password');await admin.getByRole('button',{name:'用户管理',exact:true}).click();
 const userRow=name=>admin.locator('#users-list .user-row').filter({hasText:name});
 await userRow('alice').getByRole('button',{name:'用量详情',exact:true}).click();await admin.locator('#usage-overview-body table').first().waitFor();
 await admin.evaluate(()=>{document.querySelector('#usage-log-dialog').close();const row=[...document.querySelectorAll('#users-list .user-row')].find(row=>row.textContent.includes('bobby'));[...row.querySelectorAll('button')].find(button=>button.textContent==='用量详情').click();});
 await admin.waitForFunction(()=>document.querySelector('#usage-log-title').textContent==='bobby · 用量详情',undefined,{timeout:2000});
 assert.ok(await admin.locator('#usage-overview-body table').first().isVisible());await admin.keyboard.press('Escape');
 let releaseSave,saveStarted;const saveBlocked=new Promise(resolve=>releaseSave=resolve),saveObserved=new Promise(resolve=>saveStarted=resolve);
 await admin.route('**/api/admin/users/'+alice,async route=>{if(route.request().method()!=='PUT')return route.continue();const response=await route.fetch();assert.equal(response.status(),200);saveStarted();await saveBlocked;await route.fulfill({response});});
 await userRow('alice').getByRole('button',{name:'编辑账号',exact:true}).click();await admin.locator('#user-form [name=displayName]').fill('Alice saved');await admin.getByRole('button',{name:'保存账号',exact:true}).click();await saveObserved;
 await admin.keyboard.press('Escape');await userRow('bobby').getByRole('button',{name:'编辑账号',exact:true}).click();await admin.locator('#user-form [name=displayName]').fill('Bobby unsaved draft');
 const saveResponse=admin.waitForResponse(r=>new URL(r.url()).pathname.endsWith('/users/'+alice)&&r.request().method()==='PUT');releaseSave();await saveResponse;
 await admin.waitForFunction(()=>document.querySelector('#users-list').textContent.includes('Alice saved'));
 assert.ok(await admin.locator('#user-dialog').isVisible(),'A delayed save for Alice must not close Bobby\'s editor');
 assert.equal(await admin.locator('#user-form [name=displayName]').inputValue(),'Bobby unsaved draft');
 assert.equal(store.getUser(alice).display_name,'Alice saved');assert.equal(store.getUser(bob).display_name,'');
 await admin.keyboard.press('Escape');assert.equal(await userRow('bobby').getByRole('button',{name:'编辑账号',exact:true}).evaluate(el=>el===document.activeElement),true,'Closing a surviving draft restores its replacement opener after an older save rebuilt the list');await admin.unroute('**/api/admin/users/'+alice);
 await admin.route('**/api/admin/users/'+bob,route=>route.request().method()==='PUT'?route.fulfill({status:429,contentType:'application/json',body:'{"error":"模拟限流，请稍后重试","retryAfter":5}'}):route.continue());
 await userRow('bobby').getByRole('button',{name:'编辑账号',exact:true}).click();await admin.getByRole('button',{name:'保存账号',exact:true}).click();await admin.getByRole('button',{name:/请等待 \d+ 秒/}).waitFor();
 await admin.keyboard.press('Escape');await userRow('alice').getByRole('button',{name:'编辑账号',exact:true}).click();assert.ok(await admin.getByRole('button',{name:'保存账号',exact:true}).isEnabled(),'Reset clears only this form\'s old cooldown UI; server limits remain authoritative');await admin.keyboard.press('Escape');await admin.unroute('**/api/admin/users/'+bob);
 await userRow('bobby').getByRole('button',{name:'编辑账号',exact:true}).click();await admin.locator('#user-form [name=displayName]').fill('Must not save with expired session');store.db.prepare('DELETE FROM sessions WHERE user_id=?').run(owner);await admin.getByRole('button',{name:'保存账号',exact:true}).click();await admin.locator('#login-view').waitFor();
 assert.equal(await admin.locator('dialog[open]').count(),0);assert.equal(await admin.locator('#user-form [name=displayName]').inputValue(),'');assert.equal(await admin.locator('#grant-options').innerText(),'');assert.equal(store.getUser(bob).display_name,'','The expired administrator cannot mutate an account');
 await admin.close();
 assert.deepEqual(errors,[]);
 console.log('PASS: real user/admin expiry clears sensitive state and open dialogs; late 401s cannot evict a new account; delayed successful saves preserve another account draft and never mutate it');
}finally{await browser?.close();for(const server of servers){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}store.close();await rm(dir,{recursive:true,force:true});}
