const MAX_BYTES=480*1024*1024,CHUNK_BYTES=512*1024;
async function originAllowed(url){try{const {origin='http://localhost:5173'}=await chrome.storage.local.get('origin');return new URL(url).origin===origin;}catch{return false;}}
async function chunks(mode,run){const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('radaz-chatgpt-zip',1);r.onupgradeneeded=()=>r.result.createObjectStore('chunks');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});try{return await new Promise((resolve,reject)=>{const tx=db.transaction('chunks',mode);const result=run(tx.objectStore('chunks'));tx.oncomplete=()=>resolve(result?.result);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);});}finally{db.close();}}
async function clear(){await chunks('readwrite',s=>s.clear());await chrome.storage.session.remove('pending');await chrome.alarms.clear('radaz-expire');}
async function deliver(pending,stage,message,text){try{const source=await chrome.tabs.get(pending.sourceTab);if(!await originAllowed(source.url)||new URL(source.url).pathname!=='/report')return false;await chrome.tabs.sendMessage(pending.sourceTab,{source:'RADAZ_CHATGPT_EXTENSION',request:pending.request,stage,message,text});return true;}catch{return false;}}
chrome.alarms.onAlarm.addListener(alarm=>{if(alarm.name==='radaz-expire')void clear();});
let queue=Promise.resolve();
chrome.runtime.onMessage.addListener((message,sender,respond)=>{
 const work=async()=>{
  const type=message?.type;
  if(type==='BRIDGE_INFO'){
   if(!sender.tab||!await originAllowed(sender.url))throw new Error('RADAZ ünvanını əlavənin ayarlarında yoxlayın.');
   return {ok:true,protocol:3,version:chrome.runtime.getManifest().version};
  }
  if(type?.startsWith('ZIP_')){
   if(!sender.tab||!await originAllowed(sender.url)||new URL(sender.url).pathname!=='/report')throw new Error('Bu RADAZ ünvanına icazə verilməyib. Əlavənin ayarlarını açın.');
   if(!/^[a-f0-9]{32}$/.test(message.request))throw new Error('Sorğu identifikatoru düzgün deyil.');
   const {pending}=await chrome.storage.session.get('pending');
   if(type==='ZIP_BEGIN'){
    if(pending&&pending.expires>Date.now())throw new Error('Əvvəlki ZIP hələ ötürülür. Bir az gözləyin.');
    if(typeof message.prompt!=='string'||!message.prompt.trim()||message.prompt.length>20000||message.name!=='RADAZ-ChatGPT.zip'||!Number.isInteger(message.size)||message.size<4||message.size>MAX_BYTES||message.count!==Math.ceil(message.size/CHUNK_BYTES))throw new Error('ZIP paketi düzgün deyil və ya 480 MB həddini keçir.');
    if(message.autoSubmit!==undefined&&typeof message.autoSubmit!=='boolean')throw new Error('Göndərmə seçimi düzgün deyil.');
    const a=message.attachments;
    if(a!==undefined&&(!a||typeof a.includeZip!=='boolean'||!Number.isInteger(a.first)||a.first<0||!Number.isInteger(a.count)||a.count<1||a.count>8||!Number.isInteger(a.total)||a.total<1||a.total>100000||a.first+a.count>a.total))throw new Error('JPEG qrupu düzgün deyil.');
    await clear();const next={request:message.request,sourceTab:sender.tab.id,prompt:message.prompt,name:message.name,size:message.size,count:message.count,attachments:a,autoSubmit:message.autoSubmit===true,next:0,bytes:0,expires:Date.now()+15*60000};
    await chrome.storage.session.set({pending:next});await chrome.alarms.create('radaz-expire',{when:next.expires});return {ok:true};
   }
   if(!pending||pending.sourceTab!==sender.tab.id||pending.request!==message.request||pending.expires<Date.now())throw new Error('ZIP ötürmə sessiyası bitib. Yenidən ötürün.');
   if(type==='ZIP_CANCEL'){await clear();return {ok:true};}
   if(type==='ZIP_CHUNK'){
    if(pending.targetTab||message.index!==pending.next||typeof message.data!=='string'||message.data.length>Math.ceil(CHUNK_BYTES/3)*4||!/^[A-Za-z0-9+/]+={0,2}$/.test(message.data))throw new Error('ZIP hissəsinin sırası və ya ölçüsü düzgün deyil.');
    const raw=atob(message.data),bytes=Uint8Array.from(raw,c=>c.charCodeAt(0));
    const expected=Math.min(CHUNK_BYTES,pending.size-pending.bytes);
    if(bytes.length!==expected||(message.index===0&&!(bytes[0]===80&&bytes[1]===75&&bytes[2]===3&&bytes[3]===4)))throw new Error('ZIP məzmunu düzgün deyil.');
    await chunks('readwrite',s=>s.put(message.data,message.index));pending.next++;pending.bytes+=bytes.length;await chrome.storage.session.set({pending});return {ok:true};
   }
   if(type==='ZIP_FINISH'){
    if(pending.targetTab||pending.next!==pending.count||pending.bytes!==pending.size)throw new Error('ZIP tam ötürülməyib.');
    const tab=await chrome.tabs.create({url:'about:blank',active:true});pending.targetTab=tab.id;await chrome.storage.session.set({pending});await chrome.tabs.update(tab.id,{url:'https://chatgpt.com/'});return {ok:true};
   }
  }
  if(!sender.tab||new URL(sender.url).origin!=='https://chatgpt.com')throw new Error('İcazəsiz mənbə.');
  const {pending,reports={}}=await chrome.storage.session.get(['pending','reports']);
  if(type==='COMPOSER_READY'){
   if(!pending||pending.targetTab!==sender.tab.id||pending.expires<Date.now()||pending.delivered)return {ok:true,bundle:null,returnAvailable:!!reports[sender.tab.id]&&reports[sender.tab.id].expires>Date.now()};
   pending.delivered=true;await chrome.storage.session.set({pending});return {ok:true,bundle:{prompt:pending.prompt,name:pending.name,size:pending.size,count:pending.count,attachments:pending.attachments,autoSubmit:pending.autoSubmit}};
  }
  if(type==='COMPOSER_CHUNK'){
   if(!pending||pending.targetTab!==sender.tab.id||pending.expires<Date.now()||!Number.isInteger(message.index)||message.index<0||message.index>=pending.count)throw new Error('ZIP hissəsi əlçatan deyil.');
   return {ok:true,data:await chunks('readonly',s=>s.get(message.index))};
  }
  if(type==='COMPOSER_RESULT'){
   if(!pending||pending.targetTab!==sender.tab.id)return {ok:false};
   if(message.ok){
    for(const [id,value] of Object.entries(reports))if(value.expires<Date.now())delete reports[id];
    reports[sender.tab.id]={request:pending.request,sourceTab:pending.sourceTab,expires:Date.now()+60*60000};await chrome.storage.session.set({reports});
   }
   const a=pending.attachments;
   await deliver(pending,'complete',message.ok&&message.sent===true&&pending.autoSubmit?'Tapşırıq və görüntülər ChatGPT-yə göndərildi. Cavab tamamlananda “RADAZ-a qaytar” düyməsini basın.':message.ok?`${a?`${a.count} JPEG (${a.first+1}–${a.first+a.count} / ${a.total})${a.includeZip?' və bütün görüntülərin ZIP-i':''}`:'ZIP'} ChatGPT mesaj sahəsində təsdiqləndi. Məzmunu yoxlayıb mesajı göndərin; cavabı “RADAZ-a qaytar” ilə hesabata ötürün.`:String(message.error||'Görüntülər əlavə edilmədi. Əl ilə əlavə edin.').slice(0,500));await clear();return {ok:true};
  }
  if(type==='REPORT_ANSWER'){
   const link=reports[sender.tab.id];if(!link||link.expires<Date.now()||typeof message.text!=='string'||!message.text.trim()||message.text.length>200000)throw new Error('Hesabat sessiyası bitib və ya cavab boşdur. Mətni əl ilə kopyalayın.');
   if(!await deliver(link,'answer','ChatGPT analizi hazırdır',message.text))throw new Error('Hesabat səhifəsi bağlıdır. Cavabı əl ilə kopyalayın.');await chrome.tabs.update(link.sourceTab,{active:true});return {ok:true};
  }
  throw new Error('Naməlum sorğu.');
 };
 queue=queue.then(work,work);queue.then(respond,error=>respond({ok:false,error:error.message}));return true;
});
