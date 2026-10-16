const STATUS={operational:'官方正常','no-incident':'未报告进行中故障',degraded:'官方有事件',outage:'官方报告中断',maintenance:'官方维护中',unknown:'状态未知'};
const PHASE={investigating:'调查中',identified:'已定位',monitoring:'观察中',mitigated:'已缓解',update:'进展更新',resolved:'已恢复',postmortem:'复盘',scheduled:'计划维护',in_progress:'维护中',verifying:'验证中',completed:'维护完成',unknown:'阶段未知'};
const closed=new Set(['resolved','postmortem','completed']);
export function createAIStatusUI({api,node,getIdentity,getPanel,getHealth}){
 const $=id=>document.getElementById(id);let data=null,generation=0,lastRead=0,busy=false,task=null,limit=8,signature='';
 const time=at=>at?new Date(at).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}):'尚无记录';
 const chip=(status,label)=>node('span',label||STATUS[status]||STATUS.unknown,'ai-chip '+(Object.hasOwn(STATUS,status)?status:'unknown'));
 function external(label,url){const a=node('a',label,'ai-official-link');a.href=url;a.target='_blank';a.rel='noopener noreferrer';return a;}
 function providerFilter(id){$('ai-provider-filter').value=id;$('ai-day-filter').value='';limit=8;renderRecords();$('ai-history-heading').focus({preventScroll:true});$('ai-history-heading').scrollIntoView({block:'start',behavior:'instant'});}
 function health(){
  const nodes=getHealth()?.nodes;if(!nodes){$('ai-node-comparison').textContent='节点检测结果尚未读取';return;}
  const normal=nodes.filter(n=>n.status==='normal').length,failed=nodes.filter(n=>n.status==='failed').length,pending=nodes.length-normal-failed;
  $('ai-node-comparison').textContent=nodes.length?'你的节点 · '+normal+'/'+nodes.length+' 正常'+(failed?' · '+failed+' 异常':'')+(pending?' · '+pending+' 待确认':''):'尚未分配可展示线路';
 }
 function summary(){
  if(data.readFailed){$('ai-overview-title').textContent='门户状态读取失败';$('ai-overview-note').textContent='暂时无法读取门户缓存，当前状态待确认；保留上次记录，不代表 AI 服务或官方状态源发生故障。';$('ai-overview-known').textContent='保留上次成功记录';health();return;}
  const unavailable=data.providers.filter(p=>!p.available||p.status==='unknown'),affected=data.providers.filter(p=>p.available&&(['degraded','outage','maintenance'].includes(p.status)||p.incidents.some(i=>i.active)));
  $('ai-overview-title').textContent=affected.length?affected.length+' 家服务有进行中事件':unavailable.length===data.providers.length?'官方状态暂不可用':unavailable.length?'部分官方状态尚待确认':'官方未报告进行中故障';
  $('ai-overview-note').textContent=affected.length?'先查看下方受影响功能与官方进展；这不代表所有模型、地区或请求都会失败。':unavailable.length?'状态源暂不可用，不等于 AI 服务故障。保留的历史记录仍可查看。':'若仍无法使用，再检查节点、账号或地区限制；官方状态不是你本机的连通性测试。';
  $('ai-overview-known').textContent=(data.providers.length-unavailable.length)+' / '+data.providers.length+' 状态源可用';health();
 }
 function renderProviders(){
  const open=new Set([...$('ai-providers').querySelectorAll('details[open]')].map(d=>d.dataset.aiDetail));
  const focus=document.activeElement?.dataset.aiFocus;
  $('ai-providers').replaceChildren(...data.providers.map(p=>{
   const card=node('article',undefined,'card ai-provider-card');card.dataset.aiProvider=p.id;card.dataset.status=p.status;
   const heading=node('div',undefined,'ai-provider-heading'),brand=node('div',undefined,'ai-brand'),mark=node('span',({openai:'O',claude:'C',gemini:'G',grok:'x'})[p.id]||'AI','ai-brand-mark '+p.id),name=node('div');
   name.append(node('h3',p.name),node('p',p.scope,'fine'));brand.append(mark,name);heading.append(brand);card.append(heading,chip(p.status,data.readFailed?'当前待确认':!p.available?'源暂不可用':null));
   const ongoing=p.incidents.filter(i=>i.active);
   card.append(node('p',data.readFailed?'门户读取失败，保留上次记录；恢复连接后再确认当前状态。':!p.available?(p.stale?'保留上次状态，暂不判断当前是否正常。':'尚未获得可用的官方状态。'):ongoing.length?ongoing[0].title:p.status==='no-incident'?'官方事件源未列出进行中事件。':'查看服务项，了解具体受影响范围。','ai-provider-description'));
   if(p.components.length){const details=node('details',undefined,'ai-components'),list=node('ul');details.dataset.aiDetail=p.id;details.open=open.has(p.id);const title=node('summary',(p.stale?'上次服务项':'服务项')+' · '+p.components.length);title.dataset.aiFocus=p.id+'-components';details.append(title);for(const c of p.components){const row=node('li');row.append(node('span',c.name),chip(p.available?c.status:'unknown',p.available?null:'上次：'+(STATUS[c.status]||STATUS.unknown)));list.append(row);}details.append(list);card.append(details);}
   const actions=node('div',undefined,'ai-provider-actions'),view=node('button','查看记录','secondary');view.type='button';view.setAttribute('aria-label','查看 '+p.name+' 记录');view.dataset.aiFocus=p.id+'-records';view.onclick=()=>providerFilter(p.id);actions.append(view,external('官方状态 ↗',p.sourceUrl));card.append(actions);
   const stamp=node('p','上次成功采集 · '+time(p.lastSuccessAt),'fine ai-source-time');if(p.stale)stamp.classList.add('ai-stale');card.append(stamp);return card;
  }));
  if(focus)[...$('ai-providers').querySelectorAll('[data-ai-focus]')].find(el=>el.dataset.aiFocus===focus)?.focus({preventScroll:true});
 }
 function renderRecords(){
  if(!data)return;const selected=$('ai-provider-filter').value,date=$('ai-day-filter').value,phase=$('ai-phase-filter').value,providers=data.providers.filter(p=>selected==='all'||p.id===selected);
  $('ai-history').replaceChildren(...providers.map(p=>{
   const row=node('div',undefined,'ai-history-row'),title=node('strong',p.name),bars=node('div',undefined,'ai-history-bars');bars.setAttribute('role','img');bars.setAttribute('aria-label',p.name+' 近 30 天：'+p.history.filter(d=>d.incidents).length+' 天有官方事件，'+p.history.filter(d=>d.samples).length+' 天有本站采样；未采集日期不推算正常。');
   for(const d of p.history){const bar=node('span',undefined,'ai-history-bar '+(Object.hasOwn(STATUS,d.status)?d.status:'unknown'));bar.title=d.date+' · '+STATUS[d.status]+' · '+d.samples+' 次采样 · '+d.incidents+' 项事件'+(d.missing?' · '+d.missing+' 次源不可用':'');bar.setAttribute('aria-hidden','true');bars.append(bar);}row.append(title,bars);return row;
  }));
  $('ai-history-table').replaceChildren(...providers.flatMap(p=>[...p.history].reverse().map(d=>{const tr=node('tr');for(const value of [p.name,d.date,STATUS[d.status],d.samples+' 次',d.incidents+' 项'])tr.append(node('td',value));return tr;})));
  let incidents=providers.flatMap(p=>p.incidents.map(i=>({...i,provider:p})));
  if(phase==='ongoing')incidents=incidents.filter(i=>i.active&&i.provider.available);else if(phase==='resolved')incidents=incidents.filter(i=>closed.has(i.status));
  if(date)incidents=incidents.filter(i=>{const start=new Date(date+'T00:00:00+08:00').getTime();return (i.startedAt||i.updatedAt)<start+86400000&&(i.endedAt||(i.active&&i.provider.available?data.checkedAt:i.updatedAt))>=start;});
  incidents.sort((a,b)=>b.updatedAt-a.updatedAt);$('ai-event-count').textContent=incidents.length+' 项记录';
  const open=new Set([...$('ai-incidents').querySelectorAll('details[open]')].map(d=>d.dataset.aiDetail));
  $('ai-incidents').replaceChildren(...incidents.slice(0,limit).map(i=>{
   const article=node('article',undefined,'ai-incident'),meta=node('div',undefined,'ai-incident-meta');meta.append(node('span',i.provider.name,'badge'),chip(closed.has(i.status)?'operational':i.active?'degraded':'unknown',PHASE[i.status]||PHASE.unknown),node('time',time(i.updatedAt)));article.append(meta,node('h4',i.title));
   const first=i.updates[0];if(first)article.append(node('p',first.body,'ai-incident-body'));
   const actions=node('div',undefined,'ai-incident-actions');actions.append(external('官方详情 ↗',i.url));article.append(actions);
   if(i.updates.length>1){const details=node('details',undefined,'ai-updates');details.dataset.aiDetail=i.provider.id+':'+i.id;details.open=open.has(details.dataset.aiDetail);details.append(node('summary','查看 '+i.updates.length+' 条最近更新'));for(const u of i.updates){const update=node('div');update.append(node('time',time(u.at)+' · '+(PHASE[u.status]||PHASE.unknown)),node('p',u.body));details.append(update);}article.append(details);}
   return article;
  }));
  $('ai-events-empty').hidden=!!incidents.length;$('ai-more').hidden=incidents.length<=limit;
 }
 async function load({force=false,notice=false}={}){
  if(getIdentity()?.role!=='user'||getPanel()!=='ai-status')return;
  if(busy)return task;if(!force&&Date.now()-lastRead<60000){health();return;}
  const current=++generation,identity=getIdentity(),valid=()=>generation===current&&getIdentity()===identity&&getPanel()==='ai-status';busy=true;$('ai-refresh').disabled=true;$('ai-sync').textContent='正在读取官方状态记录…';
  const operation=(async()=>{try{
   const result=await api('/api/ai-status');if(!valid())return;data=result;lastRead=Date.now();const next=JSON.stringify(data.providers);
   if(next!==signature){signature=next;renderProviders();renderRecords();}summary();
   $('ai-sync').textContent='官方每 '+data.pollIntervalSeconds/60+' 分钟采集 · 本页更新于 '+new Date().toLocaleTimeString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false});
   if(notice){const failed=data.providers.filter(p=>!p.available||p.status==='unknown').length;window.portalToast?.[failed?'info':'success'](failed?'已更新显示，'+failed+' 个官方状态源暂不可用或状态未知。':'官方状态记录已更新。');}
  }catch(error){if(valid()){
   // A cached successful view is historical after the portal read fails. Keep
   // records for inspection, but do not leave its green current-status claim.
   if(data){data={...data,readFailed:true,providers:data.providers.map(p=>({...p,status:'unknown',available:false,stale:!!p.lastSuccessAt}))};signature='';renderProviders();renderRecords();summary();}
   lastRead=0;$('ai-sync').textContent=error.message;if(notice)window.portalToast?.error(error.message);
  }}
  finally{if(valid()){busy=false;$('ai-refresh').disabled=false;}}})();task=operation;return operation;
 }
 $('ai-refresh').onclick=()=>load({force:true,notice:true});
 for(const id of ['ai-provider-filter','ai-phase-filter','ai-day-filter'])$(id).onchange=()=>{limit=8;renderRecords();};
 $('ai-clear-filter').onclick=()=>{$('ai-provider-filter').value='all';$('ai-phase-filter').value='all';$('ai-day-filter').value='';limit=8;renderRecords();};
 $('ai-more').onclick=()=>{limit+=8;renderRecords();};
 return {refresh:()=>load({force:true}),health,onPanel(id){if(id==='ai-status')return load();generation++;busy=false;$('ai-refresh').disabled=false;},reset(){generation++;busy=false;lastRead=0;data=null;signature='';limit=8;$('ai-refresh').disabled=false;for(const id of ['ai-providers','ai-history','ai-history-table','ai-incidents'])$(id).replaceChildren();for(const id of ['ai-sync','ai-event-count','ai-overview-known','ai-node-comparison'])$(id).textContent='';$('ai-overview-title').textContent='正在读取官方状态';$('ai-overview-note').textContent='';$('ai-provider-filter').value='all';$('ai-phase-filter').value='all';$('ai-day-filter').value='';$('ai-more').hidden=true;$('ai-events-empty').hidden=true;}};
}
