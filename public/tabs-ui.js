// WAI-ARIA tab semantics and roving focus, independent of data fetching.
// Owners keep panel contents/caches; only an activation requests new content.
let tabsId=0;
export function createTabs(list,{items,initial=items[0]?.value,activation='automatic',orientation='horizontal',kind='tabs',onChange=()=>{}}){
 const byValue=new Map(items.map(item=>[item.value,item]));
 if(!items.length||byValue.size!==items.length)throw Error('Tabs need unique values');
 list.id||='kenxu-tabs-'+(++tabsId);list.setAttribute('role','tablist');list.setAttribute('aria-orientation',orientation);
 list.dataset.choiceKind=kind;list.dataset.activation=activation;list.dataset.orientation=orientation;
 const lifecycle=new AbortController(),on=(name,handler)=>list.addEventListener(name,handler,{signal:lifecycle.signal});
 let selected;
 const available=()=>items.filter(({trigger})=>!trigger.disabled&&trigger.getAttribute('aria-disabled')!=='true'&&!trigger.hidden);
 const tabStop=trigger=>{for(const item of items)item.trigger.tabIndex=item.trigger===trigger?0:-1;};
 for(const [index,{trigger,panel}]of items.entries()){
  trigger.id||=list.id+'-tab-'+index;panel.id||=list.id+'-panel-'+index;
  trigger.type='button';trigger.setAttribute('role','tab');trigger.removeAttribute('aria-pressed');trigger.setAttribute('aria-controls',panel.id);
  panel.setAttribute('role','tabpanel');panel.setAttribute('aria-labelledby',trigger.id);panel.tabIndex=0;
 }
 function select(value,{notify=true,focus=false,animate=false}={}){
  const target=byValue.get(value);if(!target||!available().includes(target))return false;
  const changed=selected!==value,old=byValue.get(selected);selected=value;
  list.toggleAttribute('data-choice-animate',animate&&document.body.dataset.input==='pointer');
  for(const item of items){const active=item===target;item.trigger.setAttribute('aria-selected',String(active));item.trigger.dataset.state=active?'active':'inactive';item.panel.dataset.state=active?'active':'inactive';item.panel.hidden=!active;}
  tabStop(target.trigger);
  // Programmatic changes must not leave focus in a now-hidden panel.
  if(focus||old&&old!==target&&old.panel.contains(document.activeElement))target.trigger.focus({preventScroll:true});
  if(notify&&changed)onChange(value,{animate:animate&&document.body.dataset.input==='pointer'});
  return changed;
 }
 on('click',event=>{if(event.defaultPrevented)return;const item=items.find(({trigger})=>trigger===event.target.closest('[role=tab]'));if(item)select(item.value,{focus:true,animate:event.detail>0});});
 on('focusin',event=>{const item=items.find(({trigger})=>trigger===event.target);if(!item)return;tabStop(item.trigger);if(activation==='automatic')select(item.value,{animate:document.body.dataset.input==='pointer'});});
 on('keydown',event=>{
  if(event.defaultPrevented||event.altKey||event.ctrlKey||event.metaKey||event.shiftKey)return;
  const enabled=available(),index=enabled.findIndex(({trigger})=>trigger===event.target);if(index<0)return;
  const rtl=getComputedStyle(list).direction==='rtl',forward=orientation==='vertical'?'ArrowDown':rtl?'ArrowLeft':'ArrowRight',back=orientation==='vertical'?'ArrowUp':rtl?'ArrowRight':'ArrowLeft';
  const next=event.key===forward?(index+1)%enabled.length:event.key===back?(index+enabled.length-1)%enabled.length:event.key==='Home'?0:event.key==='End'?enabled.length-1:undefined;
  if(next===undefined)return;event.preventDefault();tabStop(enabled[next].trigger);enabled[next].trigger.focus();
 });
 on('focusout',()=>queueMicrotask(()=>{if(!lifecycle.signal.aborted&&!list.contains(document.activeElement))tabStop(byValue.get(selected)?.trigger);}));
 const observer=new MutationObserver(()=>{const enabled=available();if(!enabled.some(item=>item.value===selected)){if(enabled.length)select(enabled[0].value);else{selected=undefined;for(const {trigger,panel}of items){trigger.setAttribute('aria-selected','false');trigger.tabIndex=-1;panel.hidden=true;}}}});
 for(const {trigger}of items)observer.observe(trigger,{attributes:true,attributeFilter:['disabled','aria-disabled','hidden']});
 select(available().some(item=>item.value===initial)?initial:available()[0]?.value,{notify:false});
 return {select,get value(){return selected;},destroy:()=>{lifecycle.abort();observer.disconnect();}};
}
