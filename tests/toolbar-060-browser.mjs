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

 await viewer.getByRole('button',{name:'Alət panelini fərdiləşdir',exact:true}).click();
 await viewer.getByLabel('Yeni qrupun adı',{exact:true}).fill('Boş sınaq');
 await viewer.getByRole('button',{name:'Qrup yarat',exact:true}).click();
 await viewer.getByRole('button',{name:'Təsdiq',exact:true}).click();
 const group=viewer.locator('[data-toolbar-group]').filter({has:viewer.locator('[data-item-group^="custom-"]')}).last();
 const id=await group.getAttribute('data-toolbar-group');
 if(!await group.isVisible())await viewer.getByRole('button',{name:'Əlavə alətlər',exact:true}).click();

 // 3D inserts tools directly into the group, not into its registered item host.
 await group.evaluate(el=>{const button=document.createElement('button');button.className='test-portal-control';button.textContent='Portal tool';el.appendChild(button);});
 await viewer.waitForFunction(id=>!document.querySelector(`[data-toolbar-group="${id}"] .toolbar-empty-delete`),id);
 await group.locator('.test-portal-control').evaluate(el=>el.remove());
 await group.getByRole('button',{name:'Boş qrupu sil',exact:true}).click();
 await viewer.waitForFunction(id=>document.querySelector(`[data-toolbar-group="${id}"]`)?.dataset.groupDeleted==='true',id);
 assert.equal(await group.isVisible(),false,'Deleted group must occupy no visible space');
 await viewer.reload();
 await viewer.waitForFunction(id=>document.querySelector(`[data-toolbar-group="${id}"]`)?.dataset.groupDeleted==='true',id);
 assert.equal(await viewer.locator('[data-toolbar-group="measure"] .toolbar-empty-delete').count(),0);
 // Simulate a registered control that becomes hidden due to conditional UI.
 // Moving Help out must still allow the visually empty built-in group to be removed.
 await viewer.evaluate(()=>{
  const key=Object.keys(localStorage).find(k=>k.startsWith('radaz-toolbar-items-v1:'));
  const saved=JSON.parse(localStorage.getItem(key));
  const ids=[...document.querySelectorAll('[data-item-group="help"] > [data-toolbar-item]')].map(el=>el.dataset.toolbarItem);
  if(ids.length!==2)throw Error(`Expected Info and Help wrappers, got ${ids}`);
  saved.items[ids[1]]={group:'pool',order:1};localStorage.setItem(key,JSON.stringify(saved));
 });
 await viewer.reload();
 await viewer.locator('[data-item-group="help"] > [data-toolbar-item]').first().evaluate(el=>el.style.display='none');
 const help=viewer.locator('[data-toolbar-group="help"]');
 if(!await help.isVisible())await viewer.getByRole('button',{name:'Əlavə alətlər',exact:true}).click();
 await help.getByRole('button',{name:'Boş qrupu sil',exact:true}).waitFor({state:'visible'});
 await help.click({button:'right'});
 await viewer.getByRole('menuitem',{name:'Boş qrupu sil',exact:true}).click();
 await viewer.waitForFunction(()=>document.querySelector('[data-toolbar-group="help"]')?.dataset.groupDeleted==='true');
 assert.equal(await help.isVisible(),false,'Deleted built-in group is truly hidden');
 for(const location of ['right','second']){
  await viewer.getByRole('button',{name:'Alət panelini fərdiləşdir',exact:true}).click();
  await viewer.getByLabel('Yeni qrupun adı',{exact:true}).fill('Sil '+location);
  await viewer.getByRole('button',{name:'Qrup yarat',exact:true}).click();
  if(location==='second'){
   await viewer.getByLabel('Alət panelinin sıra sayı',{exact:true}).selectOption('2');
   await viewer.getByLabel('Sil second sırası',{exact:true}).selectOption('2');
  }
  await viewer.getByRole('button',{name:'Təsdiq',exact:true}).click();
  const added=viewer.locator('[data-toolbar-group][aria-label="Sil '+location+'"]');
  if(!await added.isVisible())await viewer.getByRole('button',{name:'Əlavə alətlər',exact:true}).click();
  if(location==='right')await added.getByRole('button',{name:'Sil right — qrupu daşı',exact:true}).press('Enter');
  await added.getByRole('button',{name:'Boş qrupu sil',exact:true}).click();
  await viewer.waitForFunction(label=>document.querySelector(`[data-toolbar-group][aria-label="${label}"]`)?.dataset.groupDeleted==='true','Sil '+location);
  assert.equal(await added.isVisible(),false,location+' deletion removes visible frame');
  if(location==='right')assert.equal(await viewer.locator('.right-tool-dock').isVisible(),false,'Last removed group hides right dock');
  await viewer.reload();
  await viewer.waitForFunction(label=>document.querySelector(`[data-toolbar-group][aria-label="${label}"]`)?.dataset.groupDeleted==='true','Sil '+location);
  assert.equal(await added.isVisible(),false,'Deleted frame stays hidden after reload');
 }
 for(const width of [1366,1920,2560]){
  await viewer.setViewportSize({width,height:1080});await delay(300);
  const size=await viewer.locator('.toolbar-workspace').first().evaluate(el=>getComputedStyle(el).getPropertyValue('--command-size').trim());
  assert.equal(size,width<1600?'32px':width<2560?'34px':'44px');
  await viewer.screenshot({path:`outputs/toolbar-060-${width}.png`});
 }
 for(const route of ['/','/archive','/pacs','/mpr','/3d']){
  await viewer.goto(base+route);
  for(const width of [640,1280,1920]){
   await viewer.setViewportSize({width,height:900});
   const settings=viewer.getByRole('button',{name:'Alət panelini fərdiləşdir',exact:true});
   await settings.waitFor({state:'visible'});await delay(200);
   assert.equal(await settings.evaluate(el=>el.closest('.toolbar-system-group')?.getAttribute('role')),'group');
   const box=await settings.boundingBox();assert.ok(box.x>=0&&box.x+box.width<=width,route+' settings inside viewport');
   assert.equal(await viewer.evaluate(()=>{
    const system=document.querySelector('.toolbar-system-group').getBoundingClientRect();
    return [...document.querySelectorAll('[data-toolbar-group]')].some(el=>{
     if(getComputedStyle(el).visibility==='hidden')return false;
     const r=el.getBoundingClientRect();
     return r.width>0&&r.height>0&&Math.min(r.right,system.right)-Math.max(r.left,system.left)>1&&Math.min(r.bottom,system.bottom)-Math.max(r.top,system.top)>1;
    });
   }),false,route+' settings group must not cover other tools');
   await settings.click();
   await viewer.getByRole('dialog',{name:'Alət panelinin düzülüşü',exact:true}).waitFor({state:'visible'});
   await viewer.getByRole('button',{name:'Təsdiq',exact:true}).click();
  }
 }
 assert.deepEqual(errors,[]);console.log('PASS: direct empty group deletion, persistence, nonempty group protected');
}finally{await browser?.close();server?.kill();fixture.kill();}




