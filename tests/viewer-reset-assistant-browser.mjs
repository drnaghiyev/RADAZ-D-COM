// Real rendering with disposable CT, MR and projection studies. No patient data.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {spawn,spawnSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,rmSync,createWriteStream,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import http from 'node:http';
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
 browser=await chromium.launch({headless:true,channel:'msedge'});
 const context=await browser.newContext({viewport:{width:1440,height:1000}}),errors=[];context.setDefaultTimeout(25000);
 context.on('page',p=>p.on('pageerror',e=>errors.push(e.message)));
 await context.route('**/local-archive-api/license',route=>route.fulfill({json:{valid:true,required:true,kind:'owner',message:'Synthetic license',deviceId:'TEST'}}));
 const viewer=await context.newPage();await viewer.goto(base);
 await viewer.waitForFunction(()=>document.querySelector('.statusbar')?.textContent.includes('Cornerstone3D hazırdır'));
 const created=context.waitForEvent('page');await viewer.getByRole('button',{name:'Local arxiv',exact:true}).click();const archive=await created;
 await archive.getByRole('checkbox',{name:'Bu gün',exact:true}).uncheck();

 await archive.getByRole('cell').filter({hasText:'WINDOW CT'}).dblclick();
 const pane=viewer.locator('[data-panel="A"]');
 await pane.locator('.bottom-left span').first().filter({hasText:'WL 100 · WW 400'}).waitFor();
 const canvas=pane.locator('.dicom-canvas');
 await delay(250);const original=await canvas.screenshot();
 for(const name of ['90° sola fırlat','90° sağa fırlat','180° fırlat','Üfüqi çevir','Şaquli çevir'])assert.ok(await viewer.getByRole('button',{name,exact:true}).isVisible());
 assert.equal(await viewer.getByRole('button',{name:'Fırlat və çevir',exact:true}).count(),0);
 await viewer.getByRole('button',{name:'90° sağa fırlat',exact:true}).click();
 await viewer.getByRole('button',{name:'Üfüqi çevir',exact:true}).click();
 await viewer.getByRole('button',{name:'Şaquli çevir',exact:true}).click();
 const box=await canvas.boundingBox(),x=box.x+box.width*.5,y=box.y+box.height*.5;
 for(const button of ['middle','right']){await viewer.mouse.move(x,y);await viewer.mouse.down({button});await viewer.mouse.move(x+55,y+45,{steps:6});await viewer.mouse.up({button});}
 await viewer.getByRole('button',{name:'Pozitiv, neqativ və window',exact:true}).click();await viewer.getByRole('menuitem',{name:'WL 80 / WW 160',exact:true}).click();
 await viewer.keyboard.press('n');await delay(150);assert.notDeepEqual(await canvas.screenshot(),original);
 await viewer.getByRole('button',{name:'Görüntünü sıfırla',exact:true}).click();
 await pane.locator('.bottom-left span').first().filter({hasText:'WL 100 · WW 400'}).waitFor();await delay(250);
 assert.deepEqual(await canvas.screenshot(),original,'Reset restores exact original pixels after window, invert, rotation, flips, pan and zoom');
 await viewer.getByRole('button',{name:'90° sola fırlat',exact:true}).click();await viewer.keyboard.press('Control+Shift+Backslash');await delay(200);assert.deepEqual(await canvas.screenshot(),original,'Keyboard uses the same complete reset');
 await viewer.screenshot({path:'outputs/viewer-reset/toolbar.png'});
 const opened=context.waitForEvent('page');await viewer.getByRole('button',{name:'AI asistent',exact:true}).click();const assistant=await opened;
 await assistant.getByRole('textbox',{name:'Hesabat mətni',exact:true}).waitFor();
 assert.equal(await assistant.locator('.report-series-list input:checked').count(),2,'Both CT series are selected');
 assert.match(await assistant.locator('.assistant-selection').innerText(),/2 seriya · 24 görüntü/);
 assert.equal(await assistant.getByRole('button',{name:'Dərindən incələ və rapor yaz',exact:true}).isDisabled(),true);
 assert.equal(await assistant.locator('a[href*="chatgpt.com"]').count(),0);
 await assistant.locator('.assistant-preview img').waitFor();await assistant.getByRole('button',{name:'Növbəti görüntü',exact:true}).click();assert.match(await assistant.locator('.assistant-navigation').innerText(),/2 \/ 24/);
 await assistant.getByRole('textbox',{name:'AI üçün əlavə tapşırıq',exact:true}).fill('Bronxit raporu yaz — sınaq');
 await assistant.getByRole('textbox',{name:'Hesabat mətni',exact:true}).fill('Sintetik sınaq hesabatı.');
 await assistant.getByRole('button',{name:'Yadda saxla',exact:true}).click();await assistant.locator('[role="status"]').filter({hasText:'Hesabat bu brauzerdə saxlanıldı'}).waitFor();
 await assistant.screenshot({path:'outputs/viewer-reset/assistant.png'});await assistant.close();
 const again=context.waitForEvent('page');await viewer.getByRole('button',{name:'AI asistent',exact:true}).click();const restored=await again;
 await restored.getByRole('textbox',{name:'Hesabat mətni',exact:true}).filter({hasText:'Sintetik sınaq hesabatı.'}).waitFor();
 assert.equal(await restored.getByRole('textbox',{name:'AI üçün əlavə tapşırıq',exact:true}).inputValue(),'Bronxit raporu yaz — sınaq');
 // Real local DPAPI settings, simulated OpenAI results. No real API credential or patient data.
 await restored.getByRole('button',{name:'AI ayarları',exact:true}).click();
 const settings=restored.getByRole('dialog',{name:'AI ayarları',exact:true});
 const key='sk-'+'synthetic-browser-test-'.repeat(3);
 await settings.getByLabel('OpenAI API açarı',{exact:true}).fill(key);
 const savedSettings=restored.waitForResponse(r=>r.url().endsWith('/ai/settings')&&r.request().method()==='POST');
 await settings.getByRole('button',{name:'Yadda saxla',exact:true}).click();const savedResponse=await savedSettings;
 assert.equal(savedResponse.status(),200);assert.equal((await savedResponse.text()).includes(key),false);
 await settings.getByRole('status').filter({hasText:'API açarı saxlanıldı'}).waitFor();
 assert.equal(await settings.getByLabel('OpenAI API açarı',{exact:true}).inputValue(),'');
 const encrypted=readFileSync(path.join(root,'archive/product/openai-key.dpapi'));assert.equal(encrypted.includes(Buffer.from(key)),false);
 await settings.getByRole('button',{name:'Bağla',exact:true}).first().click();
 const analyze=restored.getByRole('button',{name:'Dərindən incələ və rapor yaz',exact:true});assert.equal(await analyze.isEnabled(),true);
 await restored.getByRole('button',{name:'AI ayarları',exact:true}).click();await settings.locator('.ai-key-status').filter({hasText:'saxlanılıb'}).waitFor();
 assert.equal(await settings.getByLabel('OpenAI API açarı',{exact:true}).inputValue(),'');
 await settings.getByRole('button',{name:'Bağla',exact:true}).first().click();
 let calls=[],fail=false,hold=false,release;
 await context.route('**/local-archive-api/ai/report',async route=>{
  const body=route.request().postDataJSON();calls.push(body);
  if(hold)await new Promise(resolve=>release=resolve);
  if(fail)return route.fulfill({status:502,json:{error:'Sınaq: OpenAI kvotası bitib.'}});
  return route.fulfill({json:{text:body.images?.length?'Sintetik müşahidələr':'AI hesabat layihəsi — sınaq nəticəsi. <script>alert(1)</script>'}}).catch(()=>{});
 });
 await analyze.click();await restored.getByRole('status').filter({hasText:'AI layihəsi redaktora əlavə edildi'}).waitFor();
 assert.equal(calls.length,4);assert.equal(calls.slice(0,3).flatMap(c=>c.images).length,24,'All images in both series are sent');
 assert.equal(new Set(calls.slice(0,3).flatMap(c=>c.images).map(i=>i.label)).size,24,'Every image gets a distinct label');
 assert.equal(JSON.stringify(calls).includes(key),false);
 const text=await restored.getByRole('textbox',{name:'Hesabat mətni',exact:true}).innerText();assert.match(text,/Sintetik sınaq hesabatı/);assert.match(text,/AI hesabat layihəsi/);
 assert.equal(await restored.locator('.rich-editor script').count(),0,'AI output is escaped plain text');
 fail=true;calls=[];await analyze.click();await restored.getByRole('status').filter({hasText:'Sınaq: OpenAI kvotası bitib.'}).waitFor();
 assert.equal(await restored.getByRole('textbox',{name:'Hesabat mətni',exact:true}).innerText(),text,'Failure preserves the editor');
 fail=false;hold=true;calls=[];await analyze.click();for(let i=0;i<100&&!release;i++)await delay(50);
 await restored.getByRole('button',{name:'Dayandır',exact:true}).click();await restored.getByRole('status').filter({hasText:'Analiz dayandırıldı'}).waitFor();release();await delay(200);
 assert.equal(calls.length,1,'Cancel prevents further batches');assert.equal(await restored.getByRole('textbox',{name:'Hesabat mətni',exact:true}).innerText(),text);
 // Text-only template request, and key removal revokes assistant availability.
 hold=false;calls=[];while(await restored.locator('.report-series-list input:checked').count())await restored.locator('.report-series-list input:checked').first().uncheck();
 await analyze.click();await restored.getByRole('status').filter({hasText:'AI layihəsi redaktora əlavə edildi'}).waitFor();assert.equal(calls.length,1);assert.equal(calls[0].images,undefined);
 await restored.getByRole('button',{name:'AI ayarları',exact:true}).click();await settings.getByRole('button',{name:'Açarı sil',exact:true}).click();await settings.getByRole('status').filter({hasText:'API açarı silindi'}).waitFor();
 await settings.getByRole('button',{name:'Bağla',exact:true}).first().click();assert.equal(await analyze.isDisabled(),true);
 await restored.screenshot({path:'outputs/viewer-reset/assistant-ai.png'});
 assert.deepEqual(errors,[]);
 console.log('PASS: reset/rotation; all CT series; report persistence; encrypted API settings save/reopen/delete; all 24 images analyzed; plain text appended without overwriting; failed/cancelled requests preserve report; text-only drafting');
}catch(error){
 console.error(error);
 for(const [i,page] of(browser?.contexts()[0]?.pages()||[]).entries()){
  console.error('PAGE',i,await page.locator('body').innerText().catch(()=>''));
  await page.screenshot({path:`outputs/viewer-reset/failure-${i}.png`}).catch(()=>{});
 }
 throw error;
}finally{
 await browser?.close();
 for(const child of [server,fixture])if(child?.pid)spawnSync('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});
 assert.ok(path.resolve(root).startsWith(path.resolve(tmpdir())+path.sep+'radaz-viewer-reset-'));rmSync(root,{recursive:true,force:true});
}
