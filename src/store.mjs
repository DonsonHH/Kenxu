import {DatabaseSync} from 'node:sqlite';
import {randomBytes,randomUUID,createHash,createHmac,scrypt as rawScrypt,timingSafeEqual} from 'node:crypto';
import {promisify} from 'node:util';
import {mkdirSync,readFileSync,writeFileSync,chmodSync} from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import {parseSource,inventory,generateConfig,ruleTargets} from './config.mjs';
import {createMeter} from './meter.mjs';
import {createHealth} from './health.mjs';
import {createActivity} from './activity.mjs';
import {DEFAULT_SETTINGS,validateSettings,invalid} from './settings.mjs';
import {validateRules,BUILTIN_TARGETS,effectiveRules,ruleParts} from './rules.mjs';
import {retireSourceNode} from './retirement.mjs';
const scrypt=promisify(rawScrypt);
const hash=value=>createHash('sha256').update(value).digest('hex');
const safeEqual=(a,b)=>Buffer.byteLength(a)===Buffer.byteLength(b)&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
export async function passwordHash(password){
 if(typeof password!=='string'||password.length<12||password.length>128)throw Error('密码需为 12–128 个字符');
 const salt=randomBytes(16).toString('hex');
 const key=await scrypt(password,salt,64,{N:32768,r:8,p:1,maxmem:67108864});
 return `${salt}:${key.toString('hex')}`;
}
export async function passwordMatches(password,stored){
 if(typeof password!=='string'||password.length>128)return false;
 const [salt,key]=stored.split(':');
 const candidate=await scrypt(password,salt,64,{N:32768,r:8,p:1,maxmem:67108864});
 return safeEqual(candidate.toString('hex'),key);
}
export function openStore(directory){
 mkdirSync(directory,{recursive:true,mode:0o700});
 const keyPath=path.join(directory,'subscription.key');
 let key;try{key=readFileSync(keyPath);}catch(e){if(e.code!=='ENOENT')throw e;key=randomBytes(32);writeFileSync(keyPath,key,{flag:'wx',mode:0o600});}
 if(key.length!==32)throw Error('Invalid subscription key');
 const dbPath=path.join(directory,'portal.sqlite');
 const db=new DatabaseSync(dbPath);chmodSync(dbPath,0o600);
 db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
 CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, password TEXT NOT NULL, role TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, must_change INTEGER NOT NULL DEFAULT 1, grants TEXT NOT NULL, version TEXT NOT NULL, created INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), csrf TEXT NOT NULL, expires INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY,at INTEGER NOT NULL,actor TEXT NOT NULL,action TEXT NOT NULL,target TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS user_rule_profiles(user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,mode TEXT NOT NULL CHECK(mode IN ('inherit','prepend','replace')),rules TEXT NOT NULL,revision TEXT NOT NULL,updated_at INTEGER NOT NULL);
 `);
 for(const [name,type]of [['display_name',"TEXT NOT NULL DEFAULT ''"],['email',"TEXT NOT NULL DEFAULT ''"],['note',"TEXT NOT NULL DEFAULT ''"],['plan_name',"TEXT NOT NULL DEFAULT ''"],['display_gb','REAL'],['expires_at','INTEGER']])if(!db.prepare('PRAGMA table_info(users)').all().some(c=>c.name===name))db.exec(`ALTER TABLE users ADD COLUMN ${name} ${type}`);
 if(!db.prepare('PRAGMA table_info(audit)').all().some(c=>c.name==='details'))db.exec("ALTER TABLE audit ADD COLUMN details TEXT NOT NULL DEFAULT '{}'");
 db.exec('CREATE INDEX IF NOT EXISTS audit_time_id ON audit(at,id)');
 const getUser=id=>db.prepare('SELECT * FROM users WHERE id=?').get(id);
 const getSettings=()=>({...DEFAULT_SETTINGS,...JSON.parse(db.prepare("SELECT value FROM settings WHERE key='admin_config'").get()?.value||'{}')});
 const validatePassword=password=>{if(typeof password!=='string'||password.length<getSettings().minPasswordLength||password.length>128)throw invalid(`密码至少需要 ${getSettings().minPasswordLength} 个字符，最多 128 个字符`);const p=password.toLowerCase();if(/^(.)\1+$/.test(p)||['123456789012345678901234567890','012345678901234567890123456789','qwertyuiopasdfghjkl'].some(s=>s.includes(p))||['password1234','password12345','qwerty123456','admin12345678'].includes(p))throw invalid('这个密码过于常见，请使用更长的独特密码或密码短语');};
 const isActive=u=>!!u&&!!u.enabled&&(!u.expires_at||u.expires_at>Date.now());
 function profileValues(id,body,u){
  const v={username:body.username??u.username,display_name:body.displayName??u.display_name,email:body.email??u.email,note:body.note??u.note,plan_name:body.planName??u.plan_name,display_gb:body.displayGB===undefined?u.display_gb:body.displayGB,expires_at:body.expiresAt===undefined?u.expires_at:body.expiresAt};
  if(typeof v.username!=='string'||!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{2,39}$/.test(v.username))throw invalid('账号格式无效');
  const duplicate=db.prepare('SELECT id FROM users WHERE username=? AND id<>?').get(v.username,id);if(duplicate)throw invalid('账号已存在');
  for(const [k,max]of [['display_name',60],['email',254],['note',1000],['plan_name',60]])if(typeof v[k]!=='string'||v[k].length>max||/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(v[k]))throw invalid('用户资料字段无效');
  if(v.email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email))throw invalid('邮箱格式无效');
  if(v.display_gb!==null&&(!Number.isFinite(v.display_gb)||v.display_gb<0.1||v.display_gb>10000))throw invalid('展示额度需为 0.1–10000 GB，或留空');
  if(v.expires_at!==null&&(!Number.isSafeInteger(v.expires_at)||v.expires_at<=0||v.expires_at>Date.UTC(2100,0,1)))throw invalid('有效期格式无效');
  const enabled=body.enabled===undefined?!!u.enabled:body.enabled,grants=body.grants===undefined?JSON.parse(u.grants):body.grants;
  if(typeof enabled!=='boolean'||!Array.isArray(grants)||grants.length>200||!grants.every(id=>store.inventory().some(n=>n.id===id)))throw invalid('权限数据无效');
  return {v,enabled,grants};
 }
 function updateUser(id,body){
  const u=getUser(id);if(!u||u.role!=='user')throw invalid('只能修改普通用户');
  const {v,enabled,grants}=profileValues(id,body,u);
  db.exec('BEGIN IMMEDIATE');try{
   db.prepare('UPDATE users SET username=?,display_name=?,email=?,note=?,plan_name=?,display_gb=?,expires_at=?,enabled=?,grants=? WHERE id=?').run(v.username,v.display_name,v.email,v.note,v.plan_name,v.display_gb,v.expires_at,enabled?1:0,JSON.stringify([...new Set(grants)]),id);
   for(const n of store.meter.nodes())if((n.enabled||n.direct_delivery)&&grants.includes(n.proxy_id))store.meter.allowUser(n.id,id);
   if(u.username!==v.username||!enabled||v.expires_at&&v.expires_at<=Date.now()){db.prepare('DELETE FROM sessions WHERE user_id=?').run(id);rotate(id);}
   db.exec('COMMIT');return getUser(id);
  }catch(e){db.exec('ROLLBACK');throw e;}
 }
 let lastPrune=0;
 function pruneAudit(force=false){if(!force&&Date.now()-lastPrune<3600000)return 0;lastPrune=Date.now();return db.prepare('DELETE FROM audit WHERE at<?').run(Date.now()-30*86400000).changes;}
 const audit=(actor,action,target,details={})=>{pruneAudit();db.prepare('INSERT INTO audit(at,actor,action,target,details) VALUES(?,?,?,?,?)').run(Date.now(),actor,action,target,JSON.stringify(details));};
 function auditPage(cursor){
  pruneAudit();const now=Date.now();let anchor=now,before=db.prepare('SELECT coalesce(max(id),0)+1 id FROM audit').get().id,since=now-86400000;
  if(cursor){if(typeof cursor!=='string'||cursor.length>300)throw invalid('日志游标无效');const [encoded,signature]=cursor.split('.');if(!encoded||!signature||!safeEqual(signature,createHmac('sha256',key).update('audit:'+encoded).digest('base64url')))throw invalid('日志游标无效');let value;try{value=JSON.parse(Buffer.from(encoded,'base64url').toString());}catch{throw invalid('日志游标无效');}if(!Number.isSafeInteger(value.before)||value.before<1||!Number.isSafeInteger(value.anchor)||value.anchor>now+300000||value.anchor<now-30*86400000)throw invalid('日志游标无效');({anchor,before}=value);since=now-30*86400000;}
  const items=db.prepare('SELECT id,at,actor,action,target,details FROM audit WHERE at>=? AND at<=? AND id<? ORDER BY id DESC LIMIT 30').all(since,anchor,before).map(r=>({...r,details:JSON.parse(r.details)}));
  const nextBefore=items.at(-1)?.id||before,hasMore=!!db.prepare('SELECT 1 FROM audit WHERE at>=? AND at<=? AND id<? LIMIT 1').get(now-30*86400000,anchor,nextBefore);
  const encoded=Buffer.from(JSON.stringify({anchor,before:nextBefore})).toString('base64url');return {items,hasMore,nextCursor:hasMore?encoded+'.'+createHmac('sha256',key).update('audit:'+encoded).digest('base64url'):null,retentionDays:30,window:cursor?'30d':'24h'};
 }
 pruneAudit(true);
 const rotate=id=>db.prepare('UPDATE users SET version=? WHERE id=?').run(randomBytes(16).toString('hex'),id);
 let cachedText,cachedSource;
 const source=()=>{const text=db.prepare('SELECT value FROM settings WHERE key=?').get('source')?.value;if(text!==cachedText){cachedSource=text?parseSource(text):null;cachedText=text;}return cachedSource?structuredClone(cachedSource):null;};
 const subscription=u=>`${u.id}.${createHmac('sha256',key).update(u.id+':'+u.version).digest('base64url')}`;
 const ruleProfile=id=>{const row=db.prepare('SELECT * FROM user_rule_profiles WHERE user_id=?').get(id);return row?{mode:row.mode,rules:JSON.parse(row.rules),revision:row.revision,updatedAt:row.updated_at}:{mode:'inherit',rules:[],revision:'initial',updatedAt:null};};
 function userRuleSource(s,user){
  const grants=new Set(JSON.parse(user.grants)),meters=store.meter.nodes(),enrolled=new Set(db.prepare('SELECT node_id FROM meter_allowlist WHERE user_id=?').all(user.id).map(row=>row.node_id));
  const available=new Set(inventory(s).filter(n=>{const meter=meters.find(m=>m.proxy_id===n.id);return grants.has(n.id)&&(!meter||(meter.enabled&&!meter.direct_delivery||!meter.enabled&&meter.direct_delivery)&&enrolled.has(meter.id));}).map(n=>n.name));
  return {...s,proxies:s.proxies.filter(p=>available.has(p.name))};
 }
 function rulesState(userId=null){
  const s=source();if(!s)throw invalid('请先导入私有配置源');
  const sourceRevision=hash(db.prepare("SELECT value FROM settings WHERE key='source'").get().value);
  if(userId===null)return {scope:'global',mode:'global',rules:s.rules||[],revision:sourceRevision,targets:[...BUILTIN_TARGETS,...s.proxies.map(p=>p.name),...(s['proxy-groups']||[]).map(g=>g.name)],providers:Object.keys(s['rule-providers']||{})};
  const u=getUser(userId);if(!u||u.role!=='user')throw invalid('只能为现有普通用户分配规则');
  const profile=ruleProfile(userId),available=userRuleSource(s,u),targets=ruleTargets(available,JSON.parse(u.grants));
  return {scope:'user',userId,username:u.username,mode:profile.mode,rules:profile.rules,updatedAt:profile.updatedAt,revision:hash(JSON.stringify([sourceRevision,profile.revision,u.grants,targets])),targets,providers:Object.keys(s['rule-providers']||{}),baseRuleCount:(s.rules||[]).length};
 }
 function preparedRules(patch,current){
  const s=source(),user=current.scope==='user';
  if(!patch||typeof patch!=='object'||Array.isArray(patch)||Object.keys(patch).some(k=>!(user?['rules','revision','mode']:['rules','revision']).includes(k)))throw invalid('规则编辑字段无效');
  if(patch.revision!==current.revision)throw Object.assign(Error('规则、配置源或授权已被更新，请重新载入后再保存'),{statusCode:409});
  const mode=user?patch.mode:'global';if(user&&!['inherit','prepend','replace'].includes(mode))throw invalid('请选择继承、优先补充或独立规则');
  let rules=validateRules(patch.rules,s,{targets:current.targets,prepend:mode==='prepend'});
  if(mode==='inherit'&&rules.length)throw invalid('继承模式不能同时保存个人规则');
  if(mode==='replace'&&!rules.some(rule=>rule.startsWith('MATCH,'))){
   const fallback=(s.rules||[]).findLast(rule=>ruleParts(rule).type==='MATCH'),target=fallback?ruleParts(fallback).target:current.targets.find(t=>!BUILTIN_TARGETS.includes(t));
   rules.push('MATCH,'+(current.targets.includes(target)?target:'REJECT'));
  }
  return {mode,rules};
 }
 function saveRules(patch,userId=null){
  db.exec('BEGIN IMMEDIATE');try{
   const current=rulesState(userId),{mode,rules}=preparedRules(patch,current);
   if(userId===null){const text=YAML.stringify({...source(),rules});parseSource(text);db.prepare("UPDATE settings SET value=? WHERE key='source'").run(text);}
   else db.prepare('INSERT INTO user_rule_profiles VALUES(?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET mode=excluded.mode,rules=excluded.rules,revision=excluded.revision,updated_at=excluded.updated_at').run(userId,mode,JSON.stringify(rules),randomBytes(16).toString('hex'),Date.now());
   db.exec('COMMIT');return rulesState(userId);
  }catch(error){db.exec('ROLLBACK');throw error;}
 }
 function previewRules(patch,userId=null){
  const current=rulesState(userId),profile=preparedRules(patch,current),s=source();
  const raw=userId===null?profile.rules:effectiveRules(s.rules||[],profile),available=userId===null?s:userRuleSource(s,getUser(userId));
  const grants=userId===null?inventory(s).map(n=>n.id):JSON.parse(getUser(userId).grants),warnings=[];
  if(!available.proxies.length)warnings.push({code:'NO_NODES',message:'尚未授权可用节点；先分配线路后才能领取订阅。'});
  const denied=raw.filter(rule=>!current.targets.includes(ruleParts(rule).target)).length;
  if(denied)warnings.push({code:'UNAUTHORIZED_TARGET',count:denied,message:`${denied} 条继承规则的目标未授权，导出时使用 REJECT。`});
  let output=[];try{if(available.proxies.length)output=YAML.parse(generateConfig({...available,rules:raw},grants)).rules;}catch(error){throw invalid(error.message);}
  return {scope:current.scope,mode:profile.mode,effectiveRules:output,count:output.length,convertedCount:raw.filter(rule=>/^PROCESS-(NAME|PATH)-WILDCARD,/.test(rule)).length,warnings};
 }
 function retireNode(name){
  db.exec('BEGIN IMMEDIATE');try{
   const current=db.prepare("SELECT value FROM settings WHERE key='source'").get();if(!current)throw invalid('请先导入私有配置源');
   const prepared=retireSourceNode(current.value,name);
   if(db.prepare('SELECT rules FROM user_rule_profiles').all().some(profile=>JSON.parse(profile.rules).some(rule=>ruleParts(rule).target===name)))throw invalid('个人规则直接引用此节点，请先选择替代策略');
   db.prepare("UPDATE settings SET value=? WHERE key='source'").run(prepared.text);
   const meter=db.prepare('SELECT id FROM meter_nodes WHERE proxy_id=?').get(prepared.id);
   if(meter){db.prepare('UPDATE meter_nodes SET enabled=0 WHERE id=?').run(meter.id);db.prepare('DELETE FROM meter_allowlist WHERE node_id=?').run(meter.id);}
   let updatedUsers=0;for(const user of db.prepare('SELECT id,grants FROM users').all()){
    const grants=JSON.parse(user.grants);if(grants.includes(prepared.id)){db.prepare('UPDATE users SET grants=? WHERE id=?').run(JSON.stringify(grants.filter(id=>id!==prepared.id)),user.id);updatedUsers++;}
   }
   // Credentials and usage remain available for historical/queued counters.
   // Account versions, passwords and sessions are not rotated by retirement.
   const result={name,remainingNodes:prepared.remainingNodes,updatedUsers,historicalUsageRetained:true};
   audit('operator','node-retire',prepared.id,{name,updatedUsers});db.exec('COMMIT');return result;
  }catch(error){db.exec('ROLLBACK');throw error;}
 }
 const store={
  db,close:()=>db.close(),getUser,source,audit,getSettings,isActive,updateUser,pruneAudit,auditPage,rulesState,saveRules,previewRules,retireNode,
  setSettings(patch){const settings=validateSettings(patch,getSettings());db.prepare("INSERT INTO settings(key,value) VALUES('admin_config',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(JSON.stringify(settings));return settings;},
  displayBytes:u=>Math.round((u?.display_gb??getSettings().defaultDisplayGB)*1024**3),
  publicPolicy:()=>{const s=getSettings();return {siteName:s.siteName,subscriptionMinutes:s.subscriptionMinutes,uiRefreshSeconds:s.uiRefreshSeconds,minPasswordLength:s.minPasswordLength};},
  inventory:()=>{const s=source();return s?inventory(s):[];},
  listUsers:()=>db.prepare('SELECT id,username,role,enabled,must_change,grants,created,display_name,email,note,plan_name,display_gb,expires_at FROM users ORDER BY created').all().map(u=>({...u,active:isActive(u),grants:JSON.parse(u.grants)})),
  async createUser(username,password,grants=[],role='user',profile={}){
   validatePassword(password);
   if(!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{2,39}$/.test(username))throw Error('账号需为 3–40 位字母、数字、点、横线或下划线');
   const hashed=await passwordHash(password),id=randomUUID();
   const {v,enabled,grants:validated}=profileValues(id,{...profile,username,grants},{username,display_name:'',email:'',note:'',plan_name:'',display_gb:null,expires_at:null,enabled:1,grants:'[]'});
   db.prepare('INSERT INTO users(id,username,password,role,must_change,grants,version,created,display_name,email,note,plan_name,display_gb,expires_at,enabled) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id,username,hashed,role,role==='admin'?0:1,JSON.stringify(validated),randomBytes(16).toString('hex'),Date.now(),v.display_name,v.email,v.note,v.plan_name,v.display_gb,v.expires_at,enabled?1:0);
   if(role==='user')for(const n of store.meter.nodes())if((n.enabled||n.direct_delivery)&&grants.includes(n.proxy_id))store.meter.allowUser(n.id,id);
   return id;
  },
  findUser:username=>db.prepare('SELECT * FROM users WHERE username=?').get(username),
  async setPassword(id,password){validatePassword(password);const value=await passwordHash(password);db.prepare('UPDATE users SET password=?,must_change=0 WHERE id=?').run(value,id);db.prepare('DELETE FROM sessions WHERE user_id=?').run(id);rotate(id);},
  requirePasswordChange:id=>db.prepare('UPDATE users SET must_change=1 WHERE id=?').run(id),
  setAccess:(id,enabled,grants)=>updateUser(id,{enabled,grants}),
  importSource(text){parseSource(text);db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run('source',text);},
  session(id){db.prepare('DELETE FROM sessions WHERE expires<?').run(Date.now());db.prepare('DELETE FROM sessions WHERE user_id=?').run(id);const token=randomBytes(32).toString('base64url'),csrf=randomBytes(24).toString('base64url');db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(hash(token),id,csrf,Date.now()+getSettings().sessionHours*3600000);return {token,csrf};},
  authenticate(token){if(typeof token!=='string'||token.length>128)return null;const u=db.prepare('SELECT users.*,sessions.csrf FROM sessions JOIN users ON users.id=sessions.user_id WHERE token_hash=? AND expires>? AND enabled=1').get(hash(token),Date.now());return isActive(u)?u:null;},
  logout:token=>{if(token)db.prepare('DELETE FROM sessions WHERE token_hash=?').run(hash(token));},
  subscription,rotate,
  subscriptionUser(token){if(typeof token!=='string'||token.length>128)return null;const id=token.split('.')[0],u=getUser(id);return isActive(u)&&!u.must_change&&safeEqual(token,subscription(u))?u:null;},
  config(u){const s=source();if(!s)throw Error('管理员尚未导入配置');s.rules=effectiveRules(s.rules||[],ruleProfile(u.id));return generateConfig(store.meter.overrideSource(s,u),JSON.parse(u.grants));},
 };
 store.activity=createActivity(store);
 store.meter=createMeter(store);
 store.health=createHealth(store);
 return store;
}
