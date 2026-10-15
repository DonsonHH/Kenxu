import {isIP} from 'node:net';
import {getDomain} from 'tldts';
export const website=host=>isIP(host)?host:getDomain(host,{allowPrivateDomains:true})||host;
const add=(a,b)=>{a.up+=b.up;a.down+=b.down;},amount=()=>({up:0,down:0});
export function groupActivity(windows,observations,{source='',target='',sourceLimit=10}={}){
 const meta=new Map(),sites=new Map(),sources=new Map(),total=amount(),withoutTargets=amount();let observedWindows=0,windowCount=0;
 for(const row of observations){const key=row.node_id+'|'+row.bucket;let m=meta.get(key);if(!m)meta.set(key,m={ips:new Map(),hosts:new Set()});
  for(const ip of JSON.parse(row.sources)){const old=m.ips.get(ip);m.ips.set(ip,{first:Math.min(old?.first??row.at,row.at),last:Math.max(old?.last??row.at,row.at)});}
  for(const t of JSON.parse(row.targets))m.hosts.add(t.host);
 }
 for(const row of windows){const m=meta.get(row.node_id+'|'+row.bucket);if(source&&!m?.ips.has(source)||target&&![...(m?.hosts||[])].some(h=>h.toLowerCase().includes(target.toLowerCase())))continue;
  windowCount++;add(total,row);if(!m?.hosts.size)add(withoutTargets,row);else observedWindows++;
  const seen=new Set();for(const host of m?.hosts||[]){if(target&&!host.toLowerCase().includes(target.toLowerCase()))continue;const site=website(host);let item=sites.get(site);if(!item)sites.set(site,item={site,related:amount(),windows:0,hosts:new Set(),lastSeen:0});item.hosts.add(host);if(!seen.has(site)){add(item.related,row);item.windows++;seen.add(site);}item.lastSeen=Math.max(item.lastSeen,...[...m.ips.values()].map(v=>v.last),row.bucket);}
  for(const [ip,value]of m?.ips||[]){let item=sources.get(ip);if(!item)sources.set(ip,item={ip,firstSeen:value.first,lastSeen:value.last,windows:0});item.firstSeen=Math.min(item.firstSeen,value.first);item.lastSeen=Math.max(item.lastSeen,value.last);item.windows++;}
 }
 const sorted=[...sites.values()].sort((a,b)=>(b.related.up+b.related.down)-(a.related.up+a.related.down)||a.site.localeCompare(b.site));
 return {total,withoutTargets,observedWindows,windowCount,siteCount:sorted.length,sites:sorted.slice(0,10).map(s=>({...s,hostCount:s.hosts.size,hosts:[...s.hosts].sort().slice(0,8)})),sourceCount:sources.size,sources:[...sources.values()].sort((a,b)=>b.lastSeen-a.lastSeen).slice(0,sourceLimit),scope:'related-windows',additive:false};
}
