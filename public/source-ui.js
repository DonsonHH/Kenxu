// Shared presentation for an administrator's selected account and one's own
// profile. The caller supplies the authorized endpoint, never an arbitrary IP API.
export function renderSources(container,data,{node,time,lookup,isCurrent=()=>true}){
 container.replaceChildren();
 for(const source of data.sources){
  const card=node('div',undefined,'usage-source'),location=node('div'),status=node('p',undefined,'fine');
  status.setAttribute('role','status');
  card.append(node('strong',source.ip),node('p','最近使用 · '+time(source.lastSeen),'fine'));
  function render(value){
   location.replaceChildren();let country=value?.country;
   if(value?.countryCode)try{country=new Intl.DisplayNames(['zh-CN'],{type:'region'}).of(value.countryCode);}catch{}
   const parts=value?[country,value.region,value.city,value.network,value.asn]:[source.location?.country,source.location?.region];
   location.append(node('p',[...new Set(parts.filter(Boolean))].join(' · ')||'归属未知','usage-source-location'));
   if(value)location.append(node('span','IPinfo Legacy · '+(value.city?'省市估算':value.region?'城市未提供':'省市未提供')+' · '+time(value.checkedAt),'fine'));
  }
  render(source.enrichment);card.append(location,status);
  if(source.canLookup&&!source.enrichment){
   const button=node('button','查询 IPinfo 归属','secondary');button.type='button';
   button.onclick=async()=>{
    if(button.disabled)return;button.disabled=true;status.textContent='查询中…';
    try{const value=await lookup(source.ip);if(!isCurrent())return;render(value);status.textContent=value.cached?'使用已缓存的归属信息':'归属信息已更新';button.hidden=true;}
    catch(error){if(isCurrent())status.textContent=error.message;}
    finally{if(isCurrent())button.disabled=false;}
   };
   card.append(button);
  }
  container.append(card);
 }
 if(!data.sources.length)container.append(node('p','此范围尚无来源 IP 记录。','muted'));
 if(data.sourceCount>data.sources.length)container.append(node('p','显示最近 '+data.sources.length+' 个来源，共 '+data.sourceCount+' 个。','fine'));
}

export const sourcePrivacyNote=enabled=>enabled
 ?'点击查询会将该来源 IP 发送给 IPinfo Legacy Free；缓存 7 天，不发送账号或访问目标。IP 归属为估算，不代表具体住址。'
 :'当前显示离线归属信息。IP 归属为估算，不代表具体住址。';

export function createAccountSourcesUI({api,node,time}){
 const $=id=>document.getElementById(id);let generation=0,busy=false,loadedAt=0;
 async function load(force=false){
  if(busy||!force&&Date.now()-loadedAt<60000)return;
  const current=++generation;busy=true;$('account-sources-refresh').disabled=true;$('account-sources-hours').disabled=true;
  $('account-sources').replaceChildren();$('account-sources-note').textContent='';
  $('account-sources-status').textContent='读取来源记录中…';
  try{
   const data=await api('/api/account/sources?hours='+$('account-sources-hours').value);if(current!==generation)return;
   renderSources($('account-sources'),data,{node,time,isCurrent:()=>current===generation,lookup:ip=>api('/api/account/ip-location',{method:'POST',body:{ip}})});
   $('account-sources-note').textContent=sourcePrivacyNote(data.ipinfoEnabled);
   $('account-sources-status').textContent='更新于 '+time(data.until);loadedAt=Date.now();
  }catch(error){if(current===generation)$('account-sources-status').textContent=error.message;}
  finally{if(current===generation){busy=false;$('account-sources-refresh').disabled=false;$('account-sources-hours').disabled=false;}}
 }
 $('account-sources-refresh').onclick=()=>load(true);$('account-sources-hours').onchange=()=>load(true);
 return {onPanel:id=>{if(id==='account')load();},reset(){generation++;busy=false;loadedAt=0;$('account-sources').replaceChildren();$('account-sources-note').textContent='';$('account-sources-status').textContent='';$('account-sources-hours').value='720';$('account-sources-refresh').disabled=false;$('account-sources-hours').disabled=false;}};
}
