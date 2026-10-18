// One lifecycle per form: closing/reopening or switching sessions invalidates
// earlier UI work, without pretending to cancel a server-side write.
import {createButtonFeedback} from './button-feedback.js';
export function bindForm(form,{work,getIdentity,onError,pendingLabel='处理中…'}){
 const button=form.querySelector('button[type="submit"],button.primary,button.secondary');
 const feedback=createButtonFeedback(button);
 let generation=0,active=null,cooldownTimer=null,cooldownLabel=null;
 function reset(){
  generation++;clearInterval(cooldownTimer);cooldownTimer=null;
  feedback.reset();if(cooldownLabel)button.textContent=cooldownLabel;
  cooldownLabel=null;
  active=null;button.disabled=false;form.reset();onError('');
 }
 form.addEventListener('submit',async event=>{
  event.preventDefault();if(button.disabled)return;
  const operation={generation,identity:getIdentity(),label:button.textContent};active=operation;
  const sameIdentity=()=>getIdentity()===operation.identity;
  const owns=()=>active===operation&&generation===operation.generation;
  const current=()=>owns()&&sameIdentity();
  button.disabled=true;feedback.show(pendingLabel);onError('');let cooldown=0;
  try{await work(form,{current,sameIdentity});}
  catch(error){if(current()){cooldown=error.status===429?Math.min(900,Math.max(1,error.retryAfter||3)):0;onError(error.message,error);}}
  finally{
   if(owns()){
    active=null;feedback.reset();button.disabled=false;
    if(cooldown&&sameIdentity()){
     cooldownLabel=operation.label;
     const deadline=Date.now()+cooldown*1000;button.disabled=true;
     const tick=()=>{
      if(generation!==operation.generation||!sameIdentity()){clearInterval(cooldownTimer);return;}
      const remaining=Math.max(0,Math.ceil((deadline-Date.now())/1000));button.textContent=remaining?'请等待 '+remaining+' 秒':operation.label;
      if(!remaining){button.disabled=false;clearInterval(cooldownTimer);cooldownTimer=null;cooldownLabel=null;}
     };
     cooldownTimer=setInterval(tick,1000);tick();
    }
   }
  }
 });
 return {reset};
}
