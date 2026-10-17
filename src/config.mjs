import YAML from 'yaml';
import {createHash} from 'node:crypto';
import {compatibleRule,ruleParts,BUILTIN_TARGETS,validateRules} from './rules.mjs';
const builtin=new Set(BUILTIN_TARGETS);
const idFor=name=>createHash('sha256').update(name).digest('hex').slice(0,24);
export function parseSource(text){
  if(typeof text!=='string'||Buffer.byteLength(text)>524288)throw Error('配置不能超过 512 KiB');
  const source=YAML.parse(text,{maxAliasCount:20,uniqueKeys:true});
  if(!source || !Array.isArray(source.proxies) || source.proxies.length<1 || source.proxies.length>200)throw Error('需要 1–200 个节点');
  if(source['proxy-providers'])throw Error('第一版不接受 proxy-providers，请提供显式节点');
  const names=new Set();
  for(const p of source.proxies){
    if(!p||typeof p.name!=='string'||!p.name.trim()||p.name.length>100||/[,\x00-\x1f]/.test(p.name)||builtin.has(p.name)||names.has(p.name))throw Error('节点名称无效或重复');
    if(typeof p.type!=='string'||typeof p.server!=='string'||!Number.isInteger(p.port)||p.port<1||p.port>65535)throw Error('节点连接字段不完整');
    if(p['kenxu-user-hidden']!==undefined&&typeof p['kenxu-user-hidden']!=='boolean')throw Error('节点可见性必须为布尔值');
    names.add(p.name);
  }
  if(source['proxy-groups']&&(!Array.isArray(source['proxy-groups'])||source['proxy-groups'].length>100))throw Error('策略组列表无效');
  for(const g of source['proxy-groups']||[]){
    if(!g||typeof g.name!=='string'||!g.name.trim()||g.name.length>100||/[,\x00-\x1f]/.test(g.name)||names.has(g.name)||builtin.has(g.name)||!Array.isArray(g.proxies)||g.proxies.length>300||g.use)throw Error('策略组无效、重名或引用了外部节点池');
    names.add(g.name);
  }
  const groups=new Map((source['proxy-groups']||[]).map(g=>[g.name,g]));
  const visited=new Set();
  function visit(name,stack=new Set()){
    if(stack.has(name))throw Error('不接受循环策略组');
    if(visited.has(name))return;
    const g=groups.get(name);if(!g)return;
    const next=new Set(stack).add(name);
    for(const ref of g.proxies){if(typeof ref!=='string'||(!names.has(ref)&&!builtin.has(ref)))throw Error('策略组存在无效引用');visit(ref,next);}
    visited.add(name);
  }
  for(const name of groups.keys())visit(name);
  if(source.rules&&!Array.isArray(source.rules))throw Error('rules 必须为列表');
  validateRules(source.rules||[],source);
  return source;
}
export function inventory(source){return source.proxies.map(p=>({id:idFor(p.name),name:p.name,type:p.type,...(p['kenxu-user-hidden']?{userHidden:true}:{})}));}
function selectSource(source,allowed){
  const selected=new Set(allowed);
  const proxies=source.proxies.filter(p=>selected.has(idFor(p.name)));
  const proxyNames=new Set(proxies.map(p=>p.name));
  for(const p of proxies)if(p['dialer-proxy']&&!proxyNames.has(p['dialer-proxy'])&&!builtin.has(p['dialer-proxy']))throw Error('所选节点依赖尚未授权的前置节点');
  const inputGroups=source['proxy-groups']||[];
  // Only keep groups reachable from an authorized node or a built-in policy.
  const reachable=new Set([...builtin,...proxyNames]);
  for(let i=0;i<inputGroups.length;i++)for(const g of inputGroups)if(g.proxies.some(p=>reachable.has(p)))reachable.add(g.name);
  const groups=inputGroups.filter(g=>reachable.has(g.name)).map(g=>{
    const output=structuredClone(g);
    output.proxies=g.proxies.filter(p=>reachable.has(p));
    delete output['include-all'];delete output['include-all-proxies'];delete output['include-all-providers'];delete output.filter;delete output['exclude-filter'];
    return output;
  });
  return {proxies,groups,reachable};
}
export function ruleTargets(source,allowed){return [...selectSource(source,allowed).reachable];}
export function generateConfig(source,allowed,groupAdditions=[]){
  if(groupAdditions.length){
    const selected=new Set(allowed),nodes=new Set(source.proxies.filter(p=>selected.has(idFor(p.name))).map(p=>p.name));
    source={...source,'proxy-groups':(source['proxy-groups']||[]).map(group=>{
      if(group.type!=='select')return group;
      const extra=groupAdditions.find(row=>row.groupName===group.name)?.nodes||[];
      return {...group,proxies:[...new Set([...group.proxies,...extra.filter(name=>nodes.has(name))])]};
    })};
  }
  const {proxies,groups,reachable}=selectSource(source,allowed);
  if(!proxies.length)throw Error('尚未分配可用节点');
  const rules=(source.rules||[]).map(rule=>{
    if(typeof rule!=='string')throw Error('规则必须为字符串');
    const {parts,target,targetIndex}=ruleParts(rule);
    if(!reachable.has(target))parts[targetIndex]='REJECT';
    return compatibleRule(parts.join(','));
  });
  const clientProxies=structuredClone(proxies);for(const proxy of clientProxies)delete proxy['kenxu-user-hidden'];
  const result={'mixed-port':7890,'allow-lan':false,mode:'rule','log-level':'warning',proxies:clientProxies};
  // Do not publish controller secrets, local scripts or arbitrary top-level data.
  if(source.dns)result.dns=structuredClone(source.dns);
  if(source['rule-providers'])result['rule-providers']=structuredClone(source['rule-providers']);
  result['proxy-groups']=groups;
  result.rules=rules;
  if(!rules.some(r=>r.startsWith('MATCH,')))result.rules.push(`MATCH,${groups[0]?.name||proxies[0].name}`);
  return '# Kenxu — 私人配置。请勿转发订阅链接或节点凭据。\n'+YAML.stringify(result);
}
