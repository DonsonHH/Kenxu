import http from 'node:http';
import {insecureCloudflareRequest} from './transport.mjs';

// Fixed, loopback-only WebSocket bridge. The Xray inbound authenticates each
// connection using its per-user VLESS UUID; portal cookies never reach the core.
export function attachRelay(server,{port=4460,path='/relay/v1',limit=256,requireHttps=false,trustCloudflare=false}={}){
 const sockets=new Set();
 server.on('upgrade',(req,socket,head)=>{
  if(requireHttps&&insecureCloudflareRequest(req,trustCloudflare)){socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\nCache-Control: no-store\r\n\r\n');return;}
  if(req.url!==path||req.method!=='GET'||req.headers.upgrade?.toLowerCase()!=='websocket'||sockets.size>=limit){socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');return;}
  sockets.add(socket);socket.once('close',()=>sockets.delete(socket));socket.on('error',()=>socket.destroy());
  const headers={host:'127.0.0.1:'+port,upgrade:'websocket',connection:'Upgrade'};
  for(const name of ['sec-websocket-key','sec-websocket-version','sec-websocket-protocol'])if(req.headers[name])headers[name]=req.headers[name];
  const upstream=http.request({host:'127.0.0.1',port,path,method:'GET',headers});
  upstream.setTimeout(10000,()=>upstream.destroy());
  upstream.on('upgrade',(response,remote,remoteHead)=>{
   upstream.setTimeout(0);remote.on('error',()=>{socket.destroy();remote.destroy();});
   socket.once('close',()=>remote.destroy());remote.once('close',()=>{if(!remote.readableEnded)socket.destroy();});
   const reply=['HTTP/1.1 101 Switching Protocols'];
   for(const name of ['upgrade','connection','sec-websocket-accept','sec-websocket-protocol'])if(response.headers[name])reply.push(name+': '+response.headers[name]);
   socket.write(reply.join('\r\n')+'\r\n\r\n');
   if(remoteHead.length)socket.write(remoteHead);if(head.length)remote.write(head);
   socket.pipe(remote);remote.pipe(socket);
  });
  upstream.on('response',response=>{response.resume();socket.end('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n');});
  upstream.on('error',()=>socket.destroy());socket.once('close',()=>upstream.destroy());upstream.end();
 });
 return ()=>{for(const socket of sockets)socket.destroy();};
}
