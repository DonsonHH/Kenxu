import {chromium} from 'playwright';
import {mkdtemp,mkdir,rm} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import http from 'node:http';
import assert from 'node:assert/strict';
import {openStore} from '../src/store.mjs';
import {createApp} from '../src/app.mjs';
const directory=await mkdtemp(path.join(tmpdir(),'kenxu-responsive-')),store=openStore(directory),servers=[];let browser;const realNow=Date.now;
try{
 Date.now=()=>realNow()-8*86400000;store.importSource('proxies: [{name: Example Node, type: vless, server: fixture.example, port: 443, uuid: fixture}, {name: Pending Node, type: vless, server: pending.example, port: 443, uuid: fixture}]\nrules: ["MATCH,Example Node"]');
 const proxy=store.inventory()[0],registration=store.meter.register(proxy.id,'Example Node'),meter=store.meter.authenticate(registration.token);
 await store.createUser('owner','owner-responsive-fixture',[],'admin');const user=await store.createUser('friend','friend-responsive-fixture',store.inventory().map(n=>n.id));await store.setPassword(user,'friend-responsive-fixture');
 const pending=store.inventory()[1];store.meter.register(pending.id,'Pending Node');
 const desired=store.meter.desired(meter),client=desired.clients[0];let up=0,down=0;
 for(let day=0;day<7;day++){Date.now=()=>realNow()-(6-day)*86400000;up+=120*1024**2;down+=(day%3+1)*700*1024**2;store.meter.report(meter,{epoch:'fixture-responsive',seq:day+1,at:Date.now(),revision:desired.revision,counters:[{email:client.email,up,down}]});}
 Date.now=realNow;store.health.record(proxy.id,store.source().proxies[0],{status:'normal',at:Date.now(),latency:80,setupMs:980,totalMs:1200,metric:'http-response-v2',target:'gstatic-204'});
 store.health.record(pending.id,store.source().proxies[1],{status:'normal',at:Date.now(),latency:120,setupMs:980,totalMs:1200,metric:'http-response-v2',target:'gstatic-204'});
 const origins=[];for(const admin of [false,true]){let app;const server=http.createServer((req,res)=>app(req,res));await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));servers.push(server);const origin=`http://127.0.0.1:${server.address().port}`;app=createApp({store,origin,admin});origins.push(origin);}
 browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHANNEL?{channel:process.env.PLAYWRIGHT_CHANNEL}:{})});await mkdir('test-output',{recursive:true});
 for(const [index,origin]of origins.entries()){
  const page=await browser.newPage({viewport:{width:2560,height:1440}});page.setDefaultTimeout(6000);
  if(!index)await page.addInitScript(()=>{window.motionCalls=[];const original=Element.prototype.animate;Element.prototype.animate=function(frames,options){window.motionCalls.push({id:this.id,frames,options});return original.call(this,frames,options);};});
  await page.goto(origin);
  if(!index){await page.locator('#login-scene').waitFor();assert.equal(await page.locator('#login-scene').getAttribute('aria-hidden'),'true');await page.screenshot({path:'test-output/user-2560-login.png',fullPage:true});}
  await page.locator('#login-form [name=username]').fill(index?'owner':'friend');await page.locator('#login-form [name=password]').fill(index?'owner-responsive-fixture':'friend-responsive-fixture');await page.locator('#login-form [type=submit]').click();await page.locator(index?'#admin-view':'#user-view').waitFor();
  await page.getByLabel('外观模式').selectOption('dark');
  if(!index){await page.waitForFunction(()=>document.querySelector('#dashboard-nodes').textContent==='1 / 1');assert.equal(await page.locator('#nodes-normal').innerText(),'1');assert.equal(await page.locator('#node-list .route-card').count(),1);}
  if(index){await page.getByRole('button',{name:'节点管理',exact:true}).click();await page.locator('#admin-nodes').getByText('80 ms',{exact:true}).waitFor();assert.ok((await page.locator('#admin-nodes').innerText()).includes('980 ms'));await page.locator('#admin-nodes .latency-breakdown summary').first().click();assert.ok((await page.locator('#admin-nodes').innerText()).includes('1200 ms'));await page.getByRole('button',{name:'仪表盘',exact:true}).click();}
  if(!index){assert.ok(await page.evaluate(()=>window.motionCalls.some(call=>call.id==='user-view')),'Pointer login should receive a short view transition');const count=await page.evaluate(()=>window.motionCalls.length);await page.getByRole('button',{name:'我的订阅',exact:true}).focus();await page.keyboard.press('Enter');assert.equal(await page.evaluate(()=>window.motionCalls.length),count,'Keyboard navigation must not animate');await page.getByRole('button',{name:'仪表盘',exact:true}).click();}
  for(const width of [1280,1920,2560,3840]){
   await page.setViewportSize({width,height:1440});const dimensions=await page.evaluate(index=>{
    const view=document.querySelector(index?'#admin-view':'#user-view').getBoundingClientRect(),side=document.querySelector('#sidebar').getBoundingClientRect().right;
    return {width:innerWidth,viewWidth:view.width,left:view.left-side,right:innerWidth-view.right,sidebar:side,overflow:document.documentElement.scrollWidth>innerWidth};
   },index);console.log(JSON.stringify({realm:index?'admin':'user',...dimensions}));
   if(width>=1920)assert.ok(Math.abs(dimensions.left-dimensions.right)<=24,'Large-screen content must be centered in the area beside the sidebar');
   if(width<=2560)assert.ok(dimensions.viewWidth/(width-dimensions.sidebar)>.86,'Desktop layout must use the available width');
   assert.equal(dimensions.overflow,false);
   if(width===2560)await page.screenshot({path:'test-output/'+(index?'admin':'user')+'-2560-dashboard.png',fullPage:true});
  }
  if(!index){await page.setViewportSize({width:390,height:844});await page.getByRole('button',{name:'打开导航',exact:true}).click();await page.getByRole('button',{name:'节点状态',exact:true}).click();assert.ok((await page.locator('#node-list').innerText()).includes('80 ms'));assert.ok(!(await page.locator('#user-latency').getAttribute('aria-label')).includes('Pending Node'));assert.equal(await page.locator('#node-list .latency-breakdown').count(),0);assert.ok(!(await page.locator('#node-list').innerText()).includes('1200 ms'));assert.ok(!(await page.locator('#node-list').innerText()).includes('980 ms'));assert.ok((await page.locator('#node-list .status-strip-legend').innerText()).includes('未确认'));assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
   await page.emulateMedia({reducedMotion:'reduce'});const before=await page.evaluate(()=>window.motionCalls.length);await page.getByRole('button',{name:'打开导航',exact:true}).click();await page.getByRole('button',{name:'仪表盘',exact:true}).click();assert.ok(await page.evaluate(before=>window.motionCalls.slice(before).every(call=>call.frames.every(frame=>!Object.hasOwn(frame,'transform'))),before),'Reduced motion must not move panels');
   await page.evaluate(()=>{document.activeElement.blur();window.scrollTo(0,0);});await page.screenshot({path:'test-output/user-390-dashboard-dark.png',fullPage:true});
   store.setAccess(user,true,[]);await page.getByRole('button',{name:'刷新数据',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#dashboard-nodes').textContent==='0 / 0');assert.equal(await page.locator('#node-list .route-card').count(),0,'Revoked nodes disappear without requiring logout');assert.equal(await page.locator('#delivery').evaluate(e=>e.hidden),true);assert.equal(await page.locator('#empty-grants').evaluate(e=>e.hidden),false);assert.equal(await page.locator('#node-count').innerText(),'0 条线路');
   store.setAccess(user,true,[proxy.id]);await page.getByRole('button',{name:'刷新数据',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#dashboard-nodes').textContent==='1 / 1');assert.equal(await page.locator('#node-list .route-card').count(),1);assert.equal(await page.locator('#delivery').evaluate(e=>e.hidden),false);assert.equal(await page.locator('#node-count').innerText(),'1 条线路');
   await page.getByRole('button',{name:'退出',exact:true}).click();await page.locator('#login-view').waitFor();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.screenshot({path:'test-output/user-390-login-dark.png',fullPage:true});
  }
  await page.close();
 }
 console.log('PASS: user/admin 1280, 1920, 2560 and 3840 CSS-pixel layouts are balanced without horizontal overflow');
}finally{Date.now=realNow;await browser?.close();for(const server of servers){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}store.close();await rm(directory,{recursive:true,force:true});}
