import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'playwright');
const base=process.env.RADAZ_TEST_URL||'http://localhost:5488/';
const doctor={id:'dr1',name:'QA doctor',role:'radiologist',active:true,permissions:['receive','download']};
const admin={id:'admin',name:'QA coordinator',role:'coordinator',active:true,permissions:['send','receive','download','forward','manage_schedule','view_status']};
const mock={enabled:true,configured:true,online:true,user:admin,membership:admin,members:[admin,doctor],clinics:[{id:'alpha',name:'Klinika A'}],clinic:'alpha',queue:[],deliveries:[],sent:[],history:[],policy:{}};
test('Viewer settings opens the desktop network settings window and reuses it',async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.RADAZ_CHROME||'C:/Program Files/Google/Chrome/Application/chrome.exe'});
 try{
  const context=await browser.newContext({viewport:{width:2560,height:1440},userAgent:'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/138.0.0.0 Electron/39.0.0 Safari/537.36'});
  let state={...mock,membership:{...admin,role:'admin'},superAdmin:true};
  let denied=null;
  await context.route('**/local-archive-api/**',route=>{
   const action=new URL(route.request().url()).pathname.split('/').at(-1);
   if(action==='state'&&denied)return route.fulfill({status:403,json:denied});
   return route.fulfill({json:action==='state'?state:action==='license'?{valid:true,kind:'owner',required:true}:{}});
  });
  const viewer=await context.newPage();
  await viewer.goto(base);
  await viewer.getByRole('button',{name:'Yardım və lisenziya',exact:true}).click();
  await viewer.getByRole('menuitem',{name:'Ayarlar',exact:true}).click();
  const link=viewer.getByRole('dialog',{name:'Ayarlar',exact:true}).getByRole('link',{name:'DICOM Network ayarları'});
  const [settings]=await Promise.all([viewer.waitForEvent('popup'),link.click()]);
  await settings.getByRole('heading',{name:'Cihaz və bağlantı'}).waitFor();
  const nav=settings.getByRole('navigation',{name:'DICOM Network ayarları'});
  assert.deepEqual(await nav.getByRole('button').allTextContents(),['Bağlantı və qəbul ayarları','Klinikalar və radioloqlar','Növbə cədvəli','Avtomatik göndərmə']);
  await nav.getByRole('button',{name:'Klinikalar və radioloqlar'}).click();
  await settings.getByRole('heading',{name:'Klinika yarat'}).waitFor();
  await settings.getByRole('heading',{name:'Klinikanın cihazları'}).waitFor();
  await nav.getByRole('button',{name:'Növbə cədvəli'}).click();
  await settings.getByRole('button',{name:'Növbə əlavə et'}).waitFor();
  await nav.getByRole('button',{name:'Avtomatik göndərmə'}).click();
  await settings.getByRole('heading',{name:'Avtomatik göndərmə'}).waitFor();
  await link.click();
  await settings.getByRole('heading',{name:'Cihaz və bağlantı'}).waitFor();
  assert.equal(context.pages().length,2);
  state={enabled:false,configured:false,online:false};
  const retry=settings.getByRole('button',{name:'Yenilə',exact:true});
  await retry.click();
  await settings.getByRole('button',{name:'Qeydiyyata al'}).waitFor();
  assert.equal(await nav.getByRole('button',{name:'Klinikalar və radioloqlar'}).isDisabled(),true);
  for(const error of [{code:'NETWORK_DESKTOP_REQUIRED'},{code:'NETWORK_DESKTOP_IDENTITY'},{error:'Bu əməliyyat yalnız Windows RADAZ Desktop üçün açıqdır.'}]){
   denied=error;await retry.click();
   await settings.getByRole('alert').filter({hasText:/Windows Başlat menyusundan/}).waitFor();
   denied=null;await retry.click();
   await settings.getByRole('button',{name:'Qeydiyyata al'}).waitFor();
   assert.equal(await settings.getByRole('alert').count(),0);
  }
  const web=await browser.newPage();
  let networkRequests=0;
  await web.route('**/local-archive-api/license',route=>route.fulfill({json:{valid:true,kind:'owner',required:true}}));
  await web.route('**/local-archive-api/private-network/**',async route=>{networkRequests++;await route.abort();});
  await web.goto(new URL('private-network/settings',base).href);
  await web.getByText('Windows RADAZ Desktop proqramında açın.').waitFor();
  assert.equal(await web.getByRole('navigation',{name:'DICOM Network ayarları'}).count(),0);
  assert.equal(networkRequests,0);
 }finally{await browser.close();}
});
test('Desktop network checks only selected archive studies and keeps web access disabled',async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.RADAZ_CHROME||'C:/Program Files/Google/Chrome/Application/chrome.exe'});
 try{
 const context=await browser.newContext({viewport:{width:2560,height:1440},userAgent:'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/138.0.0.0 Electron/39.0.0 Safari/537.36'});
 const today=new Date().toLocaleDateString('sv').replaceAll('-','');
 const studies=['2.25.1','2.25.2'].map((uid,i)=>({uid,patient:'TEST '+i,patientId:'qa',date:today,time:'120000',modality:'CT',description:'QA',series:[],imageCount:1,addedAt:1,size:1,storage:'disk'}));
 const calls=[];let dropOnce=false;
 await context.route('**/local-archive-api/**',route=>{const action=new URL(route.request().url()).pathname.split('/').at(-1);const payload=route.request().postDataJSON();calls.push({action,payload});if(action==='send'&&payload.study==='2.25.2'&&dropOnce){dropOnce=false;return route.abort('failed');}return route.fulfill({json:action==='state'?mock:action==='studies'?studies:action==='license'?{valid:true,required:true,kind:'owner'}:{ok:true}});});
 const page=await context.newPage();page.setDefaultTimeout(6500);await page.goto(new URL('archive',base).href);
 const sendButton=page.getByRole('button',{name:'RADAZ-a göndər',exact:true});await sendButton.waitFor();assert.equal(await sendButton.isDisabled(),true);
 await page.getByLabel('TEST 1 müayinəsini seç',{exact:true}).check();await sendButton.click();const dialog=page.getByRole('dialog');await dialog.getByRole('combobox').nth(2).selectOption('dr1');assert.deepEqual(await dialog.locator('li').allTextContents(),['TEST 1 · CT']);await dialog.getByRole('button',{name:'Göndər',exact:true}).click();await dialog.getByText('Göndərişlər növbəyə əlavə edildi.').waitFor();
 assert.deepEqual(calls.filter(c=>c.action==='send').map(c=>[c.payload.study,c.payload.recipients]),[['2.25.2',['dr1']]]);
 await dialog.getByRole('button',{name:'Bağla',exact:true}).click();
 await page.getByLabel('TEST 0 müayinəsini seç',{exact:true}).check();
 await sendButton.click();
 await dialog.getByRole('combobox').nth(2).selectOption('dr1');
 dropOnce=true;
 const nextSend=dialog.getByRole('button',{name:'Göndər',exact:true});
 await nextSend.click();
 await dialog.getByRole('status').getByText(/Failed to fetch/).waitFor();
 await nextSend.click();
 await dialog.getByText('Göndərişlər növbəyə əlavə edildi.').waitFor();
 const batch=calls.filter(c=>c.action==='send').slice(1);
 assert.deepEqual(batch.map(c=>c.payload.study),['2.25.1','2.25.2','2.25.2']);
 assert.ok(batch[1].payload.requestId);assert.equal(batch[1].payload.requestId,batch[2].payload.requestId);
 await page.goto(new URL('private-network',base).href);await page.getByRole('button',{name:'Növbə cədvəli',exact:true}).click();await page.getByRole('button',{name:'Növbə əlavə et'}).click();await page.getByLabel('QA doctor',{exact:true}).first().check();await page.getByRole('button',{name:'Saxla',exact:true}).click();await page.getByText('Saxlanıldı.',{exact:true}).waitFor();assert.deepEqual(calls.find(c=>c.action==='policy').payload.policy.shifts[0].recipients,['dr1']);
 const web=await browser.newPage();web.setDefaultTimeout(6500);await web.route('**/local-archive-api/license',r=>r.fulfill({json:{valid:true,required:true,kind:'owner'}}));await web.goto(new URL('private-network',base).href);await web.getByText('Windows RADAZ Desktop proqramında açın.').waitFor();assert.equal(await web.getByRole('navigation',{name:'DICOM Network'}).count(),0);
 }finally{await browser.close();}
});


