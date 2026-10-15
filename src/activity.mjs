import {isIP} from 'node:net';
import {domainToASCII} from 'node:url';
import {readFileSync} from 'node:fs';
import {Reader} from 'maxmind';
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
  const cutoff=Date.now()-RETENTION,row=db.prepare("SELECT at,sources FROM activity_samples WHERE user_id=? AND at>=? AND sources<>'[]' ORDER BY at DESC,node_id LIMIT 1").get(userId,cutoff),flow=db.prepare("SELECT at,source FROM flow_events WHERE user_id=? AND at>=? AND source<>'' ORDER BY at DESC,id DESC LIMIT 1").get(userId,cutoff);
  return flow&&(!row||flow.at>=row.at)?{ip:flow.source,at:flow.at}:row?{ip:JSON.parse(row.sources)[0],at:row.at}:null;
 }
 function hasSource(userId,ip){const cutoff=Date.now()-RETENTION;return !!(db.prepare('SELECT 1 FROM activity_samples a,json_each(a.sources) p WHERE a.user_id=? AND a.at>=? AND p.value=? LIMIT 1').get(userId,cutoff,ip)||db.prepare('SELECT 1 FROM flow_events WHERE user_id=? AND at>=? AND source=? LIMIT 1').get(userId,cutoff,ip));}
 function lastUse(userId){
  const row=latest(userId);if(!row)return null;
  const saved=store.ipLocation?.peek(row.ip),location=saved?{country:saved.country,countryCode:saved.countryCode,region:saved.region,city:saved.city,provider:saved.provider}:{...lookup(row.ip),city:''};
  return {...row,location,canLookup:!saved&&isPublicIp(row.ip)&&!!store.ipLocation?.enabled};
 }
 function sources(userId,{hours='24',source=''}={}){
  if(!store.getUser(userId)||store.getUser(userId).role!=='user')throw invalid('用户不存在');
  const duration=Number(hours);if(![24,168,720].includes(duration)||typeof source!=='string'||source&&!isIP(source))throw invalid('来源筛选条件无效');
  const until=Date.now(),from=Math.max(until-RETENTION,until-duration*3600000);
  // Sources have their own observation timestamps, never a join to a billed
  // minute. This query does not read destinations, credentials or other users.
  const observed=db.prepare(`WITH observations AS (
   SELECT ip.value ip,a.at FROM activity_samples a,json_each(a.sources) ip WHERE a.user_id=? AND a.at>=? AND a.at<?
   UNION ALL SELECT source ip,at FROM flow_events WHERE user_id=? AND at>=? AND at<? AND source<>''
  ) SELECT ip,min(at) firstSeen,max(at) lastSeen FROM observations ${source?'WHERE ip=?':''} GROUP BY ip ORDER BY lastSeen DESC,ip`).all(userId,from,until,userId,from,until,...(source?[source]:[]));
  return {sourceCount:observed.length,from,until,windowHours:duration,retentionDays:30,sources:observed.slice(0,10).map(s=>({...s,location:lookup(s.ip),enrichment:store.ipLocation?.peek(s.ip)||null,canLookup:isPublicIp(s.ip)&&!!store.ipLocation?.enabled})),ipinfoEnabled:!!store.ipLocation?.enabled};
 }
 return {record,prune,latest,lastUse,hasSource,sources};
}
