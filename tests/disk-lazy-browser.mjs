import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=mkdtempSync(path.join(tmpdir(),'radaz-lazy-test-'));
const fixture=spawn('python',['tests/media-browser-fixture.py','--root',root],{windowsHide:true,stdio:['ignore','pipe','pipe']});
 let browser,fixtureError='';fixture.stderr.on('data',d=>fixtureError+=d);
try {
 const port=await new Promise((resolve,reject)=>{let text='';const timer=setTimeout(()=>reject(Error(fixtureError)),30000);fixture.stdout.on('data',d=>{text+=d;if(text.includes('\n')){clearTimeout(timer);resolve(JSON.parse(text.split('\n')[0]).port);}});});
 const backend=`http://127.0.0.1:${port}`,base=process.env.RADAZ_TEST_URL||'http://127.0.0.1:5197';
 browser=await chromium.launch({headless:true,channel:'msedge'});
 const context=await browser.newContext({viewport:{width:1440,height:950}}),errors=[];let transfers=0;
 context.on('page',p=>p.on('pageerror',e=>errors.push(e.message)));
 await context.route('**/local-archive-api/**',async route=>{
  const u=new URL(route.request().url());
  if(u.pathname.endsWith('/license'))return route.fulfill({json:{valid:true,kind:'owner'}});
  if(u.pathname.includes('/stress/')){const r=await fetch(backend+'/_test/large');return route.fulfill({contentType:'application/dicom',body:Buffer.from(await r.arrayBuffer())});}
  if(!u.pathname.includes('/removable/'))return route.fulfill({json:[]});
  if(u.pathname.includes('/file/'))transfers++;
  const response=await fetch(backend+u.pathname.replace('/local-archive-api','')+u.search,{method:route.request().method(),body:route.request().postData(),headers:{'Content-Type':route.request().headers()['content-type']||'application/json'}});
  if(u.pathname.endsWith('/entries')){const data=await response.json();data.items=data.items.map(item=>({...item,size:64*1024**2,decodedBytes:32*1024**2}));return route.fulfill({json:data});}
  return route.fulfill({status:response.status,contentType:response.headers.get('content-type'),body:Buffer.from(await response.arrayBuffer())});
 });
 const page=await context.newPage();page.setDefaultTimeout(30000);await page.goto(base);
 await page.getByRole('button',{name:'CD/DVD import',exact:true}).click();
 await fetch(backend+'/_test/insert',{method:'POST'});
 await page.locator('.series-card').filter({hasText:'CD progressive CT'}).click();
 await page.waitForFunction(()=>document.querySelector('[data-panel="A"] .overlay.bottom-right')?.textContent.includes('/ 700'));
 assert.ok(transfers<12,`Discovery should not fetch all pixels: ${transfers}`);
 assert.ok(!(await page.locator('body').innerText()).includes('Müvəqqəti yaddaş həddi doldu'));
 const initial=transfers;await page.mouse.move(650,480);await page.mouse.wheel(0,120);await page.waitForTimeout(400);assert.ok(transfers>initial,'Scroll reads the next image lazily');
 await fetch(backend+'/_test/resume',{method:'POST'});
 const beforeReport=transfers,pending=context.waitForEvent('page');await page.getByRole('button',{name:'AI asistent',exact:true}).click();const report=await pending;
 await report.locator('.report-study').waitFor();assert.equal(await report.locator('.report-series-list input').count(),1,'Every series from this study reaches the assistant');
 assert.match(await report.locator('.report-panel-title').first().innerText(),/700/);assert.ok(transfers<=beforeReport+1,'Assistant keeps disk metadata and loads only one preview, not 700 Files');
 await fetch(backend+'/_test/eject',{method:'POST'});await report.waitForFunction(()=>document.querySelectorAll('.report-study').length===0);
 await page.waitForFunction(()=>!document.querySelector('[data-panel="A"][data-has-image="true"]'));
 const memory=await page.evaluate(async()=>{
  const module=await import(performance.getEntriesByType('resource').find(e=>e.name.includes('/lib/cornerstone.ts')).name),{core}=await module.getViewer();
  const tags={x00280010:'2048',x00280011:'2048',x00280100:'16',x00280101:'12',x00280102:'11',x00280103:'0',x00280002:'1',x00280004:'MONOCHROME2',x00080060:'CT',x0020000d:'2.25.102',x0020000e:'2.25.103',x00200032:'0\\0\\0',x00200037:'1\\0\\0\\0\\1\\0',x00280030:'1\\1'};
  const controller=new AbortController(),ids=Array.from({length:38},(_,i)=>module.registerDiskDicom(tags,`/local-archive-api/stress/${i}`,controller.signal));
  const fractional=module.registerDiskDicom({...tags,x00281053:'.5'},'/local-archive-api/stress/fractional',controller.signal);
  const predicted=module.shareLocalDicoms([ids[0],fractional]).map(item=>item.record.bits);
  if(predicted[0]!==16||predicted[1]!==32)throw Error('GPU budget must preserve integer CT resolution and fractional HU precision');
  module.releaseLocalDicoms([fractional]);
  for(const id of ids)await core.imageLoader.loadAndCacheImage(id);
  const shared=module.shareLocalDicoms(ids),resident=shared.reduce((n,i)=>n+i.record.pixels.byteLength,0),evicted=!shared[0].record.pixels.length;
  const decoded=window.radazPerformance().decodeCount;await core.imageLoader.loadAndCacheImage(ids[0]);
  const reread=window.radazPerformance().decodeCount===decoded+1;
  controller.abort();module.releaseLocalDicoms(ids);return {resident,evicted,reread};
 });
 assert.ok(memory.resident<=256*1024**2,JSON.stringify(memory));assert.ok(memory.evicted&&memory.reread,'LRU eviction preserves ability to revisit images');
 assert.deepEqual(errors,[]);console.log(`PASS: 701 images advertised above 40 GiB; ${transfers} pixel reads, lazy scrolling, selected-series lazy report, eject cleanup.`);
}finally {
 await browser?.close();fixture.kill();await new Promise(resolve=>fixture.once('exit',resolve));
 const target=path.resolve(root);assert.equal(path.dirname(target),path.resolve(tmpdir()));assert.ok(path.basename(target).startsWith('radaz-lazy-test-'));rmSync(target,{recursive:true,force:true});
}
