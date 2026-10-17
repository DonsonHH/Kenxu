import {officialEventDays} from './ai-status-model.js';
const STATUS={operational:'官方正常','no-incident':'未报告进行中故障',degraded:'官方有事件',outage:'官方报告中断',maintenance:'官方维护中',unknown:'状态未知'};
const DAY_STATUS={unreported:'未报告异常',degraded:'官方事件／状态异常',outage:'官方报告中断',maintenance:'官方维护',unknown:'记录不可用'};
const PHASE={investigating:'调查中',identified:'已定位',monitoring:'观察中',mitigated:'已缓解',update:'进展更新',resolved:'已恢复',postmortem:'复盘',scheduled:'计划维护',in_progress:'维护中',verifying:'验证中',completed:'维护完成',unknown:'阶段未知'};
const closed=new Set(['resolved','postmortem','completed']);
export function createAIStatusUI({api,node,getIdentity,getPanel}){
 const $=id=>document.getElementById(id);let data=null,generation=0,lastRead=0,busy=false,task=null,limit=8,signature='';
 const time=at=>at?new Date(at).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}):'尚无记录';
 const chip=(status,label)=>node('span',label||STATUS[status]||STATUS.unknown,'ai-chip '+(Object.hasOwn(STATUS,status)?status:'unknown'));
 function external(label,url){const a=node('a',label,'ai-official-link');a.href=url;a.target='_blank';a.rel='noopener noreferrer';return a;}
 function summary(){
  if(data.readFailed){$('ai-overview-title').textContent='门户状态读取失败';$('ai-overview-known').textContent='保留上次记录';return;}
  const unavailable=data.providers.filter(p=>!p.available||p.status==='unknown'),affected=data.providers.filter(p=>p.available&&(['degraded','outage','maintenance'].includes(p.status)||p.incidents.some(i=>i.active)));
  $('ai-overview-title').textContent=affected.length?affected.length+' 家服务有进行中事件':unavailable.length===data.providers.length?'官方状态暂不可用':unavailable.length?'部分官方状态尚待确认':'官方未报告进行中故障';
  $('ai-overview-known').textContent=(data.providers.length-unavailable.length)+' / '+data.providers.length+' 状态源可用';
 }
 function renderProviders(){
  const open=new Set([...$('ai-providers').querySelectorAll('details[open]')].map(d=>d.dataset.aiDetail));
  const focus=document.activeElement?.dataset.aiFocus;
  $('ai-providers').replaceChildren(...data.providers.map(p=>{
   const card=node('article',undefined,'card ai-provider-card');card.dataset.aiProvider=p.id;card.dataset.status=p.status;
   const heading=node('div',undefined,'ai-provider-heading'),brand=node('div',undefined,'ai-brand'),mark=node('span',({openai:'O',claude:'C',gemini:'G',grok:'x'})[p.id]||'AI','ai-brand-mark '+p.id),name=node('div');
   name.append(node('h3',p.name),node('p',p.scope,'fine'));brand.append(mark,name);heading.append(brand);card.append(heading,chip(p.status,data.readFailed?'当前待确认':!p.available?'源暂不可用':null));
   const ongoing=p.incidents.filter(i=>i.active);
   if(p.available&&ongoing.length)card.append(node('p',ongoing[0].title,'ai-provider-description'));
   if(p.components.length){const details=node('details',undefined,'ai-components'),list=node('ul');details.dataset.aiDetail=p.id;details.open=open.has(p.id);const title=node('summary',(p.stale?'上次服务项':'服务项')+' · '+p.components.length);title.dataset.aiFocus=p.id+'-components';details.append(title);for(const c of p.components){const row=node('li');row.append(node('span',c.name),chip(p.available?c.status:'unknown',p.available?null:'上次：'+(STATUS[c.status]||STATUS.unknown)));list.append(row);}details.append(list);card.append(details);}
   const actions=node('div',undefined,'ai-provider-actions');actions.append(external('官方状态 ↗',p.sourceUrl));card.append(actions);return card;
  }));
  if(focus)[...$('ai-providers').querySelectorAll('[data-ai-focus]')].find(el=>el.dataset.aiFocus===focus)?.focus({preventScroll:true});
 }
 function renderRecords(){
  if(!data)return;const selected=$('ai-provider-filter').value,date=$('ai-day-filter').value,phase=$('ai-phase-filter').value,providers=data.providers.filter(p=>selected==='all'||p.id===selected);
  $('ai-history').replaceChildren(...providers.map(p=>{
   const days=officialEventDays(p,data.checkedAt),row=node('div',undefined,'ai-history-row'),title=node('strong',p.name),bars=node('div',undefined,'ai-history-bars');bars.setAttribute('role','img');bars.setAttribute('aria-label',p.name+' 近 30 天官方记录：'+days.filter(d=>d.incidents).length+' 天有事件，'+days.filter(d=>d.status==='unreported').length+' 天未报告异常，'+days.filter(d=>d.status==='unknown').length+' 天记录不可用。未报告异常不等于本站全天采样正常。');
   for(const d of days){const bar=node('span',undefined,'ai-history-bar '+d.status);bar.title=d.date+' · '+DAY_STATUS[d.status]+' · '+d.incidents+' 项事件';bar.setAttribute('aria-hidden','true');bars.append(bar);}row.append(title,bars);return row;
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
 async function load({force=false}={}){
  if(getIdentity()?.role!=='user'||getPanel()!=='ai-status')return;
  if(busy)return task;if(!force&&Date.now()-lastRead<60000)return;
  const current=++generation,identity=getIdentity(),valid=()=>generation===current&&getIdentity()===identity&&getPanel()==='ai-status';busy=true;$('ai-sync').textContent='正在读取官方状态记录…';
  const operation=(async()=>{try{
   const result=await api('/api/ai-status');if(!valid())return;data=result;lastRead=Date.now();const next=JSON.stringify(data.providers);
   if(next!==signature){signature=next;renderProviders();renderRecords();}summary();
   $('ai-sync').textContent='官方每 '+data.pollIntervalSeconds/60+' 分钟采集';
  }catch(error){if(valid()){
   // A cached successful view is historical after the portal read fails. Keep
   // records for inspection, but do not leave its green current-status claim.
   if(data){data={...data,readFailed:true,providers:data.providers.map(p=>({...p,status:'unknown',available:false,stale:!!p.lastSuccessAt}))};signature='';renderProviders();renderRecords();summary();}
   else{$('ai-overview-title').textContent='门户状态读取失败';$('ai-overview-known').textContent='';}
   lastRead=0;$('ai-sync').textContent=error.message;return error;
  }}
  finally{if(valid())busy=false;}})();task=operation;return operation;
 }
 for(const id of ['ai-provider-filter','ai-phase-filter','ai-day-filter'])$(id).onchange=()=>{limit=8;renderRecords();};
 $('ai-clear-filter').onclick=()=>{$('ai-provider-filter').value='all';$('ai-phase-filter').value='all';$('ai-day-filter').value='';limit=8;renderRecords();};
 $('ai-more').onclick=()=>{limit+=8;renderRecords();};
 return {async refresh(){const error=await load({force:true});if(error)throw error;},onPanel(id){if(id==='ai-status')return load();generation++;busy=false;},reset(){generation++;busy=false;lastRead=0;data=null;signature='';limit=8;for(const id of ['ai-providers','ai-history','ai-history-table','ai-incidents'])$(id).replaceChildren();for(const id of ['ai-sync','ai-event-count','ai-overview-known'])$(id).textContent='';$('ai-overview-title').textContent='正在读取官方状态';$('ai-provider-filter').value='all';$('ai-phase-filter').value='all';$('ai-day-filter').value='';$('ai-more').hidden=true;$('ai-events-empty').hidden=true;}};
}
