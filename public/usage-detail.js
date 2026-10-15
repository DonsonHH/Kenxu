export function renderUsageOverview(container,data,{node,bytes,kind='user',name=value=>value}){
 const sum=v=>bytes((v?.up||0)+(v?.down||0)),totals=data.totals||data;
 function table(headings,rows){
  const wrapper=node('div',undefined,'table-scroll'),t=node('table'),head=node('thead'),tr=node('tr'),body=node('tbody');
  for(const h of headings){const th=node('th',h);th.scope='col';tr.append(th);}head.append(tr);
  for(const values of rows){const r=node('tr');for(const value of values)r.append(node('td',String(value)));body.append(r);}
  t.append(head,body);wrapper.append(t);return wrapper;
 }
 const stats=node('div',undefined,'detail-stats');
 for(const [label,amount]of [['今日',totals.today],['本月',totals.month],['累计',totals.total]]){const d=node('div');d.append(node('span',label+' · 上传 + 下载'),node('strong',sum(amount)));stats.append(d);}
 container.replaceChildren(stats,node('p','入口计量账本 · 北京时间；不含直连未计量线路。下方连接分类不再次计费。','fine'));
 if(kind==='user')container.append(node('h3','按线路分配'),table(['线路','类型','今日合计','本月上传','本月下载','累计合计'],data.routes.map(r=>[name(r.name),r.kind==='direct-unmetered'?'直连 · 仅历史用量':r.kind==='relay'?'Jetson 中转':r.kind==='forwarded'?'UK 转发':'自建',sum(r.today),bytes(r.month.up),bytes(r.month.down),sum(r.total)])));
 else container.append(node('h3','按用户分配'),table(['账号','昵称','今日合计','本月上传','本月下载','累计合计'],data.users.map(u=>[u.username,u.displayName||'—',sum(u.totals.today),bytes(u.totals.month.up),bytes(u.totals.month.down),sum(u.totals.total)])));
 const daily=node('details',undefined,'usage-daily-details');daily.append(node('summary','每日用量 · 最近 30 天'),table(['日期','上传','下载','合计'],[...data.daily].reverse().map(d=>[d.date,bytes(d.up),bytes(d.down),sum(d)])));container.append(daily);
}
