// Optional Windows-only integration. Two temporary Mihomo processes, loopback
// HTTP fixtures and fictional proxies; never uses TUN or the running client.
import assert from 'node:assert/strict';
import {access,mkdtemp,mkdir,copyFile,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomUUID,randomBytes} from 'node:crypto';
import {spawn} from 'node:child_process';
import http from 'node:http';
import net from 'node:net';
import YAML from 'yaml';
const binary=process.argv[2]||process.env.MIHOMO_BIN;
if(process.platform!=='win32'||!binary)throw Error('Windows and a Mihomo executable path are required');
await access(binary);
const directory=await mkdtemp(path.join(tmpdir(),'kenxu-cockpit-core-')),servers=[],children=[],sockets=new Set();
const secret=randomBytes(24).toString('hex');let outerHits=0;
async function listen(server){server.on('connection',socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));servers.push(server);return server.address().port;}
const selectedPorts=new Set();
async function freePort(){for(let attempt=0;attempt<20;attempt++){const server=net.createServer(),port=await listen(server);await new Promise(resolve=>server.close(resolve));servers.pop();if(!selectedPorts.has(port)){selectedPorts.add(port);return port;}}throw Error('Could not allocate distinct fixture ports');}
function controller(port,pathname){return fetch('http://127.0.0.1:'+port+pathname,{headers:{Authorization:'Bearer '+secret},signal:AbortSignal.timeout(2000)}).then(async response=>{assert.equal(response.status,200);return response.json();});}
async function core(executable,name,configuration){const data=path.join(directory,name);await mkdir(data);const file=path.join(data,'fixture.yaml');await writeFile(file,YAML.stringify(configuration));let output='',failed;const child=spawn(executable,['-d',data,'-f',file],{windowsHide:true,stdio:['ignore','pipe','pipe']});children.push(child);child.on('error',error=>failed=error);child.stdout.on('data',chunk=>output+=chunk);child.stderr.on('data',chunk=>output+=chunk);const end=Date.now()+8000;while(Date.now()<end){if(failed)throw Error('Fixture core spawn failed: '+failed.code);if(child.exitCode!==null)throw Error('Fixture core exited: '+output);try{await controller(Number(configuration['external-controller'].split(':').at(-1)),'/version');return child;}catch{}await new Promise(resolve=>setTimeout(resolve,40));}throw Error('Fixture core did not start: '+output);}
function base(port,control){return {'mixed-port':port,'external-controller':'127.0.0.1:'+control,secret,'allow-lan':false,'bind-address':'127.0.0.1',mode:'rule','find-process-mode':'strict','log-level':'warning',ipv6:false,tun:{enable:false},dns:{enable:false},proxies:[]};}
function request(port,target,token){const req=http.get({host:'127.0.0.1',port,path:'http://127.0.0.1:'+target+'/'+token,headers:{Host:'127.0.0.1:'+target,Connection:'close'}},response=>response.resume());req.on('error',()=>{});return req;}
try{
 const responses=new Map(),destination=await listen(http.createServer((req,res)=>{responses.set(req.url,res);res.writeHead(200,{'Content-Type':'text/plain'});res.write('fixture');}));
 const proxy=http.createServer();proxy.on('connect',(req,socket,head)=>{outerHits++;const [host,port]=req.url.split(':'),upstream=net.connect(Number(port),host,()=>{socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');if(head.length)upstream.write(head);socket.pipe(upstream);upstream.pipe(socket);});sockets.add(upstream);upstream.on('close',()=>sockets.delete(upstream));upstream.on('error',()=>socket.destroy());socket.on('error',()=>upstream.destroy());socket.on('close',()=>upstream.destroy());});
 const proxyPort=await listen(proxy),outerPort=await freePort(),outerControl=await freePort(),innerPort=await freePort(),innerControl=await freePort();
 const rules=(await readFile(new URL('../examples/cockpit-windows-direct.rules.txt',import.meta.url),'utf8')).split(/\r?\n/).map(line=>line.trim()).filter(line=>line&&!line.startsWith('#'));
 await core(binary,'outer',{...base(outerPort,outerControl),proxies:[{name:'Fixture outer proxy',type:'http',server:'127.0.0.1',port:proxyPort}],rules:[...rules,'MATCH,Fixture outer proxy']});
 const innerRoot=path.join(directory,'.cockpit_tools','proxy-engine','release-'+randomUUID());await mkdir(innerRoot,{recursive:true});const innerBinary=path.join(innerRoot,'mihomo.exe');await copyFile(binary,innerBinary);
 await core(innerBinary,'inner',{...base(innerPort,innerControl),proxies:[{name:'Fixture transit',type:'http',server:'127.0.0.1',port:outerPort}],rules:['MATCH,Fixture transit']});
 const first=request(innerPort,destination,'via-cockpit'),deadline=Date.now()+8000;while(!responses.has('/via-cockpit')&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,40));assert.ok(responses.has('/via-cockpit'),'The real inner engine request must arrive');
 let observed;for(let i=0;i<25;i++){const connections=await controller(outerControl,'/connections');observed=connections.connections.find(connection=>connection.metadata.processPath?.toLowerCase()===innerBinary.toLowerCase());if(observed)break;await new Promise(resolve=>setTimeout(resolve,40));}
 assert.ok(observed,'The outer core must identify the real inner engine process');console.log(JSON.stringify({phase:'cockpit',identifiedProcess:path.basename(observed.metadata.processPath),matchedRule:observed.rule,chain:observed.chains,outerHits}));assert.deepEqual(observed.chains,['DIRECT'],'The dedicated Cockpit engine must bypass the outer proxy');assert.equal(observed.rule,'ProcessPathRegex');assert.equal(outerHits,0);responses.get('/via-cockpit').end();first.destroy();
 const second=request(outerPort,destination,'ordinary'),secondDeadline=Date.now()+8000;while(!responses.has('/ordinary')&&Date.now()<secondDeadline)await new Promise(resolve=>setTimeout(resolve,40));assert.ok(responses.has('/ordinary'));assert.equal(outerHits,1,'An ordinary caller still follows the original proxy fallback');responses.get('/ordinary').end();second.destroy();
 console.log('PASS: real Cockpit-path core bypasses the outer hop; ordinary caller stays proxied; no live settings, nodes, credentials or TUN changed');
}finally{
 for(const child of children){if(child.pid&&child.exitCode===null&&child.signalCode===null){const exited=new Promise(resolve=>child.once('exit',resolve));child.kill();await exited;}}
 for(const socket of sockets)socket.destroy();for(const server of servers){server.closeAllConnections?.();await new Promise(resolve=>server.close(resolve));}
 const resolved=path.resolve(directory),root=path.resolve(tmpdir());assert.ok(path.dirname(resolved)===root&&path.basename(resolved).startsWith('kenxu-cockpit-core-'));await rm(resolved,{recursive:true,force:true});
}
