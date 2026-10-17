import {openStore} from './store.mjs';
import {readFile} from 'node:fs/promises';
import {emitKeypressEvents} from 'node:readline';
import path from 'node:path';
async function hiddenPassword(prompt){
 if(!process.stdin.isTTY)throw Error('请在交互终端输入密码，不支持命令行或环境变量传密码');
 process.stdout.write(prompt);emitKeypressEvents(process.stdin);process.stdin.setRawMode(true);process.stdin.resume();
 return new Promise((resolve,reject)=>{
  let input='';const done=()=>{process.stdin.removeListener('keypress',handler);process.stdin.setRawMode(false);process.stdin.pause();process.stdout.write('\n');};
  const handler=(str,key)=>{if(key?.ctrl&&key.name==='c'){done();reject(Error('已取消'));}else if(key?.name==='return'){done();resolve(input);}else if(key?.name==='backspace'){input=input.slice(0,-1);}else if(str&&!key?.ctrl&&!/[\r\n]/.test(str)&&input.length<128){input+=str;}};
  process.stdin.on('keypress',handler);
 });
}
const [command,value,...extra]=process.argv.slice(2);
const store=openStore(path.resolve(process.env.DATA_DIR||'data'));
try{
 if(command==='create-admin'){
  if(store.listUsers().some(u=>u.role==='admin'))throw Error('管理员已存在；不覆盖现有密码');
  const password=await hiddenPassword('管理员密码（至少 12 位，不回显）：');
  if(password!==await hiddenPassword('再次输入：'))throw Error('两次输入不一致');
  await store.createUser(value||'donson',password,[],'admin');console.log('管理员已创建');
 }else if(command==='import'){
  if(!value)throw Error('请指定配置文件路径');store.importSource(await readFile(value,'utf8'));console.log(`已导入 ${store.inventory().length} 个节点，未输出凭据`);
 }else if(command==='retire-node'){
  if(!value)throw Error('请指定完整节点名称');console.log(JSON.stringify(store.retireNode(value)));
 }else if(command==='group-options'){
  const user=store.findUser(value);if(!user||user.role!=='user')throw Error('请指定现有普通用户');
  const state=store.groupAdditionsState(user.id);if(!extra.length)console.log(JSON.stringify(state));
  else console.log(JSON.stringify(store.saveGroupAdditions({revision:state.revision,groupName:extra[0],nodes:extra.slice(1)},user.id)));
 }else throw Error('用法：node src/admin.mjs create-admin <用户名>、import <私有 YAML 路径>、retire-node <完整节点名称> 或 group-options <用户名> [组名 [节点名...]]');
}catch(e){console.error(e.message);process.exitCode=1;}finally{store.close();}
