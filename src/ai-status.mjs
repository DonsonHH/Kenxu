import {XMLParser,XMLValidator} from 'fast-xml-parser';
import {ProxyAgent} from 'undici';
import {createHash} from 'node:crypto';
const INTERVAL=5*60000,DAY=86400000,KEEP=30*DAY,LIMIT=524288;
const PROVIDERS=[
 {id:'openai',name:'OpenAI',scope:'ChatGPT · Codex · API',url:'https://status.openai.com/',feed:'https://status.openai.com/feed.rss',kind:'statuspage'},
 {id:'claude',name:'Claude',scope:'Claude · Claude Code · API',url:'https://status.claude.com/',feed:'https://status.claude.com/history.rss',kind:'statuspage'},
 {id:'gemini',name:'Gemini',scope:'AI Studio · Gemini API',url:'https://aistudio.google.com/status',kind:'google'},
 {id:'grok',name:'Grok',scope:'grok.com · xAI API',url:'https://status.x.ai/',feed:'https://status.x.ai/feed.xml',kind:'rss'},
];
const parser=new XMLParser({ignoreAttributes:true,processEntities:true,htmlEntities:true,isArray:name=>name==='item'});
const text=(value,max=1200)=>typeof value==='string'?value.replace(/<br\s*\/?\s*>|<\/p>|<\/div>/gi,'\n').replace(/<[^>]*>/g,'').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g,'').trim().slice(0,max):'';
const timestamp=value=>{const n=typeof value==='number'?value:Date.parse(value);return Number.isSafeInteger(n)&&n>0?n:null;};
const dayOf=at=>new Date(at+8*3600000).toISOString().slice(0,10);
const validId=id=>typeof id==='string'&&/^[\w:.-]{1,160}$/.test(id);
const phases=new Set(['investigating','identified','monitoring','mitigated','update','resolved','postmortem','scheduled','in_progress','verifying','completed']);
const phase=value=>phases.has(value)?value:'unknown';
const active=status=>!['resolved','postmortem','completed','unknown','scheduled'].includes(status);
const level=value=>({none:'operational',operational:'operational',minor:'degraded',major:'outage',critical:'outage',degraded_performance:'degraded',partial_outage:'degraded',major_outage:'outage',under_maintenance:'maintenance',maintenance:'maintenance'}[value]||'unknown');
const weight=value=>({operational:0,'no-incident':0,unknown:1,maintenance:2,degraded:3,outage:4}[value]??1);
function safeLink(value,provider){try{const u=new URL(value,provider.url);if(u.protocol!=='https:'||u.origin!==new URL(provider.url).origin||u.username||u.password)return null;u.pathname=u.pathname.replace(/\/{2,}/g,'/');u.hash='';return u.href;}catch{return null;}}
function jsonIncidents(rows,provider){
 if(!Array.isArray(rows)||rows.length>500||rows.some(r=>!validId(r?.id)||typeof r.name!=='string'))throw Error('Invalid incident list');
 return rows.map(r=>{
  const updates=(Array.isArray(r.incident_updates)?r.incident_updates:[]).slice(0,5).map(u=>({status:phase(u.status),body:text(u.body),at:timestamp(u.display_at||u.created_at)}));
  const status=phase(r.status),updatedAt=timestamp(r.updated_at)||updates[0]?.at||timestamp(r.created_at);
  if(!updatedAt)throw Error('Invalid official incident timestamp');
  return {id:r.id,title:text(r.name,220),status,startedAt:timestamp(r.started_at||r.created_at),updatedAt,endedAt:timestamp(r.resolved_at)||(['resolved','postmortem','completed'].includes(status)?updatedAt:null),url:new URL('incidents/'+encodeURIComponent(r.id),provider.url).href,updates};
 });
}
function rssIncidents(raw,provider){
 if(/<!\s*(?:DOCTYPE|ENTITY)/i.test(raw)||XMLValidator.validate(raw)!==true)throw Error('Invalid status feed');
 const channel=parser.parse(raw)?.rss?.channel;if(!channel||typeof channel.title!=='string')throw Error('Invalid status feed');
 const rows=channel.item||[];if(!Array.isArray(rows)||rows.length>500)throw Error('Invalid status feed');
 const incidents=rows.map(r=>{
  const url=safeLink(r.link,provider),id=url&&new URL(url).pathname.split('/').filter(Boolean).at(-1),description=typeof r.description==='string'?r.description:'',updatedAt=timestamp(r.pubDate);
  if(!url||!validId(id)||!updatedAt||typeof r.title!=='string')throw Error('Invalid official incident entry');
  const rawPhase=/(?:Status\s*:\s*|<strong>\s*)(Investigating|Identified|Monitoring|Resolved|Postmortem|Scheduled|In Progress|Verifying|Completed)/i.exec(description)?.[1]?.toLowerCase().replace(/ /g,'_');
  const status=phase(rawPhase),ended=/(?:Resolved:\s*)([^<\n]+)/i.exec(description)?.[1],endedAt=timestamp(ended)||(['resolved','postmortem','completed'].includes(status)?updatedAt:null),latest=Math.max(updatedAt,endedAt||0);
  return {id,title:text(r.title,220),status,startedAt:null,updatedAt:latest,endedAt,url,updates:[{status,body:text(description),at:latest}]};
 });
 return incidents;
}
function mergeIncidents(...lists){const result=new Map();for(const r of lists.flat()){const old=result.get(r.id);if(!old)result.set(r.id,r);else{const newer=r.updatedAt>old.updatedAt?r:old;result.set(r.id,{...newer,startedAt:old.startedAt||r.startedAt,endedAt:newer.endedAt});}}return [...result.values()];}