test('PACS checks study and series identity before archiving a selected study for the network',async()=>{
 const {readFile}=await import('node:fs/promises');
 const parser=createRequire(import.meta.url)('dicom-parser');
 const bytes=await readFile(new URL('./fixtures/demo/thorax-1.dcm',import.meta.url));
 const sample=parser.parseDicom(bytes);
 const uid=sample.string('x0020000d'),series=sample.string('x0020000e'),sop=sample.string('x00080018');
 const endpoint=new URL('network-fixture',base).href;
 const browser=await chromium.launch({headless:true,executablePath:process.env.RADAZ_CHROME||'C:/Program Files/Google/Chrome/Application/chrome.exe'});
 try{
  const page=await browser.newPage({viewport:{width:2560,height:1440},userAgent:'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/138.0.0.0 Electron/39.0.0 Safari/537.36'});
  page.setDefaultTimeout(7000);
  await page.addInitScript(endpoint=>localStorage.setItem('radaz-pacs-config-v1',JSON.stringify({locations:[{id:'qa',host:'',port:'11112',aeTitle:'QA_PACS',description:'QA',dicomwebUrl:endpoint}],selected:'qa',aeTitle:'RADAZ',listenerPort:'11112'})),endpoint);
  const events=[];let incomplete=false;
  await page.route('**/local-archive-api/**',route=>{
    const request=route.request(),path=new URL(request.url()).pathname.split('/').at(-1);
    if(path==='import')events.push({path,bytes:request.postDataBuffer().length,ae:request.headers()['x-radaz-import-ae'],source:request.headers()['x-radaz-import-source']});
    if(path==='send')events.push({path,study:request.postDataJSON().study,onlyUids:request.postDataJSON().onlyUids});
    return route.fulfill({json:path==='state'?mock:path==='license'?{valid:true,required:true,kind:'owner'}:path==='studies'?[]:{ok:true}});
  });
  const field=x=>({Value:[x]});
  const today=new Date().toLocaleDateString('sv').replaceAll('-','');
  await page.route('**/network-fixture/**',route=>{
    const path=new URL(route.request().url()).pathname;
    if(path.endsWith('/studies'))return route.fulfill({json:[{ '0020000D':field(uid),'00100010':field('QA_STUDY'),'00080020':field(today),'00080061':field('CT'),'00201206':field(1),'00201208':field(1)},{ '0020000D':field('2.25.999'),'00100010':field('QA_MISMATCH'),'00080020':field(today),'00080061':field('CT'),'00201206':field(1),'00201208':field(1)}]});
    if(path.endsWith('/series'))return route.fulfill({json:[{'0020000E':field(series),'00201209':field(1)}]});
    if(path.endsWith('/instances')&&incomplete)return route.fulfill({json:[]});
    if(path.endsWith('/instances'))return route.fulfill({json:[{'0020000E':field(series),'00080018':field(sop)}]});
    return route.fulfill({body:bytes,contentType:'application/dicom'});
  });
  await page.goto(new URL('pacs',base).href);
  await page.getByRole('button',{name:/Axtar/}).first().click();
  const first=page.getByLabel('QA_STUDY müayinəsini seç',{exact:true});
  await first.check();
  async function send(){await page.getByRole('button',{name:'RADAZ-a göndər',exact:true}).click();const dialog=page.getByRole('dialog');await dialog.getByRole('combobox').nth(2).selectOption('dr1');await dialog.getByRole('button',{name:'Göndər',exact:true}).click();return dialog;}
  const good=await send();await good.getByText('Göndərişlər növbəyə əlavə edildi.').waitFor();
  assert.deepEqual(events,[{path:'import',bytes:bytes.length,ae:'QA_PACS',source:'private-network-stage'},{path:'send',study:uid,onlyUids:[sop]}]);
  await good.getByRole('button',{name:'Bağla',exact:true}).click();await first.uncheck();
  await page.getByLabel('QA_MISMATCH müayinəsini seç',{exact:true}).check();
  const bad=await send();await bad.getByText('PACS-dan gələn görüntü seçilmiş müayinə və seriyaya uyğun deyil.').waitFor();
  assert.equal(events.length,2);
  await bad.getByRole('button',{name:'Bağla',exact:true}).click();await page.getByLabel('QA_MISMATCH müayinəsini seç',{exact:true}).uncheck();await first.check();incomplete=true;
  const partial=await send();await partial.getByText('PACS-dən müayinənin bütün DICOM fayllarının siyahısı alınmadı').waitFor();assert.equal(events.length,2);
 }finally{await browser.close();}
});
