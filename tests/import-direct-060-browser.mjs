// Real rendering with disposable CT, MR and projection studies. No patient data.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {spawn,spawnSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,rmSync,createWriteStream,readFileSync,writeFileSync,copyFileSync} from 'node:fs';
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


 const dialog=viewer.locator('.import-dialog');
 async function pick(label){
  await viewer.getByRole('button',{name:'DICOM import',exact:true}).click();
  const picker=viewer.waitForEvent('filechooser');
  await viewer.getByRole('menuitem',{name:label,exact:true}).click();return picker;
 }
 async function count(){return (await (await fetch(`http://127.0.0.1:${archivePort}/status`)).json()).instanceCount;}
 async function imported(expected){
  for(let n=0;n<100;n++){if(await count()===expected)break;await delay(150);}
  assert.equal(await count(),expected);
  await viewer.waitForFunction(()=>!!document.querySelector('[data-panel="A"][data-has-image="true"]'));
  await viewer.getByRole('button',{name:'DICOM import',exact:true}).waitFor({state:'visible'});
  await viewer.waitForFunction(()=>!document.querySelector('button[aria-label="DICOM import"]')?.disabled);
 }
 const folder=path.join(root,'direct-folder');mkdirSync(path.join(folder,'nested'),{recursive:true});
 copyFileSync(path.join(root,'disc/CT/I0001'),path.join(folder,'one.dcm'));
 copyFileSync(path.join(root,'disc/CT/I0002'),path.join(folder,'nested/two.dcm'));
 const directory=await pick('Qovluq aç');assert.equal(await dialog.count(),0);
 await directory.setFiles(folder);await imported(2);assert.equal(await dialog.count(),0);
 const zip=async index=>{const z=new JSZip();z.file('scan.dcm',readFileSync(path.join(root,`disc/CT/I${String(index).padStart(4,'0')}`)));return {name:`scan-${index}.zip`,mimeType:'application/zip',buffer:await z.generateAsync({type:'nodebuffer'})};};
 const archives=await pick('ZIP / RAR aç');assert.equal(await dialog.count(),0);
 await archives.setFiles([await zip(3),await zip(4)]);await imported(4);assert.equal(await dialog.count(),0);
 const cancel=await pick('ZIP / RAR aç');await cancel.setFiles([]);assert.equal(await dialog.count(),0);assert.equal(await count(),4);
 await viewer.getByRole('button',{name:'DICOM import',exact:true}).click();
 await viewer.getByRole('menuitem',{name:'Bir neçə mənbə seç',exact:true}).click();await dialog.waitFor({state:'visible'});
 const queued=viewer.waitForEvent('filechooser');await dialog.getByRole('button',{name:'ZIP / RAR seç',exact:true}).click();
 await (await queued).setFiles(await zip(5));await dialog.getByRole('button',{name:'1 mənbəni aç',exact:true}).waitFor();
 assert.equal(await count(),4,'Multi-source selection must wait for explicit open');
 await dialog.getByRole('button',{name:'1 mənbəni aç',exact:true}).click();await imported(5);
 await dialog.waitFor({state:'hidden'});
 assert.deepEqual(errors,[]);
 console.log('PASS direct folder+subfolder, two ZIP files, cancellation preserves images, explicit multi-source queue');
}finally{await browser?.close();server?.kill();fixture.kill();}
