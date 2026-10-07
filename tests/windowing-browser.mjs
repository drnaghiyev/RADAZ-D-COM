// Real rendering with disposable CT, MR and projection studies. No patient data.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {spawn,spawnSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,rmSync,createWriteStream} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {setTimeout as delay} from 'node:timers/promises';
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'playwright');
const free=()=>new Promise(resolve=>{const s=http.createServer();s.listen(0,'127.0.0.1',()=>{const port=s.address().port;s.close(()=>resolve(port));});});
const root=mkdtempSync(path.join(tmpdir(),'radaz-windowing-'));
mkdirSync('outputs/windowing',{recursive:true});
const fixture=spawn(process.env.PYTHON||'python',['tests/media-browser-fixture.py','--root',root],{windowsHide:true,stdio:['ignore','pipe','pipe']});
let server,browser,fixtureErrors='';fixture.stderr.on('data',d=>fixtureErrors+=String(d));
try{
 const archivePort=await new Promise((resolve,reject)=>{let buffer='';const timer=setTimeout(()=>reject(Error(fixtureErrors)),20000);fixture.stdout.on('data',d=>{buffer+=d;if(buffer.includes('\n')){clearTimeout(timer);resolve(JSON.parse(buffer.split('\n')[0]).port);}});});
 await fetch(`http://127.0.0.1:${archivePort}/_test/window-modalities`,{method:'POST'});
 const port=await free(),worker=await free(),base=`http://127.0.0.1:${port}`;
 server=spawn(process.execPath,['scripts/start-release.mjs'],{windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,RADAZ_PORT:String(port),RADAZ_WORKER_PORT:String(worker),RADAZ_ARCHIVE_PORT:String(archivePort)}});
 const log=createWriteStream('outputs/windowing/server.log');server.stdout.pipe(log);server.stderr.pipe(log);
 for(let i=0;i<100;i++){try{if((await fetch(base)).ok)break;}catch{}await delay(200);}
 browser=await chromium.launch({headless:true,channel:'msedge'});
 const context=await browser.newContext({viewport:{width:1440,height:1000}}),errors=[];context.setDefaultTimeout(25000);
 context.on('page',p=>p.on('pageerror',e=>errors.push(e.message)));
 await context.route('**/local-archive-api/license',route=>route.fulfill({json:{valid:true,required:true,kind:'owner',message:'Synthetic license',deviceId:'TEST'}}));
 const viewer=await context.newPage();await viewer.goto(base);
 await viewer.waitForFunction(()=>document.querySelector('.statusbar')?.textContent.includes('Cornerstone3D hazırdır'));
 const created=context.waitForEvent('page');await viewer.getByRole('button',{name:'Local arxiv',exact:true}).click();const archive=await created;
 await archive.getByRole('checkbox',{name:'Bu gün',exact:true}).uncheck();
 const pane=(page,id)=>page.locator(`[data-panel="${id}"]`),windowText=(page,id)=>pane(page,id).locator('.bottom-left span').first();
 const expectWindow=async(page,id,text)=>{await windowText(page,id).filter({hasText:text}).waitFor();assert.equal(await windowText(page,id).innerText(),text);};
 const custom=async(page,id,wl,ww)=>{
  await pane(page,id).click({position:{x:30,y:30}});
  await page.getByRole('button',{name:'Pozitiv, neqativ və window',exact:true}).click();await page.getByRole('menuitem',{name:'Xüsusi pəncərə',exact:true}).click();
  await page.getByLabel('Window level (WL)',{exact:true}).fill(String(wl));await page.getByLabel('Window width (WW)',{exact:true}).fill(String(ww));await page.getByRole('button',{name:'Tətbiq et',exact:true}).click();
  await expectWindow(page,id,`WL ${wl} · WW ${ww}`);
 };
 const scroll=async(page,id,direction)=>{
  const before=await pane(page,id).locator('.bottom-right').innerText();await pane(page,id).hover();await page.mouse.wheel(0,direction*120);
  await page.waitForFunction(({id,before})=>document.querySelector(`[data-panel="${id}"] .bottom-right`)?.textContent!==before,{id,before});
 };
 const drag=async(page,id)=>{
  await pane(page,id).click({position:{x:30,y:30}});await page.keyboard.press('w');const box=await pane(page,id).boundingBox();
  await page.mouse.move(box.x+box.width*.3,box.y+box.height*.3);await page.mouse.down();await page.mouse.move(box.x+box.width*.3+55,box.y+box.height*.3+25,{steps:8});await page.mouse.up();
  return windowText(page,id).innerText();
 };
 for(const modality of ['CT','MR']){
  await archive.getByRole('cell').filter({hasText:`WINDOW ${modality}`}).dblclick();
  await pane(viewer,'A').locator('.top-left').filter({hasText:`WINDOW ${modality}`}).waitFor();
  await viewer.locator('.series-card').filter({hasText:`${modality} window 1`}).click();
  await expectWindow(viewer,'A','WL 100 · WW 400');
  await viewer.getByRole('button',{name:'Pozitiv, neqativ və window',exact:true}).click();await viewer.getByRole('menuitem',{name:'WL 80 / WW 160',exact:true}).click();
  await scroll(viewer,'A',1);await expectWindow(viewer,'A','WL 80 · WW 160');
  await viewer.locator('.series-card').filter({hasText:`${modality} window 2`}).click();await expectWindow(viewer,'A','WL 100 · WW 400');
  await viewer.locator('.series-card').filter({hasText:`${modality} window 1`}).click();await expectWindow(viewer,'A','WL 80 · WW 160');
  await viewer.getByRole('button',{name:'Panel düzülüşü',exact:true}).click();await viewer.getByRole('gridcell',{name:'2 sütun, 1 sətir, 2 panel',exact:true}).click();
  await pane(viewer,'B').click();await viewer.locator('.series-card').filter({hasText:`${modality} window 1`}).click();await expectWindow(viewer,'B','WL 80 · WW 160');
  await custom(viewer,'B',75,123);await expectWindow(viewer,'A','WL 75 · WW 123');
  await viewer.locator('.series-card').filter({hasText:`${modality} window 2`}).click();await expectWindow(viewer,'B','WL 100 · WW 400');
  await custom(viewer,'B',500,600);await expectWindow(viewer,'A','WL 75 · WW 123');
  await viewer.locator('.series-card').filter({hasText:`${modality} window 1`}).click();await expectWindow(viewer,'B','WL 75 · WW 123');
  await viewer.getByRole('button',{name:'WINDOW PRESET menyusu',exact:true}).click();await viewer.getByRole('menuitem').filter({hasText:'Ağciyər'}).click();
  const preset=await windowText(viewer,'B').innerText();assert.notEqual(preset,'WL 75 · WW 123');await expectWindow(viewer,'A',preset);
  await scroll(viewer,'B',1);await expectWindow(viewer,'B',preset);
  const dragged=await drag(viewer,'A');assert.notEqual(dragged,preset);await expectWindow(viewer,'B',dragged);
  const opened=context.waitForEvent('page');await viewer.getByRole('button',{name:'MPR rekonstruksiya',exact:true}).click();const mpr=await opened;
  await mpr.waitForFunction(()=>document.querySelectorAll('[data-panel][data-has-image="true"]').length===3&&!document.querySelector('.viewport-loading'));
  for(const id of ['MA','MC','MS'])await expectWindow(mpr,id,dragged);
  await custom(mpr,'MC',40,400);
  for(const id of ['MA','MC','MS'])await expectWindow(mpr,id,'WL 40 · WW 400');
  for(const id of ['A','B'])await expectWindow(viewer,id,'WL 40 · WW 400');
  await scroll(mpr,'MC',1);await expectWindow(mpr,'MC','WL 40 · WW 400');
  await mpr.getByRole('button',{name:'MIP',exact:true}).click();await mpr.getByRole('slider',{name:'Aktiv MPR panelinin qalınlığı'}).fill('3');
  await mpr.waitForFunction(()=>!document.querySelector('.viewport-loading'));await delay(300);
  for(const id of ['MA','MC','MS'])await expectWindow(mpr,id,'WL 40 · WW 400');
  const mprDrag=await drag(mpr,'MA');assert.notEqual(mprDrag,'WL 40 · WW 400');
  for(const id of ['MC','MS'])await expectWindow(mpr,id,mprDrag);
  for(const id of ['A','B'])await expectWindow(viewer,id,mprDrag);
  await scroll(mpr,'MA',1);await expectWindow(mpr,'MA',mprDrag);
  await viewer.locator('.series-card').filter({hasText:`${modality} window 2`}).click();
  for(const id of ['MA','MC','MS'])await expectWindow(mpr,id,'WL 500 · WW 600');
  await expectWindow(viewer,'B',mprDrag);
  await viewer.locator('.series-card').filter({hasText:`${modality} window 1`}).click();
  for(const id of ['MA','MC','MS'])await expectWindow(mpr,id,mprDrag);
  await mpr.screenshot({path:`outputs/windowing/${modality.toLowerCase()}-mpr.png`});await mpr.close();
  console.log(`PASS: ${modality} menu, custom, preset and drag affect all series slices/panels, separate series stay independent; MPR shares all planes across scrolling and reconstruction, including the source Viewer`);
 }
 await archive.getByRole('cell').filter({hasText:'WINDOW DX'}).dblclick();await expectWindow(viewer,'A','WL 100 · WW 400');
 await custom(viewer,'A',75,123);await scroll(viewer,'A',1);await expectWindow(viewer,'A','WL 200 · WW 800');
 await scroll(viewer,'A',-1);await expectWindow(viewer,'A','WL 75 · WW 123');
 await viewer.getByRole('button',{name:'Panel düzülüşü',exact:true}).click();await viewer.getByRole('gridcell',{name:'2 sütun, 1 sətir, 2 panel',exact:true}).click();
 await pane(viewer,'B').click();await viewer.locator('.series-card').filter({hasText:'DX window 1'}).click();await expectWindow(viewer,'B','WL 100 · WW 400');
 await custom(viewer,'B',120,240);await expectWindow(viewer,'A','WL 75 · WW 123');await scroll(viewer,'B',1);await expectWindow(viewer,'B','WL 200 · WW 800');
 console.log('PASS: DX radiographs change only the active image/panel; other projections keep their own defaults and edits');
 assert.deepEqual(errors,[]);
}catch(error){
 console.error(error);
 for(const [i,page] of(browser?.contexts()[0]?.pages()||[]).entries()){
  console.error('PAGE',i,await page.locator('body').innerText().catch(()=>''));
  await page.screenshot({path:`outputs/windowing/failure-${i}.png`}).catch(()=>{});
 }
 throw error;
}finally{
 await browser?.close();
 for(const child of [server,fixture])if(child?.pid)spawnSync('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});
 assert.ok(path.resolve(root).startsWith(path.resolve(tmpdir())+path.sep+'radaz-windowing-'));rmSync(root,{recursive:true,force:true});
}
