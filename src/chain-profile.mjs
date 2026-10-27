import {isIP} from 'node:net';
import YAML from 'yaml';
import {inventory} from './config.mjs';
import {ruleParts} from './rules.mjs';

const LAN4=['0.0.0.0/8','10.0.0.0/8','100.64.0.0/10','127.0.0.0/8','169.254.0.0/16','172.16.0.0/12','192.168.0.0/16','224.0.0.0/4'];
const LAN6=['::/128','::1/128','fc00::/7','fe80::/10','ff00::/8'];
export const CHAIN_PROFILE='jetson-chain';
export const JETSON_DIRECT='Jetson · 国内直出';
export const CHAIN_LOCAL_RULES=[
 ...['tailscaled.exe','tailscale.exe','tailscale-ipn.exe','tailscaled','tailscale'].map(name=>'PROCESS-NAME,'+name+',DIRECT'),
 ...['localhost','local','lan','home.arpa','ts.net','tailscale.com','tailscale.io'].map(name=>'DOMAIN-SUFFIX,'+name+',DIRECT'),
 'DOMAIN-REGEX,^[^.]+$,DIRECT',
 ...LAN4.map(cidr=>'IP-CIDR,'+cidr+',DIRECT,no-resolve'),...LAN6.map(cidr=>'IP-CIDR6,'+cidr+',DIRECT,no-resolve'),
];
export function createChainProfiles(store,settings){
 if(!settings)return null;
 if(typeof settings.ownerUserId!=='string'||isIP(settings.gateway?.server)!==4||Number(settings.gateway.server.split('.')[0])!==100||Number(settings.gateway.server.split('.')[1])<64||Number(settings.gateway.server.split('.')[1])>127||!Number.isInteger(settings.gateway.port)||settings.gateway.port<1024||settings.gateway.port>65535||typeof settings.gateway.uuid!=='string'||!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(settings.gateway.uuid)||!Array.isArray(settings.endpoints)||!settings.endpoints.length)throw Error('Invalid private chain configuration');
 const endpoints=new Set(settings.endpoints.map(item=>item.server+':'+item.port));
 const owned=user=>user?.id===settings.ownerUserId&&user.role==='user'&&store.isActive(user)&&!user.must_change;
 const owner=()=>{const user=store.getUser(settings.ownerUserId);return owned(user)?user:null;};
 return {
  available:owned,
  owner,
  info:user=>owned(user)?{profile:CHAIN_PROFILE,label:'Jetson 链式分流',client:'Mihomo / Clash Meta',description:'国内由 Jetson 直出，国外按原规则经 Jetson → 自有 VPS；保持规则模式并先连接 Tailscale。'}:null,
  config(user){
   if(!owned(user))throw Error('Chain profile unavailable');
   const source=store.source(),meters=store.meter.nodes(),granted=new Set(JSON.parse(user.grants));
   const allowed=inventory(source).filter(route=>{const meter=meters.find(m=>m.proxy_id===route.id),proxy=source.proxies.find(p=>p.name===route.name);return granted.has(route.id)&&meter?.enabled&&!meter.direct_delivery&&!meter.client_template&&proxy.type==='vless'&&endpoints.has(proxy.server+':'+proxy.port);}).map(node=>node.id);
   if(!allowed.length)throw Error('No managed routes available');
   const config=YAML.parse(store.config({...user,grants:JSON.stringify(allowed)}));
   assertNoCollision(config);
   for(const proxy of config.proxies){if(proxy['dialer-proxy'])throw Error('Nested source dialer requires explicit review');proxy['dialer-proxy']=JETSON_DIRECT;}
   config.proxies.push({name:JETSON_DIRECT,type:'vless',server:settings.gateway.server,port:settings.gateway.port,uuid:settings.gateway.uuid,network:'tcp',tls:false,udp:true,'packet-encoding':'xudp','dialer-proxy':'DIRECT'});
   config['proxy-groups']=config['proxy-groups'].map(group=>({...group,proxies:group.proxies.map(ref=>ref==='DIRECT'?JETSON_DIRECT:ref)}));
   // GLOBAL is restricted as well: never offer the raw transport or a local
   // direct policy as an accidental global internet exit.
   const main=config['proxy-groups'].find(group=>group.name==='Donson - Proxy')?.name||config['proxy-groups'][0]?.name||config.proxies[0].name;
   config['proxy-groups'].push({name:'GLOBAL',type:'select',hidden:true,proxies:[main]});
   config.rules=[...CHAIN_LOCAL_RULES,...config.rules.map(rule=>{const p=ruleParts(rule);if(p.target==='DIRECT')p.parts[p.targetIndex]=JETSON_DIRECT;return p.parts.join(',');})];
   config.dns={enable:true,ipv6:false,'enhanced-mode':'fake-ip','fake-ip-range':'198.18.0.1/16','fake-ip-filter':['*.lan','*.local','*.home.arpa','localhost','*.ts.net','*.tailscale.com'],'default-nameserver':['223.5.5.5','119.29.29.29'],nameserver:['https://dns.alidns.com/dns-query#'+JETSON_DIRECT],'proxy-server-nameserver':['223.5.5.5'],'respect-rules':true};
   return '# Kenxu Jetson 链式分流 · 仅限本人。先连接 Tailscale，保持规则模式。\n# 国内 DIRECT → Jetson；国外 → Jetson → 自有 VPS；仅内网及 Tailscale 传输本地直连。\n'+YAML.stringify(config);
  },
 };
}
function assertNoCollision(config){if([...config.proxies,...config['proxy-groups']].some(item=>[JETSON_DIRECT,'GLOBAL'].includes(item.name)))throw Error('Reserved chain profile name conflict');}
