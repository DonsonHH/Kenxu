import {Chart,LineController,LineElement,PointElement,BarController,BarElement,DoughnutController,ArcElement,CategoryScale,LinearScale,Tooltip,Legend,Filler} from 'chart.js';
import {mergeDaily,routeRanking,statusCounts} from '../public/chart-model.js';
import {displayNodeName,groupNodes,httpResponseMs} from '../public/node-model.js';
Chart.register(LineController,LineElement,PointElement,BarController,BarElement,DoughnutController,ArcElement,CategoryScale,LinearScale,Tooltip,Legend,Filler);
const charts=new Map(),palette=['#138c94','#7fc7ba','#638acc','#b095d6','#f2b56b','#cf8491','#7b9da5','#9bc298'];let snapshot=null,health=null,role=null,monitor=null,days=7;
const bytes=n=>{if(!n)return '0 B';const units=['B','KB','MB','GB','TB'];let value=n,i=0;while(value>=1024&&i<4){value/=1024;i++;}return value.toFixed(i?1:0)+' '+units[i];};
function draw(id,type,labels,datasets,{unit='bytes',horizontal=false,stacked=false}={}){
 labels=labels.map(displayNodeName);
 const canvas=document.getElementById(id);if(!canvas||!canvas.getClientRects().length)return;
 const dark=document.documentElement.dataset.theme==='dark',text=dark?'#a7b8c9':'#617786',grid=dark?'#293746':'#edf2f5';
 const fingerprint=JSON.stringify([type,labels,datasets,unit,horizontal,stacked,dark]),existing=charts.get(id);
 if(existing?.fingerprint===fingerprint){existing.chart.resize();return;}
 const nonzero=datasets.some(d=>d.data.some(n=>n!==null&&(unit==='ms'?n>=0:n>0))),note=canvas.closest('.chart-card')?.querySelector('.chart-note');
 if(note)note.textContent=!labels.length?'暂无数据':!nonzero&&unit==='bytes'?'这个时间段还没有记录到用量':!nonzero&&unit==='ms'?'尚无可用的连接响应':!nonzero&&unit==='count'?'暂无节点':'';
 const formatter=n=>n===null?'未知':unit==='ms'?Math.round(n)+' ms':unit==='percent'?Math.round(n)+'%':unit==='count'?String(n):bytes(n);
 canvas.setAttribute('aria-label',labels.map((l,i)=>l+': '+datasets.map(d=>d.label+' '+(d.data[i]===null?'未知':formatter(d.data[i]||0))).join(', ')).join('; ')||'暂无数据');
 const options={responsive:true,maintainAspectRatio:false,animation:false,devicePixelRatio:Math.min(devicePixelRatio||1,2),normalized:true,interaction:{mode:'index',intersect:false},plugins:{legend:{position:'bottom',labels:{usePointStyle:true,boxWidth:7,padding:18,color:text,font:{size:11}}},tooltip:{callbacks:{label:ctx=>ctx.dataset.label+': '+formatter(ctx.raw)}}}};
 if(type==='doughnut'){options.cutout='72%';options.plugins.tooltip.callbacks.label=ctx=>ctx.label+': '+formatter(ctx.raw);}
 else {options.indexAxis=horizontal?'y':'x';options.scales={x:{stacked,beginAtZero:horizontal,grid:{display:horizontal,color:'#eef2f5'},ticks:{maxRotation:0,maxTicksLimit:8,color:'#8296a3',font:{size:10},...(horizontal?{callback:v=>formatter(v)}:{})},border:{display:false}},y:{stacked,beginAtZero:!horizontal,grid:{display:!horizontal,color:'#edf2f5'},ticks:{color:'#8296a3',font:{size:10},...(!horizontal?{callback:v=>formatter(v)}:{})},border:{display:false}}};}
 if(options.scales)for(const scale of Object.values(options.scales)){scale.ticks.color=text;scale.grid.color=grid;}
 if(options.scales&&unit==='bytes'&&!nonzero){const axis=options.scales[horizontal?'x':'y'];axis.min=0;axis.max=1;axis.ticks.stepSize=1;}
 let chart=existing?.chart;if(chart){chart.data.labels=labels;chart.data.datasets=datasets;chart.options=options;chart.update('none');}else chart=new Chart(canvas,{type,data:{labels,datasets},options});canvas.dataset.rendered='true';charts.set(id,{chart,fingerprint});
}
function trend(id,rows,admin=false,bar=false){const color=admin?'#7563c4':'#128c94';draw(id,bar?'bar':'line',rows.map(r=>r.date.slice(5)),[{label:'下载',data:rows.map(r=>r.down),borderColor:color,backgroundColor:bar?color:color+'18',fill:!bar,borderWidth:2,pointRadius:0,pointHitRadius:12,tension:.25,borderRadius:3},{label:'上传',data:rows.map(r=>r.up),borderColor:admin?'#d0b169':'#84cbb9',backgroundColor:admin?'#d0b16960':'#84cbb960',fill:!bar,borderWidth:1.5,pointRadius:0,pointHitRadius:12,tension:.25,borderRadius:3}],{stacked:bar});}
function render(){
 if(!snapshot)return;
 if(role==='user'){
  const daily=snapshot.routes.length?snapshot.daily:[];trend('user-trend',daily.slice(-days));trend('user-daily-chart',daily,false,true);
  const routes=[...snapshot.routes].sort((a,b)=>b.month.up+b.month.down-a.month.up-a.month.down).slice(0,8);
  draw('user-route-share','doughnut',routes.map(r=>r.name),[{label:'本月用量',data:routes.map(r=>r.month.up+r.month.down),backgroundColor:palette,borderWidth:0}]);
  const nodes=groupNodes(health?.nodes||[]).flatMap(g=>g.nodes);draw('user-latency','bar',nodes.map(n=>n.name),[{label:'HTTP 响应',data:nodes.map(httpResponseMs),backgroundColor:'#74bdb3',borderRadius:4}],{unit:'ms',horizontal:true});
  const count=statusCounts(nodes);draw('user-health','doughnut',['正常','异常','待检测/更新'],[{label:'节点',data:[count.normal,count.failed,count.unknown],backgroundColor:['#71c4a5','#da8c86','#d6e1e5'],borderWidth:0}],{unit:'count'});
 }else if(role==='admin'){
  const daily=mergeDaily(snapshot.users),rank=routeRanking(snapshot.users,snapshot.nodes);
  trend('admin-trend',daily,true);trend('admin-traffic-trend',daily,true,true);
  const users=[...snapshot.users].filter(u=>u.routes.length).sort((a,b)=>b.month.up+b.month.down-a.month.up-a.month.down).slice(0,8);
  draw('admin-user-ranking','bar',users.map(u=>u.username),[{label:'本月用量',data:users.map(u=>u.month.up+u.month.down),backgroundColor:'#9b8dd7',borderRadius:4}],{horizontal:true});
  draw('admin-route-ranking','bar',rank.map(r=>r.name),[{label:'上传',data:rank.map(r=>r.up),backgroundColor:'#beabdf',borderRadius:3},{label:'下载',data:rank.map(r=>r.down),backgroundColor:'#7967c0',borderRadius:3}],{horizontal:true,stacked:true});
  const counts=statusCounts(health?.nodes||[]);draw('admin-node-health','doughnut',['出口正常','出口异常','未确认'],[{label:'线路',data:[counts.normal,counts.failed,counts.unknown],backgroundColor:['#76bca5','#d99392','#cbd4e0'],borderWidth:0}],{unit:'count'});
  if(monitor){const records=monitor.servers.slice(0,20);draw('admin-resource-chart','bar',records.map(s=>s.name),[{label:'CPU',data:records.map(s=>s.online&&!monitor.stale?s.cpu:null),backgroundColor:'#9f8dcd',borderRadius:3},{label:'内存',data:records.map(s=>s.online&&!monitor.stale&&s.ram!==null&&s.ramTotal?s.ram/s.ramTotal*100:null),backgroundColor:'#7eabc5',borderRadius:3}],{unit:'percent',horizontal:true});const canvas=document.getElementById('admin-resource-chart');if(canvas?.getClientRects().length)canvas.closest('.chart-card').querySelector('.chart-note').textContent=monitor.stale?'监测暂不可用，图中不使用过期读数。':records.some(s=>!s.online)?'暂离线主机的读数显示为未知。':records.length?'':'尚未配置或读取到服务器资源。';}
 }
}
window.portalCharts={update:(data,status,kind)=>{snapshot=data;health=status;role=kind;render();},monitor:data=>{monitor=data;render();},render,clear:()=>{for(const [id,{chart}]of charts){chart.destroy();const canvas=document.getElementById(id);canvas.removeAttribute('data-rendered');canvas.setAttribute('aria-label','暂无数据');}charts.clear();snapshot=null;health=null;monitor=null;role=null;days=7;for(const button of document.querySelectorAll('[data-chart-days]'))button.setAttribute('aria-pressed',String(button.dataset.chartDays==='7'));}};
document.addEventListener('click',event=>{const button=event.target.closest('[data-chart-days]');if(!button)return;days=Number(button.dataset.chartDays);for(const b of document.querySelectorAll('[data-chart-days]'))b.setAttribute('aria-pressed',String(b===button));render();});
window.addEventListener('portal-theme-change',render);
