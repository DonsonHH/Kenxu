export function createUsageLogsUI({api,node,bytes,time}){
 const $=id=>document.getElementById(id),dialog=$('usage-log-dialog');let userId=null,cursor=null,generation=0,busy=false,detailBusy=false,appliedQuery='';
 const sum=v=>bytes((v?.up||0)+(v?.down||0));
 let viewMode='actual',lastSummary=null;
 const viewControl=node('div',undefined,'usage-flow-controls'),viewLabel=node('label','统计口径'),viewSelect=node('select'),coverageNote=node('p',undefined,'usage-summary-note');
 viewSelect.id='usage-flow-view';viewLabel.htmlFor=viewSelect.id;
 for(const [value,label]of [['actual','连接实际字节'],['related','历史关联区间']]){const option=node('option',label);option.value=value;viewSelect.append(option);}
 viewControl.append(viewLabel,viewSelect,coverageNote);$('usage-summary').prepend(viewControl);
 viewSelect.onchange=()=>{viewMode=viewSelect.value;if(lastSummary)renderSummary(lastSummary,generation);};
 const params=()=>new URLSearchParams({hours:$('usage-log-hours').value,source:$('usage-log-source').value.trim(),target:$('usage-log-target').value.trim()});
 function renderLocation(container,source,value){
  container.replaceChildren();let country=value?.country;if(value?.countryCode)try{country=new Intl.DisplayNames(['zh-CN'],{type:'region'}).of(value.countryCode);}catch{}const parts=value?[country,value.region,value.city,value.network,value.asn]:[source.location?.country,source.location?.region];container.append(node('p',[...new Set(parts.filter(Boolean))].join(' · ')||'归属未知','usage-source-location'));
  if(value)container.append(node('span','IPinfo Legacy · '+(value.city?'省市估算':value.region?'城市未提供':'省市未提供')+' · '+time(value.checkedAt),'fine'));
 }
 function renderSummary(data,current){
  lastSummary=data;const actual=viewMode==='actual'&&data.actual?.available,view=actual?data.actual:data;
  viewControl.hidden=!data.actual?.available;viewSelect.value=actual?'actual':'related';
  if(data.actual?.available){const c=data.actual.coverage;coverageNote.textContent='当前采集覆盖 '+c.nodes+' / '+c.totalNodes+' 条受管线路'+(c.since?' · 本段连续覆盖始于 '+time(c.since):' · 采集暂不完整')+'。只统计启用后的连接字节；上线前、采集中断及未计量直连不补造网站去向。';}
  $('usage-log-title').textContent=data.username+' · 使用总览';const cards=$('usage-summary-stats');cards.replaceChildren();
  const stats=actual?[['已采集的连接字节',sum(view.total)],['未归属目标的字节',sum(view.unknown)],['合并后的网站',String(view.siteCount)]]:[['区间实际用量',sum(data.total)],['无新目标记录的区间用量',sum(data.withoutTargets)],['合并后的网站',String(data.siteCount)]];
  for(const [label,value]of stats){const card=node('div',undefined,'usage-summary-stat');card.append(node('span',label),node('strong',value));cards.append(card);}
  const section=$('usage-sites').closest('section');section.querySelector('h3').textContent=actual?'实际连接流量去向':'网站关联总览';section.querySelector('.badge').textContent=actual?'可相加，不重复计费':'关联值，不可相加';
  section.querySelector('.usage-summary-note').textContent=actual?'按连接目标合并主域名，含 TLS／HTTP 开销，不是文件净大小或账单流量。无法识别的网站保留为未知；共享 CDN 和 IP 直连不猜测应用。原总账与这份分类统计不叠加。':'同一主域名已合并。数字是该网站出现时的整个区间用量，可能同时包含其他网站；排序不是网站实际消耗排名，持续连接也可能没有新目标记录。';
  const siteRows=view.sites.map(s=>({...s,display:s.actual||s.related}));
  const sites=$('usage-sites');sites.replaceChildren();const max=Math.max(1,...siteRows.map(s=>s.display.up+s.display.down));
  for(const site of siteRows){const li=node('li',undefined,'usage-site'),header=node('div',undefined,'usage-site-heading'),identity=node('div'),value=node('div',undefined,'usage-site-amount');identity.append(node('strong',site.site),node('span',(actual?'':site.windows+' 个关联区间 · ')+site.hostCount+' 个主机名','fine'));value.append(node('strong',sum(site.display)),node('span',actual?'连接实际字节':'关联区间用量','fine'));header.append(identity,value);const bar=node('div',undefined,'usage-site-bar'),fill=node('span');fill.style.width=((site.display.up+site.display.down)/max*100)+'%';bar.setAttribute('aria-hidden','true');bar.append(fill);li.append(header,bar);
   const detail=node('details'),hosts=node('summary','查看主机名');detail.append(hosts,node('p',site.hosts.join('、')+(site.hostCount>site.hosts.length?' 等':''),'fine'));li.append(detail);sites.append(li);
  }
  if(!siteRows.length)sites.append(node('li',actual?'此范围尚无已识别的网站字节。':'此范围尚无可关联的网站记录。已有用量不补造网站去向。','muted'));
  $('usage-site-count').textContent=view.siteCount>siteRows.length?'显示前 '+siteRows.length+' 个，共 '+view.siteCount+' 个网站':'';
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
 function invalidate(){generation++;busy=false;detailBusy=false;userId=null;cursor=null;lastSummary=null;}
 function open(id){invalidate();viewMode='actual';userId=id;$('usage-log-title').textContent='使用总览';$('usage-log-hours').value='24';$('usage-log-source').value='';$('usage-log-target').value='';dialog.showModal();load();}
 $('usage-log-close').onclick=()=>{invalidate();dialog.close();};dialog.addEventListener('close',()=>{if(!dialog.open)invalidate();});
 $('usage-log-refresh').onclick=load;$('usage-log-form').onsubmit=event=>{event.preventDefault();load();};$('usage-log-more').onclick=()=>loadDetails(true);$('usage-log-details').ontoggle=()=>{if($('usage-log-details').open&&!$('usage-log-body').children.length)loadDetails();};
 return {button(id){const button=node('button','使用日志','secondary');button.onclick=()=>open(id);return button;},reset(){invalidate();$('usage-log-body').replaceChildren();$('usage-sites').replaceChildren();$('usage-sources').replaceChildren();$('usage-summary-stats').replaceChildren();$('usage-summary').hidden=true;$('usage-log-status').textContent='';dialog.close();}};
}
