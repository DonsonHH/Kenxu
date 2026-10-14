export function createUsageLogsUI({api,node,bytes,time}){
 const $=id=>document.getElementById(id),dialog=$('usage-log-dialog');let userId=null,cursor=null,generation=0,busy=false,detailBusy=false,appliedQuery='';
 const sum=v=>bytes((v?.up||0)+(v?.down||0));
 const params=()=>new URLSearchParams({hours:$('usage-log-hours').value,source:$('usage-log-source').value.trim(),target:$('usage-log-target').value.trim()});
 function renderLocation(container,source,value){
  container.replaceChildren();let country=value?.country;if(value?.countryCode)try{country=new Intl.DisplayNames(['zh-CN'],{type:'region'}).of(value.countryCode);}catch{}const parts=value?[country,value.region,value.city,value.network,value.asn]:[source.location?.country,source.location?.region];container.append(node('p',[...new Set(parts.filter(Boolean))].join(' · ')||'归属未知','usage-source-location'));
  if(value)container.append(node('span','IPinfo Legacy · '+(value.city?'省市估算':value.region?'城市未提供':'省市未提供')+' · '+time(value.checkedAt),'fine'));
 }
 function renderSummary(data,current){
  $('usage-log-title').textContent=data.username+' · 使用总览';const cards=$('usage-summary-stats');cards.replaceChildren();
  for(const [label,value]of [['区间实际用量',sum(data.total)],['无新目标记录的区间用量',sum(data.withoutTargets)],['合并后的网站',String(data.siteCount)]]){const card=node('div',undefined,'usage-summary-stat');card.append(node('span',label),node('strong',value));cards.append(card);}
  const sites=$('usage-sites');sites.replaceChildren();const max=Math.max(1,...data.sites.map(s=>s.related.up+s.related.down));
  for(const site of data.sites){const li=node('li',undefined,'usage-site'),header=node('div',undefined,'usage-site-heading'),identity=node('div'),value=node('div',undefined,'usage-site-amount');identity.append(node('strong',site.site),node('span',site.windows+' 个关联区间 · '+site.hostCount+' 个主机名','fine'));value.append(node('strong',sum(site.related)),node('span','关联区间用量','fine'));header.append(identity,value);const bar=node('div',undefined,'usage-site-bar'),fill=node('span');fill.style.width=((site.related.up+site.related.down)/max*100)+'%';bar.setAttribute('aria-hidden','true');bar.append(fill);li.append(header,bar);
   const detail=node('details'),hosts=node('summary','查看主机名');detail.append(hosts,node('p',site.hosts.join('、')+(site.hostCount>site.hosts.length?' 等':''),'fine'));li.append(detail);sites.append(li);
  }
  if(!data.sites.length)sites.append(node('li','此范围尚无可关联的网站记录。已有用量不补造网站去向。','muted'));
  $('usage-site-count').textContent=data.siteCount>data.sites.length?'显示前 '+data.sites.length+' 个，共 '+data.siteCount+' 个网站':'';
  const sources=$('usage-sources');sources.replaceChildren();
  for(const source of data.sources.slice(0,10)){const card=node('div',undefined,'usage-source'),location=node('div'),status=node('p',undefined,'fine');status.setAttribute('role','status');card.append(node('strong',source.ip),node('p','最近使用 · '+time(source.lastSeen),'fine'));renderLocation(location,source,source.enrichment);card.append(location,status);
   if(source.canLookup&&!source.enrichment){const button=node('button','查询 IPinfo 归属','secondary');button.type='button';button.onclick=async()=>{const id=userId;button.disabled=true;status.textContent='查询中…';try{const value=await api('/api/admin/usage/users/'+encodeURIComponent(id)+'/ip-location',{method:'POST',body:{ip:source.ip}});if(current!==generation||userId!==id)return;renderLocation(location,source,value);status.textContent=value.cached?'使用已缓存的归属信息':'归属信息已更新';button.hidden=true;}catch(error){if(current===generation)status.textContent=error.message;}finally{if(current===generation)button.disabled=false;}};card.append(button);}
   sources.append(card);
  }
  if(!data.sources.length)sources.append(node('p','此范围尚无来源 IP 记录。','muted'));
  if(data.sourceCount>data.sources.length)sources.append(node('p','显示最近 '+data.sources.length+' 个来源，共 '+data.sourceCount+' 个；可按 IP 筛选。','fine'));
  $('usage-log-location').textContent=data.ipinfoEnabled?'点击查询会将该来源 IP 发送给 IPinfo Legacy Free；读取国家、省市和运营商 / ASN，缓存 7 天，不发送账号或访问目标。':'IPinfo 尚未配置；当前显示离线归属信息。';
 }
 async function load(){
  if(busy||!userId)return;const current=++generation;busy=true;detailBusy=false;cursor=null;appliedQuery=params().toString();$('usage-log-status').textContent='正在合并网站记录…';for(const control of $('usage-log-form').elements)control.disabled=true;$('usage-summary').hidden=true;$('usage-log-details').open=false;$('usage-log-body').replaceChildren();$('usage-log-more').hidden=true;
  try{const data=await api('/api/admin/usage/users/'+encodeURIComponent(userId)+'/activity-summary?'+appliedQuery);if(current!==generation)return;renderSummary(data,current);$('usage-summary').hidden=false;$('usage-log-status').textContent='更新于 '+time(data.until);dialog.scrollTop=0;}
  catch(error){if(current===generation)$('usage-log-status').textContent=error.message;}
  finally{if(current===generation){busy=false;for(const control of $('usage-log-form').elements)control.disabled=false;if($('usage-log-details').open&&!$('usage-log-body').children.length)loadDetails();}}
 }
 async function loadDetails(more=false){
  if(detailBusy||busy||!userId)return;const current=generation;detailBusy=true;$('usage-log-detail-status').textContent='读取明细中…';$('usage-log-more').disabled=true;
  const query=new URLSearchParams(appliedQuery);if(more&&cursor)query.set('cursor',cursor);
  try{const data=await api('/api/admin/usage/users/'+encodeURIComponent(userId)+'/logs?'+query);if(current!==generation)return;
   if(!more)$('usage-log-body').replaceChildren();for(const item of data.items){const tr=node('tr');for(const value of [time(item.at),item.node,bytes(item.up),bytes(item.down),item.sources.map(s=>s.ip+' · '+s.country+(s.region?' / '+s.region:'')).join('\n')||'未采集',item.targets.map(t=>t.host+':'+t.port).join('\n')||'持续连接／无新目标记录'])tr.append(node('td',value));$('usage-log-body').append(tr);}
   cursor=data.nextCursor;$('usage-log-more').hidden=!data.hasMore;$('usage-log-detail-status').textContent='已显示 '+$('usage-log-body').children.length+' 条区间记录';
  }catch(error){if(current===generation)$('usage-log-detail-status').textContent=error.message;}
  finally{if(current===generation){detailBusy=false;$('usage-log-more').disabled=false;}}
 }
 function invalidate(){generation++;busy=false;detailBusy=false;userId=null;cursor=null;}
 function open(id){invalidate();userId=id;$('usage-log-title').textContent='使用总览';$('usage-log-hours').value='24';$('usage-log-source').value='';$('usage-log-target').value='';dialog.showModal();load();}
 $('usage-log-close').onclick=()=>{invalidate();dialog.close();};dialog.addEventListener('close',()=>{if(!dialog.open)invalidate();});
 $('usage-log-refresh').onclick=load;$('usage-log-form').onsubmit=event=>{event.preventDefault();load();};$('usage-log-more').onclick=()=>loadDetails(true);$('usage-log-details').ontoggle=()=>{if($('usage-log-details').open&&!$('usage-log-body').children.length)loadDetails();};
 return {button(id){const button=node('button','使用日志','secondary');button.onclick=()=>open(id);return button;},reset(){invalidate();$('usage-log-body').replaceChildren();$('usage-sites').replaceChildren();$('usage-sources').replaceChildren();$('usage-summary-stats').replaceChildren();$('usage-summary').hidden=true;$('usage-log-status').textContent='';dialog.close();}};
}
