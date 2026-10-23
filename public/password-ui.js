// Keep native inputs/autocomplete/validation. The visibility control is outside
// the label and never changes the input value or submits its form.
export function enhancePasswords(root=document){
 for(const input of root.querySelectorAll('input[type=password]:not([readonly])')){
  const label=input.closest('label');if(!label)continue;
  const name=label.textContent.trim();input.id||=input.form.id+'-'+input.name;
  const field=document.createElement('div');field.className='password-field';field.hidden=label.hidden;
  if(label.id){field.id=label.id;label.removeAttribute('id');}
  label.before(field);field.append(label);label.htmlFor=input.id;
  const frame=document.createElement('div');frame.className='password-input';field.append(frame);frame.append(input);
  const button=document.createElement('button');button.type='button';button.className='quiet password-toggle';button.dataset.passwordToggle='';button.setAttribute('aria-controls',input.id);frame.append(button);
  function hide(){input.type='password';button.textContent='显示';button.setAttribute('aria-label','显示'+name);button.setAttribute('aria-pressed','false');}
  button.addEventListener('click',()=>{const visible=input.type==='password';input.type=visible?'text':'password';button.textContent=visible?'隐藏':'显示';button.setAttribute('aria-label',(visible?'隐藏':'显示')+name);button.setAttribute('aria-pressed',String(visible));});
  input.form.addEventListener('reset',hide);hide();
 }
}
