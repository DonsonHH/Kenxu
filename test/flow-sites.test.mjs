import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {openStore} from '../src/store.mjs';

test('site visibility is strictly above 10 MiB after domain merging without discarding any observed bytes',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'flow-sites-')),s=openStore(dir),MiB=1024**2;
 try{
  s.importSource('proxies: [{name: Fixture, type: vless, server: example.test, port: 443}]');
  const proxy=s.inventory()[0],n=s.meter.register(proxy.id,'Fixture'),u=await s.createUser('friend','fixture-sites-password',[proxy.id]);
  await s.setPassword(u,'fixture-sites-password');
  const agent=s.meter.authenticate(n.token),email=s.meter.desired(agent).clients[0].email,at=Math.floor(Date.now()/60000)*60000;
  const row=(host,down,quality='actual')=>({id:host||'unknown',email,at,host,port:443,network:'tcp',source:'192.0.2.1',up:0,down,quality});
  const body={schema:1,epoch:'sites',seq:1,at:Date.now(),records:[row('api.example.com',6*MiB),row('cdn.example.com',5*MiB),row('equal.example.net',10*MiB),row('small.example.org',MiB),row('',2*MiB,'unknown-capacity')]};
  s.flows.report(agent,body);
  const result=s.flows.summary(u);
  assert.deepEqual(result.sites.map(r=>r.site),['example.com']);
  assert.equal(result.sites[0].actual.down,11*MiB);
  assert.equal(result.minimumSiteBytes,10*MiB);
  assert.equal(result.siteCount,3);
  assert.equal(result.visibleSiteCount,1);
  assert.equal(result.smallSites.count,2);
  assert.deepEqual(result.smallSites.total,{up:0,down:11*MiB});
  assert.deepEqual(result.total,{up:0,down:24*MiB});
  assert.deepEqual(result.unknown,{up:0,down:2*MiB});
  assert.deepEqual(s.meter.totals(u).total,{up:0,down:0},'Classification never adds a second bill');
  assert.equal(s.flows.summary(u,{target:'example.net'}).sites.length,0,'Filters do not bypass the threshold');
  assert.equal(s.flows.report(agent,body).duplicate,true);
  assert.deepEqual(s.flows.summary(u).total,result.total);
 }finally{s.close();await rm(dir,{recursive:true,force:true});}
});
