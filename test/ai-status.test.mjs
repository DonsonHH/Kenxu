import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {openStore} from '../src/store.mjs';
import {createAIStatus} from '../src/ai-status.mjs';
import {createApp} from '../src/app.mjs';
import http from 'node:http';

const rss=items=>'<?xml version="1.0"?><rss version="2.0"><channel><title>Official status</title>'+items.map(i=>'<item><title>'+i.title+'</title><link>'+i.url+'</link><guid>'+i.url+'</guid><pubDate>'+i.at+'</pubDate><description><![CDATA['+i.body+']]></description></item>').join('')+'</channel></rss>';
const response=value=>new Response(typeof value==='string'?value:JSON.stringify(value));
const DAY=86400000;
test('official current status and RSS history stay distinct, cached and durable; a failed source is unknown rather than a provider outage',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'ai-status-'));let store=openStore(dir),clock=Date.UTC(2026,9,16,4),requests=0;
 try{
  const fetcher=async url=>{requests++;if(url==='https://status.openai.com/api/v2/summary.json')return response({status:{indicator:'minor'},components:[{id:'api',name:'Responses',status:'degraded_performance'}],incidents:[{id:'current',name:'API errors',status:'investigating',created_at:new Date(clock-3600000).toISOString(),updated_at:new Date(clock).toISOString(),incident_updates:[{status:'investigating',body:'Investigating',created_at:new Date(clock).toISOString()}]}]});
   if(url==='https://status.openai.com/feed.rss')return response(rss([{title:'Recovered issue',url:'https://status.openai.com/incidents/old',at:new Date(clock-86400000).toUTCString(),body:'<b>Status: Resolved</b><br/>Recovered safely.'}]));
   if(url==='https://status.openai.com/api/v2/incidents.json')return response({incidents:[]});return new Response('',{status:503});};
  let monitor=createAIStatus(store,{fetcher,now:()=>clock});assert.ok(monitor.snapshot().providers.every(p=>p.status==='unknown'));
  const result=await monitor.refresh(),openai=result.providers.find(p=>p.id==='openai');assert.equal(openai.status,'degraded');assert.equal(openai.available,true);assert.equal(openai.components[0].status,'degraded');assert.equal(openai.incidents.find(i=>i.id==='old').status,'resolved');assert.equal(openai.incidents.find(i=>i.id==='current').status,'investigating');assert.ok(result.providers.filter(p=>p.id!=='openai').every(p=>p.status==='unknown'&&!p.available));
  const count=requests;await monitor.refresh();assert.equal(requests,count,'Refreshing the cached view does not fan out provider requests');
  store.close();store=openStore(dir);monitor=createAIStatus(store,{fetcher,now:()=>clock});assert.equal(monitor.snapshot().providers.find(p=>p.id==='openai').incidents.length,2);
  clock+=16*60000;const expired=monitor.snapshot().providers.find(p=>p.id==='openai');assert.equal(expired.status,'unknown');assert.equal(expired.lastKnownStatus,'degraded');assert.equal(expired.stale,true);assert.equal(expired.incidents.length,2);
 }finally{store.close();await rm(dir,{recursive:true,force:true});}
});
test('a new unrecognized current incident phase is unknown, never silently green',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'ai-status-new-phase-')),store=openStore(dir),clock=Date.UTC(2026,9,16,4);let id='unrecognized';
 try{
  const fetcher=async url=>url==='https://status.openai.com/api/v2/summary.json'?response({status:{indicator:'none'},components:[{name:'API',status:'operational'}],incidents:[{id,name:'New vendor phase',status:'future_vendor_phase',created_at:new Date(clock-60000).toISOString(),updated_at:new Date(clock).toISOString()}]}):url.endsWith('/incidents.json')?response({incidents:[]}):url==='https://status.openai.com/feed.rss'?response(rss([])):new Response('',{status:503});
  const p=(await createAIStatus(store,{fetcher,now:()=>clock}).refresh()).providers[0];assert.equal(p.status,'unknown');assert.equal(p.incidents[0].status,'unknown');
  id='';const malformed=(await createAIStatus(store,{fetcher,now:()=>clock+300001}).refresh()).providers[0];assert.equal(malformed.status,'unknown');assert.equal(malformed.available,false,'Malformed current events cannot be dropped to manufacture a healthy status');
 }finally{store.close();await rm(dir,{recursive:true,force:true});}
});
test('a missing current incident timestamp or current list cannot silently discard an active official event',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'ai-status-incomplete-current-')),store=openStore(dir),clock=Date.UTC(2026,9,16,4);let includeList=true;
 try{
  const fetcher=async url=>url==='https://status.openai.com/api/v2/summary.json'?response({status:{indicator:'none'},components:[{name:'API',status:'operational'}],...(includeList?{incidents:[{id:'without-time',name:'Current disruption',status:'investigating'}]}:{})}):url.endsWith('/incidents.json')?response({incidents:[]}):url==='https://status.openai.com/feed.rss'?response(rss([])):new Response('',{status:503});
  let p=(await createAIStatus(store,{fetcher,now:()=>clock}).refresh()).providers[0];assert.equal(p.status,'unknown');assert.equal(p.available,false);
  includeList=false;p=(await createAIStatus(store,{fetcher,now:()=>clock+300001}).refresh()).providers[0];assert.equal(p.status,'unknown');assert.equal(p.available,false);
 }finally{store.close();await rm(dir,{recursive:true,force:true});}
});
test('an invalid or off-site RSS feed cannot manufacture a healthy Grok status or lose the last good incident',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'ai-status-untrusted-')),store=openStore(dir);let clock=Date.UTC(2026,9,16,4),evil=false;
 try{
  const fetcher=async url=>url==='https://status.x.ai/feed.xml'?response(rss([{title:'Incident',url:evil?'https://attacker.example/collect':'https://status.x.ai/grok-com/known',at:new Date(clock).toUTCString(),body:'<h3>Status: INVESTIGATING</h3><script>not executable</script>'}])):new Response('',{status:503});
  const monitor=createAIStatus(store,{fetcher,now:()=>clock});let p=(await monitor.refresh()).providers.find(p=>p.id==='grok');assert.equal(p.status,'degraded');assert.ok(!p.incidents[0].updates[0].body.includes('<script>'));
  evil=true;clock+=300001;p=(await monitor.refresh()).providers.find(p=>p.id==='grok');assert.equal(p.status,'unknown');assert.equal(p.stale,true);assert.equal(p.incidents.length,1);assert.ok(!JSON.stringify(p).includes('attacker.example'));
  const dtd=createAIStatus(store,{now:()=>clock+300001,fetcher:async()=>response('<!DOCTYPE rss [<!ENTITY x SYSTEM "file:///etc/passwd">]><rss><channel><title>&x;</title></channel></rss>')});assert.ok((await dtd.refresh()).providers.every(p=>p.status==='unknown'));
  assert.throws(()=>createAIStatus(store,{proxyUrl:'http://attacker.example:8080'}),/loopback/);
 }finally{store.close();await rm(dir,{recursive:true,force:true});}
});
test('a partially malformed RSS feed is unknown even when it also contains a valid recovered event',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'ai-status-mixed-feed-')),store=openStore(dir),clock=Date.UTC(2026,9,16,4);
 try{
  const fetcher=async url=>url==='https://status.x.ai/feed.xml'?response(rss([
   {title:'Recovered event',url:'https://status.x.ai/grok-com/recovered',at:new Date(clock-3600000).toUTCString(),body:'<h3>Status: RESOLVED</h3>'},
   {title:'Current disruption with broken link',url:'https://other.example/grok-com/current',at:new Date(clock).toUTCString(),body:'<h3>Status: INVESTIGATING</h3>'},
  ])):new Response('',{status:503});
  const p=(await createAIStatus(store,{fetcher,now:()=>clock}).refresh()).providers.find(p=>p.id==='grok');assert.equal(p.status,'unknown');assert.equal(p.available,false);
 }finally{store.close();await rm(dir,{recursive:true,force:true});}
});
test('scheduled collection continues without any visitor and stops cleanly on shutdown',async t=>{
 t.mock.timers.enable({apis:['setInterval']});const dir=await mkdtemp(path.join(tmpdir(),'ai-status-schedule-')),store=openStore(dir),started=Date.UTC(2026,9,16,4);let clock=started,calls=0;
 const monitor=createAIStatus(store,{now:()=>clock,fetcher:async()=>{calls++;clock+=1000;return new Response('',{status:503});}});
 try{monitor.start();await monitor.refresh();assert.equal(calls,4);clock=started+300000;t.mock.timers.tick(300000);await monitor.refresh();assert.equal(calls,8,'Network completion time must not make the next scheduled cycle skip its five-minute turn');await monitor.stop();clock+=300000;t.mock.timers.tick(300000);assert.equal(calls,8);}
 finally{await monitor.stop();store.close();await rm(dir,{recursive:true,force:true});}
});
test('ongoing official events span through today; observed outages are not diluted by a historical event marker',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'ai-status-history-')),store=openStore(dir);let clock=Date.UTC(2026,9,16,4),indicator='none';
 try{
  const fetcher=async url=>{if(url==='https://status.openai.com/api/v2/summary.json')return response({status:{indicator},components:[{name:'API',status:'degraded_performance'}],incidents:[{id:'long-event',name:'Ongoing issue',status:'identified',created_at:new Date(clock-2*DAY).toISOString(),updated_at:new Date(clock-DAY).toISOString()}]});if(url==='https://status.openai.com/feed.rss')return response(rss([]));if(url.endsWith('incidents.json'))return response({incidents:[]});return new Response('',{status:503});};
  const monitor=createAIStatus(store,{fetcher,now:()=>clock});let p=(await monitor.refresh()).providers[0];assert.equal(p.status,'degraded');assert.equal(p.history.at(-1).incidents,1);assert.equal(p.history.at(-2).incidents,1);
  indicator='major';clock+=300001;p=(await monitor.refresh()).providers[0];assert.equal(p.history.at(-1).status,'outage');assert.equal(p.history[0].status,'unknown');
 }finally{store.close();await rm(dir,{recursive:true,force:true});}
});
test('AI status is a protected cached read; caller URLs never trigger external requests and first-login/admin gates stay intact',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'ai-status-http-')),store=openStore(dir);let server,calls=0;
 try{
  store.importSource('proxies: [{name: Fixture, type: vless, server: example.test, port: 443}]');const user=await store.createUser('friend','fixture-ai-status-password',[]);await store.setPassword(user,'fixture-ai-status-password');
  store.aiStatus=createAIStatus(store,{fetcher:async()=>{calls++;throw Error('No network from a read');}});
  let app;server=http.createServer((req,res)=>app(req,res));await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;app=createApp({store,origin});
  assert.equal((await fetch(origin+'/api/ai-status')).status,401);const session=store.session(user),headers={Cookie:'donson_local='+session.token};
  const r=await fetch(origin+'/api/ai-status?url=http://127.0.0.1/private&force=1',{headers});assert.equal(r.status,200);assert.equal((await r.json()).providers.length,4);assert.equal(calls,0);assert.match(r.headers.get('cache-control'),/no-store/);
  store.requirePasswordChange(user);assert.equal((await fetch(origin+'/api/ai-status',{headers})).status,403);
 }finally{if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}store.close();await rm(dir,{recursive:true,force:true});}
});
test('Google historical display IDs and its official Update phase do not break current Gemini monitoring',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'ai-status-google-history-')),store=openStore(dir),clock=Date.UTC(2026,9,16,4);
 try{
  const fetcher=async url=>url==='https://aistudio.google.com/status'?response('<script>{"WIu0Nc":"AIza-fixture-public-page-client-key"}</script>'):url.endsWith('MakerSuiteService/ListIncidentsHistory')?response([[[['Old status / human readable ID','Google incident',1,[[1,'',[(clock/1000-600).toString()],'Detected'],[3,'',[(clock/1000-120).toString()],'Mitigated'],[5,'',[(clock/1000-60).toString()],'Mitigations are underway']],1,[1]]]]]):new Response('',{status:503});
  const result=await createAIStatus(store,{fetcher,now:()=>clock}).refresh(),gemini=result.providers.find(p=>p.id==='gemini');assert.equal(gemini.available,true);assert.equal(gemini.status,'degraded');assert.equal(gemini.incidents[0].status,'update');assert.ok(gemini.incidents[0].active);assert.match(gemini.incidents[0].id,/^google:[a-f0-9]{32}$/);
 }finally{store.close();await rm(dir,{recursive:true,force:true});}
});
test('Gemini uses only the anonymous AI Studio incident source; Grok uses official RSS without guessing a global uptime',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'ai-status-adapters-')),store=openStore(dir),clock=Date.UTC(2026,9,16,4),calls=[];
 try{
  const fetcher=async(url,options)=>{calls.push({url,options});
   if(url==='https://aistudio.google.com/status')return response('<html><script>var WIZ_global_data={"WIu0Nc":"AIza-fixture-public-page-client-key"};</script></html>');
   if(url.endsWith('MakerSuiteService/ListIncidentsHistory')){assert.equal(options.headers.Authorization,undefined);assert.equal(options.credentials,'omit');assert.equal(options.body,'[]');assert.equal(options.headers['X-Goog-Api-Key'],'AIza-fixture-public-page-client-key');return response([[[['studio-issue','AI Studio API errors',1,[[1,'',[(clock/1000-600).toString()],'Investigation underway']],1,[1,3]]]]]);}
   if(url==='https://status.x.ai/feed.xml')return response(rss([{title:'[grok.com] Recovered',url:'https://status.x.ai/grok-com/fixture',at:new Date(clock-2*DAY).toUTCString(),body:'<h3>Status: RESOLVED</h3><p>Issue resolved.</p>'}]));
   return new Response('',{status:503});
  };
  const monitor=createAIStatus(store,{fetcher,now:()=>clock}),data=await monitor.refresh(),google=data.providers.find(p=>p.id==='gemini'),grok=data.providers.find(p=>p.id==='grok');
  assert.equal(google.status,'degraded');assert.equal(google.scope,'AI Studio · Gemini API');assert.deepEqual(google.components.map(c=>c.name),['Gemini API','Multimodal Live API','Google AI Studio']);assert.equal(google.incidents[0].active,true);
  assert.equal(grok.status,'no-incident');assert.equal(grok.incidents[0].status,'resolved');assert.ok(grok.history.slice(0,20).every(d=>d.status==='unknown'),'Never invent healthy historical days before local monitoring');assert.ok(!JSON.stringify(data).includes('AIza'));
  assert.ok(calls.every(c=>!c.url.includes('workspace')&&!c.url.includes('status.cloud.google.com')));
 }finally{store.close();await rm(dir,{recursive:true,force:true});}
});
