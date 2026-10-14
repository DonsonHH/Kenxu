import {test} from 'node:test';import assert from 'node:assert/strict';import {DatabaseSync} from 'node:sqlite';
import {createIpLocation,isPublicIp} from '../src/ip-location.mjs';
test('IPinfo enrichment is admin-triggered, observed-source-only, bounded, cached and never available for private IPs',async()=>{
 const db=new DatabaseSync(':memory:');let requests=0,release;
 const store={db,activity:{hasSource:(user,ip)=>user==='owner'&&['8.8.8.8','1.1.1.1'].includes(ip)}};
 const lookup=createIpLocation(store,{token:'fictional-token',fetchImpl:async(url,options)=>{requests++;assert.equal(url,'https://ipinfo.io/8.8.8.8/json');assert.equal(options.headers.Authorization,'Bearer fictional-token');assert.equal(options.redirect,'error');await new Promise(resolve=>{release=resolve;});return new Response(JSON.stringify({ip:'8.8.8.8',country:'US',region:'California',city:'Mountain View',org:'AS15169 Google LLC',loc:'must-not-persist',postal:'must-not-persist',hostname:'must-not-persist',extra:'ignored'}));}});
 assert.equal(requests,0);assert.equal(lookup.peek('8.8.8.8'),null);await assert.rejects(lookup.lookup('foreign','8.8.8.8'));await assert.rejects(lookup.lookup('owner','127.0.0.1'));await assert.rejects(lookup.lookup('owner','8.8.8.8/../../me'));
 const a=lookup.lookup('owner','8.8.8.8'),b=lookup.lookup('owner','8.8.8.8');await new Promise(resolve=>setImmediate(resolve));assert.equal(requests,1);release();const result=await a;await b;assert.equal(result.precision,'city');assert.equal(result.region,'California');assert.equal(result.city,'Mountain View');assert.equal(result.network,'Google LLC');assert.ok(!JSON.stringify(result).includes('must-not-persist'));await lookup.lookup('owner','8.8.8.8');assert.equal(requests,1);assert.equal(lookup.peek('8.8.8.8').provider,'ipinfo-legacy');
 db.prepare('UPDATE ip_location_cache SET expires=?').run(Date.now()-1);assert.equal(lookup.peek('8.8.8.8'),null);assert.equal(lookup.prune(),1);db.close();
});
test('Legacy capability upgrades a Lite cache once and caches legitimate missing cities without inventing one',async()=>{
 const db=new DatabaseSync(':memory:');let calls=0;const lookup=createIpLocation({db,activity:{hasSource:()=>true}},{token:'fixture',fetchImpl:async()=>{calls++;return new Response(JSON.stringify({ip:'8.8.8.8',country:'US',org:'AS15169 Google LLC'}));}}),now=Date.now();
 db.prepare('INSERT INTO ip_location_cache VALUES(?,?,?,?)').run('8.8.8.8',now,now+86400000,JSON.stringify({provider:'ipinfo-lite',countryCode:'US',precision:'country'}));assert.equal(lookup.peek('8.8.8.8'),null);
 const result=await lookup.lookup('owner','8.8.8.8');assert.equal(result.city,'');assert.equal(result.region,'');assert.equal(result.precision,'country');await lookup.lookup('owner','8.8.8.8');assert.equal(calls,1);db.close();
});
test('Legacy rejects Lite-shaped, mismatched, oversized and forbidden responses without switching endpoints',async()=>{
 for(const response of [()=>new Response(JSON.stringify({ip:'1.1.1.1',country:'US'})),()=>new Response(JSON.stringify({ip:'8.8.8.8',country:'United States',country_code:'US'})),()=>new Response('x'.repeat(17000)),()=>new Response('{}',{status:403})]){
  const db=new DatabaseSync(':memory:');let calls=0;const lookup=createIpLocation({db,activity:{hasSource:()=>true}},{token:'fixture',fetchImpl:async url=>{calls++;assert.ok(url.startsWith('https://ipinfo.io/'));return response();}});await assert.rejects(lookup.lookup('owner','8.8.8.8'),/暂不可用/);assert.equal(calls,1);assert.equal(lookup.peek('8.8.8.8'),null);db.close();
 }
});
test('equivalent IPv6 response formatting is accepted without allowing scoped/private source addresses',async()=>{
 const db=new DatabaseSync(':memory:'),lookup=createIpLocation({db,activity:{hasSource:()=>true}},{token:'fixture',fetchImpl:async()=>new Response(JSON.stringify({ip:'2001:4860:4860::8888',country:'US',region:'California',city:'Mountain View'}))});
 const result=await lookup.lookup('owner','2001:4860:4860:0:0:0:0:8888');assert.equal(result.precision,'city');assert.equal(result.city,'Mountain View');db.close();
});
test('global IP checks and provider failures do not disclose arbitrary local addresses or poison successful cached locations',async()=>{
 for(const ip of ['127.0.0.1','10.0.0.1','192.168.1.1','169.254.1.1','192.0.2.1','224.0.0.1','::1','::ffff:127.0.0.1','fc00::1','fe80::1','2001:db8::1','2001:4860::1%eth0','not-an-ip'])assert.equal(isPublicIp(ip),false,ip);
 assert.ok(isPublicIp('8.8.8.8'));assert.ok(isPublicIp('2001:4860:4860::8888'));
 const db=new DatabaseSync(':memory:'),store={db,activity:{hasSource:()=>true}},lookup=createIpLocation(store,{token:'fixture',fetchImpl:async()=>new Response('provider-private-debug',{status:429})});
 await assert.rejects(lookup.lookup('owner','8.8.8.8'),/暂不可用/);assert.equal(lookup.peek('8.8.8.8'),null);await assert.rejects(lookup.lookup('owner','8.8.8.8'),/稍后/);assert.ok(!JSON.stringify(db.prepare('SELECT * FROM ip_location_cache').all()).includes('provider-private-debug'));db.close();
});
