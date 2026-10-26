import {openDialog,closeDialog} from './overlay-ui.js';
import {announcementSnoozed,setAnnouncementSnooze} from './announcement-model.js';

export function createAnnouncementsUI({node,getIdentity,onSubscription,tell}){
 const dialog=document.querySelector('#announcement-dialog'),button=document.querySelector('#announcement-open'),content=document.querySelector('#announcement-content'),checkbox=document.querySelector('#announcement-snooze');
 let account=null,notices=[],shownKey='',opened=null;
 const storage={getItem:key=>localStorage.getItem(key),setItem:(key,value)=>localStorage.setItem(key,value),removeItem:key=>localStorage.removeItem(key)};
 const valid=()=>getIdentity()?.role==='user'&&!getIdentity()?.mustChange&&getIdentity()?.username===account;
 function reset(){
  account=null;notices=[];shownKey='';opened=null;button.hidden=true;checkbox.checked=false;
  if(dialog.open)closeDialog(dialog,{immediate:true});content.replaceChildren();
 }
 function dismiss({immediate=false}={}){
  if(opened&&valid()&&!setAnnouncementSnooze(storage,account,opened,checkbox.checked))tell('浏览器未能保存提醒偏好，下次进入可能仍会弹出。','info');
  opened=null;if(dialog.open)closeDialog(dialog,{immediate});
 }
 function open(items=notices){
  if(!valid()||!items.length||dialog.open)return;
  opened=items;
  checkbox.checked=items.every(notice=>announcementSnoozed(storage,account,notice));
  content.replaceChildren(...items.map(notice=>{
   const article=node('article',undefined,'announcement-entry'),heading=node('div',undefined,'announcement-entry-heading'),date=node('time',notice.publishedAt);
   date.dateTime=notice.publishedAt;heading.append(node('span','线路更新','badge'),date);
   const capacity=node('div',undefined,'announcement-capacity');capacity.append(node('strong',notice.quota),node('span',notice.quotaLabel));
   const steps=node('ol',undefined,'announcement-steps');for(const text of notice.steps)steps.append(node('li',text));
   article.append(heading,node('h3',notice.title),capacity,node('p',notice.message),steps,node('p',notice.note,'announcement-note'));return article;
  }));
  openDialog(dialog,{opener:button});
 }
 button.addEventListener('click',()=>open());
 document.querySelector('#announcement-close').addEventListener('click',()=>dismiss());
 document.querySelector('#announcement-done').addEventListener('click',()=>dismiss());
 document.querySelector('#announcement-subscription').addEventListener('click',()=>{dismiss({immediate:true});if(valid())onSubscription();});
 dialog.addEventListener('cancel',event=>{event.preventDefault();dismiss();});
 return {
  reset,
  sync(identity){
   if(!identity||identity.role!=='user'||identity.mustChange){reset();return;}
   if(account!==identity.username)reset();
   account=identity.username;notices=identity.announcements||[];button.hidden=!notices.length;
   const next=JSON.stringify([account,notices.map(notice=>[notice.id,notice.revision])]);
   if(next===shownKey)return;shownKey=next;
   const pending=notices.filter(notice=>!announcementSnoozed(storage,account,notice));
   if(pending.length)open(pending);
  },
 };
}
