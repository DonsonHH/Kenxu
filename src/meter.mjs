import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {inventory} from './config.mjs';
import {monthlyPeriod} from './policy.mjs';
import {validateActivity} from './activity.mjs';
const digest=value=>createHash('sha256').update(value).digest('hex');
const DAY=86400000;
const routeKind=node=>node.direct_delivery?'direct-unmetered':node.client_template?'relay':node.outbound_tag==='residential-v6'?'residential-ipv6':node.outbound_tag?'forwarded':'direct';
export function createMeter(store){
 const db=store.db;
 db.exec(`
 CREATE TABLE IF NOT EXISTS meter_nodes(id TEXT PRIMARY KEY,proxy_id TEXT UNIQUE NOT NULL,name TEXT NOT NULL,token_hash TEXT NOT NULL,enabled INTEGER NOT NULL DEFAULT 1,last_seen INTEGER,applied_revision TEXT,created INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS meter_credentials(user_id TEXT NOT NULL REFERENCES users(id),node_id TEXT NOT NULL REFERENCES meter_nodes(id),uuid TEXT NOT NULL,email TEXT UNIQUE NOT NULL,created INTEGER NOT NULL,PRIMARY KEY(user_id,node_id));
 CREATE TABLE IF NOT EXISTS meter_allowlist(user_id TEXT NOT NULL REFERENCES users(id),node_id TEXT NOT NULL REFERENCES meter_nodes(id),PRIMARY KEY(user_id,node_id));
 CREATE TABLE IF NOT EXISTS meter_epochs(node_id TEXT NOT NULL,epoch TEXT NOT NULL,last_seq INTEGER NOT NULL,last_sample INTEGER NOT NULL,PRIMARY KEY(node_id,epoch));
 CREATE TABLE IF NOT EXISTS meter_reports(node_id TEXT NOT NULL,epoch TEXT NOT NULL,seq INTEGER NOT NULL,hash TEXT NOT NULL,PRIMARY KEY(node_id,epoch,seq));
 CREATE TABLE IF NOT EXISTS meter_counters(node_id TEXT NOT NULL,epoch TEXT NOT NULL,email TEXT NOT NULL,up INTEGER NOT NULL,down INTEGER NOT NULL,PRIMARY KEY(node_id,epoch,email));
 CREATE TABLE IF NOT EXISTS meter_retired_identities(agent_id TEXT NOT NULL,email TEXT NOT NULL,retired_at INTEGER NOT NULL,PRIMARY KEY(agent_id,email));
 CREATE TABLE IF NOT EXISTS usage_events(id INTEGER PRIMARY KEY,node_id TEXT NOT NULL,user_id TEXT NOT NULL,at INTEGER NOT NULL,up INTEGER NOT NULL,down INTEGER NOT NULL,counter_reset INTEGER NOT NULL DEFAULT 0);
 CREATE INDEX IF NOT EXISTS usage_user_time ON usage_events(user_id,at);
 CREATE INDEX IF NOT EXISTS usage_user_node ON usage_events(user_id,node_id,at);
 `);
 for(const [name,type]of [['agent_id','TEXT'],['outbound_tag','TEXT'],['client_template','TEXT'],['direct_delivery','INTEGER NOT NULL DEFAULT 0'],['user_hidden','INTEGER NOT NULL DEFAULT 0']])if(!db.prepare('PRAGMA table_info(meter_nodes)').all().some(c=>c.name===name))db.exec(`ALTER TABLE meter_nodes ADD COLUMN ${name} ${type}`);
 db.exec('UPDATE meter_nodes SET agent_id=id WHERE agent_id IS NULL; CREATE INDEX IF NOT EXISTS meter_agent ON meter_nodes(agent_id);');
 const nodeById=id=>db.prepare('SELECT * FROM meter_nodes WHERE id=?').get(id);
 function credential(user,node){
  let c=db.prepare('SELECT * FROM meter_credentials WHERE user_id=? AND node_id=?').get(user.id,node.id);
  if(!c){c={user_id:user.id,node_id:node.id,uuid:randomUUID(),email:`kenxu:${user.id}:${node.id}`,created:Date.now()};db.prepare('INSERT INTO meter_credentials VALUES(?,?,?,?,?)').run(c.user_id,c.node_id,c.uuid,c.email,c.created);}
  return c;
 }
 function desired(node){
  const s=store.source(),users=store.listUsers(),names=new Map((s?inventory(s):[]).map(n=>[n.id,n.name]));
  const routes=db.prepare('SELECT * FROM meter_nodes WHERE agent_id=? AND enabled=1 AND direct_delivery=0 ORDER BY id').all(node.agent_id||node.id).map(n=>{
   const proxy=s?.proxies.find(p=>p.name===names.get(n.proxy_id));if(!proxy||proxy.type!=='vless')throw Error('计量节点源配置不可用');
   const ws=JSON.parse(n.client_template||'null')?.network==='ws';
   const clients=users.filter(u=>u.role==='user'&&store.isActive(u)&&!u.must_change&&u.grants.includes(n.proxy_id)&&db.prepare('SELECT 1 FROM meter_allowlist WHERE user_id=? AND node_id=?').get(u.id,n.id)).map(u=>credential(u,n)).map(c=>({id:c.uuid,email:c.email,level:88,...(!ws?{flow:proxy.flow||''}:{})})).sort((a,b)=>a.email.localeCompare(b.email));
   return {nodeId:n.id,routeId:n.proxy_id,outboundTag:n.outbound_tag||null,clients};
  });
  return {nodeId:node.agent_id||node.id,routes,revision:digest(JSON.stringify(routes)),clients:routes.flatMap(r=>r.clients).sort((a,b)=>a.email.localeCompare(b.email))};
 }
 function overrideSource(source,user){
  const s=structuredClone(source);
  const nodes=db.prepare('SELECT * FROM meter_nodes').all();
  const grants=new Set(JSON.parse(user.grants));const ids=new Map(inventory(s).map(n=>[n.name,n.id]));
  s.proxies=s.proxies.flatMap(p=>{const n=nodes.find(n=>n.proxy_id===ids.get(p.name));if(!n)return [p];
   const enrolled=db.prepare('SELECT 1 FROM meter_allowlist WHERE user_id=? AND node_id=?').get(user.id,n.id);
   // Direct delivery is an explicit operator opt-in, not a disabled gateway
   // fallback. Keep both its original grant and enrollment requirement.
   if(n.direct_delivery)return !n.enabled&&enrolled&&grants.has(n.proxy_id)?[p]:[];
   // Every managed route must have an individual enrollment. Never reveal
   // shared source credentials while a new node/user awaits provisioning.
   if(!n.enabled||!enrolled)return [];
   if(!grants.has(n.proxy_id)||!enrolled)return [p];
   return [n.client_template?{name:p.name,type:'vless',...JSON.parse(n.client_template),uuid:credential(user,n).uuid}:{...p,uuid:credential(user,n).uuid,...(n.outbound_tag==='uk-gusecure2'?{udp:false}:{})}];
  });
  return s;
 }
 function report(node,body){
  if(!body||!Number.isSafeInteger(body.seq)||body.seq<1||typeof body.epoch!=='string'||!/^[a-zA-Z0-9:._-]{1,120}$/.test(body.epoch)||!Number.isSafeInteger(body.at)||body.at<node.created-300000||body.at>Date.now()+300000||!Array.isArray(body.counters)||body.counters.length>500||typeof body.revision!=='string'||!/^[a-f0-9]{64}$/.test(body.revision))throw Error('Invalid meter report');
  const seen=new Set();
  for(const c of body.counters){if(!c||typeof c.email!=='string'||c.email.length>150||seen.has(c.email)||![c.up,c.down].every(n=>Number.isSafeInteger(n)&&n>=0&&n<1e15))throw Error('Invalid counter');seen.add(c.email);}
  const activity=validateActivity(body.activity,body.at),deltas=new Map();
  // Privacy metadata may be redacted from a durable retry after 30 days.
  // Accounting identity, sequence, timestamps and byte counters stay exact.
  const hash=digest(JSON.stringify(body.activity===undefined?body:{...body,activity:[]}));
  db.exec('BEGIN IMMEDIATE');
  try{
   const duplicate=db.prepare('SELECT hash FROM meter_reports WHERE node_id=? AND epoch=? AND seq=?').get(node.id,body.epoch,body.seq);
   if(duplicate){if(duplicate.hash!==hash)throw Error('Conflicting meter sequence');db.exec('COMMIT');return {ok:true,duplicate:true};}
   const epoch=db.prepare('SELECT * FROM meter_epochs WHERE node_id=? AND epoch=?').get(node.id,body.epoch);
   if(epoch&&(body.seq<=epoch.last_seq||body.at<epoch.last_sample))throw Error('Out-of-order meter report');
   for(const c of body.counters){
    const owner=db.prepare('SELECT c.user_id,c.node_id FROM meter_credentials c JOIN meter_nodes n ON n.id=c.node_id WHERE n.agent_id=? AND c.email=?').get(node.id,c.email);
    // Xray may retain counters after client removal; queued reports may also
    // predate deletion. Only exact operator-retired identities from this agent
    // are ignored. Other unknown identities still reject the entire batch.
    if(!owner){if(db.prepare('SELECT 1 FROM meter_retired_identities WHERE agent_id=? AND email=?').get(node.id,c.email))continue;throw Error('Unknown meter identity');}
    const previous=db.prepare('SELECT up,down FROM meter_counters WHERE node_id=? AND epoch=? AND email=?').get(node.id,body.epoch,c.email);
    const up=previous?c.up>=previous.up?c.up-previous.up:c.up:c.up;
    const down=previous?c.down>=previous.down?c.down-previous.down:c.down:c.down;
    const reset=previous&&(c.up<previous.up||c.down<previous.down)?1:0;
    deltas.set(c.email,{up,down});
    if(up||down)db.prepare('INSERT INTO usage_events(node_id,user_id,at,up,down,counter_reset) VALUES(?,?,?,?,?,?)').run(owner.node_id,owner.user_id,body.at,up,down,reset);
    db.prepare('INSERT INTO meter_counters VALUES(?,?,?,?,?) ON CONFLICT(node_id,epoch,email) DO UPDATE SET up=excluded.up,down=excluded.down').run(node.id,body.epoch,c.email,c.up,c.down);
   }
   store.activity.record(node,activity,body.at,deltas);
   db.prepare('INSERT INTO meter_epochs VALUES(?,?,?,?) ON CONFLICT(node_id,epoch) DO UPDATE SET last_seq=excluded.last_seq,last_sample=excluded.last_sample').run(node.id,body.epoch,body.seq,body.at);
   db.prepare('INSERT INTO meter_reports VALUES(?,?,?,?)').run(node.id,body.epoch,body.seq,hash);
   db.prepare('UPDATE meter_nodes SET last_seen=?,applied_revision=? WHERE agent_id=?').run(Math.min(Date.now(),body.at),body.revision,node.id);
   db.exec('COMMIT');return {ok:true,duplicate:false};
  }catch(e){db.exec('ROLLBACK');throw e;}
 }
 function totals(userId,nodeId){
  const now=Date.now(),period=monthlyPeriod(now),local=new Date(now+8*3600000);
  const day=Date.UTC(local.getUTCFullYear(),local.getUTCMonth(),local.getUTCDate())-8*3600000;
  const data=db.prepare(`SELECT coalesce(sum(up),0) u,coalesce(sum(down),0) d,
   coalesce(sum(CASE WHEN at>=? AND at<? THEN up ELSE 0 END),0) du,coalesce(sum(CASE WHEN at>=? AND at<? THEN down ELSE 0 END),0) dd,
   coalesce(sum(CASE WHEN at>=? AND at<? THEN up ELSE 0 END),0) mu,coalesce(sum(CASE WHEN at>=? AND at<? THEN down ELSE 0 END),0) md
   FROM usage_events WHERE ${[userId?'user_id=?':null,nodeId?'node_id=?':null].filter(Boolean).join(' AND ')||'1=1'}`).get(day,day+DAY,day,day+DAY,period.start,period.end,period.start,period.end,...[userId,nodeId].filter(Boolean));
  return {today:{up:data.du,down:data.dd},month:{up:data.mu,down:data.md},total:{up:data.u,down:data.d},period};
 }
 function daily(userId,nodeId){
  const now=Date.now(),local=new Date(now+8*3600000),today=Date.UTC(local.getUTCFullYear(),local.getUTCMonth(),local.getUTCDate())-8*3600000,start=today-29*DAY;
  const filter=[userId?'user_id=?':null,nodeId?'node_id=?':null].filter(Boolean).join(' AND ');
  const rows=new Map(db.prepare(`SELECT strftime('%Y-%m-%d',at/1000,'unixepoch','+8 hours') date,sum(up) up,sum(down) down FROM usage_events WHERE ${filter?filter+' AND ':''}at>=? AND at<? GROUP BY date`).all(...[userId,nodeId].filter(Boolean),start,today+DAY).map(r=>[r.date,r]));
  return Array.from({length:30},(_,i)=>{const date=new Date(start+i*DAY+8*3600000).toISOString().slice(0,10);return rows.get(date)||{date,up:0,down:0};});
 }
 function usage(userId,revisions=new Map(),{includeHidden=true}={}){
  const now=Date.now();
  const amounts=totals(userId);
  const user=store.getUser(userId),grants=new Set(JSON.parse(user.grants));
  const revisionFor=n=>{if(!revisions.has(n.agent_id)){try{revisions.set(n.agent_id,desired(nodeById(n.agent_id)).revision);}catch{revisions.set(n.agent_id,null);}}return revisions.get(n.agent_id);};
  const routes=db.prepare('SELECT n.*,c.created started FROM meter_nodes n JOIN meter_credentials c ON c.node_id=n.id WHERE c.user_id=?').all(userId).filter(n=>includeHidden||!n.user_hidden).map(n=>{const amount=totals(userId,n.id);return {id:n.proxy_id,meterId:n.id,agentId:n.agent_id,name:n.name,lastSeen:n.last_seen,startedAt:n.started,assigned:grants.has(n.proxy_id)&&!!n.enabled&&!n.direct_delivery,kind:routeKind(n),online:!!n.enabled&&!n.direct_delivery&&n.last_seen>now-90000,synced:!n.direct_delivery&&!!revisionFor(n)&&n.applied_revision===revisionFor(n),...amount.total,today:amount.today,month:amount.month,total:amount.total};});
  return {...amounts,daily:daily(userId),allowance:{bytes:store.displayBytes(user),enforced:false},routes,timezone:'Asia/Shanghai',coverage:'受管入口上传与下载合计；不含 DIRECT、旧共享凭据与绕过入口的连接',sampleIntervalSeconds:15,uiRefreshIntervalSeconds:store.getSettings().uiRefreshSeconds};
 }
 return {
  desired,overrideSource,report,usage,totals,
  retireUserCredentials(userId){const user=store.getUser(userId);if(!user||user.role!=='user'||user.enabled)throw Error('Only disabled ordinary-user credentials may be retired');return db.prepare('INSERT OR IGNORE INTO meter_retired_identities(agent_id,email,retired_at) SELECT n.agent_id,c.email,? FROM meter_credentials c JOIN meter_nodes n ON n.id=c.node_id WHERE c.user_id=?').run(Date.now(),userId).changes;},
  // A retired logical route can be the original physical-agent registration.
  // Its token may serve surviving enabled siblings, never the retired route.
  authenticate(token){if(typeof token!=='string'||token.length<30||token.length>128)return null;return db.prepare('SELECT n.* FROM meter_nodes n WHERE n.token_hash=? AND n.agent_id=n.id AND (n.enabled=1 OR EXISTS(SELECT 1 FROM meter_nodes sibling WHERE sibling.agent_id=n.id AND sibling.enabled=1))').get(digest(token))||null;},
  register(proxyId,name,{agentId,outboundTag,clientTemplate}={}){if(!store.inventory().some(n=>n.id===proxyId&&n.type==='vless'))throw Error('节点不存在或不是 VLESS');if(agentId&&nodeById(agentId)?.agent_id!==agentId)throw Error('Invalid physical agent');if(outboundTag&&!/^[a-zA-Z0-9_-]{1,64}$/.test(outboundTag))throw Error('Invalid outbound');const id=randomUUID(),token=randomBytes(32).toString('base64url');db.prepare('INSERT INTO meter_nodes(id,proxy_id,name,token_hash,created,agent_id,outbound_tag,client_template) VALUES(?,?,?,?,?,?,?,?)').run(id,proxyId,name,digest(token),Date.now(),agentId||id,outboundTag||null,clientTemplate?JSON.stringify(clientTemplate):null);return {id,token};},
  nodes:()=>db.prepare('SELECT id,proxy_id,name,enabled,last_seen,created,agent_id,outbound_tag,client_template,direct_delivery,user_hidden FROM meter_nodes').all().map(n=>({...n,client_template:undefined,kind:routeKind(n)})),
  nodeById,
  nodeUsage(id){const n=nodeById(id);if(!n)return null;return {node:{id:n.id,name:n.name,agentId:n.agent_id,lastSeen:n.last_seen,kind:routeKind(n)},totals:totals(null,id),daily:daily(null,id),users:store.listUsers().filter(u=>u.role==='user'&&db.prepare('SELECT 1 FROM meter_credentials WHERE user_id=? AND node_id=?').get(u.id,id)).map(u=>({id:u.id,username:u.username,displayName:u.display_name,totals:totals(u.id,id)}))};},
  allowUser(nodeId,userId){const n=nodeById(nodeId),u=store.getUser(userId);if(!n||!u||u.role!=='user'||!JSON.parse(u.grants).includes(n.proxy_id))throw Error('用户未获节点授权');db.prepare('INSERT OR IGNORE INTO meter_allowlist VALUES(?,?)').run(userId,nodeId);if(!n.direct_delivery)credential(u,n);},
  users:()=>{const revisions=new Map();return store.listUsers().filter(u=>u.role==='user').map(u=>({id:u.id,username:u.username,enabled:!!u.enabled,...usage(u.id,revisions)}));},
 };
}
