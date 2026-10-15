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

export function addressLabel(value){
 if(!value)return '归属未知';let country=value.country;
 if(value.countryCode)try{country=new Intl.DisplayNames(['zh-CN'],{type:'region'}).of(value.countryCode);}catch{}
 const parts=[...new Set([country,value.region,value.city].filter(v=>v&&v!=='未知'))];
 return parts.length?parts.join(' · ')+'（估算）':'归属未知';
}

export function createAccountLastUseUI({api,getIdentity,getPanel}){
 const $=id=>document.getElementById(id);let generation=0,busy=false,loadedAt=0,lastIp=null;
 const attempts=new Map();
 function render(location){$('account-last-use-location').textContent=addressLabel(location);$('account-last-use-location').title='IP 地理归属估算，不是设备的精确位置'+(location?.provider==='ipinfo-legacy'?' · IP data by IPinfo':'');}
 async function load(force=false){
  if(getIdentity()?.role!=='user'||busy||!force&&Date.now()-loadedAt<60000)return;
  const current=++generation,identity=getIdentity();busy=true;const valid=()=>current===generation&&getIdentity()===identity;
  try{
   const data=await api('/api/account/last-use');if(!valid())return;
   lastIp=data?.ip||null;$('account-last-use-ip').textContent=lastIp||'暂无使用记录';render(data?.location);loadedAt=Date.now();
   if(!lastIp){$('account-last-use-location').textContent='';return;}
   const attempt=attempts.get(lastIp);
   if(attempt?.location&&attempt.expires>Date.now()){render(attempt.location);return;}
   if(!data.canLookup||attempt?.retryAt>Date.now())return;
   attempts.set(lastIp,{retryAt:Date.now()+5*60000});
   // Only the displayed latest IP is enriched. The provider's seven-day cache
   // and failure backoff are reused; no historical source list is fetched.
   try{const value=await api('/api/account/ip-location',{method:'POST',body:{ip:lastIp}});if(!valid())return;attempts.set(lastIp,{location:value,expires:value.expiresAt});render(value);}
   catch(error){if(valid())$('account-last-use-location').title+=' · '+error.message;}
  }catch(error){if(valid()){$('account-last-use-location').textContent='归属暂不可用';$('account-last-use-location').title=error.message;}}
  finally{if(valid())busy=false;}
 }
 return {
  onPanel:id=>{if(id==='account')load();},
  observe(ip){if(ip===lastIp)return;generation++;busy=false;loadedAt=0;lastIp=ip;render(null);if(getPanel()==='account')load(true);},
  reset(){generation++;busy=false;loadedAt=0;lastIp=null;attempts.clear();$('account-last-use-location').textContent='';$('account-last-use-location').title='';}
 };
}
