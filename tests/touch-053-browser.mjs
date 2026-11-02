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
 const created=context.waitForEvent('page');await viewer.getByRole('button',{name:'Local arxiv',exact:true}).click();const archive=await created;
 await archive.getByRole('checkbox',{name:'Bu gün',exact:true}).uncheck();

 await archive.getByRole('cell').filter({hasText:'WINDOW CT'}).dblclick();
 const pane=viewer.locator('[data-panel="A"]');
 await pane.locator('.bottom-left span').first().filter({hasText:'WL 100 · WW 400'}).waitFor();


 const cdp=await context.newCDPSession(viewer),canvas=pane.locator('.dicom-canvas');
 const box=await canvas.boundingBox(),x=box.x+box.width*.5,y=box.y+box.height*.5;
 async function drag(){
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y,id:1}]});
  for(let i=1;i<=6;i++)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x+i*8,y:y+i*7,id:1}]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await delay(150);
 }
 const windowText=()=>pane.locator('.bottom-left span').first().innerText();
 for(const key of ['P','Z','P','Z']){
  await viewer.locator(`button.view-tool[title$=" · ${key}"]`).click();await delay(100);
  const voi=await windowText();
  const before=await canvas.screenshot();await drag();assert.notDeepEqual(await canvas.screenshot(),before,key+' touch changes image');
  assert.equal(await windowText(),voi,key+' touch must not change WW/WL');
 }
 await viewer.locator('button.view-tool[title$=" · S"]').click();
 const voi=await windowText();
 const before=await pane.locator('.bottom-right').innerText();await drag();
 await viewer.waitForFunction(({before})=>document.querySelector('[data-panel="A"] .bottom-right')?.textContent!==before,{before});
 const sliceText=await pane.locator('.bottom-right').innerText();
 const slice=Number(sliceText.match(/(\d+)\s*\//)?.[1]);
 assert.ok(slice>1,sliceText);
 assert.equal(await windowText(),`WL ${100*slice} · WW ${400*slice}`,'Scroll keeps the new slice metadata VOI, without touch windowing');
 const beforeWL=await windowText();
 await viewer.locator('button.view-tool[title$=" · W / Ü"]').click();
 await drag();assert.notEqual(await windowText(),beforeWL,'WW/WL touch works when explicitly selected');
 const chooseMeasurement=async(name)=>{
  await viewer.getByRole('button',{name:'Ölçmə alətləri',exact:true}).click();
  await viewer.getByRole('menuitem',{name}).click();await delay(120);
 };
 const touchLine=async(ax,ay,bx,by)=>{
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:ax,y:ay,id:1}]});
  for(let i=1;i<=8;i++)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:ax+(bx-ax)*i/8,y:ay+(by-ay)*i/8,id:1}]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await delay(250);
 };
 const imageBeforeErase=await canvas.screenshot();
 await chooseMeasurement(/^Uzunluq/);
 await touchLine(x-100,y-100,x+100,y-100);
 const endpoints=pane.locator('line[data-id*="-endpoint-"]');
 await endpoints.first().waitFor();
 const voiBeforeErase=await windowText();
 const longPress=async(px,py)=>{
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:px,y:py,id:1}]});
  await delay(750);
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await viewer.getByRole('menuitem',{name:'Sil',exact:true}).waitFor();
 };
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y:y-100,id:1}]});
 await cdp.send('Input.dispatchTouchEvent',{type:'touchCancel',touchPoints:[]});await delay(700);
 assert.equal(await pane.locator('.measurement-menu').count(),0,'Cancelled contact does not open a delayed menu');
 await longPress(x,y-100);
 const deleteBox=await viewer.getByRole('menuitem',{name:'Sil',exact:true}).boundingBox();
 await touchLine(deleteBox.x+deleteBox.width/2,deleteBox.y+deleteBox.height/2,deleteBox.x+deleteBox.width/2,deleteBox.y+deleteBox.height/2);
 await endpoints.first().waitFor({state:'hidden'});
 assert.equal(await windowText(),voiBeforeErase,'Touch deletion does not change WW/WL');
 assert.deepEqual(await canvas.screenshot(),imageBeforeErase,'Deleting annotation does not damage DICOM canvas');
 await chooseMeasurement(/^Qələm/);
 await touchLine(x-100,y+80,x+100,y+120);
 await pane.locator('[data-drawing="pencil"]').waitFor();
 await longPress(x,y+100);
 await viewer.getByRole('menuitem',{name:'Sil',exact:true}).click();
 await pane.locator('[data-drawing="pencil"]').waitFor({state:'hidden'});
 assert.deepEqual(errors,[]);console.log('PASS: real touch pan, zoom, scroll, native/local long-press deletion, unchanged image and VOI');
}finally{await browser?.close();server?.kill();fixture.kill();}
