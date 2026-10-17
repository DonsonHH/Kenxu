const dateAt=at=>new Date(at+8*3600000).toISOString().slice(0,10);
export function officialEventDays(provider,at){
 // This is a view of the official records we have obtained, not reconstructed
 // uptime or fabricated successful samples. Leave provider.history untouched.
 const last=Number.isFinite(provider.lastSuccessAt)&&provider.lastSuccessAt>0?dateAt(Math.min(at,provider.lastSuccessAt)):'',today=dateAt(at);
 return provider.history.map(day=>{
  const known=last&&day.date<=last&&(day.date<today||provider.available&&provider.status!=='unknown');
  const status=['degraded','outage','maintenance'].includes(day.status)?day.status:day.incidents>0?'degraded':known?'unreported':'unknown';
  return {...day,status};
 });
}
