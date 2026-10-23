import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,readdir,rm,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {chromium} from 'playwright';
import {openStore} from '../src/store.mjs';
import {createApp} from '../src/app.mjs';

const directory=await mkdtemp(path.join(tmpdir(),'kenxu-guide-')),store=openStore(directory);
let browser,server;
try{
 store.importSource('proxies: [{name: Azure@SG1, type: vless, server: sg.fixture.example, port: 443, uuid: guide-fixture}, {name: Azure@US1, type: vless, server: us.fixture.example, port: 443, uuid: guide-fixture}]\nrules: ["MATCH,Azure@SG1"]');
 const user=await store.createUser('guide_friend','fixture-guide-password',store.inventory().map(n=>n.id));await store.setPassword(user,'fixture-guide-password');
 let app;server=http.createServer((req,res)=>app(req,res));await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;app=createApp({store,origin});
 browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHANNEL?{channel:process.env.PLAYWRIGHT_CHANNEL}:{})});
 const page=await browser.newPage({viewport:{width:1440,height:1100}}),errors=[],externalRequests=[];page.setDefaultTimeout(8000);page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(new URL(r.url()).origin!==origin)externalRequests.push(new URL(r.url()).origin);});await page.emulateMedia({reducedMotion:'reduce'});
 await page.goto(origin);await page.locator('#login-form [name=username]').fill('guide_friend');await page.locator('#login-form [name=password]').fill('fixture-guide-password');await page.locator('#login-form [type=submit]').click();await page.waitForFunction(()=>document.querySelector('#page-sync').textContent.startsWith('更新于'));
 const personal=await page.locator('#subscription').inputValue(),exportBefore=await(await fetch(personal)).text();
 async function openGuide(){const menu=page.locator('#menu-toggle');if(await menu.isVisible()&&await menu.getAttribute('aria-expanded')!=='true')await menu.click();await page.getByRole('link',{name:'使用文档',exact:true}).click();}
 await openGuide();const root=page.locator('#user-view [data-panel=knowledge]'),content=await root.textContent(),markdown=await readFile(new URL('../docs/user-guide.md',import.meta.url),'utf8');
 for(const text of [content,markdown]){assert.ok(!/Residential@US-LA|Microsoft Policy|Misaka Network|cloud\.kenxu\.top|1440\s*分钟/.test(text));assert.match(text,/720/);assert.match(text,/Intel/);assert.match(text,/Apple Silicon/);assert.match(text,/aarch64/);assert.match(text,/自己的 Apple 账号/);}
 assert.equal(await root.locator('.guide-device').count(),3);assert.equal(await root.locator('a[href*="/s/"],a[href*="/subscribe/"],img[src$=".pdf"]').count(),0,'No shared subscription or source PDF is embedded');
 const allowed=new Set(['github.com','apps.apple.com','www.clashverge.dev']);
 for(const href of await root.locator('a[href^="https:"]').evaluateAll(links=>links.map(link=>link.href)))assert.ok(allowed.has(new URL(href).hostname),'Guide links only to verified client download/help sources');
 const publicFiles=await readdir(new URL('../public/',import.meta.url),{recursive:true});assert.ok(publicFiles.every(name=>!name.toLowerCase().endsWith('.pdf')),'The private source PDF must not be published');
 await mkdir('test-output/guide',{recursive:true});
 for(const [label,platform]of [['电脑','desktop'],['Android','android'],['iPhone / iPad','ios']]){
  await root.getByRole('tab',{name:label,exact:true}).click();const section=root.locator('[data-device-guide='+platform+']');assert.ok(await section.isVisible());assert.equal(await section.locator('[data-step]').count(),4);assert.equal(await root.locator('[data-device-guide]:visible').count(),1);
  for(const step of [2,3,4,1]){const button=section.locator('nav [data-jump-step="'+step+'"]');await button.focus();await page.keyboard.press('Enter');assert.equal(await button.getAttribute('aria-current'),'step');assert.ok(await section.locator('[data-step="'+step+'"] h3').evaluate(el=>document.activeElement===el));}
  assert.equal(await section.locator('.guide-checks input').count(),3);await section.locator('.guide-checks input').first().check();assert.match(await section.locator('.guide-check-status').innerText(),/1 \/ 3/);
  const download=section.locator('.guide-download');for(const box of await download.evaluateAll(links=>links.map(link=>({height:link.getBoundingClientRect().height,href:link.href})))){assert.ok(box.height>=56);assert.ok(new URL(box.href).protocol==='https:');}
  for(const width of [320,390,768,1440,2560,3840]){await page.setViewportSize({width,height:1000});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,platform+' fits '+width+'px');}
  await page.setViewportSize({width:1440,height:1100});await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:'test-output/guide/'+platform+'-desktop.png',fullPage:true});
 }
 // The only diagram is a desktop reference; loading it must not fetch private/source material.
 await root.getByRole('tab',{name:'电脑',exact:true}).click();await root.getByText('查看截图与策略组说明',{exact:true}).click();const image=root.locator('[data-device-guide=desktop] .guide-figure img');await image.scrollIntoViewIfNeeded();await page.waitForFunction(()=>document.querySelector('[data-device-guide=desktop] .guide-figure img').naturalWidth===989);assert.equal(await image.evaluate(img=>img.naturalHeight),709);assert.match(await image.getAttribute('alt'),/两个选择组/);
 const asset=await(await fetch(origin+'/guide/clash-proxy-groups-20261017.png')).arrayBuffer(),expected=await readFile(new URL('../public/guide/clash-proxy-groups-20261017.png',import.meta.url));assert.equal(createHash('sha256').update(Buffer.from(asset)).digest('hex'),createHash('sha256').update(expected).digest('hex'));
 // Each guide CTA selects the correct personal format, but does not auto-launch native apps.
 for(const [platform,client,label]of [['desktop','clash-verge','前往导入 Clash Verge'],['android','clash-meta','前往导入 Android 配置'],['ios','shadowrocket','导入 Shadowrocket 订阅'],['ios','stash','导入 Stash 配置']]){
  await openGuide();await root.locator('[data-guide-platform='+platform+']').click();await root.getByRole('button',{name:label,exact:true}).click();assert.equal(await page.locator('#page-heading').innerText(),'我的订阅');assert.equal(await page.locator('#client-choice').inputValue(),client);const url=new URL(await page.locator('#subscription').inputValue());assert.equal(url.origin,origin);if(client==='clash-meta'||client==='clash-verge')assert.equal(url.toString(),personal);else assert.equal(url.searchParams.get('format'),client);assert.equal((await fetch(url)).status,200);assert.ok(await page.locator('#import-clash').getAttribute('href'));
 }
 await page.evaluate(()=>window.portalToast.dismiss());await page.waitForFunction(()=>!document.querySelector('[data-sonner-toast]'));
 await openGuide();await root.getByRole('tab',{name:'Android',exact:true}).click();await page.getByLabel('外观模式').selectOption('dark');await page.setViewportSize({width:390,height:844});await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:'test-output/guide/android-mobile-dark.png',fullPage:true});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 await root.getByRole('tab',{name:'iPhone / iPad',exact:true}).click();await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:'test-output/guide/ios-mobile-dark.png',fullPage:true});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 await root.getByRole('button',{name:'查看 AI 状态',exact:true}).click();assert.equal(await page.locator('#page-heading').innerText(),'AI 状态');await openGuide();await root.getByRole('button',{name:'查看节点状态',exact:true}).click();assert.equal(await page.locator('#page-heading').innerText(),'节点状态');
 assert.equal(await(await fetch(personal)).text(),exportBefore,'Reading the guide never changes subscription output');assert.deepEqual(externalRequests,[],'The guide loads only local assets, not third-party trackers or shared services');assert.deepEqual(errors,[]);
 await writeFile('test-output/guide/result.json',JSON.stringify({pass:true,platforms:3,stepsEach:4,widths:[320,390,768,1440,2560,3840],personalImportFormats:4,sourcePdfPublished:false,credentialsChanged:false,externalRequests,errors}));console.log('PASS: revised guide content, three 4-step paths, 320–3840px layouts, keyboard navigation, personal-format imports, privacy and unchanged exports');
}finally{await browser?.close();if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}store.close();await rm(directory,{recursive:true,force:true});}
