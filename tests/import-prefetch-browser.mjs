// Isolated synthetic archive: verifies first-image usability while another read waits.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import {mkdtempSync,mkdirSync,readFileSync,createWriteStream} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {setTimeout as delay} from 'node:timers/promises';
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'playwright');
const free=()=>new Promise(resolve=>{const s=http.createServer();s.listen(0,'127.0.0.1',()=>{const port=s.address().port;s.close(()=>resolve(port));});});
const root=mkdtempSync(path.join(tmpdir(),'radaz-import-prefetch-'));
mkdirSync('outputs/import-prefetch',{recursive:true});
const fixture=spawn(process.env.PYTHON||'python',['tests/media-browser-fixture.py','--root',root],{windowsHide:true,stdio:['ignore','pipe','pipe']});
let server,browser,stderr='';fixture.stderr.on('data',d=>stderr+=d);
try{
 const archivePort=await new Promise((resolve,reject)=>{let buffer='';const timer=setTimeout(()=>reject(Error(stderr||'Fixture timeout')),30000);fixture.stdout.on('data',d=>{buffer+=d;if(buffer.includes('\n')){clearTimeout(timer);resolve(JSON.parse(buffer.split('\n')[0]).port);}});});
 const port=await free(),worker=await free(),base=`http://127.0.0.1:${port}`;
 server=spawn(process.execPath,['scripts/start-release.mjs'],{windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,RADAZ_PORT:String(port),RADAZ_WORKER_PORT:String(worker),RADAZ_ARCHIVE_PORT:String(archivePort)}});
 const log=createWriteStream('outputs/import-prefetch/server.log');server.stdout.pipe(log);server.stderr.pipe(log);
 for(let n=0;n<150;n++){try{if((await fetch(base)).ok)break;}catch{}await delay(200);}
 browser=await chromium.launch({channel:'msedge',headless:true});
 const context=await browser.newContext({viewport:{width:1440,height:900}});context.setDefaultTimeout(30000);
 await context.route('**/local-archive-api/license',r=>r.fulfill({json:{valid:true,required:true,kind:'owner',deviceId:'TEST'}}));
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(base);await page.waitForFunction(()=>document.querySelector('.statusbar')?.textContent.includes('Cornerstone3D hazırdır'));
 await page.evaluate(()=>{
   const read=File.prototype.arrayBuffer;
   File.prototype.arrayBuffer=async function(){
     if(this.name==='blocked.dcm'&&!window.__readReleased)await new Promise(resolve=>{window.__releaseRead=()=>{window.__readReleased=true;resolve();};});
     if(this.name==='unreadable.dcm')throw Error('Synthetic unavailable source');
     return read.call(this);
   };
 });
 const input=page.locator('input[type=file]:not([accept]):not([webkitdirectory])');
 const file=(name,index)=>({name,mimeType:'application/dicom',buffer:readFileSync(path.join(root,`disc/CT/I${String(index).padStart(4,'0')}`))});
 await input.setInputFiles([file('first.dcm',1),file('blocked.dcm',2),file('unreadable.dcm',3),file('last.dcm',4)]);
 await page.waitForFunction(()=>document.querySelector('[data-panel="A"][data-has-image="true"]')&&typeof window.__releaseRead==='function');
 assert.ok(await page.locator('.import-job-progress progress').count(),'progress remains while a source is waiting');
 console.log('PASS first image usable before later file read completes');
 await page.evaluate(()=>window.__releaseRead());
 await page.waitForFunction(()=>!document.querySelector('.import-job-progress progress'),null,{timeout:45000});
 const status=await (await fetch(`http://127.0.0.1:${archivePort}/status`)).json();
 assert.equal(status.instanceCount,3,'unreadable file skipped; other DICOM files persisted');
 assert.ok(await page.locator('[data-panel="A"][data-has-image="true"]').count());
 assert.deepEqual(errors,[]);
 console.log('PASS bounded file reads preserve valid images and persistence when one source read fails');
}finally{await browser?.close();server?.kill();fixture.kill();}
