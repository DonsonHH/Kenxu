import {displayNodeName} from '/node-model.js';
import {createButtonFeedback} from './button-feedback.js';
export function createRulesUI({api,node,getUsers,getPanel,tell,onUnauthorized}){
 const $=selector=>document.querySelector(selector),form=$('#rules-form'),owner=$('#rules-owner'),mode=$('#rules-mode'),content=$('#rules-content');
 let state=null,loadedOwner='',dirty=false,busy=false,generation=0,sequence=0;
 const saveFeedback=createButtonFeedback($('#rules-save'));
 const endpoint=id=>id?'/api/admin/users/'+encodeURIComponent(id)+'/rules':'/api/admin/rules';
 function controls(){owner.disabled=busy;mode.disabled=busy||!state;content.disabled=busy||!state||state.scope==='user'&&mode.value==='inherit';for(const id of ['rules-save','rules-preview','rules-add','rules-copy'])$('#'+id).disabled=busy||!state;$('#rules-reload').disabled=busy;$('#rules-add').disabled=busy||!state||content.disabled;$('#rules-copy').hidden=state?.scope!=='user';}
 function clearPreview(){$('#rules-preview-list').replaceChildren();$('#rules-preview-summary').textContent='尚未预览';$('#rules-warnings').replaceChildren();}
 function note(){
  $('#rules-mode-label').hidden=state?.scope!=='user';
  $('#rules-scope-note').textContent=!state?'':state.scope==='global'?'全局默认规则影响继承和补充方案；独立方案不会跟随规则内容变化。':mode.value==='inherit'?`使用当前全局规则（${state.baseRuleCount} 条）。选择补充或独立模式可以为此用户定制。`:mode.value==='prepend'?'补充规则先于全局规则匹配；不要填写 MATCH，全局列表负责后续分流与兜底。':'只使用个人规则。没有 MATCH 时会保存当前兜底策略，之后不跟随全局规则变化。';
 }
 function render(value){state=value;loadedOwner=value.userId||'';owner.value=loadedOwner;mode.value=value.mode==='global'?'inherit':value.mode;content.value=value.rules.join('\n');dirty=false;
  $('#rules-target').replaceChildren(...value.targets.map(target=>{const option=node('option',displayNodeName(target));option.value=target;return option;}));
  $('#rules-provider-note').textContent=value.providers.length?'现有规则集：'+value.providers.join('、'):'未配置规则集；可直接使用域名、网段和进程规则。';note();controls();
 }
 function syncUsers(){const selected=owner.value;owner.replaceChildren(node('option','全局默认规则'));owner.firstElementChild.value='';for(const user of getUsers()){const option=node('option',(user.display_name?user.display_name+' · ':'')+user.username);option.value=user.id;owner.append(option);}owner.value=[...owner.options].some(option=>option.value===selected)?selected:'';}
 function problem(error,expectedGeneration,request){if(expectedGeneration!==generation||request!==sequence)return;if(error.status===401){onUnauthorized();return;}$('#rules-status').textContent=error.message;}
 async function load(id=owner.value){const expectedGeneration=generation,request=++sequence;state=null;loadedOwner=id;owner.value=id;content.value='';$('#rules-target').replaceChildren();busy=true;controls();note();window.portalToast?.dismiss('rules-editor');$('#rules-status').textContent='读取规则中…';clearPreview();
  try{const data=await api(endpoint(id));if(expectedGeneration!==generation||request!==sequence)return;render(data);$('#rules-status').textContent='';}
  catch(error){problem(error,expectedGeneration,request);}finally{if(expectedGeneration===generation&&request===sequence){busy=false;controls();}}
 }
 function patch(){return {revision:state.revision,rules:state.scope==='user'&&mode.value==='inherit'?[]:content.value.split(/\r?\n/).map(line=>line.trim()).filter(Boolean),...(state.scope==='user'?{mode:mode.value}:{})};}
 function showPreview(value){$('#rules-preview-list').replaceChildren(...value.effectiveRules.map(rule=>{const item=node('li');item.append(node('code',displayNodeName(rule)));return item;}));$('#rules-preview-summary').textContent=`${value.count} 条有效规则${value.convertedCount?' · '+value.convertedCount+' 条通配符已适配旧内核':''}`;$('#rules-warnings').replaceChildren(...value.warnings.map(warning=>node('p',warning.message,'rules-warning')));}
 async function operate(save,copy=false){if(busy||!state)return;const expectedGeneration=generation,request=++sequence,selected=loadedOwner,data=patch();busy=true;controls();if(save)saveFeedback.show('保存中…');$('#rules-status').textContent=save?'正在保存规则…':'检查格式与授权中…';
  const operation=api(save?endpoint(selected):'/api/admin/rules/preview',{method:save?'PUT':'POST',body:save?data:{userId:selected||null,patch:data}}).then(result=>{if(copy&&!result.count)throw Error('请先为此用户分配可用线路，再复制导出规则。');return result;});
  window.portalToast?.promise(operation,{id:'rules-editor',loading:save?'正在保存规则…':'正在检查规则…',success:save?'规则已保存，请让用户更新订阅。':copy?'已复制到独立草稿，尚未保存。':'格式与授权校验通过，详见预览。',error:error=>error.message});
  try{const result=await operation;if(expectedGeneration!==generation||request!==sequence)return;
   if(save){render(result);clearPreview();$('#rules-status').textContent='规则已保存，不会重启节点。用户更新订阅后生效。';}
   else{showPreview(result);if(copy){mode.value='replace';content.value=result.effectiveRules.join('\n');dirty=true;note();$('#rules-status').textContent='已复制当前导出规则为独立草稿。尚未保存，可继续编辑。';}else $('#rules-status').textContent='格式与授权校验通过。预览只包含规则，不包含节点凭据。';}
   if(!window.portalToast)tell(save?'规则已保存，请让用户更新订阅。':'格式与授权校验通过。');
  }catch(error){problem(error,expectedGeneration,request);}finally{if(expectedGeneration===generation&&request===sequence){saveFeedback.reset();busy=false;controls();}}
 }
 owner.onchange=()=>{if(dirty&&!confirm('规则尚未保存，切换后将丢弃当前编辑。继续吗？')){owner.value=loadedOwner;return;}dirty=false;load(owner.value);};
 mode.onchange=()=>{dirty=true;clearPreview();$('#rules-status').textContent='尚未保存';note();controls();};content.oninput=()=>{dirty=true;clearPreview();$('#rules-status').textContent='尚未保存';};
 form.addEventListener('submit',event=>{event.preventDefault();operate(true);});$('#rules-preview').onclick=()=>operate(false);$('#rules-copy').onclick=()=>operate(false,true);$('#rules-reload').onclick=()=>{if(dirty&&!confirm('放弃尚未保存的修改，重新载入当前规则？'))return;dirty=false;load(loadedOwner);};
 $('#rules-add').onclick=()=>{const domain=$('#rules-domain').value.trim();if(!domain||/[\s,/:?#\\]/.test(domain)){$('#rules-status').textContent='请填写一个域名，例如 example.com，不带协议或路径。';$('#rules-domain').focus();return;}
  const line='DOMAIN-SUFFIX,'+domain+','+$('#rules-target').value,lines=content.value.split(/\r?\n/).filter(Boolean),fallback=lines.findIndex(rule=>/^MATCH,/.test(rule));lines.splice(fallback<0?lines.length:fallback,0,line);content.value=lines.join('\n');content.dispatchEvent(new Event('input'));content.focus();
 };
 function reset(){generation++;sequence++;saveFeedback.reset();state=null;loadedOwner='';dirty=false;busy=false;form.reset();owner.replaceChildren(node('option','全局默认规则'));owner.firstElementChild.value='';content.value='';$('#rules-target').replaceChildren();$('#rules-status').textContent='';$('#rules-scope-note').textContent='';$('#rules-provider-note').textContent='';window.portalToast?.dismiss('rules-editor');clearPreview();controls();}
 return {reset,syncUsers,onPanel:id=>{if(id==='rules'){syncUsers();if(!state&&!busy)load();}},openUser:id=>{if(getPanel()!=='rules')return;syncUsers();if(dirty&&!confirm('放弃尚未保存的规则，编辑此用户？'))return;dirty=false;owner.value=id;load(id);}};
}
