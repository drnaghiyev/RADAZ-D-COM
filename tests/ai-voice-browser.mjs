// Real rendering with disposable CT, MR and projection studies. No patient data.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {spawn,spawnSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,rmSync,createWriteStream,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import http from 'node:http';
import JSZip from 'jszip';
import {setTimeout as delay} from 'node:timers/promises';
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'playwright');
const free=()=>new Promise(resolve=>{const s=http.createServer();s.listen(0,'127.0.0.1',()=>{const port=s.address().port;s.close(()=>resolve(port));});});
const root=mkdtempSync(path.join(tmpdir(),'radaz-viewer-reset-'));
mkdirSync('outputs/viewer-reset',{recursive:true});
const fixture=spawn(process.env.PYTHON||'python',['tests/media-browser-fixture.py','--root',root],{windowsHide:true,stdio:['ignore','pipe','pipe']});
let server,browser,fixtureErrors='';fixture.stderr.on('data',d=>fixtureErrors+=String(d));
try{
 const archivePort=await new Promise((resolve,reject)=>{let buffer='';const timer=setTimeout(()=>reject(Error(fixtureErrors)),20000);fixture.stdout.on('data',d=>{buffer+=d;if(buffer.includes('\n')){clearTimeout(timer);resolve(JSON.parse(buffer.split('\n')[0]).port);}});});
 await fetch(`http://127.0.0.1:${archivePort}/_test/window-modalities`,{method:'POST'});
 const port=await free(),worker=await free(),base=`http://127.0.0.1:${port}`;
 server=spawn(process.execPath,['scripts/start-release.mjs'],{windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,RADAZ_PORT:String(port),RADAZ_WORKER_PORT:String(worker),RADAZ_ARCHIVE_PORT:String(archivePort)}});
 const log=createWriteStream('outputs/viewer-reset/server.log');server.stdout.pipe(log);server.stderr.pipe(log);
 for(let i=0;i<100;i++){try{if((await fetch(base)).ok)break;}catch{}await delay(200);}
 browser=await chromium.launch({headless:true,channel:'msedge',args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream']});
 const context=await browser.newContext({viewport:{width:1920,height:1080}}),errors=[];context.setDefaultTimeout(25000);
 context.on('page',p=>p.on('pageerror',e=>errors.push(e.message)));
 await context.route('**/local-archive-api/license',route=>route.fulfill({json:{valid:true,required:true,kind:'owner',message:'Synthetic license',deviceId:'TEST'}}));
 const viewer=await context.newPage();await viewer.goto(base);
 await viewer.waitForFunction(()=>document.querySelector('.statusbar')?.textContent.includes('Cornerstone3D hazırdır'));
 const created=context.waitForEvent('page');await viewer.getByRole('button',{name:'Local arxiv',exact:true}).click();const archive=await created;
 await archive.getByRole('checkbox',{name:'Bu gün',exact:true}).uncheck();

 await archive.getByRole('cell').filter({hasText:'WINDOW CT'}).dblclick();
 const pane=viewer.locator('[data-panel="A"]');
 await pane.locator('.bottom-left span').first().filter({hasText:'WL 100 · WW 400'}).waitFor();

 const calls=[];let savedSettings={configured:true,model:'gpt-6-astra',reasoning:'low'};
 await context.route('**/local-archive-api/ai/**',async route=>{
  const endpoint=route.request().url().split('/').pop();
  const body=route.request().method()==='POST'?route.request().postDataJSON():null;
  if(endpoint==='settings'){if(body)savedSettings={...savedSettings,...body};return route.fulfill({json:savedSettings});}
  if(endpoint==='test')return route.fulfill({json:{ok:true,message:'Test bağlantısı'}});
  if(endpoint==='transcribe'){assert.ok(body.audio.length>0);return route.fulfill({json:{text:'Sintetik diktə: sağ tərəfdə 5 mm.'}});}
  if(endpoint==='report'){calls.push(body);return route.fulfill({json:{text:body.phase==='voice'?'Öd kisəsi: Divarı 5 mm qalınlaşmışdır.':body.phase==='report'?'FINAL SYNTHETIC REPORT':'SYNTHETIC OBSERVATIONS',templateId:body.templates?.[0]?.id||'',warnings:[]}});}
  return route.abort();
 });
 const assistant=await context.newPage();await assistant.goto(base+'/report?archive-study=2.25.401');
 await assistant.getByRole('textbox',{name:'Hesabat mətni',exact:true}).waitFor();
 assert.equal(await assistant.locator('.report-series-list input:checked').count(),2,'Both CT series are selected');
 assert.match(await assistant.locator('.assistant-selection').innerText(),/24/);
 assert.equal(await assistant.locator('.assistant-analyze').isDisabled(),false);
 assert.equal(await assistant.locator('a[href*="chatgpt.com"]').count(),0);
 await assistant.locator('.assistant-preview img').waitFor();await assistant.getByRole('button',{name:'Növbəti görüntü',exact:true}).click();assert.match(await assistant.locator('.assistant-navigation').innerText(),/2 \/ 24/);
 // Actual DICOM windowing by pointer and wheel, isolated to the selected series.
 const beforeImage=await assistant.locator('.assistant-preview img').getAttribute('src');
 const area=await assistant.locator('.assistant-image').boundingBox();
 await assistant.mouse.move(area.x+area.width*.4,area.y+area.height*.4);await assistant.mouse.down();
 await assistant.mouse.move(area.x+area.width*.4+45,area.y+area.height*.4+25,{steps:6});await assistant.mouse.up();
 assert.ok(Number(await assistant.getByLabel('AI WW',{exact:true}).inputValue())>400);
 await assistant.waitForFunction(src=>document.querySelector('.assistant-preview img')?.src!==src,beforeImage);
 await assistant.mouse.wheel(0,120);await assistant.waitForFunction(()=>document.querySelector('.assistant-navigation')?.textContent.includes('3 / 24'));
 const editorBefore=await assistant.locator('.rich-content').boundingBox();
 await assistant.getByRole('button',{name:'AI ayarları',exact:true}).click();
 await assistant.getByRole('dialog',{name:'AI ayarları'}).waitFor();
 assert.equal(await assistant.locator('.report-assistant .ai-settings').count(),0,'Settings are portaled, not inline');
 assert.deepEqual(await assistant.locator('.rich-content').boundingBox(),editorBefore);
 await assistant.getByLabel('AI modeli',{exact:true}).selectOption('gpt-6.1-sol');
 await assistant.getByLabel('Düşünmə səviyyəsi',{exact:true}).selectOption('high');
 await assistant.locator('.ai-settings button[type=submit]').click();
 await assistant.locator('.ai-settings [role=status]').filter({hasText:'AI ayarları saxlanıldı'}).waitFor();
 assert.equal(savedSettings.reasoning,'high');
 await assistant.keyboard.press('Escape');
 await assistant.getByRole('dialog').waitFor({state:'hidden'});
 await assistant.getByRole('button',{name:'AI ayarları',exact:true}).click();
 await assistant.waitForFunction(()=>document.querySelector('select[aria-label="Düşünmə səviyyəsi"]')?.value==='high');
 await assistant.setViewportSize({width:480,height:640});
 await assistant.waitForFunction(()=>{const el=document.querySelector('[role=dialog]');return el&&el.getBoundingClientRect().height<=innerHeight-16;});
 await assistant.screenshot({path:'outputs/viewer-reset/settings-054.png'});
 await assistant.keyboard.press('Escape');
 await assistant.setViewportSize({width:1920,height:1080});
 await assistant.getByLabel('Hesabat dili',{exact:true}).selectOption('tr');
 await assistant.locator('.assistant-analyze').click();
 await assistant.getByRole('textbox',{name:'Hesabat mətni',exact:true}).filter({hasText:'FINAL SYNTHETIC REPORT'}).waitFor();
 assert.equal(calls.filter(c=>c.phase==='observations').length,3);
 assert.equal(calls.filter(c=>c.phase==='observations').flatMap(c=>c.images).length,24);
 assert.ok(calls[0].images.every(i=>i.data.startsWith('data:image/jpeg;base64,')));
 assert.equal(await assistant.getByRole('button',{name:'RADAZ Voice',exact:true}).count(),0,'Voice removed from AI assistant');
 assert.ok(calls.every(c=>c.language==='tr'));
 assert.equal(await assistant.locator('.report-sidebar .report-series-list').count(),1);
 for(const size of [{width:1920,height:1080},{width:1366,height:768},{width:800,height:850}]){
  await assistant.setViewportSize(size);
  assert.equal(await assistant.evaluate(()=>document.documentElement.scrollHeight<=innerHeight&&document.documentElement.scrollWidth<=innerWidth),true,'Workspace fits viewport');
  assert.ok((await assistant.locator('.rich-content').boundingBox()).height>150);
 }
 await assistant.setViewportSize({width:1366,height:768});
 await assistant.screenshot({path:'outputs/viewer-reset/assistant-053.png'});

 assert.ok(await assistant.evaluate(()=>{const a=document.querySelector('.assistant-preview').getBoundingClientRect(),n=document.querySelector('.assistant-navigation').getBoundingClientRect(),p=document.querySelector('.assistant-providers').getBoundingClientRect();return n.bottom<=a.bottom+1&&p.top>=n.bottom;}),'Preview controls do not overlap');
 const downloading=assistant.waitForEvent('download');await assistant.locator('button[title="MS Word"]').click();const download=await downloading;
 const zip=await JSZip.loadAsync(readFileSync(await download.path()));assert.match(await zip.file('word/document.xml').async('string'),/RADYOLOJİ RAPORU/);
 await assistant.pdf({path:'outputs/viewer-reset/report-053.pdf',format:'A4'});
 await assistant.getByRole('button',{name:'Səslə düzəlt',exact:true}).click();await delay(1100);
 await assistant.getByRole('button',{name:'Dayandır',exact:true}).click();
 await assistant.getByLabel('Səsli düzəliş layihəsi',{exact:true}).waitFor();
 assert.match(await assistant.locator('.rich-content').innerText(),/FINAL SYNTHETIC REPORT/,'Dictation never silently replaces the editor');
 await assistant.getByRole('button',{name:'Düzəlişi tətbiq et',exact:true}).click();
 assert.ok(calls.some(c=>c.phase==='revision'&&c.language==='tr'&&c.observations.includes('FINAL SYNTHETIC REPORT')));
 await context.route('https://radaz.space/voice/',route=>route.fulfill({body:'<h1>Hosted Voice test</h1>',contentType:'text/html'}));
 const opening=context.waitForEvent('page');await viewer.getByRole('button',{name:'RADAZ Voice',exact:true}).click();const voice=await opening;
 await voice.waitForURL('https://radaz.space/voice/');
 assert.equal(voice.url(),'https://radaz.space/voice/');
 assert.deepEqual(errors,[]);
 console.log('PASS: assistant image analysis, language, left series list, responsive bounded editor, direct hosted Voice');
}finally{await browser?.close();server?.kill();fixture.kill();}

