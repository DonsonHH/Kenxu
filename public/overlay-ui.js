import {pointerMotion} from './motion.js';

// Native open/close remains the source of truth. No deferred close callbacks,
// animation timers, prototype overrides or duplicate dialog state machine.
const dialogs=[...document.querySelectorAll('dialog')];
const returnPoints=new WeakMap();
for(const dialog of dialogs)dialog.inert=!dialog.open;
const observer=new MutationObserver(records=>{
 for(const {target}of records){target.inert=!target.open;if(!target.open)repairReturnPoint(target);}
});
for(const dialog of dialogs){
 observer.observe(dialog,{attributes:true,attributeFilter:['open']});
 dialog.addEventListener('close',()=>{
  if(dialog.open)return;const point=returnPoints.get(dialog);returnPoints.delete(dialog);
  // Native focus restoration wins. Repair only neutral/closed-surface focus;
  // never steal it from another control or an immediately reopened dialog.
  repairReturnPoint(dialog,point);
 });
}
function prepare(dialog,immediate){
 if(!immediate&&pointerMotion())dialog.dataset.dialogMotion='pointer';
 else dialog.removeAttribute('data-dialog-motion');
}
function focusReturnPoint(key){
 const available=element=>element&&element.getClientRects().length&&!element.disabled&&!element.closest('[hidden],[inert]')&&getComputedStyle(element).visibility!=='hidden';
 const target=key.startsWith('id:')?document.getElementById(key.slice(3)):[...document.querySelectorAll('[data-dialog-opener]')].find(element=>element.dataset.dialogOpener===key&&available(element));
 if(available(target))target.focus();else document.getElementById('page-heading')?.focus({preventScroll:true});
}
function repairReturnPoint(dialog,point=returnPoints.get(dialog)){
 if(!dialog.open&&point?.key&&(document.activeElement===document.body||dialog.contains(document.activeElement)))focusReturnPoint(point.key);
}
export function retainListFocus(container){
 const active=document.activeElement,key=container.contains(active)?active.dataset.dialogOpener||(active.id?'id:'+active.id:null):null;
 return ()=>{if(key&&document.activeElement===document.body)focusReturnPoint(key);};
}
export function openDialog(dialog,{opener=document.activeElement}={}){
 if(dialog.open)return;
 // Safari/WebKit pointer activation need not focus a button. Make the actual
 // invoker explicit before showModal so native restoration remembers it too.
 if(opener?.isConnected&&!opener.disabled)opener.focus({preventScroll:true});
 returnPoints.set(dialog,{key:opener?.getAttribute('data-dialog-opener')||(opener?.id?'id:'+opener.id:null)});prepare(dialog,false);dialog.inert=false;dialog.showModal();
}
export function closeDialog(dialog,{immediate=false}={}){
 if(immediate)returnPoints.delete(dialog);prepare(dialog,immediate);dialog.inert=true;dialog.close();
}
export function resetDialogMotion(){
 // Session resets must not leave private content painting in the top layer.
 for(const dialog of dialogs){returnPoints.delete(dialog);dialog.removeAttribute('data-dialog-motion');for(const animation of dialog.getAnimations())animation.cancel();}
}
