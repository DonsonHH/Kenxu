import {chromium,firefox} from 'playwright';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import {openStore} from '../src/store.mjs';
import {createApp} from '../src/app.mjs';

const engine=process.env.KENXU_LAYOUT_ENGINE||'edge';assert.ok(['edge','firefox'].includes(engine));
const dir=await mkdtemp(path.join(tmpdir(),'kenxu-login-layout-')),out=path.resolve('../.agents/kenxu-login-layout-20261023',engine),store=openStore(dir),servers=[],measurements=[],errors=[];
let browser;
try{
 await mkdir(out,{recursive:true});await writeFile(path.join(out,'results.json'),JSON.stringify({passed:false,status:'running',at:new Date().toISOString()}));
 const origins={};for(const role of ['user','admin']){let app;const server=http.createServer((req,res)=>app(req,res));await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));origins[role]='http://127.0.0.1:'+server.address().port;app=createApp({store,origin:origins[role],admin:role==='admin'});servers.push(server);}
 browser=await(engine==='edge'?chromium:firefox).launch({headless:true,...(engine==='edge'?{channel:process.env.PLAYWRIGHT_CHANNEL||'msedge'}:{executablePath:process.env.PLAYWRIGHT_FIREFOX_EXECUTABLE})});
 for(const role of ['user','admin']){
  const page=await browser.newPage({viewport:{width:1912,height:924},reducedMotion:'reduce'});page.setDefaultTimeout(6500);page.on('pageerror',e=>errors.push(e.message));await page.goto(origins[role]);await page.waitForFunction(()=>!document.body.classList.contains('booting'));
  for(const [width,height]of [[1912,924],[1440,900],[1366,768],[1024,768],[2560,1440],[390,844],[320,700]])for(const theme of ['light','dark']){
   await page.setViewportSize({width,height});await page.getByLabel('外观模式').selectOption(theme);await page.evaluate(()=>scrollTo({top:0,behavior:'instant'}));
   const geometry=await page.evaluate(()=>{const input=document.querySelector('#login-form [name=password]'),field=input.closest('.password-field'),label=field.querySelector('label'),frame=field.querySelector('.password-input'),toggle=field.querySelector('button'),account=document.querySelector('#login-form [name=username]');const r=e=>e.getBoundingClientRect();return {gap:r(frame).top-r(label).bottom,labelMargin:getComputedStyle(label).marginBlockStart,passwordWidth:r(frame).width,accountWidth:r(account).width,toggleCenter:r(toggle).top+r(toggle).height/2,inputCenter:r(frame).top+r(frame).height/2,footerBottom:r(document.querySelector('footer')).bottom,documentHeight:document.documentElement.scrollHeight,viewport:innerHeight,overflow:document.documentElement.scrollWidth>innerWidth,offenders:[...document.querySelectorAll('.topbar *')].filter(el=>el.getBoundingClientRect().right>innerWidth).map(el=>({tag:el.tagName,id:el.id,className:el.className})).slice(0,6),cardHeight:r(document.querySelector('.login-card')).height};});
   measurements.push({role,width,height,theme,...geometry});
   if(width===1912&&theme==='dark')await page.screenshot({path:path.join(out,role+'-1912-dark.png')});
   assert.ok(geometry.gap>=6&&geometry.gap<=12,'Password label/input gap must match the 8px account rhythm: '+JSON.stringify(measurements.at(-1)));
   assert.equal(geometry.labelMargin,'0px','A standalone password label must not inherit spacing for a label containing its input');
   assert.ok(Math.abs(geometry.passwordWidth-geometry.accountWidth)<=1,'Account/password controls must align');assert.ok(Math.abs(geometry.toggleCenter-geometry.inputCenter)<=1,'Visibility toggle must stay vertically centered');assert.equal(geometry.overflow,false);
   if(width>=1024)assert.ok(geometry.footerBottom<=height+1,'Desktop footer must not be pushed below the viewport: '+JSON.stringify(measurements.at(-1)));
   if(width===390&&theme==='dark'){await page.locator('#login-form').scrollIntoViewIfNeeded();await page.screenshot({path:path.join(out,role+'-mobile-dark.png')});}
  }
  const password=page.locator('#login-form [name=password]'),toggle=page.locator('#login-form [data-password-toggle]');await password.fill('fictional-layout-check');await toggle.click();assert.equal(await password.getAttribute('type'),'text');assert.equal(await password.inputValue(),'fictional-layout-check');await toggle.click();assert.equal(await password.getAttribute('type'),'password');await password.fill('');await page.close();
 }
 assert.deepEqual(errors,[]);await writeFile(path.join(out,'results.json'),JSON.stringify({passed:true,measurements,errors,browser:browser.version(),at:new Date().toISOString()},null,2));console.log(JSON.stringify({passed:true,realmThemeViewportCases:measurements.length,passwordGapRange:[Math.min(...measurements.map(r=>r.gap)),Math.max(...measurements.map(r=>r.gap))],desktopFootersFit:true,visibilityTogglePreserved:true}));
}catch(error){await writeFile(path.join(out,'results.json'),JSON.stringify({passed:false,measurements,error:error.message,at:new Date().toISOString()},null,2));throw error;}
finally{await browser?.close();for(const server of servers){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}await store.aiStatus.stop();store.close();assert.equal(path.dirname(path.resolve(dir)),path.resolve(tmpdir()));assert.ok(path.basename(dir).startsWith('kenxu-login-layout-'));await rm(dir,{recursive:true,force:true});}
