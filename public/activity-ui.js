export function createUsageLogsUI({api,node,bytes,time,tell}){
 const $=id=>document.getElementById(id);let userId=null,cursor=null,generation=0,busy=false;
 function row(values){const tr=node('tr');for(const value of values)tr.append(node('td',String(value)));return tr;}
 async function load(more=false,notify=false){
  if(busy||!userId)return;const current=++generation;busy=true;$('usage-log-status').textContent='读取中…';$('usage-log-refresh').disabled=true;$('usage-log-more').disabled=true;
  if(!more){cursor=null;$('usage-log-body').replaceChildren();}
  const params=new URLSearchParams({hours:$('usage-log-hours').value,source:$('usage-log-source').value.trim(),target:$('usage-log-target').value.trim()});if(more&&cursor)params.set('cursor',cursor);
  try{
   const data=await api('/api/admin/usage/users/'+encodeURIComponent(userId)+'/logs?'+params);if(current!==generation)return;
   for(const r of data.items)$('usage-log-body').append(row([time(r.at),r.node,bytes(r.up),bytes(r.down),r.sources.length?r.sources.map(s=>s.ip+' · '+s.country+(s.region?' / '+s.region:'')).join('\n'):'未采集',r.targets.length?r.targets.map(t=>t.host+':'+t.port+' · '+t.network.toUpperCase()).join('\n'):'持续连接／无新目标记录']));
   cursor=data.nextCursor;$('usage-log-more').hidden=!data.hasMore;$('usage-log-status').textContent=$('usage-log-body').children.length?'已显示 '+$('usage-log-body').children.length+' 条区间记录':'此范围暂无用量记录。';
   $('usage-log-location').textContent=data.geoAvailable?'IP 地区为估算结果':'尚无离线 IP 地区数据，地区显示未知';if(notify)tell('使用日志已更新');
  }catch(error){if(current===generation)$('usage-log-status').textContent=error.message;}
  finally{if(current===generation){busy=false;$('usage-log-refresh').disabled=false;$('usage-log-more').disabled=false;}}
 }
 function open(id){generation++;busy=false;userId=id;cursor=null;$('usage-log-hours').value='24';$('usage-log-source').value='';$('usage-log-target').value='';$('usage-log-dialog').showModal();load();}
 $('usage-log-close').onclick=()=>{generation++;busy=false;userId=null;$('usage-log-dialog').close();};
 $('usage-log-refresh').onclick=()=>load(false,true);$('usage-log-more').onclick=()=>load(true);$('usage-log-form').onsubmit=event=>{event.preventDefault();load();};
 return {button(id){const button=node('button','使用日志','secondary');button.onclick=()=>open(id);return button;},reset(){generation++;busy=false;userId=null;cursor=null;$('usage-log-body').replaceChildren();$('usage-log-status').textContent='';$('usage-log-dialog').close();}};
}
