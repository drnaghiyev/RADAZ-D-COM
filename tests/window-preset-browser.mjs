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
 const context=await browser.newContext({viewport:{width:1280,height:800},hasTouch:true}),errors=[];context.setDefaultTimeout(25000);
 context.on('page',p=>p.on('pageerror',e=>errors.push(e.message)));
 await context.route('**/local-archive-api/license',route=>route.fulfill({json:{valid:true,required:true,kind:'owner',message:'Synthetic license',deviceId:'TEST'}}));
 const viewer=await context.newPage();await viewer.goto(base);
 await viewer.waitForFunction(()=>document.querySelector('.statusbar')?.textContent.includes('Cornerstone3D hazırdır'));
 const created=context.waitForEvent('page');await viewer.getByRole('button',{name:'Local arxiv',exact:true}).click();const archive=await created;
 await archive.getByRole('checkbox',{name:'Bu gün',exact:true}).uncheck();
 const pane=(page,id)=>page.locator(`[data-panel="${id}"]`),windowText=(page,id)=>pane(page,id).locator('.bottom-left span').first();
 const expectWindow=async(page,id,text)=>{await windowText(page,id).filter({hasText:text}).waitFor();assert.equal(await windowText(page,id).innerText(),text);};
 const scroll=async(page,id,direction)=>{
  const before=await pane(page,id).locator('.bottom-right').innerText();await pane(page,id).hover();await page.mouse.wheel(0,direction*120);
  await page.waitForFunction(({id,before})=>document.querySelector(`[data-panel="${id}"] .bottom-right`)?.textContent!==before,{id,before});
 };
 for(const modality of ['CT','MR']){
  await archive.getByRole('cell').filter({hasText:`WINDOW ${modality}`}).dblclick();
  await pane(viewer,'A').locator('.top-left').filter({hasText:`WINDOW ${modality}`}).waitFor();
  await viewer.locator('.series-card').filter({hasText:`${modality} window 1`}).click();
  await expectWindow(viewer,'A','WL 100 · WW 400');
  for(const [screen,activation] of [[1280,'click-only'],[1920,'mouse'],[2560,'touch'],[1280,'keyboard']]){
  await viewer.setViewportSize({width:screen,height:900});await delay(400);
  for(const [label,wl,ww] of [['Ağciyər',-600,1500],['Sümük',400,1800],['Beyin',40,80]]){
   const trigger=viewer.getByRole('button',{name:'WINDOW PRESET menyusu',exact:true});
   if(!await trigger.isVisible())await viewer.getByRole('button',{name:'Əlavə alətlər',exact:true}).click();
   if(activation==='click-only')await trigger.evaluate(button=>button.click());
   else if(activation==='mouse')await trigger.click();
   else if(activation==='touch')await trigger.tap();
   else{await trigger.focus();await trigger.press('Enter');}
   await viewer.getByRole('menuitem').filter({hasText:label}).tap();
   await expectWindow(viewer,'A',`WL ${wl} · WW ${ww}`);
   await scroll(viewer,'A',1);await expectWindow(viewer,'A',`WL ${wl} · WW ${ww}`);
  }
  }
  console.log(`PASS: ${modality} window presets: click-only, mouse, touch, keyboard; 1280/1920/2560; slice persistence`);
 }
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

