import {isIP} from 'node:net';
import {domainToASCII} from 'node:url';
import {readFileSync} from 'node:fs';
import {Reader} from 'maxmind';
import {groupActivity} from './activity-summary.mjs';
import {isPublicIp} from './ip-location.mjs';
const RETENTION=30*86400000;
const invalid=message=>Object.assign(Error(message),{statusCode:400});
export function validateActivity(records,at){
 if(records===undefined)return [];
 if(!Array.isArray(records)||records.length>200)throw Error('Invalid activity batch');
 const emails=new Set();
 return records.map(row=>{
  if(!row||typeof row.email!=='string'||row.email.length>150||emails.has(row.email)||!Array.isArray(row.sources)||row.sources.length>16||!Array.isArray(row.targets)||row.targets.length>40||!Number.isSafeInteger(row.connections)||row.connections<0||row.connections>100000)throw Error('Invalid activity row');
  emails.add(row.email);
  const sources=[...new Set(row.sources.map(ip=>{if(typeof ip!=='string'||!isIP(ip))throw Error('Invalid source IP');return ip.startsWith('::ffff:')&&isIP(ip.slice(7))===4?ip.slice(7):ip;}))];
  const targets=row.targets.map(target=>{
   if(!target||typeof target.host!=='string'||target.host.length>253||!Number.isInteger(target.port)||target.port<1||target.port>65535||!['tcp','udp'].includes(target.network))throw Error('Invalid destination');
   const host=isIP(target.host)?target.host:domainToASCII(target.host.toLowerCase().replace(/\.$/,''));
   if(!host||!isIP(host)&&!host.split('.').every(label=>/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)))throw Error('Invalid destination host');
   return {host,port:target.port,network:target.network};
  });
  return {email:row.email,sources,targets,connections:row.connections,at};
 });
}
export function createActivity(store,{geoLookup}={}){
 const db=store.db;let geo;
 if(!geoLookup&&process.env.GEOIP_DB)try{geo=new Reader(readFileSync(process.env.GEOIP_DB));}catch{console.warn('GeoIP database unavailable; locations will be unknown');}
 const lookup=geoLookup||((ip)=>{const value=geo?.get(ip);return value?{country:value.country?.names?.['zh-CN']||value.country?.names?.en||value.country?.iso_code||value.registered_country?.names?.en||'未知',region:value.subdivisions?.[0]?.names?.['zh-CN']||value.subdivisions?.[0]?.names?.en||''}:{country:'未知',region:''};});
 db.exec('CREATE TABLE IF NOT EXISTS activity_samples(node_id TEXT NOT NULL,user_id TEXT NOT NULL,at INTEGER NOT NULL,bucket INTEGER NOT NULL,sources TEXT NOT NULL,targets TEXT NOT NULL,connections INTEGER NOT NULL,PRIMARY KEY(node_id,user_id,at)); CREATE INDEX IF NOT EXISTS activity_user_bucket ON activity_samples(user_id,bucket DESC,node_id); CREATE INDEX IF NOT EXISTS activity_user_time ON activity_samples(user_id,at DESC); CREATE INDEX IF NOT EXISTS activity_time ON activity_samples(at);');
 const prune=()=>db.prepare('DELETE FROM activity_samples WHERE at<?').run(Date.now()-RETENTION).changes;
 prune();
 function record(node,records,at,deltas){
  if(at<Date.now()-RETENTION)return;
  for(const row of records){
   const owner=db.prepare('SELECT c.user_id,c.node_id FROM meter_credentials c JOIN meter_nodes n ON n.id=c.node_id WHERE n.agent_id=? AND c.email=?').get(node.id,row.email);
   if(!owner){if(db.prepare('SELECT 1 FROM meter_retired_identities WHERE agent_id=? AND email=?').get(node.id,row.email))continue;throw Error('Activity identity does not belong to this collector');}
   const delta=deltas.get(row.email);
   // Empty idle samples do not manufacture recent use or inflate log volume.
   if(!row.connections&&!(delta?.up||delta?.down))continue;
   db.prepare('INSERT OR REPLACE INTO activity_samples VALUES(?,?,?,?,?,?,?)').run(owner.node_id,owner.user_id,at,Math.floor(at/60000)*60000,JSON.stringify(row.sources),JSON.stringify(row.targets),row.connections);
  }
 }
 function latest(userId){
  const row=db.prepare("SELECT at,sources FROM activity_samples WHERE user_id=? AND at>=? AND sources<>'[]' ORDER BY at DESC,node_id LIMIT 1").get(userId,Date.now()-RETENTION);
  return row?{ip:JSON.parse(row.sources)[0],at:row.at}:null;
 }
 function page(userId,{hours='24',cursor,source='',target=''}={}){
  if(!store.getUser(userId)||store.getUser(userId).role!=='user')throw invalid('用户不存在');
  const duration=Number(hours);if(![24,168,720].includes(duration))throw invalid('请选择 1、7 或 30 天');
  if(typeof source!=='string'||source&&!isIP(source)||typeof target!=='string'||target.length>253||/[\x00-\x1f]/.test(target))throw invalid('日志筛选条件无效');
  const cutoff=Date.now()-RETENTION;
  let beforeBucket=Date.now()+1,beforeNode='',until=Date.now(),from=Math.max(cutoff,until-duration*3600000);
  if(cursor){try{const c=JSON.parse(Buffer.from(cursor,'base64url'));if(!Array.isArray(c)||c.length!==5||!c.slice(0,3).every(Number.isSafeInteger)||typeof c[3]!=='string'||c[3].length>50||c[4]!==duration)throw Error();[from,until,beforeBucket,beforeNode]=c;if(from<Date.now()-RETENTION-60000||until>Date.now()+60000||from>=until)throw Error();}catch{throw invalid('日志分页标记无效');}}
  from=Math.max(from,cutoff);
  const query=`SELECT CAST(e.at/60000 AS INTEGER)*60000 bucket,e.node_id,n.name,sum(e.up) up,sum(e.down) down FROM usage_events e JOIN meter_nodes n ON n.id=e.node_id WHERE e.user_id=? AND e.at>=? AND e.at<?
   ${source?"AND EXISTS(SELECT 1 FROM activity_samples a,json_each(a.sources) ip WHERE a.user_id=e.user_id AND a.node_id=e.node_id AND a.bucket=CAST(e.at/60000 AS INTEGER)*60000 AND a.at>=? AND ip.value=?)":''}
   ${target?"AND EXISTS(SELECT 1 FROM activity_samples a,json_each(a.targets) t WHERE a.user_id=e.user_id AND a.node_id=e.node_id AND a.bucket=CAST(e.at/60000 AS INTEGER)*60000 AND a.at>=? AND instr(lower(json_extract(t.value,'$.host')),lower(?))>0)":''}
   GROUP BY bucket,e.node_id HAVING bucket<? OR (bucket=? AND e.node_id>?) ORDER BY bucket DESC,e.node_id LIMIT 31`;
  const rows=db.prepare(query).all(userId,from,until,...(source?[cutoff,source]:[]),...(target?[cutoff,target]:[]),beforeBucket,beforeBucket,beforeNode),items=rows.slice(0,30).map(row=>{
   const observations=db.prepare('SELECT sources,targets,connections FROM activity_samples WHERE user_id=? AND node_id=? AND bucket=? AND at>=?').all(userId,row.node_id,row.bucket,cutoff),ips=new Set(),targets=new Map();let connections=0;
   for(const observation of observations){for(const ip of JSON.parse(observation.sources))ips.add(ip);for(const t of JSON.parse(observation.targets))targets.set(t.network+'|'+t.host+'|'+t.port,t);connections+=observation.connections;}
   return {at:row.bucket,node:row.name,up:row.up,down:row.down,sources:[...ips].map(ip=>({ip,...lookup(ip)})),targets:[...targets.values()],connections,scope:'sample-window',observed:observations.length>0};
  }),last=rows[29];
  return {items,hasMore:rows.length>30,nextCursor:rows.length>30?Buffer.from(JSON.stringify([from,until,last.bucket,last.node_id,duration])).toString('base64url'):null,retentionDays:30,windowHours:duration,timezone:'Asia/Shanghai',coverage:'仅受管入口；目标为同一分钟的新连接记录，字节量是该区间合计，不是逐域名用量',geoAvailable:!!(geo||geoLookup),latestUse:latest(userId)};
 }
 function hasSource(userId,ip){return !!db.prepare('SELECT 1 FROM activity_samples a,json_each(a.sources) p WHERE a.user_id=? AND a.at>=? AND p.value=? LIMIT 1').get(userId,Date.now()-RETENTION,ip);}
 function summary(userId,{hours='24',source='',target=''}={}){
  if(!store.getUser(userId)||store.getUser(userId).role!=='user')throw invalid('用户不存在');
  const duration=Number(hours);if(![24,168,720].includes(duration)||typeof source!=='string'||source&&!isIP(source)||typeof target!=='string'||target.length>253||/[\x00-\x1f]/.test(target))throw invalid('汇总筛选条件无效');
  const until=Date.now(),from=Math.max(until-RETENTION,until-duration*3600000);
  // Two bounded range reads, not a separate query per host/minute; all selected
  // history is summarized, independently of the raw log's 30-row pagination.
  const windows=db.prepare('SELECT node_id,CAST(at/60000 AS INTEGER)*60000 bucket,sum(up) up,sum(down) down FROM usage_events WHERE user_id=? AND at>=? AND at<? GROUP BY node_id,bucket').all(userId,from,until);
  const samples=db.prepare('SELECT node_id,bucket,at,sources,targets FROM activity_samples WHERE user_id=? AND at>=? AND at<? ORDER BY at').iterate(userId,from,until),data=groupActivity(windows,samples,{source,target});
  return {...data,username:store.getUser(userId).username,from,until,windowHours:duration,retentionDays:30,sources:data.sources.map(s=>({...s,location:lookup(s.ip),enrichment:store.ipLocation?.peek(s.ip)||null,canLookup:isPublicIp(s.ip)&&!!store.ipLocation?.enabled})),ipinfoEnabled:!!store.ipLocation?.enabled};
 }
 return {record,prune,latest,page,hasSource,summary};
}
