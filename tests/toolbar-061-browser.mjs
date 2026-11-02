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
 const context=await browser.newContext({viewport:{width:1280,height:800},hasTouch:true}),errors=[];context.setDefaultTimeout(25000);
 context.on('page',p=>p.on('pageerror',e=>errors.push(e.message)));
 await context.route('**/local-archive-api/license',route=>route.fulfill({json:{valid:true,required:true,kind:'owner',message:'Synthetic license',deviceId:'TEST'}}));
 const viewer=await context.newPage();await viewer.goto(base);
 await viewer.waitForFunction(()=>document.querySelector('.statusbar')?.textContent.includes('Cornerstone3D hazırdır'));

 for(const route of ['/','/archive','/pacs','/mpr','/3d']){
  await viewer.goto(base+route);
  for(const width of [640,1280,1920]){
   await viewer.setViewportSize({width,height:900});
   const settings=viewer.getByRole('button',{name:'Alət panelini fərdiləşdir',exact:true});
   await settings.waitFor({state:'visible'});await delay(200);
   assert.equal(await settings.evaluate(el=>el.closest('[data-toolbar-group]')?.getAttribute('data-toolbar-group')),'toolbar-settings');
   const box=await settings.boundingBox();assert.ok(box.x>=0&&box.x+box.width<=width,route+' settings inside viewport');
   assert.equal(await viewer.evaluate(()=>{
    const system=document.querySelector('[data-toolbar-group="toolbar-settings"]').getBoundingClientRect();
    return [...document.querySelectorAll('[data-toolbar-group]')].some(el=>{
     if(el.dataset.toolbarGroup==='toolbar-settings'||getComputedStyle(el).visibility==='hidden')return false;
     const r=el.getBoundingClientRect();
     return r.width>0&&r.height>0&&Math.min(r.right,system.right)-Math.max(r.left,system.left)>1&&Math.min(r.bottom,system.bottom)-Math.max(r.top,system.top)>1;
    });
   }),false,route+' settings group must not cover other tools');
   await settings.click();
   await viewer.getByRole('dialog',{name:'Alət panelinin düzülüşü',exact:true}).waitFor({state:'visible'});
   await viewer.getByRole('button',{name:'Təsdiq',exact:true}).click();
  }
 }
 await viewer.goto(base);await viewer.setViewportSize({width:1920,height:1080});
 const settingsGroup=viewer.locator('[data-toolbar-group="toolbar-settings"]');
 const handle=settingsGroup.locator('.toolbar-drag-handle');
 await handle.waitFor({state:'visible'});
 const h=await handle.boundingBox();
 await viewer.mouse.move(h.x+h.width/2,h.y+h.height/2);await viewer.mouse.down();
 await viewer.mouse.move(1900,350,{steps:15});await viewer.mouse.up();
 await viewer.waitForFunction(()=>document.querySelector('[data-toolbar-group="toolbar-settings"]')?.dataset.dock==='right');
 await viewer.reload();await viewer.waitForFunction(()=>document.querySelector('[data-toolbar-group="toolbar-settings"]')?.dataset.dock==='right');
 await settingsGroup.getByRole('button',{name:'Alət panelini fərdiləşdir',exact:true}).click();
 await viewer.getByRole('button',{name:'Təsdiq',exact:true}).click();
 await handle.press('Enter');
 await viewer.waitForFunction(()=>document.querySelector('[data-toolbar-group="toolbar-settings"]')?.dataset.dock==='top');
 await viewer.reload();await viewer.waitForFunction(()=>document.querySelector('[data-toolbar-group="toolbar-settings"]')?.dataset.dock==='top');
 assert.deepEqual(errors,[]);console.log('PASS: settings group in five windows, responsive sizing, pointer drag to right dock, persistence and return to top');
}finally{await browser?.close();server?.kill();fixture.kill();}




