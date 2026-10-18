// Enhance the existing buttons; selection remains owned by their real handlers.
export function enhanceChoices(group,{kind='range'}={}){
 const buttons=[...group.querySelectorAll('button')];group.dataset.choiceKind=kind;
 if(group.tagName!=='NAV'&&!group.hasAttribute('role'))group.setAttribute('role','group');
 if(!group.hasAttribute('aria-label'))group.setAttribute('aria-label',(group.closest('.chart-card')?.querySelector('h2')?.textContent||'选项')+'范围');
 const attribute=kind==='steps'?'aria-current':kind==='tabs'?'aria-selected':'aria-pressed';
 const selected=()=>buttons.find(button=>button.getAttribute(attribute)===(kind==='steps'?'step':'true'))||buttons.find(button=>!button.disabled);
 function tabStop(target){for(const button of buttons)button.tabIndex=button===target?0:-1;}
 function sync({animate=false}={}){group.toggleAttribute('data-choice-animate',animate);tabStop(selected());}
 group.addEventListener('click',event=>group.toggleAttribute('data-choice-animate',document.body.dataset.input==='pointer'&&event.detail>0),{capture:true});
 // Observe the owner's committed ARIA state. A microtask in a capture listener
 // can run before a later native-event listener has made its selection.
 const observer=new MutationObserver(()=>tabStop(kind==='steps'&&buttons.includes(document.activeElement)?document.activeElement:selected()));
 observer.observe(group,{subtree:true,attributes:true,attributeFilter:[attribute]});
 group.addEventListener('focusout',()=>queueMicrotask(()=>{if(!group.contains(document.activeElement))sync();}));
 group.addEventListener('keydown',event=>{
  if(kind==='tabs'||event.altKey||event.ctrlKey||event.metaKey||event.shiftKey||!buttons.includes(event.target))return;
  const available=buttons.filter(button=>!button.disabled&&button.getClientRects().length),index=available.indexOf(event.target);if(index<0)return;
  const next={ArrowRight:(index+1)%available.length,ArrowLeft:(index+available.length-1)%available.length,Home:0,End:available.length-1}[event.key];
  if(next===undefined)return;event.preventDefault();const target=available[next];
  target.focus();if(kind==='steps')tabStop(target);else{if(target!==selected())target.click();sync();}
 });
 sync();return {sync};
}
