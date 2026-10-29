import {createHash} from 'node:crypto';import {isIP} from 'node:net';import {domainToASCII} from 'node:url';import {website} from './activity-summary.mjs';
const KEEP=30*86400000,hash=v=>createHash('sha256').update(v).digest('hex'),bad=()=>{throw Error('Invalid flow observation');},amount=()=>({up:0,down:0});
const MINIMUM_SITE_BYTES=10*1024**2;
export function createFlows(store){
 const db=store.db;db.exec(`CREATE TABLE IF NOT EXISTS flow_reports(agent_id TEXT NOT NULL,epoch TEXT NOT NULL,seq INTEGER NOT NULL,hash TEXT NOT NULL,at INTEGER NOT NULL,PRIMARY KEY(agent_id,epoch,seq));
 CREATE TABLE IF NOT EXISTS flow_events(id INTEGER PRIMARY KEY,agent_id TEXT NOT NULL,user_id TEXT NOT NULL,node_id TEXT NOT NULL,at INTEGER NOT NULL,host TEXT NOT NULL,port INTEGER NOT NULL,network TEXT NOT NULL,source TEXT NOT NULL,up INTEGER NOT NULL,down INTEGER NOT NULL,quality TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS flow_user_time ON flow_events(user_id,at);CREATE INDEX IF NOT EXISTS flow_time ON flow_events(at);
 CREATE TABLE IF NOT EXISTS flow_delivery_faults(agent_id TEXT NOT NULL,epoch TEXT NOT NULL,needed_seq INTEGER NOT NULL,PRIMARY KEY(agent_id,epoch));
 CREATE TABLE IF NOT EXISTS flow_agents(agent_id TEXT PRIMARY KEY,epoch TEXT NOT NULL,scope TEXT NOT NULL,users TEXT NOT NULL,since INTEGER NOT NULL,last_seen INTEGER NOT NULL,backlog INTEGER NOT NULL DEFAULT 0);`);
 if(!db.prepare('PRAGMA table_info(flow_agents)').all().some(c=>c.name==='backlog'))db.exec('ALTER TABLE flow_agents ADD COLUMN backlog INTEGER NOT NULL DEFAULT 0');
 const owner=(agent,email)=>db.prepare('SELECT c.user_id,c.node_id,c.created FROM meter_credentials c JOIN meter_nodes n ON n.id=c.node_id WHERE n.agent_id=? AND c.email=?').get(agent.id,email);
 const identity=body=>{if(!body||body.schema!==1||typeof body.epoch!=='string'||!/^[a-zA-Z0-9:._-]{1,120}$/.test(body.epoch)||!Number.isSafeInteger(body.at)||body.at>Date.now()+300000)bad();};
 const prune=()=>db.prepare("UPDATE flow_events SET host='',source='',port=0,quality='unknown-expired' WHERE at<? AND (host<>'' OR source<>'')").run(Date.now()-KEEP).changes;prune();
 function report(agent,body){
  identity(body);if(!Number.isSafeInteger(body.seq)||body.seq<1||!Array.isArray(body.records)||!body.records.length||body.records.length>1000)bad();
  const seen=new Set(),rows=body.records.map((r,i)=>{
   if(!r||typeof r.id!=='string'||!/^[a-zA-Z0-9:._-]{1,120}$/.test(r.id)||typeof r.email!=='string'||r.email.length>150||!Number.isSafeInteger(r.at)||r.at>body.at+300000||![r.up,r.down].every(v=>Number.isSafeInteger(v)&&v>=0&&v<1e15)||!['actual','unknown-capacity','unknown-expired'].includes(r.quality))bad();
   if(seen.has(r.id))bad();seen.add(r.id);
   const found=owner(agent,r.email);if(!found){if(db.prepare('SELECT 1 FROM meter_retired_identities WHERE agent_id=? AND email=?').get(agent.id,r.email))return null;bad();}if(r.at<found.created-300000)bad();
   let host='',source='',port=0,network='unknown',quality=r.quality;
   if(r.quality==='actual'&&r.at>=Date.now()-KEEP){
    if(typeof r.host!=='string'||r.host.length>253||!r.host||/[\s\x00-\x1f\x7f]/u.test(r.host)||!Number.isInteger(r.port)||r.port<1||r.port>65535||!['tcp','udp'].includes(r.network)||typeof r.source!=='string'||!isIP(r.source))bad();
    // Observed DNS owner names may contain service/cache underscores. These
    // are display metadata, not URLs or outbound requests. Reject raw URL
    // delimiters before URL-based ASCII conversion can silently truncate them.
    if(!isIP(r.host)&&/[\\/?#%@:]/.test(r.host))bad();
    host=isIP(r.host)?r.host:domainToASCII(r.host.toLowerCase().replace(/\.$/,''));if(!host||!isIP(host)&&!host.split('.').every(v=>/^[a-z0-9_](?:[a-z0-9_-]{0,61}[a-z0-9_])?$/.test(v)))bad();source=r.source;port=r.port;network=r.network;
   }else if(r.at<Date.now()-KEEP)quality='unknown-expired';
   return {...found,at:r.at,host,port,network,source,up:r.up,down:r.down,quality,index:i};
  });
  // Private labels may be removed from durable retries at retention expiry.
  const fingerprint=hash(JSON.stringify({epoch:body.epoch,seq:body.seq,at:body.at,records:body.records.map(r=>({id:r.id,email:r.email,at:r.at,up:r.up,down:r.down}))}));
  db.exec('BEGIN IMMEDIATE');try{const old=db.prepare('SELECT hash FROM flow_reports WHERE agent_id=? AND epoch=? AND seq=?').get(agent.id,body.epoch,body.seq);if(old){if(old.hash!==fingerprint)bad();db.exec('COMMIT');return {ok:true,duplicate:true};}
   const previous=db.prepare('SELECT max(seq) seq FROM flow_reports WHERE agent_id=? AND epoch=?').get(agent.id,body.epoch);
   // Flow batches contain deltas, unlike the native cumulative meter. A gap
   // cannot be filled by a later value; do not silently claim full coverage.
   if(body.seq!==(previous.seq??0)+1)throw Object.assign(Error('Missing or out-of-order flow batch sequence'),{deliveryGap:body.seq>(previous.seq??0)+1});
   for(const r of rows)if(r&&(r.up||r.down))db.prepare('INSERT INTO flow_events(agent_id,user_id,node_id,at,host,port,network,source,up,down,quality) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(agent.id,r.user_id,r.node_id,r.at,r.host,r.port,r.network,r.source,r.up,r.down,r.quality);
   db.prepare('INSERT INTO flow_reports VALUES(?,?,?,?,?)').run(agent.id,body.epoch,body.seq,fingerprint,body.at);
   db.prepare('DELETE FROM flow_delivery_faults WHERE agent_id=? AND epoch=? AND needed_seq<=?').run(agent.id,body.epoch,body.seq);db.exec('COMMIT');return {ok:true,duplicate:false};
  }catch(error){
   // The gap guard runs before category writes. Commit only its fault marker
   // under the same write lock, so another receiver cannot fill and clear the
   // gap between rollback and marker insertion. All other errors roll back.
   if(error.deliveryGap){try{db.prepare('INSERT INTO flow_delivery_faults VALUES(?,?,?) ON CONFLICT(agent_id,epoch) DO UPDATE SET needed_seq=max(needed_seq,excluded.needed_seq)').run(agent.id,body.epoch,body.seq);db.prepare('UPDATE flow_agents SET backlog=max(backlog,1) WHERE agent_id=? AND epoch=?').run(agent.id,body.epoch);db.exec('COMMIT');}catch(faultError){db.exec('ROLLBACK');throw faultError;}}
   else db.exec('ROLLBACK');throw error;
  }
 }
 function heartbeat(agent,body){identity(body);if(!['all-managed','selected'].includes(body.scope)||!Array.isArray(body.users)||body.users.length>500||!body.users.every(v=>typeof v==='string'&&v.length<=150&&owner(agent,v))||body.backlog!==undefined&&(!Number.isSafeInteger(body.backlog)||body.backlog<0))bad();
  const users=JSON.stringify([...new Set(body.users)].sort()),old=db.prepare('SELECT * FROM flow_agents WHERE agent_id=?').get(agent.id),since=old&&old.epoch===body.epoch&&old.last_seen>Date.now()-90000&&old.scope===body.scope&&old.users===users?old.since:Math.min(Date.now(),body.at);
  const fault=db.prepare('SELECT 1 FROM flow_delivery_faults WHERE agent_id=? AND epoch=?').get(agent.id,body.epoch);
  db.prepare('INSERT OR REPLACE INTO flow_agents VALUES(?,?,?,?,?,?,?)').run(agent.id,body.epoch,body.scope,users,since,Math.min(Date.now(),body.at),Math.max(body.backlog||0,fault?1:0));return {ok:true};
 }
 function summary(userId,{hours='24',source='',target=''}={}){
  const duration=Number(hours);if(![24,168,720].includes(duration)||typeof source!=='string'||source&&!isIP(source)||typeof target!=='string'||target.length>253||/[\x00-\x1f]/.test(target))throw Object.assign(Error('请选择 1、7 或 30 天，并填写有效的来源 IP 或网站筛选条件'),{statusCode:400});
  const until=Date.now(),from=until-duration*3600000,clauses=source?' AND source=?':'';const values=[userId,from,until,...(source?[source]:[]),...(target?[target]:[])];
  const rows=db.prepare(`SELECT host,sum(up) up,sum(down) down,max(at) lastSeen,count(*) records FROM flow_events WHERE user_id=? AND at>=? AND at<?${clauses}${target?' AND instr(lower(host),lower(?))>0':''} GROUP BY host`).all(...values),total=amount(),unknown=amount(),sites=new Map();
  for(const row of rows){total.up+=row.up;total.down+=row.down;if(!row.host){unknown.up+=row.up;unknown.down+=row.down;continue;}const site=website(row.host);let s=sites.get(site);if(!s)sites.set(site,s={site,actual:amount(),hostCount:0,hosts:[],records:0,lastSeen:0});s.actual.up+=row.up;s.actual.down+=row.down;s.hostCount++;if(s.hosts.length<8)s.hosts.push(row.host);s.records+=row.records;s.lastSeen=Math.max(s.lastSeen,row.lastSeen);}
  const grants=JSON.parse(store.getUser(userId)?.grants||'[]');
  const agents=db.prepare('SELECT n.id,n.proxy_id,n.agent_id,c.email,f.scope,f.users,f.since,f.last_seen,f.backlog FROM meter_credentials c JOIN meter_nodes n ON n.id=c.node_id JOIN meter_allowlist a ON a.node_id=c.node_id AND a.user_id=c.user_id LEFT JOIN flow_agents f ON f.agent_id=n.agent_id WHERE c.user_id=? AND n.enabled=1 AND n.direct_delivery=0').all(userId).filter(a=>grants.includes(a.proxy_id)),covered=agents.filter(a=>a.last_seen>Date.now()-90000&&a.backlog===0&&(a.scope==='all-managed'||JSON.parse(a.users||'[]').includes(a.email)));
  // The threshold only controls the ranked list. Keep small sites distinct from
  // unknown targets, and never change either the observer total or billing.
  const smallSites={count:0,total:amount()},visible=[];
  for(const site of sites.values()){
   if(site.actual.up+site.actual.down>MINIMUM_SITE_BYTES)visible.push(site);
   else{smallSites.count++;smallSites.total.up+=site.actual.up;smallSites.total.down+=site.actual.down;}
  }
  visible.sort((a,b)=>b.actual.up+b.actual.down-a.actual.up-a.actual.down||a.site.localeCompare(b.site));
  return {available:rows.length>0||covered.length>0,total,unknown,sites:visible.slice(0,10),siteCount:sites.size,visibleSiteCount:visible.length,minimumSiteBytes:MINIMUM_SITE_BYTES,smallSites,scope:'actual-flow-bytes',additive:true,from,until,coverage:{nodes:covered.length,totalNodes:agents.length,since:covered.length?Math.max(...covered.map(a=>a.since)):null,allCurrentNodes:agents.length>0&&covered.length===agents.length}};
 }
 return {report,heartbeat,summary,prune};
}
