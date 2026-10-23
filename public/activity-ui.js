import {renderSources,sourcePrivacyNote} from '/source-ui.js';
import {renderUsageOverview} from '/usage-detail.js';
import {openDialog,closeDialog} from './overlay-ui.js';
import {createTabs} from './tabs-ui.js';
import {createButtonFeedback} from './button-feedback.js';

export function createUsageDetailsUI({api,node,bytes,time,name}){
 const $=id=>document.getElementById(id),dialog=$('usage-log-dialog'),tabs=[...dialog.querySelectorAll('[data-usage-tab]')];
 const tabChoices=createTabs(dialog.querySelector('.usage-tabs'),{activation:'manual',items:tabs.map(trigger=>({value:trigger.dataset.usageTab,trigger,panel:$('usage-panel-'+trigger.dataset.usageTab)})),onChange:(tab,options)=>select(tab,options)});
 const refresh=$('usage-detail-refresh'),refreshFeedback=createButtonFeedback(refresh);
 const sum=v=>bytes((v?.up||0)+(v?.down||0));
 let userId=null,generation=0,active='overview';const pending=new Set(),loaded=new Map();
 const status={overview:'usage-overview-status',sites:'usage-log-status',sources:'usage-source-status'};
 const retries=new Map(Object.entries(status).map(([tab,id])=>{const button=node('button','重试读取','secondary');button.type='button';button.dataset.usageRetry=tab;button.hidden=true;button.onclick=()=>load(tab,true);$(id).after(button);return [tab,button];}));
 function refreshState(){const busy=pending.has(active);refresh.setAttribute('aria-disabled',String(busy));if(busy)refreshFeedback.show('读取中…');else refreshFeedback.reset();}
 function renderSites(data){
  const view=data.actual,c=view.coverage;
  $('usage-coverage-note').textContent='当前采集覆盖 '+c.nodes+' / '+c.totalNodes+' 条受管线路'+(c.since?' · 本段连续覆盖始于 '+time(c.since):' · 采集暂不完整')+'。只统计启用后的连接字节；上线前、采集中断和直连流量不补造去向。';
  const cards=$('usage-summary-stats');cards.replaceChildren();
  for(const [label,value]of [['已采集的连接字节',sum(view.total)],['未归属目标的字节',sum(view.unknown)],['超过 10 MiB 的网站',String(view.visibleSiteCount)]]){const card=node('div',undefined,'usage-summary-stat');card.append(node('span',label),node('strong',value));cards.append(card);}
  const sites=$('usage-sites');sites.replaceChildren();const max=Math.max(1,...view.sites.map(s=>s.actual.up+s.actual.down));
  for(const site of view.sites){
   const li=node('li',undefined,'usage-site'),header=node('div',undefined,'usage-site-heading'),identity=node('div'),value=node('div',undefined,'usage-site-amount');
   identity.append(node('strong',site.site),node('span',site.hostCount+' 个主机名','fine'));value.append(node('strong',sum(site.actual)),node('span','连接实际字节','fine'));header.append(identity,value);
   const bar=node('div',undefined,'usage-site-bar'),fill=node('span');fill.style.width=((site.actual.up+site.actual.down)/max*100)+'%';bar.setAttribute('aria-hidden','true');bar.append(fill);
   const detail=node('details');detail.append(node('summary','查看主机名'),node('p',site.hosts.join('、')+(site.hostCount>site.hosts.length?' 等':''),'fine'));li.append(header,bar,detail);sites.append(li);
  }
  if(!view.sites.length)sites.append(node('li',view.available?'此范围没有超过 10 MiB 的网站。':'此范围尚无连接实际字节，旧区间记录不会补成网站用量。','muted'));
  $('usage-site-count').textContent=(view.visibleSiteCount>view.sites.length?'显示前 '+view.sites.length+' 个，共 '+view.visibleSiteCount+' 个。':'')+'小额网站（≤ 10 MiB）'+view.smallSites.count+' 个，合计 '+sum(view.smallSites.total)+'；仍计入已采集总量，不列入排行。';
 }
 function query(tab){
  if(tab==='sites')return new URLSearchParams({hours:$('usage-log-hours').value,source:$('usage-log-source').value.trim(),target:$('usage-log-target').value.trim()}).toString();
  return tab==='sources'?new URLSearchParams({hours:$('usage-source-hours').value}).toString():'';
 }
 async function load(tab=active,force=false){
  if(!userId||pending.has(tab))return;
  const key=query(tab);if(!force&&loaded.get(tab)===key)return;
  const current=generation,id=userId,panel=$('usage-panel-'+tab),form=tab==='sites'?$('usage-log-form'):tab==='sources'?$('usage-source-form'):null;
  const hadData=loaded.get(tab)===key;
  if(!hadData){loaded.delete(tab);if(tab==='sites')$('usage-summary').hidden=true;
   else if(tab==='sources'){$('usage-sources').replaceChildren();$('usage-log-location').textContent='';}
   else $('usage-overview-body').replaceChildren();}
  pending.add(tab);panel.setAttribute('aria-busy','true');$(status[tab]).textContent='读取中…';
  $(status[tab]).classList.remove('usage-tab-error');if(document.activeElement===retries.get(tab))panel.focus({preventScroll:true});retries.get(tab).hidden=true;refreshState();
  const returnFocus=form?.contains(document.activeElement)?document.activeElement:null;
  if(returnFocus)panel.focus({preventScroll:true});
  if(form)for(const control of form.elements)control.disabled=true;
  const own=()=>current===generation&&id===userId;
  try{
   const base='/api/admin/usage/users/'+encodeURIComponent(id),data=await api(base+(tab==='overview'?'':tab==='sites'?'/activity-summary?'+key:'/sources?'+key));if(!own())return;
   if(data.username)$('usage-log-title').textContent=(data.displayName||data.username)+' · 用量详情';
   if(tab==='overview')renderUsageOverview($('usage-overview-body'),data,{node,bytes,name});
   else if(tab==='sites'){renderSites(data);$('usage-summary').hidden=false;}
   else{renderSources($('usage-sources'),data,{node,time,isCurrent:own,lookup:ip=>api(base+'/ip-location',{method:'POST',body:{ip}})});$('usage-log-location').textContent=sourcePrivacyNote(data.ipinfoEnabled);}
   loaded.set(tab,key);$(status[tab]).textContent='更新于 '+time(data.until||Date.now());
  }catch(error){if(own()){$(status[tab]).textContent='更新失败：'+error.message+(hadData?'。仍显示上次成功结果。':'');$(status[tab]).classList.add('usage-tab-error');retries.get(tab).hidden=false;}}
  finally{if(own()){pending.delete(tab);panel.removeAttribute('aria-busy');if(form)for(const control of form.elements)control.disabled=false;if(returnFocus&&document.activeElement===panel)returnFocus.focus({preventScroll:true});refreshState();}}
 }
 function select(tab,{animate=false}={}){
  active=tab;tabChoices.select(tab,{notify:false,animate});refreshState();load();
 }
 function reset(){
  generation++;userId=null;pending.clear();loaded.clear();
  for(const [tab,button]of retries){button.hidden=true;$('usage-panel-'+tab).removeAttribute('aria-busy');$(status[tab]).classList.remove('usage-tab-error');}
  refreshState();
  for(const id of ['usage-overview-body','usage-sites','usage-sources','usage-summary-stats'])$(id).replaceChildren();
  for(const id of Object.values(status))$(id).textContent='';
  $('usage-summary').hidden=true;$('usage-log-location').textContent='';$('usage-coverage-note').textContent='';$('usage-site-count').textContent='';
 }
 function open(id,opener){
  reset();userId=id;$('usage-log-title').textContent='用量详情';$('usage-log-hours').value='24';$('usage-source-hours').value='24';$('usage-log-source').value='';$('usage-log-target').value='';
  for(const form of dialog.querySelectorAll('form'))for(const control of form.elements)control.disabled=false;
  for(const panel of dialog.querySelectorAll('[data-usage-panel]'))panel.removeAttribute('aria-busy');
  openDialog(dialog,{opener});dialog.scrollTop=0;select('overview');$('usage-log-title').tabIndex=-1;$('usage-log-title').focus({preventScroll:true});
 }
 $('usage-log-close').onclick=()=>closeDialog(dialog);dialog.addEventListener('close',()=>{if(!dialog.open)reset();});
 $('usage-detail-refresh').onclick=()=>load(active,true);
 $('usage-log-form').onsubmit=event=>{event.preventDefault();load('sites',true);};$('usage-source-form').onsubmit=event=>{event.preventDefault();load('sources',true);};
 $('usage-source-hours').onchange=()=>load('sources',true);
 return {button(id){const button=node('button','用量详情','secondary detail-button');button.dataset.dialogOpener='account-usage:'+id;button.onclick=event=>open(id,event.currentTarget);return button;},reset(){reset();closeDialog(dialog,{immediate:true});}};
}
