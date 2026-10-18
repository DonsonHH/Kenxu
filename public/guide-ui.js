import {enhanceChoices} from './choice-ui.js';
export function createGuideUI({root,onImport,reveal}){
 const positions=new Map();let selected,visible=false,reader=null,frame=null;
 const sections=[...root.querySelectorAll('[data-device-guide]')];
 const devices=enhanceChoices(root.querySelector('.device-switch'),{kind:'device'}),stepChoices=new Map(sections.map(section=>[section,enhanceChoices(section.querySelector('.guide-step-nav'),{kind:'steps'})]));
 function highlight(section,number,{reading=false}={}){
  const step=section.querySelector('[data-step="'+number+'"]');if(!step)return;
  if(positions.get(section.dataset.deviceGuide)===number&&step.classList.contains('is-current'))return step;
  positions.set(section.dataset.deviceGuide,number);
  for(const element of section.querySelectorAll('[data-step]'))element.classList.toggle('is-current',element===step);
  for(const button of section.querySelectorAll('.guide-step-nav [data-jump-step]'))button.setAttribute('aria-current',Number(button.dataset.jumpStep)===number?'step':'false');
  section.querySelector('.guide-reading-status').textContent='步骤导航 · '+number+' / 4 '+step.querySelector('h3').textContent;
  if(!reading||!section.querySelector('.guide-step-nav').contains(document.activeElement))stepChoices.get(section).sync();
  return step;
 }
 function currentSection(){return visible&&!root.closest('[hidden]')?sections.find(section=>section.dataset.deviceGuide===selected):null;}
 function readingLine(section){const style=getComputedStyle(section.querySelector('[data-step]'));return Math.min(innerHeight-1,Math.max(0,(parseFloat(style.scrollMarginTop)||0)+(parseFloat(style.paddingTop)||0)+1));}
 function syncReading(){
  const section=currentSection();if(!section||document.hidden)return;const line=readingLine(section),steps=[...section.querySelectorAll('[data-step]')];let current=steps[0];
  for(const step of steps){if(step.getBoundingClientRect().top<=line)current=step;else break;}
  if(current)highlight(section,Number(current.dataset.step),{reading:true});
 }
 function stopReader(){reader?.disconnect();reader=null;if(frame!==null)cancelAnimationFrame(frame);frame=null;}
 function refreshReader(){
  stopReader();if(!visible)return;
  frame=requestAnimationFrame(()=>{frame=null;const section=currentSection();if(!section)return;
   if(typeof IntersectionObserver==='function'){const line=readingLine(section);reader=new IntersectionObserver(syncReading,{rootMargin:`-${line}px 0px -${Math.max(0,innerHeight-line-1)}px 0px`});for(const step of section.querySelectorAll('[data-step]'))reader.observe(step);}
   syncReading();
  });
 }
 window.addEventListener('resize',()=>{if(visible)refreshReader();});
 function select(platform,{animate=false,client}={}){
  const target=sections.find(section=>section.dataset.deviceGuide===platform);if(!target)return;
  const changed=selected!==platform;selected=platform;
  for(const section of sections)section.hidden=section!==target;
  for(const button of root.querySelectorAll('[data-guide-platform]'))button.setAttribute('aria-pressed',String(button.dataset.guidePlatform===platform));
  devices.sync({animate:animate&&document.body.dataset.input==='pointer'});
  for(const slot of target.querySelectorAll('[data-policy-reference]'))if(!slot.dataset.loaded){slot.append(root.querySelector('#guide-policy-template').content.cloneNode(true));slot.dataset.loaded='true';}
  if(client&&platform==='ios')for(const detail of target.querySelectorAll('[data-ios-app]'))detail.open=detail.dataset.iosApp===client;
  highlight(target,positions.get(platform)||1);
  if(animate&&changed)reveal(target);
  if(visible)refreshReader();
 }
 root.addEventListener('click',event=>{
  const platform=event.target.closest('[data-guide-platform]');if(platform){select(platform.dataset.guidePlatform,{animate:true});return;}
  const importer=event.target.closest('[data-guide-client]');if(importer){onImport(importer.dataset.guideClient);return;}
  const jump=event.target.closest('[data-jump-step]');if(!jump)return;const section=jump.closest('[data-device-guide]'),step=highlight(section,Number(jump.dataset.jumpStep));
  if(step){step.querySelector('h3').focus({preventScroll:true});step.scrollIntoView({block:'start',behavior:'instant'});reveal(step);}
 });
 root.addEventListener('change',event=>{const checks=event.target.closest('.guide-checks');if(!checks)return;const inputs=[...checks.querySelectorAll('input')],count=inputs.filter(input=>input.checked).length;checks.querySelector('.guide-check-status').textContent='你已确认 '+count+' / '+inputs.length+' 项';});
 return {select,onPanel:id=>{visible=id==='knowledge';if(visible)refreshReader();else stopReader();},reset:()=>{visible=false;stopReader();positions.clear();for(const input of root.querySelectorAll('.guide-checks input'))input.checked=false;for(const status of root.querySelectorAll('.guide-check-status'))status.textContent='勾选你已确认的项目';for(const section of sections)highlight(section,1);}};
}
