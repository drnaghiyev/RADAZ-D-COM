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

 const selectors=['[aria-label="WINDOW PRESET menyusu"]','button.help-trigger','[aria-label="Pozitiv, neqativ və window"]'];
 const moved=await viewer.evaluate(selectors=>{
  const items={},removed=[];
  for(const [order,selector] of selectors.entries()){
   const el=document.querySelector(selector),id=el?.closest('[data-toolbar-item]')?.getAttribute('data-toolbar-item');
   if(!id)throw Error('Missing command: '+selector);
   items[id]={group:'custom-menus',order};removed.push(id.split('/')[0]);
  }
  const saved={groups:[{id:'custom-menus',name:'Menus'}],items,removed,rows:1};
  localStorage.setItem('radaz-toolbar-items-v1:viewer',JSON.stringify(saved));
  localStorage.setItem('radaz-toolbar-v1:viewer',JSON.stringify({'custom-menus':{side:'right',order:0}}));
  return saved;
 },selectors);
 await viewer.reload();await viewer.waitForFunction(()=>document.querySelector('.statusbar')?.textContent.includes('Cornerstone3D hazırdır'));
 for(const [index,selector] of selectors.entries()){
  await viewer.locator(selector).click();
  const menu=viewer.locator('[role="menu"]:visible');await menu.waitFor();
  const count=await menu.getByRole('menuitem').count();
  assert.ok(count>=[4,8,8][index],`Moved menu ${index} has only ${count} items`);
  await viewer.keyboard.press('Escape');
 }
 assert.deepEqual(JSON.parse(await viewer.evaluate(()=>localStorage.getItem('radaz-toolbar-items-v1:viewer'))).items,moved.items);
 console.log('PASS: right-docked moved menus retain all commands after original groups are removed and page reloads');
 // Earlier deletion code also saved every nested menu command in the pool.
 await viewer.evaluate(()=>{
  const saved=JSON.parse(localStorage.getItem('radaz-toolbar-items-v1:viewer'));
  for(const el of document.querySelectorAll('[data-toolbar-item]')){
   const id=el.getAttribute('data-toolbar-item');
   if(id.includes('/menu:')&&saved.removed.includes(id.split('/')[0]))saved.items[id]={group:'pool',order:100};
  }
  localStorage.setItem('radaz-toolbar-items-v1:viewer',JSON.stringify(saved));
 });
 await viewer.reload();await delay(500);
 for(const [index,selector] of selectors.entries()){
  await viewer.locator(selector).tap();
  const menu=viewer.locator('[role="menu"]:visible');await menu.waitFor();
  assert.ok(await menu.getByRole('menuitem').count()>=[4,8,8][index]);
  await viewer.keyboard.press('Escape');
 }
 const mpr=await context.newPage();await mpr.setViewportSize({width:2560,height:1440});await mpr.goto(base+'/mpr');
 for(const [index,selector] of selectors.entries()){
  await mpr.locator(selector).click();const menu=mpr.locator('[role="menu"]:visible');await menu.waitFor();
  assert.ok(await menu.getByRole('menuitem').count()>=[4,8,8][index]);await mpr.keyboard.press('Escape');
 }
 console.log('PASS: legacy pooled menu entries restored; MPR menus remain complete');

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
