import {UI_REFRESH_SECONDS,DISPLAY_ALLOWANCE_BYTES} from '/policy.js';
import {createAdminUI} from '/admin.js';
import {pointerMotion,revealPanel,revealView} from '/motion.js';
import {CLIENTS,detectPlatform,clientImport} from '/client-imports.js';
import {createGuideUI} from '/guide-ui.js';
import {createRulesUI} from '/rules-ui.js';
import {createAccountSourcesUI} from '/source-ui.js';
import {nodePresentation,nodeTitle,renderNodeGroups,displayNodeName} from '/node-model.js';
const $=selector=>document.querySelector(selector);
let me=null,adminState=null,adminUsage=null,timer=null,currentPanel='dashboard',usageTask=null,lastUsageAt=0,shownView='';
let realm={adminInterface:false,policy:{uiRefreshSeconds:UI_REFRESH_SECONDS}};
let lastHealth=null;
const rendered=new Map();
function changed(key,value){const next=JSON.stringify(value);if(rendered.get(key)===next)return false;rendered.set(key,next);return true;}
const routes={
 user:[['工作台','dashboard','仪表盘','dashboard'],['工作台','subscription','我的订阅','subscription'],['工作台','connections','节点状态','nodes'],['工作台','usage','流量明细','traffic'],['使用与账户','knowledge','使用文档','knowledge'],['使用与账户','account','个人中心','account']],
 admin:[['概览','dashboard','仪表盘','dashboard'],['用户与流量','accounts','用户管理','users'],['用户与流量','traffic','流量统计','traffic'],['连接管理','nodes','节点管理','nodes'],['连接管理','rules','规则管理','subscription'],['系统','settings','系统设置','settings'],['系统','audit','操作日志','audit']]
};
const tell=(message,type='success')=>{if(window.portalToast){$('#status').textContent='';window.portalToast[type](message);}else $('#status').textContent=message;};
const error=message=>tell(message,'error');
const rulesUI=createRulesUI({api,node,tell,getUsers:()=>adminState?.users.filter(user=>user.role==='user')||[],getPanel:()=>currentPanel,onUnauthorized:()=>{dropSession();tell('登录已过期，请重新登录。','info');}});
const kindName=kind=>({direct:'自建入口',forwarded:'SG2 → Glasgow · TCP',relay:'Jetson → 第三方','direct-unmetered':'直连第三方 · 不计量',unmanaged:'未接入计量'}[kind]||'受管入口');
const time=value=>value?new Date(value).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}):'等待首次采样';
const total=value=>bytes((value?.up||0)+(value?.down||0));
function bytes(value){if(value<1024)return value+' B';const units=['KB','MB','GB','TB'];let n=value/1024,i=0;while(n>=1024&&i<3){n/=1024;i++;}return n.toFixed(2)+' '+units[i];}
function node(tag,text,className){const el=document.createElement(tag);if(text!==undefined)el.textContent=text;if(className)el.className=className;return el;}
const icon=name=>window.portalIcon?.(name)||node('span');
const detectedPlatform=detectPlatform(navigator);let selectedClient=detectedPlatform==='ios'?'shadowrocket':detectedPlatform==='android'?'clash-meta':'clash-verge';
try{const saved=localStorage.getItem('kenxu-client');if(Object.hasOwn(CLIENTS,saved))selectedClient=saved;}catch{}
const guideUI=createGuideUI({root:$('#user-view [data-panel="knowledge"]'),reveal:revealPanel,onImport:client=>{if(!Object.hasOwn(CLIENTS,client))return;selectedClient=client;try{localStorage.setItem('kenxu-client',client);}catch{}updateDelivery();selectPanel('subscription',{focus:true});tell('已选择 '+CLIENTS[client].name+'，请在客户端确认导入。','info');}});
function guidePlatform(platform){guideUI.select(platform,{client:selectedClient});}
function updateDelivery(){
 const choice=$('#client-choice');choice.value=selectedClient;guidePlatform(CLIENTS[selectedClient].platform);
 const link=$('#import-clash');link.replaceChildren(icon('subscription'),node('span','导入 '+CLIENTS[selectedClient].name));
 $('#subscription-kind').textContent=CLIENTS[selectedClient].kind+'链接';
 $('#client-import-note').textContent=selectedClient==='shadowrocket'?'这个节点订阅供 Shadowrocket 使用，不包含 Clash 策略组和分流规则。请选择节点并使用客户端的路由设置。':selectedClient==='stash'?'这份 iOS YAML 保留授权节点、策略组和域名分流；已调整负载均衡策略并省略电脑进程规则，DNS 使用 Stash 设置。':'这份 YAML 包含已授权线路与策略组。请在客户端确认导入、选中配置，然后启动连接。';
 $('#download').hidden=selectedClient==='shadowrocket';$('#download').href=selectedClient==='stash'?'/api/config?format=stash':'/api/config';
 if(!me?.subscriptionUrl||me.mustChange){link.removeAttribute('href');$('#subscription').value='';return;}
 const delivery=clientImport(me.subscriptionUrl,selectedClient,realm.policy.subscriptionMinutes);link.href=delivery.scheme;$('#subscription').value=delivery.remote;$('#subscription').type='password';$('#show-sub').textContent='显示';$('#show-sub').setAttribute('aria-pressed','false');
}
const adminUI=createAdminUI({api,node,bytes,time,tell,reload:load,getState:()=>adminState,getPanel:()=>currentPanel});
const accountSources=createAccountSourcesUI({api,node,time});
function applyRealm(info){realm=info;document.body.classList.toggle('admin-shell',info.adminInterface);for(const span of document.querySelectorAll('.brand>span'))span.textContent=info.title;document.title=info.adminInterface?info.title+' · 私有管理后台':info.title;$('#release-version').textContent=info.version?'v'+info.version:'';
 document.body.classList.toggle('user-shell',!info.adminInterface);
 for(const f of ['#password-form','#user-form','#reset-form'])$(f).elements.password.minLength=info.policy.minPasswordLength;
 $('.password-card>p.muted').textContent='至少 '+info.policy.minPasswordLength+' 个字符。保存后重新登录，旧订阅链接失效。';
 const periodLabel=document.querySelector('.plan-meta span:last-child b');if(periodLabel)periodLabel.textContent=info.policy.subscriptionMinutes+' 分钟';
 const recommendation=document.querySelector('#delivery .notice.subtle');if(recommendation)recommendation.textContent='订阅建议每 '+info.policy.subscriptionMinutes+' 分钟更新。已有配置若手动保存了其他间隔，请在客户端「编辑信息」中修改。';
 if(info.adminInterface){$('.intro h1').textContent=info.title;$('.intro>p').textContent='账号、节点、用量与系统运行。私有入口，仅限管理员。';$('.login-card h2').textContent='管理员登录';$('#login-form button').textContent='登录管理后台';$('#invite-badge').textContent='私有管理入口';}
}
let menuTransition;
function mobileMenu(open,focus=true){
 if(open&&!matchMedia('(max-width:850px)').matches)return;
 clearTimeout(menuTransition);const animate=focus&&pointerMotion();document.body.classList.toggle('menu-animating',animate);if(animate)menuTransition=setTimeout(()=>document.body.classList.remove('menu-animating'),240);
 document.body.classList.toggle('nav-open',open);$('#menu-backdrop').hidden=!open;$('#menu-toggle').setAttribute('aria-expanded',String(open));
 $('#content').inert=open;document.querySelector('.topbar').inert=open;
 if(open){$('#sidebar').setAttribute('role','dialog');$('#sidebar').setAttribute('aria-modal','true');$('#section-nav button').focus();}
 else{$('#sidebar').removeAttribute('role');$('#sidebar').removeAttribute('aria-modal');if(focus)$('#menu-toggle').focus();}
}
function selectPanel(id,{focus=false}={}){
 if(!me||me.mustChange)return;const entry=routes[me.role].find(r=>r[1]===id);if(!entry)return;
 const changed=currentPanel!==id;currentPanel=id;show(me.role==='admin'?'admin-view':'user-view');
 for(const panel of document.querySelectorAll('#user-view [data-panel],#admin-view [data-panel]'))panel.hidden=panel.dataset.panel!==id;
 for(const b of $('#section-nav').querySelectorAll('button'))b.setAttribute('aria-current',b.dataset.panel===id?'page':'false');
 $('#page-heading').textContent=entry[2];document.title=entry[2]+' · '+realm.title+(realm.adminInterface?' · Admin':'');
 if(location.hash!=='#'+id)history.replaceState(null,'','#'+id);
 mobileMenu(false,false);if(focus)$('#page-heading').focus();
 if(me.role==='admin'){adminUI.onPanel(id);rulesUI.onPanel(id);}
 else accountSources.onPanel(id);
 window.portalCharts?.render();
 if(focus&&changed){if(me.role==='user')revealPanel($('#user-view [data-panel="'+id+'"]'));window.scrollTo({top:0,behavior:'instant'});}
}
function navigation(){
 let group;const entries=routes[me.role],parts=[];
 for(const [category,id,title,glyph]of entries){if(category!==group){parts.push(node('p',category,'nav-group'));group=category;}const b=node('button',undefined,'nav-button');b.dataset.panel=id;b.append(icon(glyph),node('span',title));b.onclick=()=>selectPanel(id,{focus:true});parts.push(b);}
 $('#section-nav').replaceChildren(...parts);
 const requested=location.hash.slice(1);selectPanel(entries.some(e=>e[1]===requested)?requested:entries.some(e=>e[1]===currentPanel)?currentPanel:'dashboard');
}
function resetUsage(){
 rendered.clear();
 $('#password-form').reset();
 guideUI.reset();
 for(const id of ['usage-today','usage-month','usage-total','plan-used','plan-percent','period-label','reset-date','admin-month-up','admin-month-down','admin-today','admin-total','fresh-routes'])$('#'+id).textContent='—';
 $('#plan-progress').value=0;$('#page-sync').textContent='';$('#usage-sync').textContent='读取中';$('#admin-usage-sync').textContent='读取中';
 for(const id of ['node-list','usage-routes','users-list','admin-usage-list','admin-nodes','audit-list','daily-list'])$('#'+id).replaceChildren();
 adminUsage=null;lastUsageAt=0;
 lastHealth=null;for(const id of ['nodes-normal','nodes-failed'])$('#'+id).textContent='—';
 $('#dashboard-nodes').textContent='—';$('#dashboard-nodes-note').textContent='查看节点状态';$('#plan-name').textContent='好友共享';
 window.portalCharts?.clear();
 $('#import-clash').removeAttribute('href');$('#subscription').value='';
 adminUI.reset();
 accountSources.reset();
 rulesUI.reset();
 for(const id of ['welcome-name','account-name','account-last-use-ip','identity','node-count'])$('#'+id).textContent='';
}
function dropSession(){clearInterval(timer);me=null;adminState=null;resetUsage();$('#subscription').value='';$('#import-clash').removeAttribute('href');$('#identity').hidden=true;$('#logout').hidden=true;mobileMenu(false,false);show('login-view');}
function routeCard(n,r,{admin=false}={}){
 const card=node(admin?'div':'li',undefined,'route-card'),top=node('div',undefined,'route-top'),info=node('div');
 const presentation=nodePresentation(n,r);info.append(nodeTitle(n,{node}),node('small',kindName(presentation.kind),'route-kind'));
 const h=lastHealth?.nodes.find(h=>h.id===n.id),healthLabels={normal:'正常',failed:'异常',pending:'待检测',stale:'待更新',unsupported:'暂不支持'};
 const unmetered=presentation.kind==='direct-unmetered',online=admin?(unmetered?h?.status==='normal':!!r?.enabled&&r.last_seen>Date.now()-90000):h?.status==='normal',status=admin?(unmetered?'直连 · 未计量':!r?'未计量':online?'采集正常':'采集暂离线'):healthLabels[h?.status||'pending'];
 top.append(info,node('span',status,'chip '+(online?'online':h?.status==='failed'?'failed':'pending')));card.append(top);
 const split=h?.latencyMetric==='http-response-v2',measured=h?.status==='normal'&&Number.isFinite(h.latency),values=node('div',undefined,'node-metrics');
 for(const [label,value]of [[split?'HTTP 响应':'全程检测',measured?h.latency+' ms':'—'],[admin?'连接准备':'本月用量',admin?measured&&split?h.setupMs+' ms':'—':r?total(r.month):'—']]){const item=node('span',label);item.append(node('strong',value));values.append(item);}card.append(values);
 if(measured&&split){const details=node('details',undefined,'latency-breakdown');details.append(node('summary','查看检测耗时'),node('p',`连接准备 ${h.setupMs} ms · HTTP 响应 ${h.latency} ms · 全程 ${h.totalMs} ms`));details.append(node('p','Jetson → 节点 → '+(h.target==='gstatic-204'?'Gstatic 204':'Cloudflare trace')+'。HTTP 响应不含 DNS、代理和 TLS 建链；不是 ICMP ping，也不是你本机的测速结果。','fine'));card.append(details);}
 if(!admin){const strip=node('div',undefined,'status-strip');strip.setAttribute('aria-label','最近连接检测结果');for(const sample of h?.history.slice(-24)||[]){const bar=node('span',undefined,sample.status);bar.title=time(sample.at)+' · '+(healthLabels[sample.status]||sample.status);strip.append(bar);}if(!strip.children.length)strip.append(node('span',undefined,'pending'));card.append(strip);}
 card.append(node('p',unmetered?((n.userHidden||r?.user_hidden?'用户端隐藏 · ':'')+'直连出口未计量'+(r?' · 已保留旧记录':'')):(admin?'最近采样 · ':'Jetson 检测 · ')+time(admin?r?.last_seen:h?.checkedAt),'fine'));return card;
}
function renderDaily(rows){
 if(!changed('daily',rows))return;
 $('#daily-list').replaceChildren(...[...rows].reverse().map(r=>{const tr=node('tr');for(const value of [r.date,bytes(r.up),bytes(r.down),total(r)])tr.append(node('td',value));return tr;}));
}
function renderTraffic(){
 if(!adminUsage)return;const term=$('#traffic-search').value.toLowerCase();
 const users=adminUsage.users.filter(u=>u.username.toLowerCase().includes(term));
 $('#admin-usage-list').replaceChildren(...users.map(u=>{const row=node('div',undefined,'user-row'),info=node('div');
 info.append(node('strong',u.username),node('small',!u.enabled?'已停用 · 保留历史':u.routes.length?u.routes.some(r=>r.online&&r.synced)?'采集正常':'等待同步或采集':'尚未接入计量'));
 const values=node('div',undefined,'usage-line');for(const [label,value]of [['今天',u.today],['本月',u.month],['累计',u.total]]){const item=node('span',label);item.append(node('b',u.routes.length?total(value):'—'));values.append(item);}const actions=node('div',undefined,'actions');actions.append(adminUI.userUsageButton(u.id));row.append(info,values,actions);return row;}));
 if(!users.length)$('#admin-usage-list').append(node('p','暂无匹配的用量记录。','muted'));
}
function renderUsage(data){
 window.portalCharts?.update(data,lastHealth,me.role);
 $('#page-sync').textContent='更新于 '+new Date().toLocaleTimeString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false});
 if(me.role==='admin'){
  adminUsage=data;renderTraffic();$('#admin-usage-sync').textContent='每 '+realm.policy.uiRefreshSeconds+' 秒刷新';$('#admin-sync').textContent='每 '+realm.policy.uiRefreshSeconds+' 秒刷新';
  const sum=field=>data.users.reduce((r,u)=>({up:r.up+u[field].up,down:r.down+u[field].down}),{up:0,down:0});
  const month=sum('month');$('#admin-month-up').textContent=bytes(month.up);$('#admin-month-down').textContent=bytes(month.down);$('#admin-today').textContent=total(sum('today'));$('#admin-total').textContent=total(sum('total'));
  const activeNodes=data.nodes.filter(n=>n.enabled);
  $('#fresh-routes').textContent=activeNodes.filter(n=>n.last_seen>Date.now()-90000).length+' / '+activeNodes.length;
  $('#collectors-stat').textContent=new Set(activeNodes.map(n=>n.agent_id)).size+' 个采集器';
  renderNodeGroups($('#admin-nodes'),adminState.nodes,n=>{const m=data.nodes.find(m=>m.proxy_id===n.id),card=routeCard(n,m,{admin:true});if(m)adminUI.addNodeAmounts(card,m,data);return card;},{node});adminUI.onUsage();
 }else{
  const normal=lastHealth?.nodes.filter(n=>n.status==='normal').length;$('#nodes-normal').textContent=normal??'—';$('#nodes-failed').textContent=lastHealth?.nodes.filter(n=>n.status==='failed').length??'—';$('#nodes-check-description').textContent='由 Jetson 验证连接，每 '+(lastHealth?.checkIntervalMinutes||15)+' 分钟检测一次';$('#dashboard-nodes').textContent=normal===undefined?'—':normal+' / '+me.nodes.length;$('#dashboard-nodes-note').textContent=normal===undefined?'等待检测结果':'正常 / 已分配';
  const connected=data.routes.length>0,used=data.month.up+data.month.down,quota=data.allowance?.bytes||DISPLAY_ALLOWANCE_BYTES;
  for(const [id,value]of [['usage-today',data.today],['usage-month',data.month],['usage-total',data.total]])$('#'+id).textContent=connected?total(value):'—';
  $('#plan-used').textContent=connected?bytes(used):'—';$('#plan-percent').textContent=connected?(used/quota*100).toFixed(1)+'%':'未接入计量';$('#plan-progress').value=connected?Math.min(100,used/quota*100):0;
  $('#plan-quota').textContent='/ '+bytes(quota);
  $('#plan-progress').setAttribute('aria-valuetext',connected?(used/quota*100).toFixed(1)+'%，仅展示、不限制使用':'尚未接入计量');
  $('#period-label').textContent=data.period.label;$('#reset-date').textContent=new Date(data.period.end).toLocaleDateString('zh-CN',{timeZone:'Asia/Shanghai'});
  $('#allowance-note').textContent=used>quota?'已超过展示额度，仍可继续使用。':'额度仅供参考，不限制使用。';
  $('#account-allowance').textContent=bytes(quota)+' / 月';$('#account-subscription-interval').textContent=realm.policy.subscriptionMinutes+' 分钟';
  $('#usage-sync').textContent=!connected?'尚未接入计量':data.routes.some(r=>r.assigned&&r.online&&r.synced)?'采集正常 · 每 '+data.uiRefreshIntervalSeconds+' 秒刷新':'等待同步 · 保留历史';
  if(changed('nodes',[me.nodes,lastHealth?.nodes,data.routes.map(r=>({id:r.id,month:r.month,kind:r.kind}))])){renderNodeGroups($('#node-list'),me.nodes,n=>routeCard(n,data.routes.find(r=>r.id===n.id)),{node,list:true});if(!me.nodes.length)$('#node-list').append(node('p','尚未分配线路，请联系 Donson。','notice'));}
  const history=data.routes.filter(r=>!r.assigned);$('#history-section').hidden=!history.length;
  if(changed('history',history.map(r=>({name:r.name,up:r.up,down:r.down}))))$('#usage-routes').replaceChildren(...history.map(r=>{const item=node('li'),details=node('span');details.append(node('strong',displayNodeName(r.name)),node('small','当前未授权'));item.append(details,node('span',total(r)));return item;}));
  renderDaily(data.daily);
 }
}
async function refreshUsage({force=false,propagate=false}={}){
 if(!me||me.mustChange)return;const identity=me;
 if(usageTask?.identity===identity){try{return await usageTask.promise;}catch(err){if(propagate)throw err;return;}}
 if(!force&&Date.now()-lastUsageAt<(realm.policy.uiRefreshSeconds||UI_REFRESH_SECONDS)*1000)return;
 const task={identity};
 task.promise=(async()=>{try{
  const [data,health,profile]=await Promise.all([api(identity.role==='admin'?'/api/admin/usage':'/api/usage'),api(identity.role==='admin'?'/api/admin/nodes/status':'/api/nodes/status').catch(()=>null),identity.role==='user'?api('/api/me'):null]);
  if(me!==identity)return;
  if(profile){
   const deliveryChanged=identity.subscriptionUrl!==profile.subscriptionUrl;
   Object.assign(identity,profile);$('#account-last-use-ip').textContent=profile.lastUseIp||'暂无使用记录';const ids=new Set(profile.nodes.map(n=>n.id));if(health)health.nodes=health.nodes.filter(n=>ids.has(n.id));
   $('#welcome-name').textContent=me.displayName||me.username;$('#account-name').textContent=me.username;$('#identity').textContent=me.username;$('#plan-name').textContent=me.planName||'好友共享';$('#node-count').textContent=me.nodes.length+' 条线路';
   $('#empty-grants').hidden=!!me.nodes.length;$('#delivery').hidden=!me.nodes.length;if(deliveryChanged)updateDelivery();
  }
  lastHealth=health;renderUsage(data);lastUsageAt=Date.now();
 }catch(err){if(me===identity){if(err.status===401){dropSession();tell('登录已过期，请重新登录。','info');}else{$(identity.role==='admin'?'#admin-usage-sync':'#usage-sync').textContent='更新失败 · 数据可能过期';$('#page-sync').textContent='等待重新连接';}}throw err;}
 finally{if(usageTask===task)usageTask=null;}})();usageTask=task;try{return await task.promise;}catch(err){if(propagate)throw err;}
}
async function api(url,{method='GET',body}={}){
 let response;try{response=await fetch(url,{method,mode:'same-origin',referrerPolicy:'same-origin',headers:{...(body?{'Content-Type':'application/json'}:{}),...(me?.csrf?{'X-CSRF-Token':me.csrf}:{})},body:body?JSON.stringify(body):undefined,credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(15000)});}catch(err){throw Error(err.name==='TimeoutError'?'请求超时，请稍后重试。':'网络暂不可用，请稍后重试。');}
 let data;try{data=await response.json();}catch{throw Error('无法读取服务器响应，请稍后重试。');}
 if(!response.ok){const failure=Error(data.error||'请求失败');failure.status=response.status;failure.retryAfter=Number(data.retryAfter||response.headers.get('Retry-After'))||0;throw failure;}return data;
}
function show(view){
 const changed=shownView!==view;shownView=view;
 for(const id of ['login-view','user-view','admin-view','password-view'])$('#'+id).hidden=id!==view;
 const authenticated=!!me&&!me.mustChange;document.body.classList.toggle('guest',!authenticated);$('#workspace-nav').hidden=!authenticated;
 for(const id of ['page-heading','menu-toggle','refresh','header-password'])$('#'+id).hidden=!authenticated;
 if(changed&&!document.body.classList.contains('booting')&&!realm.adminInterface)revealView($('#'+view));
}
async function load(){
 clearInterval(timer);
 const [info,next]=await Promise.all([api('/api/interface'),api('/api/me').catch(err=>{if(err.status!==401)throw err;return null;})]);applyRealm(info);
 me=next;resetUsage();$('#identity').hidden=!me;$('#logout').hidden=!me;$('#invite-badge').hidden=!!me;
 if(!me){currentPanel='dashboard';adminState=null;$('#subscription').value='';$('#import-clash').removeAttribute('href');mobileMenu(false,false);history.replaceState(null,'',location.pathname);show('login-view');return;}
 $('#identity').textContent=me.username;
 if(me.mustChange){$('#password-title').textContent='首次登录，请修改初始密码';$('#password-back').hidden=true;show('password-view');return;}
 show(me.role==='admin'?'admin-view':'user-view');navigation();
 if(me.role==='admin'){await loadAdmin();}else{
  $('#welcome-name').textContent=me.displayName||me.username;$('#account-name').textContent=me.username;$('#plan-name').textContent=me.planName||'好友共享';$('#node-count').textContent=me.nodes.length+' 条线路';
  $('#empty-grants').hidden=!!me.nodes.length;$('#delivery').hidden=!me.nodes.length;$('#subscription').value=me.subscriptionUrl||'';$('#subscription').type='password';$('#show-sub').textContent='显示';$('#show-sub').setAttribute('aria-pressed','false');
  updateDelivery();
  renderNodeGroups($('#node-list'),me.nodes,n=>routeCard(n),{node,list:true});
 }
 await refreshUsage({force:true});timer=setInterval(()=>{if(!document.hidden)refreshUsage();},(realm.policy.uiRefreshSeconds||UI_REFRESH_SECONDS)*1000);
}
async function loadAdmin(){
 $('#new-user').disabled=true;const identity=me,[state,settings]=await Promise.all([api('/api/admin/state'),api('/api/admin/settings')]);if(me!==identity)return;adminState=state;adminUI.setSettings(settings);$('#new-user').disabled=false;const users=adminState.users.filter(u=>u.role==='user');
 $('#users-stat').textContent=users.length;$('#active-users-stat').textContent=users.filter(u=>u.active).length+' 个可用';$('#nodes-stat').textContent=adminState.nodes.length;renderUsers();rulesUI.syncUsers();
}
function renderUsers(){
 const term=$('#search-users').value.toLowerCase(),filter=$('#user-filter').value;
 const users=adminState.users.filter(u=>u.role==='user'&&u.username.toLowerCase().includes(term)&&(filter==='all'||filter==='enabled'&&u.enabled||filter==='disabled'&&!u.enabled)).sort((a,b)=>b.enabled-a.enabled);
 $('#users-list').replaceChildren(...users.map(u=>{
  const row=node('div',undefined,'user-row'),info=node('div');info.append(node('strong',u.display_name?u.display_name+' · '+u.username:u.username),node('small',(!u.enabled?'已停用':u.active?'允许领取':'已到期')+' · '+u.grants.filter(id=>adminState.nodes.some(n=>n.id===id)).length+' 条线路'+(u.must_change?' · 待改初始密码':'')+(u.email?' · '+u.email:'')));
  const buttons=node('div',undefined,'actions'),edit=node('button','编辑账号','secondary'),reset=node('button','重置密码','quiet');
  edit.onclick=()=>editUser(u);reset.onclick=()=>{const f=$('#reset-form');f.reset();f.elements.id.value=u.id;$('#reset-title').textContent='重置密码 · '+u.username;$('#reset-status').textContent='';$('#reset-dialog').showModal();};
  const rules=node('button','配置规则','secondary');rules.onclick=()=>{selectPanel('rules',{focus:true});rulesUI.openUser(u.id);};buttons.append(edit,rules,adminUI.userUsageButton(u.id),reset);row.append(info,buttons);return row;
 }));
 if(!users.length)$('#users-list').append(node('p','没有匹配的账号。','muted'));
}
function editUser(u){
 const f=$('#user-form');f.reset();f.elements.id.value=u?.id||'';f.elements.username.value=u?.username||'';f.elements.username.disabled=false;f.elements.enabled.checked=u?!!u.enabled:true;f.elements.password.required=!u;adminUI.profileToForm(u);
 $('#initial-password-label').hidden=!!u;$('#dialog-title').textContent=u?'编辑账号 · '+u.username:'创建账号';$('#dialog-status').textContent='';
 $('#grant-options').replaceChildren(...adminState.nodes.map(n=>{const label=node('label',undefined,'check grant-option'),input=node('input');input.type='checkbox';input.name='grant';input.value=n.id;input.setAttribute('aria-label',displayNodeName(n.name));input.checked=!!u?.grants.includes(n.id);const kind=nodePresentation(n,adminState.meterNodes.find(m=>m.proxy_id===n.id)).kind;label.append(input,nodeTitle(n,{node}),node('small',kindName(kind),'chip'));return label;}));$('#user-dialog').showModal();
}
function handleForm(selector,work,errorTarget='#status'){
 const form=$(selector);form.addEventListener('submit',async e=>{e.preventDefault();const button=form.querySelector('button[type="submit"],button.primary,button.secondary');if(button.disabled)return;
 const label=button.textContent;let cooldown=0;button.disabled=true;button.textContent='处理中…';$(errorTarget).textContent='';
 try{await work(form);}catch(err){cooldown=err.status===429?Math.min(900,Math.max(1,err.retryAfter||3)):0;$(errorTarget).textContent=err.message;if(!form.closest('dialog[open]'))error(err.message);}finally{button.disabled=false;button.textContent=label;if(cooldown){const deadline=Date.now()+cooldown*1000;button.disabled=true;const tick=()=>{const remaining=Math.max(0,Math.ceil((deadline-Date.now())/1000));button.textContent=remaining?'请等待 '+remaining+' 秒':label;if(!remaining){button.disabled=false;clearInterval(interval);}};const interval=setInterval(tick,1000);tick();}}});
}
handleForm('#login-form',async f=>{await api('/api/login',{method:'POST',body:{username:f.elements.username.value,password:f.elements.password.value}});f.reset();await load();});
handleForm('#password-form',async f=>{if(f.elements.password.value!==f.elements.confirm.value)throw Error('两次新密码不一致');await api('/api/password',{method:'POST',body:{currentPassword:f.elements.currentPassword.value,password:f.elements.password.value}});f.reset();dropSession();tell('密码已更新，请重新登录。');});
handleForm('#user-form',async f=>{
 const body=adminUI.profileBody(f),id=f.elements.id.value;
 if(id)await api('/api/admin/users/'+id,{method:'PUT',body});
 else await api('/api/admin/users',{method:'POST',body:{...body,password:f.elements.password.value}});
 f.reset();$('#user-dialog').close();await loadAdmin();await refreshUsage({force:true});tell('账号已保存。权限约 30 秒生效，请让用户更新订阅。');
},'#dialog-status');
handleForm('#reset-form',async f=>{await api('/api/admin/users/'+f.elements.id.value+'/password',{method:'POST',body:{password:f.elements.password.value}});f.reset();$('#reset-dialog').close();await loadAdmin();tell('密码已重置，旧会话和订阅链接已失效。');},'#reset-status');
handleForm('#import-form',async f=>{const file=$('#source-file').files[0];if(!file||file.size>524288)throw Error('请选择不超过 512 KiB 的 YAML');await api('/api/admin/source',{method:'PUT',body:{yaml:await file.text()}});f.reset();await loadAdmin();await refreshUsage({force:true});tell('配置源已更新，请检查授权与中转上游配置。');});
async function action(button,work,messages){if(button.disabled)return;button.disabled=true;const operation=Promise.resolve().then(work);window.portalToast?.promise(operation,messages);try{await operation;if(!window.portalToast)tell(messages.success);}catch(err){if(!window.portalToast)error(err.message);}finally{button.disabled=false;}}
$('#logout').onclick=()=>action($('#logout'),async()=>{await api('/api/logout',{method:'POST'});dropSession();},{loading:'正在退出…',success:'已退出登录',error:e=>e.message});
let copyReset;
$('#copy-sub').onclick=async()=>{if(!me?.subscriptionUrl||me.mustChange)return;try{await navigator.clipboard.writeText($('#subscription').value);const button=$('#copy-sub');button.classList.add('copied');button.replaceChildren(icon('check'),node('span','已复制'));clearTimeout(copyReset);copyReset=setTimeout(()=>{button.classList.remove('copied');button.replaceChildren(icon('copy'),node('span','复制订阅链接'));},1800);tell('订阅链接已复制，请勿转发。');}catch{$('#subscription').type='text';$('#subscription').select();$('#show-sub').textContent='隐藏';$('#show-sub').setAttribute('aria-pressed','true');tell('已展开链接，请手动复制。','info');}};
$('#client-choice').onchange=event=>{selectedClient=event.target.value;try{localStorage.setItem('kenxu-client',selectedClient);}catch{}updateDelivery();};
$('#import-clash').addEventListener('click',event=>{if(!me?.subscriptionUrl||me.mustChange){event.preventDefault();return;}tell('请在客户端确认导入；未打开时可复制链接手动添加。','info');});
guidePlatform(CLIENTS[selectedClient].platform);
$('#show-sub').onclick=()=>{const visible=$('#subscription').type==='password';$('#subscription').type=visible?'text':'password';$('#show-sub').textContent=visible?'隐藏':'显示';$('#show-sub').setAttribute('aria-pressed',String(visible));};
$('#rotate-sub').onclick=()=>{if(!confirm('重置后旧订阅链接立即失效，已下载的节点凭据不变。继续吗？'))return;action($('#rotate-sub'),async()=>{await api('/api/subscription/rotate',{method:'POST'});await load();},{loading:'正在重置…',success:'订阅已重置，请替换客户端中的链接。',error:e=>e.message});};
$('#refresh').onclick=()=>action($('#refresh'),async()=>{if(me.role==='admin')await loadAdmin();await refreshUsage({force:true,propagate:true});},{loading:'正在刷新…',success:'数据已更新',error:e=>e.message});
$('#new-user').onclick=()=>editUser();$('#close-dialog').onclick=()=>$('#user-dialog').close();$('#close-reset').onclick=()=>$('#reset-dialog').close();
$('#search-users').oninput=renderUsers;$('#user-filter').onchange=renderUsers;$('#traffic-search').oninput=renderTraffic;
function passwordView(){$('#password-form').reset();$('#password-title').textContent='修改我的密码';$('#password-back').hidden=false;show('password-view');$('#page-heading').textContent='修改密码';$('#password-form input').focus();}
$('#open-password').onclick=passwordView;$('#header-password').onclick=passwordView;$('#password-back').onclick=()=>{$('#password-form').reset();selectPanel(me.role==='admin'?'dashboard':'account');};
for(const [id,form,status]of [['user-dialog','user-form','dialog-status'],['reset-dialog','reset-form','reset-status']])$('#'+id).addEventListener('close',()=>{$('#'+form).reset();$('#'+status).textContent='';});
document.addEventListener('click',event=>{const b=event.target.closest('[data-go]');if(b)selectPanel(b.dataset.go,{focus:true});});
$('#menu-toggle').onclick=()=>mobileMenu(true);$('#close-menu').onclick=()=>mobileMenu(false);$('#menu-backdrop').onclick=()=>mobileMenu(false);
document.addEventListener('keydown',event=>{if(!document.body.classList.contains('nav-open'))return;if(event.key==='Escape'){mobileMenu(false);return;}if(event.key==='Tab'){const targets=[...$('#sidebar').querySelectorAll('a,button')].filter(x=>x.getClientRects().length),first=targets[0],last=targets.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}}});
matchMedia('(max-width:850px)').addEventListener('change',()=>mobileMenu(false,false));
window.addEventListener('hashchange',()=>selectPanel(location.hash.slice(1)));
document.addEventListener('visibilitychange',()=>{if(!document.hidden)refreshUsage();});
window.addEventListener('pageshow',event=>{if(event.persisted){dropSession();load().catch(e=>error(e.message));}});
load().catch(e=>error(e.message)).finally(()=>{document.body.classList.remove('booting');if(!me&&!realm.adminInterface)revealView($('#login-view'),{initial:true});});
