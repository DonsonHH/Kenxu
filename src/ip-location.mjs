import {isIP,BlockList} from 'node:net';
const blocked=new BlockList();
for(const [ip,prefix]of [['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],['169.254.0.0',16],['172.16.0.0',12],['192.0.0.0',24],['192.0.2.0',24],['192.88.99.0',24],['192.168.0.0',16],['198.18.0.0',15],['198.51.100.0',24],['203.0.113.0',24],['224.0.0.0',4],['240.0.0.0',4]])blocked.addSubnet(ip,prefix);
blocked.addSubnet('2001:db8::',32,'ipv6');
export const isPublicIp=ip=>typeof ip==='string'&&(isIP(ip)===4?!blocked.check(ip):isIP(ip)===6&&/^[23]/.test(ip)&&!blocked.check(ip,'ipv6'));
const invalid=message=>Object.assign(Error(message),{statusCode:400});
const text=(v,max)=>typeof v==='string'?v.replace(/[\x00-\x1f]/g,'').slice(0,max):'';
export function createIpLocation(store,{token=process.env.IPINFO_TOKEN||'',fetchImpl=fetch}={}){
 const db=store.db,inflight=new Map();let active=0;
 db.exec('CREATE TABLE IF NOT EXISTS ip_location_cache(ip TEXT PRIMARY KEY,checked INTEGER NOT NULL,expires INTEGER NOT NULL,payload TEXT NOT NULL); CREATE INDEX IF NOT EXISTS ip_location_expiry ON ip_location_cache(expires)');
 const prune=()=>db.prepare('DELETE FROM ip_location_cache WHERE expires<?').run(Date.now()).changes;
 const cached=ip=>db.prepare('SELECT payload FROM ip_location_cache WHERE ip=? AND expires>?').get(ip,Date.now());
 const peek=ip=>{const r=cached(ip);if(!r)return null;const value=JSON.parse(r.payload);return value.error?null:value;};prune();
 async function lookup(userId,ip){
  if(!isPublicIp(ip)||!store.activity.hasSource(userId,ip))throw invalid('只能查询该用户近 30 天实际使用的公网来源 IP');
  if(!token)throw invalid('未配置 IPinfo Lite 查询凭据');const saved=cached(ip);if(saved){const value=JSON.parse(saved.payload);if(value.error)throw invalid('归属查询暂不可用，请稍后再试');return {...value,cached:true};}
  if(inflight.has(ip))return inflight.get(ip);if(active>=2)throw invalid('归属查询繁忙，请稍后重试');active++;
  const pending=Promise.resolve().then(async()=>{try{
   const response=await fetchImpl('https://api.ipinfo.io/lite/'+encodeURIComponent(ip),{headers:{Authorization:'Bearer '+token,Accept:'application/json'},redirect:'error',signal:AbortSignal.timeout(5000)});
   if(!response.ok)throw Error();let size=0,raw='';const reader=response.body.getReader(),decoder=new TextDecoder();
   try{while(true){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>16384){await reader.cancel();throw Error();}raw+=decoder.decode(value,{stream:true});}raw+=decoder.decode();}finally{reader.releaseLock();}
   const input=JSON.parse(raw);if(input.ip!==ip||!/^([A-Z]{2})$/.test(input.country_code||''))throw Error();
   const now=Date.now(),value={ip,provider:'ipinfo-lite',precision:'country',country:text(input.country,100),countryCode:input.country_code,continent:text(input.continent,80),asn:/^AS\d{1,12}$/.test(input.asn||'')?input.asn:'',network:text(input.as_name,200),checkedAt:now,expiresAt:now+7*86400000};
   db.prepare('INSERT OR REPLACE INTO ip_location_cache VALUES(?,?,?,?)').run(ip,now,value.expiresAt,JSON.stringify(value));return value;
  }catch{const now=Date.now();db.prepare('INSERT OR REPLACE INTO ip_location_cache VALUES(?,?,?,?)').run(ip,now,now+5*60000,'{"error":true}');throw invalid('归属查询暂不可用，现有离线信息不受影响');}finally{active--;inflight.delete(ip);}});
  inflight.set(ip,pending);return pending;
 }
 return {lookup,peek,prune,enabled:!!token};
}
