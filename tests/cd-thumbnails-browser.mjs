import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {spawn, spawnSync} from 'node:child_process';
import {mkdtempSync, mkdirSync, rmSync, createWriteStream} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {setTimeout as delay} from 'node:timers/promises';
const {chromium} = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const free = () => new Promise(resolve => { const s=http.createServer(); s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));}); });
const root = mkdtempSync(path.join(tmpdir(), 'radaz-media-browser-'));
mkdirSync('outputs/media', {recursive:true});
const fixture = spawn(process.env.PYTHON || 'python', ['tests/media-browser-fixture.py','--root',root], {windowsHide:true,stdio:['ignore','pipe','pipe']});
let fixtureErrors=''; fixture.stderr.on('data',d=>fixtureErrors+=String(d));
let server, browser, page;
try {
  const archivePort = await new Promise((resolve,reject)=>{
    const timeout=setTimeout(()=>reject(Error('Fixture timeout: '+fixtureErrors)),30000);
    let buffer='';fixture.stdout.on('data',d=>{buffer+=d; if(buffer.includes('\n')){clearTimeout(timeout);try{resolve(JSON.parse(buffer.split('\n')[0]).port);}catch(e){reject(e);}}});
    fixture.once('exit',code=>{clearTimeout(timeout);reject(Error('Fixture stopped '+code+': '+fixtureErrors));});
  });
  const control = async action => {const r=await fetch(`http://127.0.0.1:${archivePort}/_test/${action}`,{method:'POST'});assert.equal(r.status,200);};
  const port=await free(), worker=await free(), base=`http://127.0.0.1:${port}`;
  server=spawn(process.execPath,['scripts/start-release.mjs'],{windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,RADAZ_PORT:String(port),RADAZ_WORKER_PORT:String(worker),RADAZ_ARCHIVE_PORT:String(archivePort)}});
  const log=createWriteStream('outputs/media/browser-server.log');server.stdout.pipe(log);server.stderr.pipe(log);
  for(let i=0;i<100;i++){try{if((await fetch(base)).status===200)break;}catch{}await delay(200);}
  browser=await chromium.launch({headless:true,channel:'msedge'});
  const context=await browser.newContext({viewport:{width:1366,height:768}});
  await context.route('**/local-archive-api/license',route=>route.fulfill({json:{valid:true,required:true,kind:'owner',message:'Synthetic license',deviceId:'TEST'}}));
  page=await context.newPage();page.setDefaultTimeout(90000);const errors=[];let pickers=0,imports=0;
  context.on('page',p=>{p.on('pageerror',e=>errors.push(e.stack || e.message));});page.on('pageerror',e=>errors.push(e.stack || e.message));
  page.on('filechooser',()=>pickers++);
  context.on('request',r=>{if(r.url().endsWith('/local-archive-api/import'))imports++;});
  await page.goto(base);
  assert.equal(await page.locator('.series-card').count(),0,'Production starts without demo patients');
  await page.getByRole('button',{name:'CD/DVD import',exact:true}).click();
  await control('insert');await control('resume');
  await page.locator('.series-card').filter({hasText:'JPEG compressed CD'}).waitFor();
  await page.locator('.series-card').filter({hasText:'CD progressive CT'}).locator('img').waitFor();
  await page.locator('.series-card').filter({hasText:'JPEG compressed CD'}).locator('img').waitFor();
  assert.equal(await page.locator('.series-card img').count(),2,'Both thumbnails appear without any series click');
  await page.screenshot({path:'outputs/media/unopened-series-thumbnails.png'});
  assert.deepEqual(errors,[]);console.log('PASS: disk CD and compressed JPEG series thumbnails appear before series selection');
} catch(error) {
  for (const [i,p] of (browser?.contexts()[0]?.pages() || []).entries()) {
    console.error(`PAGE ${i} ${p.url()}:`,await p.locator('body').innerText().catch(()=>''));
    await p.screenshot({path:`outputs/media/failure-${i}.png`}).catch(()=>{});
  }
  if(page){ console.error('UI:',await page.locator('body').innerText().catch(()=>''));await page.screenshot({path:'outputs/media/failure.png'}).catch(()=>{}); }
  throw error;
} finally {
  await browser?.close();
  for(const process of [server,fixture]) if(process?.pid)spawnSync('taskkill.exe',['/PID',String(process.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});
  assert.ok(path.resolve(root).startsWith(path.resolve(tmpdir())+path.sep+'radaz-media-browser-'));rmSync(root,{recursive:true,force:true});
}
