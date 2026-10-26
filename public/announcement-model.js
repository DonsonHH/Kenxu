export const ANNOUNCEMENT_DAY=24*60*60*1000;
const key=(account,notice)=>'kenxu-announcement:'+JSON.stringify([account,notice.id,notice.revision]);
export function announcementSnoozed(storage,account,notice,now=Date.now()){
 try{const until=Number(storage.getItem(key(account,notice)));return Number.isFinite(until)&&until>now&&until<=now+ANNOUNCEMENT_DAY;}catch{return false;}
}
export function setAnnouncementSnooze(storage,account,notices,enabled,now=Date.now()){
 try{for(const notice of notices){if(enabled)storage.setItem(key(account,notice),String(now+ANNOUNCEMENT_DAY));else storage.removeItem(key(account,notice));}return true;}catch{return false;}
}
