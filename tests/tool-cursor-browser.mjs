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
const root=mkdtempSync(path.join(tmpdir(),'radaz-tool-cursors-'));
mkdirSync('outputs/tool-cursors',{recursive:true});
const fixture=spawn(process.env.PYTHON||'python',['tests/media-browser-fixture.py','--root',root],{windowsHide:true,stdio:['ignore','pipe','pipe']});
let server,browser,fixtureErrors='';fixture.stderr.on('data',d=>fixtureErrors+=String(d));
try{
 const archivePort=await new Promise((resolve,reject)=>{let buffer='';const timer=setTimeout(()=>reject(Error(fixtureErrors)),20000);fixture.stdout.on('data',d=>{buffer+=d;if(buffer.includes('\n')){clearTimeout(timer);resolve(JSON.parse(buffer.split('\n')[0]).port);}});});
 await fetch(`http://127.0.0.1:${archivePort}/_test/window-modalities`,{method:'POST'});
 const port=await free(),worker=await free(),base=`http://127.0.0.1:${port}`;
 server=spawn(process.execPath,['scripts/start-release.mjs'],{windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,RADAZ_PORT:String(port),RADAZ_WORKER_PORT:String(worker),RADAZ_ARCHIVE_PORT:String(archivePort)}});
 const log=createWriteStream('outputs/tool-cursors/server.log');server.stdout.pipe(log);server.stderr.pipe(log);
 for(let i=0;i<100;i++){try{if((await fetch(base)).ok)break;}catch{}await delay(200);}
 browser=await chromium.launch({headless:true,channel:'msedge'});
 const context=await browser.newContext({viewport:{width:1920,height:1080},hasTouch:true}),errors=[];context.setDefaultTimeout(25000);
 context.on('page',p=>p.on('pageerror',e=>errors.push(e.message)));
 await context.route('**/local-archive-api/license',route=>route.fulfill({json:{valid:true,required:true,kind:'owner',message:'Synthetic license',deviceId:'TEST'}}));
 let nativeRequest=null;
 await context.route('**/native-volume-api/status',route=>route.fulfill({json:{available:true}}));
 await context.route('**/native-volume-api/open',route=>{nativeRequest=route.request().postDataJSON();return route.fulfill({json:{started:true}});});
 const viewer=await context.newPage();await viewer.goto(base);
 await viewer.waitForFunction(()=>document.querySelector('.statusbar')?.textContent.includes('Cornerstone3D hazırdır'));
 const created=context.waitForEvent('page');await viewer.getByRole('button',{name:'Local arxiv',exact:true}).click();const archive=await created;
 await archive.getByRole('checkbox',{name:'Bu gün',exact:true}).uncheck();
 const pane=viewer.locator('[data-panel="A"]');
 await archive.getByRole('cell').filter({hasText:'WINDOW CT'}).dblclick();
 await pane.locator('.top-left').filter({hasText:'WINDOW CT'}).waitFor();
 await viewer.locator('.series-card').filter({hasText:'CT window 1'}).click();
 await pane.locator('.bottom-left').filter({hasText:'WW 400'}).waitFor();
 const cursors=new Map();
 const select=async(key,expected)=>{
  // Keep the pointer over the image while changing tools using shortcuts.
  await viewer.keyboard.press(key);
  await viewer.waitForFunction(({expected})=>{
   const pane=document.querySelector('[data-panel="A"]');
   const value=pane.style.getPropertyValue('--viewer-tool-cursor');
   return expected?value===expected:value.startsWith('url(');
  },{expected});
  const result=await pane.evaluate(p=>{
   const canvas=p.querySelector('.dicom-canvas'),drawing=p.querySelector('.drawing-overlay');
   return {selected:p.style.getPropertyValue('--viewer-tool-cursor'),canvas:getComputedStyle(canvas).cursor,
    drawing:getComputedStyle(drawing).cursor,hover:p.dataset.measurementHover};
  });
  assert.equal(result.canvas,result.selected.replaceAll("'",'"'),`canvas after ${key}`);
  assert.equal(result.drawing,result.selected.replaceAll("'",'"'),`overlay after ${key}`);
  assert.equal(result.hover,'false');
  return result.selected;
 };
 await viewer.getByTitle('Listələ · S',{exact:true}).click();
 await viewer.waitForFunction(()=>document.querySelector('[data-panel="A"]').style.getPropertyValue('--viewer-tool-cursor')==='ns-resize');
 await viewer.getByTitle('WL / WW · W / Ü',{exact:true}).click();
 await pane.hover();
 cursors.set('length',await select('l'));
 cursors.set('scroll',await select('s','ns-resize'));
 cursors.set('window',await select('w'));
 assert.notEqual(cursors.get('length'),cursors.get('window'));
 await select('p','grab');await select('z','zoom-in');
 for(const key of ['a','o','q','t','h','d','x'])await select(key);
 await select('s','ns-resize');await select('w');
 // A hover left by an annotation must not mask the next selected cursor.
 await pane.evaluate(p=>p.dataset.measurementHover='true');await select('l');
 // Rapid selections must not restore a stale async tool callback.
 for(const key of ['p','w','l','s','z','w','p'])await viewer.keyboard.press(key);
 await viewer.waitForFunction(()=>document.querySelector('[data-panel="A"]').style.getPropertyValue('--viewer-tool-cursor')==='grab');
 // Secondary-button zoom cursor uses a stable state key in Azerbaijani too.
 const box=await pane.boundingBox();await viewer.mouse.move(box.x+box.width*.65,box.y+box.height*.5);
 await viewer.mouse.down({button:'right'});await viewer.mouse.move(box.x+box.width*.65,box.y+box.height*.5+20,{steps:4});
 assert.equal(await pane.getAttribute('data-mouse-gesture'),'zoom');
 assert.equal(await pane.locator('.dicom-canvas').evaluate(e=>getComputedStyle(e).cursor),'zoom-in');
 await viewer.mouse.up({button:'right'});
 assert.equal(await pane.getAttribute('data-mouse-gesture'),null);
 console.log('PASS: native measurements, scroll, WW/WL, pan and zoom share selected cursor across canvas/overlays; stale hover clears; rapid changes and secondary zoom restore correctly');
 const opened=context.waitForEvent('page');
 await viewer.getByRole('button',{name:'3D həcm görüntüləmə',exact:true}).click();
 const volume=await opened;await volume.locator('.sv-surface-canvas[data-ready=true][data-context-dimensions]').waitFor();
 assert.equal(nativeRequest,null,'Restored web viewer must never request Qt');
 assert.match(volume.url(),/\/3d\?handoff=/);assert.equal(context.pages().length,3);
 console.log('PASS: primary 3D button opens the original web volume window; Qt is not called');
 assert.deepEqual(errors,[]);

}catch(error){
 console.error(error);
 for(const [i,page] of(browser?.contexts()[0]?.pages()||[]).entries()){
  console.error('PAGE',i,await page.locator('body').innerText().catch(()=>''));
  await page.screenshot({path:`outputs/tool-cursors/failure-${i}.png`}).catch(()=>{});
 }
 throw error;
}finally{
 await browser?.close();
 for(const child of [server,fixture])if(child?.pid)spawnSync('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});
 assert.ok(path.resolve(root).startsWith(path.resolve(tmpdir())+path.sep+'radaz-tool-cursors-'));rmSync(root,{recursive:true,force:true});
}