export function createAIStatus(store,{fetcher=fetch,now=Date.now,proxyUrl=process.env.AI_STATUS_PROXY||''}={}){
 let dispatcher;
 if(proxyUrl){const proxy=new URL(proxyUrl);if(proxy.protocol!=='http:'||!['127.0.0.1','[::1]'].includes(proxy.hostname)||proxy.username||proxy.password||proxy.pathname!=='/'||proxy.search||proxy.hash)throw Error('AI status proxy must be an explicit loopback HTTP endpoint');dispatcher=new ProxyAgent(proxyUrl);}
 const db=store.db;let pending=null,timer=null,controller=null,stopped=false;
 db.exec(`CREATE TABLE IF NOT EXISTS ai_status_sources(id TEXT PRIMARY KEY,checked_at INTEGER NOT NULL,last_success INTEGER,payload TEXT,error INTEGER NOT NULL DEFAULT 0);
 CREATE TABLE IF NOT EXISTS ai_status_samples(provider TEXT NOT NULL,at INTEGER NOT NULL,status TEXT NOT NULL,PRIMARY KEY(provider,at));
 CREATE INDEX IF NOT EXISTS ai_status_sample_time ON ai_status_samples(at);
 CREATE TABLE IF NOT EXISTS ai_status_incidents(provider TEXT NOT NULL,id TEXT NOT NULL,updated_at INTEGER NOT NULL,active INTEGER NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(provider,id));`);
 function prune(){db.prepare('DELETE FROM ai_status_samples WHERE at<?').run(now()-KEEP);db.prepare('DELETE FROM ai_status_incidents WHERE updated_at<? AND active=0').run(now()-KEEP);}
 async function request(url,options={}){
  const response=await fetcher(url,{...options,...(dispatcher?{dispatcher}:{}),headers:{Accept:'application/json, application/rss+xml, text/html;q=0.8','User-Agent':'Kenxu-Official-Status/1',...options.headers},redirect:'error',credentials:'omit',signal:AbortSignal.any([controller.signal,AbortSignal.timeout(8000)])});
  if(!response.ok||Number(response.headers.get('content-length')||0)>LIMIT){await response.body?.cancel();throw Error('Status source unavailable');}
  const reader=response.body.getReader(),chunks=[];let size=0;
  try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>LIMIT){await reader.cancel();throw Error('Status source oversized');}chunks.push(Buffer.from(value));}}finally{reader.releaseLock();}
  return Buffer.concat(chunks).toString('utf8');
 }
 async function statuspage(provider){
  const summary=JSON.parse(await request(provider.url+'api/v2/summary.json'));
  if(!summary.status||!Array.isArray(summary.components)||summary.components.length>200||level(summary.status.indicator)==='unknown')throw Error('Invalid official status');
  const current=jsonIncidents(summary.incidents,provider);let history=[],rss=[],historyPartial=false;
  const details=await Promise.allSettled([request(provider.feed),request(provider.url+'api/v2/incidents.json')]);
  try{rss=rssIncidents(details[0].status==='fulfilled'?details[0].value:'',provider);}catch{historyPartial=true;}
  try{history=jsonIncidents(details[1].status==='fulfilled'?JSON.parse(details[1].value).incidents:null,provider);}catch{historyPartial=true;}
  const components=summary.components.filter(c=>typeof c.name==='string').slice(0,60).map(c=>({name:text(c.name,100),status:level(c.status)})),incidents=mergeIncidents(current,history,rss),currentIds=new Set(current.map(i=>i.id)),activeIds=incidents.filter(i=>currentIds.has(i.id)&&active(i.status)).map(i=>i.id);
  const status=[level(summary.status.indicator),...components.map(c=>c.status),...(activeIds.length?['degraded']:[]),...(current.some(i=>i.status==='unknown')?['unknown']:[])].reduce((a,b)=>weight(b)>weight(a)?b:a);
  return {status,components,incidents,activeIds,historyPartial};
 }
 let googleKey=null,keyAt=0;
 async function google(provider){
  // The same anonymous read-only widget used by the public status page. Its
  // page-published client key is not an account/API credential. Never persist
  // it, forward a visitor session, or fall back to an unrelated Gemini scope.
  if(!googleKey||now()-keyAt>6*3600000){const html=await request(provider.url);googleKey=/"WIu0Nc"\s*:\s*"(AIza[A-Za-z0-9_-]{20,100})"/.exec(html)?.[1];keyAt=now();if(!googleKey)throw Error('Official status widget changed');}
  let input;try{input=JSON.parse(await request('https://alkalimakersuite-pa.clients6.google.com/$rpc/google.internal.alkali.applications.makersuite.v1.MakerSuiteService/ListIncidentsHistory',{method:'POST',headers:{'Content-Type':'application/json+protobuf','X-Goog-Api-Key':googleKey,Referer:provider.url,Origin:'https://aistudio.google.com'},body:'[]'}));}catch(error){googleKey=null;throw error;}
  const rows=input?.[0]?.[0];if(!Array.isArray(rows)||rows.length>500)throw Error('Official status widget changed');
  const incidents=rows.map(row=>{
   if(!Array.isArray(row)||typeof row[0]!=='string'||!row[0]||row[0].length>512||typeof row[1]!=='string'||!Array.isArray(row[3])||!row[3].length||row[3].length>200||!Array.isArray(row[5])||row[5].some(c=>![1,2,3].includes(c)))throw Error('Official status widget changed');
   const updates=row[3].map(u=>{const at=timestamp(Number(u?.[2]?.[0])*1000);if(![1,2,3,4,5].includes(u?.[0])||!at||typeof u[3]!=='string')throw Error('Official status widget changed');return {status:({1:'investigating',2:'identified',3:'mitigated',4:'resolved',5:'update'})[u[0]],at,body:text(u[3])};}).sort((a,b)=>b.at-a.at);
   return {id:'google:'+createHash('sha256').update(row[0]).digest('hex').slice(0,32),title:text(row[1],220),status:updates[0].status,startedAt:updates.at(-1).at,updatedAt:updates[0].at,endedAt:updates[0].status==='resolved'?updates[0].at:null,url:provider.url,components:row[5],updates:updates.slice(0,5)};
  });
  const ongoing=incidents.filter(i=>active(i.status));
  return {status:ongoing.length?'degraded':'no-incident',components:['Gemini API','Multimodal Live API','Google AI Studio'].map((name,i)=>({name,status:ongoing.some(e=>e.components.includes(i+1))?'degraded':'no-incident'})),incidents,activeIds:ongoing.map(i=>i.id),historyPartial:false};
 }
 async function read(provider){
  if(provider.kind==='statuspage')return statuspage(provider);
  if(provider.kind==='google')return google(provider);
  const incidents=rssIncidents(await request(provider.feed),provider),ongoing=incidents.filter(i=>active(i.status));
  return {status:incidents.some(i=>i.status==='unknown')?'unknown':ongoing.length?'degraded':'no-incident',components:[],incidents,activeIds:ongoing.map(i=>i.id),historyPartial:true};
 }
 function history(provider,incidents,available){
  const local=new Date(now()+8*3600000),start=Date.UTC(local.getUTCFullYear(),local.getUTCMonth(),local.getUTCDate())-8*3600000-29*DAY;
  const samples=db.prepare('SELECT at,status FROM ai_status_samples WHERE provider=? AND at>=? ORDER BY at').all(provider.id,start);
  return Array.from({length:30},(_,i)=>{const from=start+i*DAY,date=dayOf(from),observed=samples.filter(s=>s.at>=from&&s.at<from+DAY),reported=incidents.filter(e=>(e.startedAt||e.updatedAt)<from+DAY&&(e.endedAt||(e.active&&available?now():e.updatedAt))>=from);let status='unknown';
   if(observed.length)status=observed.reduce((s,r)=>weight(r.status)>weight(s)?r.status:s,observed[0].status);
   if(reported.length){const incidentStatus=reported.every(e=>e.status==='scheduled')?'maintenance':'degraded';if(weight(incidentStatus)>weight(status))status=incidentStatus;}
   return {date,status,samples:observed.length,missing:observed.filter(s=>s.status==='unknown').length,incidents:reported.length};
  });
 }
 function snapshot(){
  return {checkedAt:now(),pollIntervalSeconds:INTERVAL/1000,historyDays:30,timezone:'Asia/Shanghai',providers:PROVIDERS.map(provider=>{
   const row=db.prepare('SELECT * FROM ai_status_sources WHERE id=?').get(provider.id),saved=row?.payload?JSON.parse(row.payload):null,available=!!saved&&!row.error&&now()-row.last_success<3*INTERVAL;
   const incidents=db.prepare('SELECT payload,active FROM ai_status_incidents WHERE provider=? AND (updated_at>=? OR active=1) ORDER BY updated_at DESC LIMIT 200').all(provider.id,now()-KEEP).map(r=>({...JSON.parse(r.payload),active:!!r.active}));
   return {id:provider.id,name:provider.name,scope:provider.scope,sourceUrl:provider.url,feedUrl:provider.feed||null,status:available?saved.status:'unknown',lastKnownStatus:saved?.status||null,available,stale:!!saved&&!available,checkedAt:row?.checked_at||null,lastSuccessAt:row?.last_success||null,components:saved?.components||[],historyPartial:saved?.historyPartial??true,incidents,history:history(provider,incidents,available)};
  })};
 }
 async function refresh(scheduled=false){
  if(pending)return pending;if(stopped)return snapshot();
  controller=new AbortController();
  const task=(async()=>{await Promise.all(PROVIDERS.map(async provider=>{
   const previous=db.prepare('SELECT * FROM ai_status_sources WHERE id=?').get(provider.id);if(!scheduled&&previous&&now()-previous.checked_at<INTERVAL)return;
   try{
    const data=await read(provider);if(stopped)return;const at=now();
    db.exec('BEGIN IMMEDIATE');try{
     db.prepare('UPDATE ai_status_incidents SET active=0 WHERE provider=?').run(provider.id);
     for(const incident of data.incidents)if(incident.updatedAt>=at-KEEP||data.activeIds.includes(incident.id)){
      const existing=db.prepare('SELECT updated_at,payload FROM ai_status_incidents WHERE provider=? AND id=?').get(provider.id,incident.id),payload=existing&&existing.updated_at>incident.updatedAt?JSON.parse(existing.payload):incident;
      db.prepare('INSERT INTO ai_status_incidents VALUES(?,?,?,?,?) ON CONFLICT(provider,id) DO UPDATE SET updated_at=excluded.updated_at,active=excluded.active,payload=excluded.payload').run(provider.id,incident.id,payload.updatedAt,data.activeIds.includes(incident.id)?1:0,JSON.stringify(payload));
     }
     db.prepare('INSERT OR REPLACE INTO ai_status_sources VALUES(?,?,?,?,0)').run(provider.id,at,at,JSON.stringify({status:data.status,components:data.components,historyPartial:data.historyPartial}));
     db.prepare('INSERT OR REPLACE INTO ai_status_samples VALUES(?,?,?)').run(provider.id,Math.floor(at/INTERVAL)*INTERVAL,data.status);db.exec('COMMIT');
    }catch(error){db.exec('ROLLBACK');throw error;}
   }catch{if(stopped)return;const at=now();db.prepare('INSERT INTO ai_status_sources VALUES(?,?,NULL,NULL,1) ON CONFLICT(id) DO UPDATE SET checked_at=excluded.checked_at,error=1').run(provider.id,at);db.prepare('INSERT OR REPLACE INTO ai_status_samples VALUES(?,?,?)').run(provider.id,Math.floor(at/INTERVAL)*INTERVAL,'unknown');}
  }));if(!stopped)prune();return snapshot();})();pending=task;
  try{return await task;}finally{if(pending===task)pending=null;}
 }
 // A timer turn is already rate-limited by the fixed schedule. Completion-time
 // cache TTLs must not skip it after a slow previous request. Readers and CLI
 // refreshes remain cached; the scheduled bypass is not part of the interface.
 const run=()=>{void refresh(true).catch(()=>console.warn('Official AI status refresh unavailable'));};
 return {snapshot,refresh:()=>refresh(),start(){if(timer)return;stopped=false;run();timer=setInterval(run,INTERVAL);timer.unref();},async stop(){stopped=true;clearInterval(timer);timer=null;controller?.abort();if(pending)await pending;await dispatcher?.close();}};
}
