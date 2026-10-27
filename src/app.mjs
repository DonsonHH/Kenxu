import express from 'express';
import {fileURLToPath} from 'node:url';
import {passwordMatches,passwordHash} from './store.mjs';
import {createMonitorReader} from './monitor.mjs';
import {VERSION} from './version.mjs';
import {createAuthGuard,clientAddress} from './auth-guard.mjs';
import {shadowrocketSubscription,stashConfiguration} from './mobile-subscription.mjs';
import {userAnnouncements} from './announcements.mjs';
const publicDir=fileURLToPath(new URL('../public/',import.meta.url));
const badPassword=await passwordHash('dummy-password-not-an-account');
export function createApp({store,origin,subscriptionOrigin=origin,admin=false,monitorReader,trustCloudflare=false}){
 const app=express();app.disable('x-powered-by');
 const readMonitor=monitorReader||createMonitorReader(store);
 for(const value of [origin,subscriptionOrigin]){const parsed=new URL(value);if(parsed.origin!==value||(parsed.protocol!=='https:'&&!(parsed.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(parsed.hostname))))throw Error('Use an exact HTTPS origin or loopback HTTP origin');}
 const parsedOrigin=new URL(origin);
 const secure=parsedOrigin.protocol==='https:',cookieName=secure?'__Host-donson-access':admin?'donson_admin':'donson_local';
 const cookie=(token,maxAge=28800)=>`${cookieName}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure?'; Secure':''}`;
 const guard=createAuthGuard(store,admin?'admin':'user');
 const throttle=(req,res,action,account)=>{const result=guard.consume(action,account,clientAddress(req,trustCloudflare&&!admin));if(!result.allowed){res.set('Retry-After',String(result.retryAfter)).status(429).json({error:'尝试过多，请稍后重试。',retryAfter:result.retryAfter});return false;}if(!guard.acquire()){res.set('Retry-After','3').status(429).json({error:'登录服务繁忙，请稍后重试。',retryAfter:3});return false;}return result;};
 const tokens=req=>{const parts=(req.headers.cookie||'').split(';').map(s=>s.trim());return parts.find(s=>s.startsWith(cookieName+'='))?.slice(cookieName.length+1)||'';};
 // Status uses authorized, deliverable nodes and excludes presentation-only
 // backups. Hiding a node never changes its subscription authorization.
 const userNodes=u=>{
  const allowed=new Set(JSON.parse(u.grants)),meters=store.meter.nodes();
  const enrollments=new Set(store.db.prepare('SELECT node_id FROM meter_allowlist WHERE user_id=?').all(u.id).map(n=>n.node_id));
  return store.inventory().flatMap(n=>{const meter=meters.find(m=>m.proxy_id===n.id);return allowed.has(n.id)&&!n.userHidden&&!meter?.user_hidden&&(!meter||(meter.enabled&&!meter.direct_delivery||!meter.enabled&&meter.direct_delivery)&&enrollments.has(meter.id))?[{...n,metered:!!meter?.enabled&&!meter?.direct_delivery,kind:meter?.kind||'unmanaged'}]:[];});
 };
 app.use((req,res,next)=>{
  const sensitiveDownload=/^\/s\//i.test(req.path)||/^\/api\/config\/?$/i.test(req.path);
  res.set({'Cache-Control':'no-store, private','X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY','Referrer-Policy':sensitiveDownload?'no-referrer':'same-origin','X-Robots-Tag':'noindex, nofollow','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; style-src-attr 'unsafe-inline'; img-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",'Cross-Origin-Resource-Policy':'same-origin'});
  if(secure)res.set('Strict-Transport-Security','max-age=31536000');
  if(!['GET','HEAD','POST','PUT'].includes(req.method))return res.sendStatus(405);
  // Only the configured loopback Tunnel may describe the visitor's protocol.
  // Node sees plain HTTP for both edge protocols; HSTS alone cannot protect
  // a visitor's first HTTP entry. Never redirect a password or bearer request.
  if(secure&&!admin&&trustCloudflare&&['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress)){
   let visitor;try{visitor=JSON.parse(req.headers['cf-visitor']||'null');}catch{}
   if(req.headers['x-forwarded-proto']==='http'||visitor?.scheme==='http'){
    if(['GET','HEAD'].includes(req.method)&&!sensitiveDownload&&!req.headers.authorization)return res.redirect(308,origin+(req.originalUrl.startsWith('/')?req.originalUrl:'/'));
    return res.status(403).json({error:'请使用 HTTPS 安全入口，刷新页面后重试',code:'INSECURE_ORIGIN'});
   }
  }
  const machineReport=req.method==='POST'&&['/api/meter/report','/api/meter/flows','/api/meter/flows/heartbeat'].includes(req.path);
  if(!machineReport&&!['GET','HEAD'].includes(req.method)&&req.headers.origin!==origin)return res.status(403).json({error:'请求来源不匹配，请从本站正确入口打开并刷新页面',code:'ORIGIN_MISMATCH'});
  next();
 });
 app.use(express.json({limit:'600kb',strict:true}));
 app.get('/healthz',(_req,res)=>res.json({ok:true,interface:admin?'admin':'user',version:VERSION}));
 app.get('/api/interface',(_req,res)=>res.json({adminInterface:admin,title:admin?store.getSettings().adminTitle:store.getSettings().siteName,version:VERSION,policy:store.publicPolicy()}));
 const sendConfig=(res,user,format)=>{
  if(format!==undefined&&!['shadowrocket','stash'].includes(format))return res.status(400).json({error:'不支持的订阅格式'});
  const configuration=store.config(user),month=store.meter.totals(user.id).month;
  const mobile=format==='shadowrocket',body=mobile?shadowrocketSubscription(configuration):format==='stash'?stashConfiguration(configuration):configuration;
  res.set({'Content-Type':mobile?'text/plain; charset=utf-8':'text/yaml; charset=utf-8','Content-Disposition':'attachment; filename='+(mobile?'Kenxu.txt':'Kenxu.yaml'),
   'Profile-Title':'Kenxu',
   'profile-update-interval':String(store.getSettings().subscriptionMinutes/60),'profile-web-page-url':subscriptionOrigin,
   'subscription-userinfo':`upload=${month.up}; download=${month.down}; total=${store.displayBytes(user)}${user.expires_at?'; expire='+Math.floor(user.expires_at/1000):''}`}).send(body);
 };
 app.post('/api/login',async(req,res)=>{
  const {username,password}=req.body||{};
  if(typeof username!=='string'||typeof password!=='string'||username.length>40||password.length>128)return res.status(400).json({error:'账号或密码格式无效'});
  const attempt=throttle(req,res,'login',username);if(!attempt)return;
  try{
   const candidate=store.findUser(username);const valid=await passwordMatches(password,candidate?.password||badPassword),u=candidate&&store.getUser(candidate.id);
   if(!valid||!store.isActive(u)||u.password!==candidate.password||(admin?u.role!=='admin':u.role==='admin')){if(attempt.attempt===1||attempt.attempt===8)store.audit('security','login-failed',admin?'admin':'user',{attempt:attempt.attempt});return res.status(401).json({error:'账号或密码不正确，或账号不可用'});}
   guard.clearAccount('login',username);
   const s=store.session(u.id);res.set('Set-Cookie',cookie(s.token,store.getSettings().sessionHours*3600));store.audit(u.username,'login',u.id);res.json({ok:true});
  }finally{guard.release();}
 });
 app.use('/api/meter',(req,res,next)=>{const auth=req.headers.authorization;const n=store.meter.authenticate(typeof auth==='string'&&auth.startsWith('Bearer ')?auth.slice(7):'');if(!n)return res.status(401).json({error:'采集身份无效'});req.meterNode=n;next();});
 app.get('/api/meter/desired',(req,res)=>res.json(store.meter.desired(req.meterNode)));
 app.post('/api/meter/report',(req,res)=>{try{res.json(store.meter.report(req.meterNode,req.body));}catch{res.status(409).json({error:'计量报告无效或顺序冲突'});}});
 app.post('/api/meter/flows',(req,res)=>{try{res.json(store.flows.report(req.meterNode,req.body));}catch{res.status(409).json({error:'连接观测无效或顺序冲突'});}});
 app.post('/api/meter/flows/heartbeat',(req,res)=>{try{res.json(store.flows.heartbeat(req.meterNode,req.body));}catch{res.status(409).json({error:'连接观测状态无效'});}});
 app.use('/api/meter',(_req,res)=>res.status(404).json({error:'接口不存在'}));
 // Bearer subscription links are intentionally usable by clients without cookies.
 app.get('/s/:token', (req,res)=>{
  const u=store.subscriptionUser(req.params.token.replace(/\.yaml$/,''));
  if(!u||u.role==='admin')return res.status(404).send('订阅不可用');
  try{sendConfig(res,u,req.query.format);}
  catch{return res.status(403).send('暂未分配可用配置，或客户端不支持该线路格式');}
 });
 app.use('/api',(req,res,next)=>{
  const u=store.authenticate(tokens(req));
  if(!u||(admin?u.role!=='admin':u.role==='admin'))return res.status(401).json({error:'请重新登录'});
  req.user=u;
  if(!['GET','HEAD'].includes(req.method)&&req.headers['x-csrf-token']!==u.csrf)return res.status(403).json({error:'操作验证失败，请刷新后重试'});
  if(u.must_change&&!['/me','/password','/logout'].includes(req.path))return res.status(403).json({error:'请先修改初始密码'});
  next();
 });
 app.get('/api/me',(req,res)=>{
  const u=req.user;
  const nodes=userNodes(u);
  res.json({username:u.username,displayName:u.display_name||u.username,planName:u.plan_name||'好友共享',role:u.role,mustChange:!!u.must_change,csrf:u.csrf,nodes,subscriptionUrl:!u.must_change&&u.role==='user'?`${subscriptionOrigin}/s/${store.subscription(u)}.yaml`:null,adminInterface:admin,lastUseIp:store.activity.latest(u.id)?.ip||null,announcements:u.role==='user'&&!u.must_change?userAnnouncements(nodes):[]});
 });
 app.get('/api/usage',(req,res)=>res.json(store.meter.usage(req.user.id,new Map(),{includeHidden:false})));
 app.get('/api/nodes/status',(req,res)=>res.json({nodes:store.health.nodes(userNodes(req.user).map(n=>n.id)),checkIntervalMinutes:store.getSettings().healthCheckMinutes}));
 app.get('/api/ai-status',(req,res)=>{
  if(req.user.role!=='user')return res.sendStatus(403);
  res.json(store.aiStatus.snapshot());
 });
 app.get('/api/account/sources',(req,res)=>{
  if(req.user.role!=='user')return res.sendStatus(403);
  res.json(store.activity.sources(req.user.id,{hours:req.query.hours}));
 });
 app.get('/api/account/last-use',(req,res)=>{
  if(req.user.role!=='user')return res.sendStatus(403);
  res.json(store.activity.lastUse(req.user.id));
 });
 app.post('/api/account/ip-location',async(req,res)=>{
  if(req.user.role!=='user')return res.sendStatus(403);
  const limit=guard.consume('ip-location',req.user.id,clientAddress(req,trustCloudflare&&!admin));
  if(!limit.allowed)return res.set('Retry-After',String(limit.retryAfter)).status(429).json({error:'归属查询较频繁，请稍后重试。',retryAfter:limit.retryAfter});
  res.json(await store.ipLocation.lookup(req.user.id,req.body?.ip));
 });
 app.post('/api/logout',(req,res)=>{store.logout(tokens(req));res.set('Set-Cookie',cookie('',0));res.json({ok:true});});
 app.post('/api/password',async(req,res)=>{
  if(!throttle(req,res,'password',req.user.id))return;
  try{if(!await passwordMatches(req.body?.currentPassword,req.user.password))return res.status(400).json({error:'当前密码不正确'});await store.setPassword(req.user.id,req.body?.password);guard.clearAccount('password',req.user.id);store.audit(req.user.username,'password-change',req.user.id);res.set('Set-Cookie',cookie('',0));res.json({ok:true});}finally{guard.release();}
 });
 app.post('/api/subscription/rotate',(req,res)=>{store.rotate(req.user.id);store.audit(req.user.username,'subscription-rotate',req.user.id);res.json({ok:true});});
 app.get('/api/config',(req,res)=>{try{sendConfig(res,req.user,req.query.format);}catch{res.status(403).json({error:'管理员尚未分配可用配置，或客户端不支持该线路格式'});}});
 app.use('/api/admin',(req,res,next)=>{if(!admin||req.user.role!=='admin')return res.status(403).json({error:'此操作仅限私有管理入口'});next();});
 const checkGrants=grants=>Array.isArray(grants)&&grants.length<=200&&grants.every(id=>typeof id==='string'&&store.inventory().some(n=>n.id===id));
 app.get('/api/admin/rules',(_req,res)=>res.json(store.rulesState()));
 app.post('/api/admin/rules/preview',(req,res)=>{
  const body=req.body;if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(k=>!['userId','patch'].includes(k))||body.userId!==null&&(typeof body.userId!=='string'||body.userId.length>100))return res.status(400).json({error:'规则预览范围无效'});
  res.json(store.previewRules(body.patch,body.userId));
 });
 app.put('/api/admin/rules',(req,res)=>{const result=store.saveRules(req.body);store.audit(req.user.username,'rules-global-update','configuration',{count:result.rules.length});res.json(result);});
 app.get('/api/admin/users/:id/rules',(req,res)=>res.json(store.rulesState(req.params.id)));
 app.put('/api/admin/users/:id/rules',(req,res)=>{const result=store.saveRules(req.body,req.params.id);store.audit(req.user.username,'rules-user-update',req.params.id,{mode:result.mode,count:result.rules.length});res.json(result);});
 app.get('/api/admin/settings',(_req,res)=>res.json(store.getSettings()));
 app.get('/api/admin/monitor',async(_req,res)=>res.json(await readMonitor()));
 app.put('/api/admin/settings',(req,res)=>{const settings=store.setSettings(req.body);store.audit(req.user.username,'settings-update','system',{fields:Object.keys(req.body)});res.json(settings);});
 app.get('/api/admin/state',(_req,res)=>res.json({users:store.listUsers().map(u=>({...u,meterNodes:store.db.prepare('SELECT node_id FROM meter_allowlist WHERE user_id=?').all(u.id).map(n=>n.node_id)})),nodes:store.inventory(),meterNodes:store.meter.nodes()}));
 app.get('/api/admin/audit',(req,res)=>res.json(store.auditPage(req.query.cursor)));
 app.get('/api/admin/usage',(_req,res)=>res.json({users:store.meter.users(),nodes:store.meter.nodes()}));
 app.get('/api/admin/nodes/status',(_req,res)=>res.json({nodes:store.health.nodes(),checkIntervalMinutes:store.getSettings().healthCheckMinutes}));
 app.get('/api/admin/usage/users/:id',(req,res)=>{const u=store.getUser(req.params.id);if(!u||u.role!=='user')return res.sendStatus(404);res.json({id:u.id,username:u.username,displayName:u.display_name,...store.meter.usage(u.id)});});
 app.get('/api/admin/usage/users/:id/activity-summary',(req,res)=>{
  const u=store.getUser(req.params.id);if(!u||u.role!=='user')return res.sendStatus(404);
  res.json({username:u.username,actual:store.flows.summary(u.id,req.query)});
 });
 app.get('/api/admin/usage/users/:id/sources',(req,res)=>res.json(store.activity.sources(req.params.id,req.query)));
 app.post('/api/admin/usage/users/:id/ip-location',async(req,res)=>res.json(await store.ipLocation.lookup(req.params.id,req.body?.ip)));
 app.get('/api/admin/usage/nodes/:id',(req,res)=>{const data=store.meter.nodeUsage(req.params.id);if(!data)return res.sendStatus(404);res.json(data);});
 app.post('/api/admin/meter/users/:id/enroll',(req,res)=>{try{store.meter.allowUser(req.body?.nodeId,req.params.id);store.audit(req.user.username,'meter-enroll',req.params.id);res.json({ok:true});}catch{res.status(400).json({error:'用户或节点授权无效'});}});
 app.post('/api/admin/users',async(req,res)=>{
  if(!checkGrants(req.body?.grants))return res.status(400).json({error:'节点权限无效'});
  if(typeof req.body?.username!=='string')return res.status(400).json({error:'账号格式无效'});
  if(store.findUser(req.body.username))return res.status(409).json({error:'账号已存在'});
  if(!throttle(req,res,'admin-write',req.user.id))return;
  try{const id=await store.createUser(req.body?.username,req.body?.password,req.body.grants,'user',req.body);store.audit(req.user.username,'user-create',id);res.status(201).json({id});}finally{guard.release();}
 });
 app.put('/api/admin/users/:id',(req,res)=>{
  const u=store.getUser(req.params.id);if(!u||u.role==='admin')return res.status(400).json({error:'只能修改普通用户'});
  if(typeof req.body?.enabled!=='boolean'||!checkGrants(req.body.grants))return res.status(400).json({error:'权限数据无效'});
  store.updateUser(u.id,req.body);store.audit(req.user.username,'user-access',u.id,{fields:Object.keys(req.body).filter(k=>k!=='password')});res.json({ok:true});
 });
 app.post('/api/admin/users/:id/password',async(req,res)=>{
  const u=store.getUser(req.params.id);if(!u||u.role==='admin')return res.status(400).json({error:'只能重置普通用户'});
  if(!throttle(req,res,'admin-write',req.user.id))return;
  try{await store.setPassword(u.id,req.body?.password);store.requirePasswordChange(u.id);store.audit(req.user.username,'password-reset',u.id);res.json({ok:true});}finally{guard.release();}
 });
 app.put('/api/admin/source',(req,res)=>{
  try{store.importSource(req.body?.yaml);}catch{return res.status(400).json({error:'配置无效：请检查节点、策略组和文件大小，未保存任何更改'});}
  store.audit(req.user.username,'source-import','configuration');res.json({ok:true,nodes:store.inventory()});
 });
 app.use('/api',(_req,res)=>res.status(404).json({error:'接口不存在'}));
 // Only this directory is public; DB, source YAML and code are never served.
 app.use(express.static(publicDir,{index:'index.html',dotfiles:'deny',cacheControl:false,setHeaders:(res,file)=>{if(/\.(?:js|css|svg)$/.test(file))res.setHeader('Cache-Control','private, no-cache');}}));
 app.use((_req,res)=>res.status(404).send('页面不存在'));
 app.use((err,_req,res,_next)=>{if(res.headersSent)return res.end();const known=err.statusCode===400||err.statusCode===409||/密码需为|账号需为/.test(err.message);res.status(known?(err.statusCode===409?409:400):err.type==='entity.too.large'?413:err.type==='entity.parse.failed'?400:500).json({error:known?err.message:'请求未完成，请检查输入或联系管理员'});});
 return app;
}
