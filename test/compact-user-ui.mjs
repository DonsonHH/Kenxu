import {chromium} from 'playwright';
import {mkdtemp,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import YAML from 'yaml';
import {openStore} from '../src/store.mjs';
import {createApp} from '../src/app.mjs';
import {createIpLocation} from '../src/ip-location.mjs';

const dir=await mkdtemp(path.join(tmpdir(),'compact-user-')),store=openStore(dir);let browser,server;
try{
 const names=['UK@GUSecure2🇬🇧','Azure@US2🇺🇸','Azure@SG3🇸🇬','Azure@SG1🇸🇬','Azure@US1🇺🇸','Azure@SG2🇸🇬','Backup@JP🇯🇵','China@US🇺🇸'];
 store.importSource(YAML.stringify({proxies:names.map((name,i)=>({name,type:'vless',server:'fixture.example',port:443,uuid:'fictional-source',...(i>5?{'kenxu-user-hidden':true}:{})})),rules:['MATCH,'+names[3]]}));
 for(const node of store.inventory().slice(0,6).filter(n=>!n.name.startsWith('UK@')))store.meter.register(node.id,node.name);
 const uk=store.inventory()[0],sg2=store.meter.nodes().find(n=>n.name.startsWith('Azure@SG2'));store.meter.register(uk.id,uk.name,{agentId:sg2.id,outboundTag:'uk-gusecure2'});
 const user=await store.createUser('friend','compact-friend-password',store.inventory().map(n=>n.id)),subset=await store.createUser('subset','compact-subset-password',[store.inventory()[1].id]);await store.setPassword(user,'compact-friend-password');await store.setPassword(subset,'compact-subset-password');
 const n=store.meter.nodes()[0],at=Date.now()-1000;store.db.prepare('INSERT INTO activity_samples VALUES(?,?,?,?,?,?,?)').run(n.id,user,at,Math.floor(at/60000)*60000,'["8.8.8.8"]','[]',1);
 const latencies=[180,122,83,81,121,82,200,220];for(const [i,proxy]of store.source().proxies.entries())store.health.record(store.inventory().find(n=>n.name===proxy.name).id,proxy,{status:'normal',latency:latencies[i],setupMs:100,totalMs:100+latencies[i],metric:'http-response-v2',target:'gstatic-204',at:Date.now()});
 let providerRequests=0;store.ipLocation=createIpLocation(store,{token:'fixture-token',fetchImpl:async()=>{providerRequests++;return new Response(JSON.stringify({ip:'8.8.8.8',country:'US',region:'California',city:'Mountain View',org:'AS15169 Do Not Display ISP'}));}});
 let app;server=http.createServer((req,res)=>app(req,res));await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;app=createApp({store,origin});
 browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHANNEL?{channel:process.env.PLAYWRIGHT_CHANNEL}:{})});const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.setDefaultTimeout(8000);page.on('pageerror',error=>errors.push(error.message));let lastUseRequests=0,historyRequests=0;
 page.on('request',r=>{const p=new URL(r.url()).pathname;if(p==='/api/account/last-use')lastUseRequests++;if(p==='/api/account/sources')historyRequests++;});
 async function signIn(username,password){await page.goto(origin);await page.locator('#login-form [name=username]').fill(username);await page.locator('#login-form [name=password]').fill(password);await page.locator('#login-form [type=submit]').click();await page.waitForFunction(()=>document.querySelector('#page-sync').textContent.startsWith('更新于'));}
 await signIn('friend','compact-friend-password');const exportBefore=await(await fetch(await page.locator('#subscription').inputValue())).text();assert.equal(providerRequests,0);assert.equal(lastUseRequests,0);
 await page.getByRole('button',{name:'个人中心',exact:true}).click();await page.locator('#account-last-use-location').filter({hasText:'Mountain View'}).waitFor();assert.equal(providerRequests,1);assert.equal(historyRequests,0);
 assert.equal(await page.locator('#user-view [data-panel=account] > .card').count(),1);assert.equal(await page.locator('#account-sources').count(),0);assert.equal(await page.getByRole('button',{name:'查询 IPinfo 归属',exact:true}).count(),0);
 assert.equal(await page.locator('#account-last-use-ip').innerText(),'8.8.8.8');assert.match(await page.locator('#account-last-use-location').innerText(),/美国 · California · Mountain View（估算）/);assert.ok(!(await page.locator('#user-view [data-panel=account]').innerText()).includes('Do Not Display ISP'));
 const ip=await page.locator('#account-last-use-ip').boundingBox(),location=await page.locator('#account-last-use-location').boundingBox();assert.ok(location.x>ip.x+ip.width&&Math.abs(location.y-ip.y)<4,'Address follows the IP on the same desktop line');
 await mkdir('test-output/review-v1.7.2',{recursive:true});await page.evaluate(()=>{document.activeElement.blur();window.scrollTo(0,0);});await page.waitForFunction(()=>document.getAnimations().every(a=>a.playState!=='running'));await page.screenshot({path:'test-output/review-v1.7.2/account.png',fullPage:true});
 await page.getByRole('button',{name:'仪表盘',exact:true}).click();await page.getByRole('button',{name:'个人中心',exact:true}).click();assert.equal(providerRequests,1);assert.equal(lastUseRequests,1,'Returning to the profile does not repeat the lookup');
 await page.getByRole('button',{name:'节点状态',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#user-latency').dataset.rendered==='true');
 const labels=(await page.locator('#user-latency').getAttribute('aria-label')).split('; ');for(const [i,name]of ['Azure@SG1','Azure@SG2','Azure@SG3','Azure@US1','Azure@US2','UK@GUSecure2'].entries())assert.ok(labels[i].startsWith(name),labels.join('; '));for(const [i,ms]of [81,82,83,121,122,180].entries())assert.ok(labels[i].endsWith(ms+' ms'),'Sorting must keep measured delays attached to the correct node');
 for(const width of [1440,1920,2560,3840,1280,768,390]){
  await page.setViewportSize({width,height:width===390?844:1000});await page.waitForFunction(()=>document.getAnimations().every(a=>a.playState!=='running'));
  const boxes=await page.locator('#node-list .route-card').evaluateAll(cards=>cards.map(card=>{const r=card.getBoundingClientRect();return {top:r.top,width:r.width};}));assert.equal(boxes.length,6);if(width>=1400)assert.ok(boxes.every(r=>Math.abs(r.top-boxes[0].top)<2),'Six cards must share one row at '+width);assert.ok(boxes.every(r=>r.width>140));assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.evaluate(()=>{document.activeElement.blur();window.scrollTo(0,0);});await page.screenshot({path:'test-output/review-v1.7.2/nodes-'+width+'.png',fullPage:true});
 }
 await page.setViewportSize({width:1440,height:1000});await page.getByLabel('外观模式').selectOption('dark');await page.screenshot({path:'test-output/review-v1.7.2/nodes-dark.png',fullPage:true});await page.getByRole('button',{name:'个人中心',exact:true}).click();await page.setViewportSize({width:390,height:844});await page.evaluate(()=>{document.activeElement.blur();window.scrollTo(0,0);});await page.screenshot({path:'test-output/review-v1.7.2/account-mobile-dark.png',fullPage:true});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 assert.equal(await(await fetch(await page.locator('#subscription').inputValue())).text(),exportBefore,'Presentation never changes delivered node identities or credentials');
 await page.getByRole('button',{name:'退出',exact:true}).click();await page.locator('#login-view').waitFor();assert.equal(await page.locator('#account-last-use-location').innerText(),'');await page.setViewportSize({width:1440,height:1000});await signIn('subset','compact-subset-password');await page.getByRole('button',{name:'节点状态',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#user-latency').dataset.rendered==='true');assert.equal(await page.locator('#node-list .route-card').count(),1);assert.ok((await page.locator('#user-latency').getAttribute('aria-label')).startsWith('Azure@US2 [US]'));
 await page.getByRole('button',{name:'个人中心',exact:true}).click();await page.getByText('暂无使用记录',{exact:true}).waitFor();assert.equal(await page.locator('#account-last-use-location').innerText(),'');assert.deepEqual(errors,[]);
 console.log('PASS: one compact profile card, inline latest-IP city, cached single-IP lookup with no history reads, SG-first measured chart order, six cards on wide rows, 390–3840 reflow, dark layout, grant isolation and unchanged subscription');
}finally{await browser?.close();if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}store.close();await rm(dir,{recursive:true,force:true});}
