// Public DOM adapter. Submit once only when the user explicitly requested it in RADAZ.
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function findComposer(){for(let i=0;i<80;i++){const e=document.querySelector('#prompt-textarea,#mobile-composer-prompt,textarea[data-id="root"],form [contenteditable="true"][role="textbox"]');if(e&&e.getBoundingClientRect().height)return e;await pause(400);}throw new Error('ChatGPT mesaj sahəsi tapılmadı. Hesaba daxil olub yenidən ötürün.');}
function show(message,failed=false){const note=document.createElement('aside');note.textContent=message;Object.assign(note.style,{position:'fixed',right:'20px',top:'20px',zIndex:'2147483647',maxWidth:'360px',padding:'16px',borderRadius:'10px',background:failed?'#61292e':'#154b50',color:'white',font:'13px/1.6 sans-serif'});const close=document.createElement('button');close.textContent=' ×';close.onclick=()=>note.remove();note.append(close);document.body.append(note);}
function enableReturn(){
 if(document.getElementById('radaz-return'))return;
 const button=document.createElement('button');button.id='radaz-return';button.textContent='RADAZ-a qaytar';Object.assign(button.style,{position:'fixed',right:'20px',bottom:'24px',zIndex:'2147483647',padding:'12px 18px',borderRadius:'8px',border:'1px solid #6fc8d4',background:'#154b50',color:'white',cursor:'pointer'});
 button.onclick=async()=>{
  if(document.querySelector('button[data-testid="stop-button"]')){show('Cavabın tamamlanmasını gözləyin.',true);return;}
  const messages=[...document.querySelectorAll('[data-message-author-role="assistant"]')];const last=messages.at(-1);const text=(last?.querySelector('.markdown')||last)?.innerText?.trim();
  if(!text){show('ChatGPT cavabı tapılmadı. Cavabı əl ilə kopyalayın.',true);return;}
  const result=await chrome.runtime.sendMessage({type:'REPORT_ANSWER',text});show(result?.ok?'Analiz RADAZ hesabat səhifəsinə qaytarıldı.':result?.error||'Cavab qaytarılmadı.',!result?.ok);
 };
 document.body.append(button);
}
(async()=>{
 const response=await chrome.runtime.sendMessage({type:'COMPOSER_READY'});if(response?.returnAvailable)enableReturn();if(!response?.ok||!response.bundle)return;
 try{
  const {bundle}=response,composer=await findComposer();
  if((composer.value||composer.textContent||'').trim())throw new Error('Mesaj sahəsi boş deyil. Mövcud mətn saxlanıldı; ZIP-i əl ilə əlavə edin.');
  const parts=[];let size=0;
  for(let index=0;index<bundle.count;index++){const r=await chrome.runtime.sendMessage({type:'COMPOSER_CHUNK',index});if(!r?.ok||typeof r.data!=='string')throw new Error(r?.error||'ZIP tam oxunmadı.');const bytes=Uint8Array.from(atob(r.data),c=>c.charCodeAt(0));parts.push(bytes);size+=bytes.length;}
  if(size!==bundle.size)throw new Error('ZIP ölçüsü uyğun gəlmir. Yenidən ötürün.');
  const files=await RADAZChatGPT.files(parts,bundle),root=RADAZChatGPT.root(composer);
  const accepts=(input,file)=>!input.accept||input.accept.split(',').some(value=>{const item=value.trim().toLowerCase();return item==='*/*'||item===file.type||item===`.${file.name.split('.').pop()}`||item===`${file.type.split('/')[0]}/*`;});
  const inputs=[...root.querySelectorAll('input[type="file"]')],groups=new Map();
  for(const file of files){const input=inputs.find(el=>accepts(el,file)&&(!groups.has(el)||el.multiple));if(!input)throw new Error(`${file.name} üçün əlavə sahəsi tapılmadı. ZIP-i yükləyib ChatGPT-yə əl ilə əlavə edin.`);groups.set(input,[...(groups.get(input)||[]),file]);}
  for(const [input,group] of groups){const transfer=new DataTransfer();group.forEach(file=>transfer.items.add(file));input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));}
  const names=files.map(file=>file.name);let ready=false;
  for(let i=0;i<150;i++){const state=RADAZChatGPT.state(composer,names);if(state.complete&&!state.busy){ready=true;break;}await pause(400);}
  if(!ready)throw new Error('Görüntü əlavələrinin tam yüklənməsi təsdiqlənmədi. Tapşırıq yerləşdirilmədi. ZIP əlavəsini və fayl limitini yoxlayın; lazım olsa ZIP-i əl ilə əlavə edin.');
  if((composer.value||composer.textContent||'').trim())throw new Error('Yükləmə zamanı mesaj mətni dəyişdi. Mövcud mətn saxlanıldı; tapşırığı əl ilə əlavə edin.');
  composer.focus();
  if(composer instanceof HTMLTextAreaElement){Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(composer,bundle.prompt);composer.dispatchEvent(new Event('input',{bubbles:true}));}
  else if(!document.execCommand('insertText',false,bundle.prompt))throw new Error('Tapşırıq yerləşdirilmədi. RADAZ-dan mətni kopyalayın.');
  await pause(600);if((composer.value||composer.textContent||'').trim()!==bundle.prompt.trim())throw new Error('Tapşırıq mətni təsdiqlənmədi. Əl ilə yapışdırın.');
  ready=false;for(let i=0;i<75;i++){const state=RADAZChatGPT.state(composer,names);if(state.complete&&!state.busy&&state.canSend){ready=true;break;}await pause(400);}
  if(!ready)throw new Error('Əlavələr və göndərmə hazırlığı təsdiqlənmədi. Mesaj göndərilməyib; ChatGPT-də yükləmə xətasını yoxlayın.');
  let sent=false;
  if(bundle.autoSubmit===true){
   // A new empty chat and the complete prompt/attachment check are required; never retry a click.
   if(document.querySelector('[data-message-author-role="user"],[data-message-author-role="assistant"]'))throw new Error('Yeni boş ChatGPT söhbəti açılmadı. Mesaj avtomatik göndərilmədi.');
   const state=RADAZChatGPT.state(composer,names);
   if(!state.complete||state.busy||!state.canSend||(composer.value||composer.textContent||'').trim()!==bundle.prompt.trim())throw new Error('Mesaj və əlavələr dəyişib. Avtomatik göndəriş dayandırıldı.');
   const send=RADAZChatGPT.root(composer).querySelector('button[data-testid="send-button"]');
   if(!send||send.disabled)throw new Error('ChatGPT göndərmə düyməsi təsdiqlənmədi. Mesajı əl ilə göndərin.');
   send.click();
   for(let i=0;i<75;i++){
    const user=[...document.querySelectorAll('[data-message-author-role="user"]')].find(el=>el.textContent.includes(bundle.prompt.trim()));
    if(user&&(composer.value||composer.textContent||'').trim()===''){sent=true;break;}
    await pause(400);
   }
   if(!sent)throw new Error('Göndərmə klikləndi, amma çatda təsdiqlənmədi. Təkrar göndərməzdən əvvəl ChatGPT-ni yoxlayın.');
  }
  await chrome.runtime.sendMessage({type:'COMPOSER_RESULT',ok:true,sent});enableReturn();
  show(sent?'RADAZ tapşırığı ChatGPT-yə göndərildi. Cavab tamamlananda “RADAZ-a qaytar” düyməsini basın.':`RADAZ: ${files.map(file=>file.name).join(', ')} təsdiqləndi. Mesajı yoxlayıb göndərin; cavabı “RADAZ-a qaytar” ilə ötürün.`);
 }catch(error){show(`RADAZ: ${error.message}`,true);await chrome.runtime.sendMessage({type:'COMPOSER_RESULT',ok:false,error:error.message});}
})().catch(()=>{});
