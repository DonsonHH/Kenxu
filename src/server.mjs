import path from 'node:path';
import {openStore} from './store.mjs';
import {createApp} from './app.mjs';
import {attachRelay} from './relay.mjs';
import {readFileSync,existsSync} from 'node:fs';
import {createChainProfiles} from './chain-profile.mjs';
if(process.env.NODE_ENV==='production'&&(!process.env.DATA_DIR||!process.env.PUBLIC_ORIGIN))throw Error('Production requires explicit DATA_DIR and PUBLIC_ORIGIN');
const store=openStore(path.resolve(process.env.DATA_DIR||'data'));
const chainFile=path.join(path.resolve(process.env.DATA_DIR||'data'),'jetson-chain.json');
const chainProfiles=createChainProfiles(store,existsSync(chainFile)?JSON.parse(readFileSync(chainFile,'utf8')):null);
const userPort=Number(process.env.PORT||4450),adminPort=Number(process.env.ADMIN_PORT||4451);
const origin=process.env.PUBLIC_ORIGIN||`http://127.0.0.1:${userPort}`;
const adminOrigin=process.env.ADMIN_ORIGIN||`http://127.0.0.1:${adminPort}`;
const servers=[
 createApp({store,origin,trustCloudflare:new URL(origin).protocol==='https:',chainProfiles}).listen(userPort,'127.0.0.1',()=>console.log(`User portal: 127.0.0.1:${userPort}`)),
 createApp({store,origin:adminOrigin,subscriptionOrigin:origin,admin:true,chainProfiles}).listen(adminPort,'127.0.0.1',()=>console.log(`Private administration: 127.0.0.1:${adminPort}`)),
];
const closeRelay=attachRelay(servers[0]);
store.aiStatus.start();
const auditMaintenance=setInterval(()=>{store.pruneAudit();store.activity.prune();store.ipLocation.prune();store.flows.prune();},3600000);auditMaintenance.unref();
let closing=false;
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>{if(closing)return;closing=true;clearInterval(auditMaintenance);closeRelay();void store.aiStatus.stop().finally(()=>{let remaining=servers.length;for(const s of servers)s.close(()=>{if(--remaining===0){store.close();process.exit(0);}});});setTimeout(()=>process.exit(1),5000).unref();});
