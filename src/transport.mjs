// Only a configured loopback Tunnel can describe the visitor's edge protocol.
// Its local HTTP transport is not the visitor's connection scheme.
export function insecureCloudflareRequest(req,trustCloudflare=false){
 if(!trustCloudflare||!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress))return false;
 let visitor;try{visitor=JSON.parse(req.headers['cf-visitor']||'null');}catch{}
 return req.headers['x-forwarded-proto']==='http'||visitor?.scheme==='http';
}
