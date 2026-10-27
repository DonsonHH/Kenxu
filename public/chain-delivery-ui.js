export function createChainDeliveryUI({api,node,tell,getIdentity}){
 let generation=0,card=null,fingerprint='';
 function reset(){generation++;card?.remove();card=null;fingerprint='';}
 function render(info,admin){
  const next=JSON.stringify([getIdentity()?.username,info,admin]);if(card?.isConnected&&next===fingerprint)return;fingerprint=next;
  card?.remove();card=node('section',undefined,'card');card.id='private-chain-delivery';
  card.append(node('h2',admin?info.username+' 专用配置':'本人专用配置'),node('p',info.description,'muted'));
  const actions=node('div',undefined,'actions'),normal=node('a','下载原版 YAML','button secondary'),chain=node('a','下载 Jetson 链式 YAML','button secondary');
  const endpoint=admin?'/api/admin/chain-config':'/api/config';normal.href=endpoint;normal.download='Kenxu.yaml';chain.href=endpoint+'?profile=jetson-chain';chain.download='Kenxu-Jetson.yaml';actions.append(normal,chain);
  if(!admin){const copy=node('button','复制链式订阅','primary');copy.type='button';copy.onclick=async()=>{const identity=getIdentity(),current=generation;if(!identity?.privateDelivery)return;const url=new URL(identity.subscriptionUrl);url.searchParams.set('profile','jetson-chain');try{await navigator.clipboard.writeText(url.href);if(current===generation&&getIdentity()===identity)tell('链式订阅已复制，请勿转发。');}catch{if(current===generation)tell('复制失败，请使用 YAML 下载，或检查浏览器剪贴板权限。','info');}};actions.append(copy);}
  card.append(actions,node('p','必须先连接 Tailscale。国内由 Jetson 直出；国外出口仍是所选 VPS。请勿在客户端切到全局或直连模式。','fine'));
  document.querySelector(admin?'#admin-view [data-panel="settings"]':'#user-view [data-panel="subscription"]').append(card);
 }
 return {reset,sync(identity){if(!identity?.privateDelivery){reset();return;}render(identity.privateDelivery,false);},async admin(){const identity=getIdentity(),current=++generation;try{const info=await api('/api/admin/chain-profiles');if(current!==generation||getIdentity()!==identity)return;if(info.available)render(info,true);else card?.remove();}catch{if(current===generation)card?.remove();}}};
}
