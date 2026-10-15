import {renderSources,sourcePrivacyNote} from '/source-ui.js';
import {renderUsageOverview} from '/usage-detail.js';

export function createUsageDetailsUI({api,node,bytes,time,name}){
 const $=id=>document.getElementById(id),dialog=$('usage-log-dialog'),tabs=[...dialog.querySelectorAll('[data-usage-tab]')];
 const sum=v=>bytes((v?.up||0)+(v?.down||0));
 let userId=null,generation=0,active='overview';const pending=new Set(),loaded=new Map();
 const status={overview:'usage-overview-status',sites:'usage-log-status',sources:'usage-source-status'};
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
  loaded.delete(tab);
  if(tab==='sites')$('usage-summary').hidden=true;
  else if(tab==='sources'){$('usage-sources').replaceChildren();$('usage-log-location').textContent='';}
  else $('usage-overview-body').replaceChildren();
  pending.add(tab);panel.setAttribute('aria-busy','true');$(status[tab]).textContent='读取中…';
  if(form)for(const control of form.elements)control.disabled=true;
  const own=()=>current===generation&&id===userId;
  try{
   const base='/api/admin/usage/users/'+encodeURIComponent(id),data=await api(base+(tab==='overview'?'':tab==='sites'?'/activity-summary?'+key:'/sources?'+key));if(!own())return;
   if(data.username)$('usage-log-title').textContent=(data.displayName||data.username)+' · 用量详情';
   if(tab==='overview')renderUsageOverview($('usage-overview-body'),data,{node,bytes,name});
   else if(tab==='sites'){renderSites(data);$('usage-summary').hidden=false;}
   else{renderSources($('usage-sources'),data,{node,time,isCurrent:own,lookup:ip=>api(base+'/ip-location',{method:'POST',body:{ip}})});$('usage-log-location').textContent=sourcePrivacyNote(data.ipinfoEnabled);}
   loaded.set(tab,key);$(status[tab]).textContent='更新于 '+time(data.until||Date.now());
  }catch(error){if(own())$(status[tab]).textContent=error.message;}
  finally{if(own()){pending.delete(tab);panel.removeAttribute('aria-busy');if(form)for(const control of form.elements)control.disabled=false;}}
 }
 function select(tab,{focus=false}={}){
  active=tab;for(const button of tabs){const chosen=button.dataset.usageTab===tab;button.setAttribute('aria-selected',String(chosen));button.tabIndex=chosen?0:-1;if(chosen&&focus)button.focus();}
  for(const panel of dialog.querySelectorAll('[data-usage-panel]'))panel.hidden=panel.dataset.usagePanel!==tab;
  load();
 }
 for(const button of tabs){
  button.onclick=()=>select(button.dataset.usageTab);
  button.onkeydown=event=>{const index=tabs.indexOf(button),next={ArrowRight:(index+1)%tabs.length,ArrowLeft:(index+tabs.length-1)%tabs.length,Home:0,End:tabs.length-1}[event.key];if(next===undefined)return;event.preventDefault();select(tabs[next].dataset.usageTab,{focus:true});};
 }
 function reset(){
  generation++;userId=null;pending.clear();loaded.clear();
  for(const id of ['usage-overview-body','usage-sites','usage-sources','usage-summary-stats'])$(id).replaceChildren();
  for(const id of Object.values(status))$(id).textContent='';
  $('usage-summary').hidden=true;$('usage-log-location').textContent='';$('usage-coverage-note').textContent='';$('usage-site-count').textContent='';
 }
 function open(id){
  reset();userId=id;$('usage-log-title').textContent='用量详情';$('usage-log-hours').value='24';$('usage-source-hours').value='24';$('usage-log-source').value='';$('usage-log-target').value='';
  for(const form of dialog.querySelectorAll('form'))for(const control of form.elements)control.disabled=false;
  for(const panel of dialog.querySelectorAll('[data-usage-panel]'))panel.removeAttribute('aria-busy');
  dialog.showModal();dialog.scrollTop=0;select('overview');
 }
 $('usage-log-close').onclick=()=>dialog.close();dialog.addEventListener('close',()=>{if(!dialog.open)reset();});
 $('usage-detail-refresh').onclick=()=>load(active,true);
 $('usage-log-form').onsubmit=event=>{event.preventDefault();load('sites',true);};$('usage-source-form').onsubmit=event=>{event.preventDefault();load('sources',true);};
 $('usage-source-hours').onchange=()=>load('sources',true);
 return {button(id){const button=node('button','用量详情','secondary detail-button');button.onclick=()=>open(id);return button;},reset(){reset();dialog.close();}};
}
