// Visual state only. Callers retain submission, identity and lifecycle ownership.
// Keep the original nodes (including icons/listeners), not a text-only facsimile.
function visibility(){document.documentElement.toggleAttribute('data-feedback-page-hidden',document.hidden);}
visibility();document.addEventListener('visibilitychange',visibility);
export function createButtonFeedback(button,{iconOnly=false}={}){
 let original=null;
 function show(label,state='pending'){
  if(!original){
   original={nodes:[...button.childNodes],width:button.getBoundingClientRect().width,hasIcon:iconOnly||!!button.querySelector('.icon,[data-icon],svg'),
    min:button.style.getPropertyValue('min-inline-size'),priority:button.style.getPropertyPriority('min-inline-size'),
    attrs:Object.fromEntries(['aria-busy','aria-label','aria-live','aria-description','title','data-feedback'].map(name=>[name,button.getAttribute(name)]))};
   // A responsive minimum, not a fixed width: shrinking a mobile viewport still fits.
   button.style.setProperty('min-inline-size',`min(${original.width}px, 100%)`);
  }
  button.classList.add('feedback-button');button.dataset.feedback=state;
  button.setAttribute('aria-busy',String(state==='pending'));button.setAttribute('aria-live','polite');
  const mark=document.createElement('span');mark.className='feedback-mark is-'+state;mark.setAttribute('aria-hidden','true');
  if(state==='success')mark.textContent='✓';
  const text=document.createElement('span');text.textContent=label;
  if(iconOnly){text.className='sr-only';if(!original.attrs['aria-label'])button.setAttribute('aria-label',label);button.setAttribute('aria-description',label);button.title=label;}
  // Reuse the existing icon slot; never widen a text-only save button for a spinner.
  button.replaceChildren(...(original.hasIcon?[mark,text]:[text]));
 }
 function reset(){
  if(!original)return;button.replaceChildren(...original.nodes);
  for(const [name,value]of Object.entries(original.attrs)){if(value===null)button.removeAttribute(name);else button.setAttribute(name,value);}
  if(original.min)button.style.setProperty('min-inline-size',original.min,original.priority);else button.style.removeProperty('min-inline-size');
  button.classList.remove('feedback-button');original=null;
 }
 return {show,reset};
}
