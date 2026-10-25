import {chromium} from 'playwright';
import {mkdtemp,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import YAML from 'yaml';
import {openStore} from '../src/store.mjs';
import {createApp} from '../src/app.mjs';

const dir=await mkdtemp(path.join(tmpdir(),'admin-workflows-')),store=openStore(dir),servers=[],errors=[];let browser;
try{
 const names=['Azure@SG1🇸🇬','Azure@SG2🇸🇬','Azure@SG3🇸🇬','Azure@US1🇺🇸','Azure@US2🇺🇸','UK@GUSecure2🇬🇧','Backup@JP🇯🇵','China@US🇺🇸','Aether@US3🇺🇸'];
 store.importSource(YAML.stringify({proxies:names.map((name,i)=>({name,type:'vless',server:'fixture.example',port:443,uuid:'fictional-source',...([6,7].includes(i)?{'kenxu-user-hidden':true}:{})})),rules:['MATCH,'+names[0]]}));
 const registrations=store.inventory().slice(0,7).map((p,i)=>store.meter.register(p.id,p.name,i===5?{agentId:store.meter.nodes().find(n=>n.name===names[1]).id,outboundTag:'uk-gusecure2'}:{}));
 store.db.prepare('UPDATE meter_nodes SET enabled=0,direct_delivery=1,user_hidden=1 WHERE id=?').run(registrations[6].id);
 const us3=store.inventory().find(n=>n.name==='Aether@US3🇺🇸');store.meter.register(us3.id,us3.name);
 const id=await store.createUser('sample_user','fixture-sample-password',store.inventory().map(n=>n.id));await store.setPassword(id,'fixture-sample-password');await store.createUser('sample_owner','fixture-owner-password',[],'admin');
 const delivered=store.config(store.getUser(id));
 for(const proxy of store.source().proxies)store.health.record(store.inventory().find(n=>n.name===proxy.name).id,proxy,{status:'normal',latency:80,setupMs:120,totalMs:200,metric:'http-response-v2',target:'gstatic-204',at:Date.now()});
 const monitorReader=async()=>({configured:true,available:true,fetchedAt:Date.now(),sourceUrl:'https://monitor.example',servers:[{id:'fixture',name:'Singapore 1',region:'SG',online:true,lastSeen:Date.now(),cpu:12,ram:1024**3,ramTotal:2*1024**3,disk:5*1024**3,diskTotal:20*1024**3,netIn:1024,netOut:2048,periodUp:3*1024**3,periodDown:4*1024**3,uptime:86400}]});
 const origins={};for(const role of ['admin','user']){let app;const s=http.createServer((req,res)=>app(req,res));await new Promise(resolve=>s.listen(0,'127.0.0.1',resolve));origins[role]='http://127.0.0.1:'+s.address().port;app=createApp({store,origin:origins[role],admin:role==='admin',monitorReader});servers.push(s);}
 browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHANNEL?{channel:process.env.PLAYWRIGHT_CHANNEL}:{})});await mkdir('test-output/review-v1.7',{recursive:true});
 async function login(page,role){page.setDefaultTimeout(8000);page.on('pageerror',e=>errors.push(e.message));await page.goto(origins[role]);await page.locator('#login-form [name=username]').fill(role==='admin'?'sample_owner':'sample_user');await page.locator('#login-form [name=password]').fill(role==='admin'?'fixture-owner-password':'fixture-sample-password');await page.locator('#login-form [type=submit]').click();await page.waitForFunction(()=>document.querySelector('#page-sync').textContent.startsWith('更新于'));}
 async function capture(page,file){await page.evaluate(()=>{document.activeElement.blur();window.scrollTo(0,0);});await page.waitForFunction(()=>document.getAnimations().every(a=>a.playState!=='running'));await page.screenshot({path:'test-output/review-v1.7/'+file+'.png',fullPage:true});}
 async function groups(page,root,counts){
  const actual=await page.locator(root+' [data-node-group]').evaluateAll(sections=>sections.map(s=>[s.dataset.nodeGroup,s.querySelectorAll('.route-card').length]));assert.deepEqual(actual,counts);
  assert.equal(await page.locator(root).evaluate(el=>/[\u{1f1e6}-\u{1f1ff}]/u.test(el.innerText)),false,'No unsupported flag glyphs in node cards');
  await page.waitForFunction(root=>[...document.querySelectorAll(root+' .country-badge img')].every(img=>img.complete&&img.naturalWidth>0),root);
 }
 const admin=await browser.newPage({viewport:{width:1440,height:1000}});await login(admin,'admin');
 for(const [i,label]of ['仪表盘','用户管理','流量统计','节点管理','规则管理','系统设置','操作日志'].entries()){
  await admin.getByRole('link',{name:label,exact:true}).click();assert.equal(await admin.locator('#page-heading').innerText(),label);
  if(label==='节点管理'){
   await groups(admin,'#admin-nodes',[['sg',3],['us',3],['other',3]]);
   const backup=admin.locator('#admin-nodes .route-card').filter({hasText:'China@US'});assert.ok((await backup.innerText()).includes('直连 · 未计量'));assert.equal(await backup.getByRole('button',{name:/节点用量/}).count(),0,'No fabricated metering drilldown for a direct backup');
   assert.equal(await admin.locator('[data-panel=nodes] #import-form').count(),1);assert.equal(await admin.locator('.source-import').getAttribute('open'),null);
   await admin.locator('#monitor-cards .monitor-card').waitFor();
  }
  if(label==='规则管理'){await admin.waitForFunction(()=>!document.querySelector('#rules-content').disabled);await admin.getByRole('button',{name:'校验并预览',exact:true}).click();await admin.locator('#rules-preview-list li').waitFor();assert.ok((await admin.locator('#rules-preview-list').innerText()).includes('[SG]'));assert.ok((await admin.locator('#rules-content').inputValue()).includes('🇸🇬'),'Editable rule identities stay exact');}
  if(label==='系统设置')assert.equal(await admin.locator('[data-panel=settings] #import-form').count(),0,'Source maintenance has one canonical location');
  if(label==='操作日志')await admin.locator('#audit-list li').first().waitFor();
  await capture(admin,(i+1)+'-admin-panel');
 }
 await admin.getByRole('link',{name:'用户管理',exact:true}).click();await admin.getByRole('button',{name:'编辑账号',exact:true}).click();await admin.getByRole('dialog',{name:'编辑账号 · sample_user',exact:true}).waitFor();assert.equal(await admin.getByRole('checkbox',{name:'China@US [US]',exact:true}).isChecked(),true);await capture(admin,'8-edit-account');await admin.keyboard.press('Escape');
 await admin.getByRole('button',{name:'重置密码',exact:true}).click();await admin.getByRole('dialog',{name:'重置密码 · sample_user',exact:true}).waitFor();await admin.locator('#reset-form [name=password]').fill('temporary-unsaved-secret');await capture(admin,'9-reset-account');await admin.keyboard.press('Escape');await admin.waitForFunction(()=>document.querySelector('#reset-form [name=password]').value==='');
 // Rejected import must not change source, grants, or the export.
 await admin.getByRole('link',{name:'节点管理',exact:true}).click();await admin.getByText('高级：更新私有配置源',{exact:true}).click();await admin.locator('#source-file').setInputFiles({name:'invalid.yaml',mimeType:'text/yaml',buffer:Buffer.from('proxies: []')});await admin.getByRole('button',{name:'校验并更新',exact:true}).click();await admin.getByText(/配置无效：请检查节点/).first().waitFor();assert.equal(store.config(store.getUser(id)),delivered);
 assert.equal(await admin.locator('[data-sonner-toaster]').count(),1,'The admin uses one notification surface');
 await admin.evaluate(()=>window.portalToast.dismiss());await admin.getByText('高级：更新私有配置源',{exact:true}).click();
 await admin.getByLabel('外观模式').selectOption('dark');await admin.getByRole('link',{name:'流量统计',exact:true}).click();const color=await admin.locator('.detail-button').first().evaluate(el=>({bg:getComputedStyle(el).backgroundColor,fg:getComputedStyle(el).color}));assert.notEqual(color.bg,'rgb(239, 237, 251)');assert.notEqual(color.fg,color.bg);await capture(admin,'10-admin-traffic-dark');
 for(const width of [1920,3840,390]){
  await admin.setViewportSize({width,height:width===390?844:1080});if(width===390)await admin.getByRole('button',{name:'打开导航',exact:true}).click();await admin.getByRole('link',{name:'节点管理',exact:true}).click();await groups(admin,'#admin-nodes',[['sg',3],['us',3],['other',3]]);assert.equal(await admin.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await capture(admin,'11-admin-nodes-'+width);
 }
 const user=await browser.newPage({viewport:{width:1440,height:1000}});await login(user,'user');await user.getByRole('link',{name:'节点状态',exact:true}).click();await groups(user,'#node-list',[['sg',3],['us',3],['other',1]]);assert.ok(!(await user.locator('#node-list').innerText()).includes('China@US'));assert.ok(!(await user.locator('#node-list').innerText()).includes('Backup@JP'));assert.ok(!(await user.locator('#user-latency').getAttribute('aria-label')).includes('🇺🇸'));await capture(user,'12-user-nodes');
 await user.getByRole('link',{name:'个人中心',exact:true}).click();await user.locator('#open-password').click();await user.locator('#password-form [name=currentPassword]').fill('unsaved-sensitive-value');await user.getByRole('button',{name:'返回',exact:true}).click();assert.equal(await user.locator('#password-form [name=currentPassword]').inputValue(),'');
 await user.getByRole('button',{name:'退出',exact:true}).click();await user.locator('#login-view').waitFor();assert.equal(await user.locator('#password-form [name=currentPassword]').inputValue(),'');
 assert.equal(store.config(store.getUser(id)),delivered,'UI audits cannot rename nodes or change delivery');assert.deepEqual(errors,[]);
 console.log('PASS: all seven admin panels, canonical usage/source maintenance, labelled account/reset dialogs, rejected import, exact subscription identities, SG/US/other grouping, real flag assets, hidden unmetered backups, 390/1920/3840 layouts and sensitive form clearing');
}finally{await browser?.close();for(const s of servers){s.closeAllConnections();await new Promise(resolve=>s.close(resolve));}store.close();await rm(dir,{recursive:true,force:true});}
