// Display only: never feed these labels back into configuration or grant IDs.
const flags=/[\u{1f1e6}-\u{1f1ff}]{2}/gu;
const countryFor=flag=>[...flag].map(c=>String.fromCharCode(c.codePointAt(0)-0x1f1e6+65)).join('');
export const displayNodeName=value=>String(value).replace(flags,flag=>' ['+countryFor(flag)+']');
export function nodePresentation(n,meter){
 const flag=n.name.match(flags)?.[0],label=n.name.replace(flags,'').trim();
 const sg=/^(?:Azure@SG|Singapore\s*)(\d+)$/i.exec(label),us=/^(?:Azure@US|US\s*)(\d+)$/i.exec(label);
 const country=flag?countryFor(flag):sg?'SG':us?'US':/^UK@/.test(label)?'GB':/@JP/.test(label)?'JP':'';
 return {label,country,group:sg?'sg':us?'us':'other',order:Number((sg||us)?.[1]||0),kind:meter?.kind||(n.kind&&n.kind!=='unmanaged'?n.kind:'direct-unmetered')};
}
export function groupNodes(nodes){
 return [['sg','SG · 新加坡'],['us','US · 美国'],['other','其他线路']].flatMap(([id,label])=>{
  const selected=nodes.filter(n=>nodePresentation(n).group===id).sort((a,b)=>nodePresentation(a).order-nodePresentation(b).order||a.name.localeCompare(b.name));
  return selected.length?[{id,label,nodes:selected}]:[];
 });
}
export function renderNodeGroups(container,nodes,renderCard,{node,list=false}){
 container.replaceChildren();
 for(const group of groupNodes(nodes)){
  const section=node('section',undefined,'node-group'),heading=node('div',undefined,'node-group-heading'),grid=node(list?'ul':'div',undefined,'route-grid');
  section.dataset.nodeGroup=group.id;heading.append(node('h3',group.label),node('span',group.nodes.length+' 条线路','badge'));
  grid.append(...group.nodes.map(renderCard));section.append(heading,grid);container.append(section);
 }
}
export function nodeTitle(n,{node}){
 const {label,country}=nodePresentation(n),identity=node('div',undefined,'node-identity');identity.append(node('strong',label,'route-title'));
 if(country){
  const badge=node('span',undefined,'country-badge');
  if(['SG','US','GB','JP'].includes(country)){const img=node('img');img.src='/flags/'+country.toLowerCase()+'.svg';img.width=24;img.height=18;img.alt='';img.setAttribute('aria-hidden','true');badge.append(img);}
  badge.append(node('span',country));identity.append(badge);
 }
 return identity;
}
