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
const root=mkdtempSync(path.join(tmpdir(),'radaz-bridge-send-'));
mkdirSync('outputs/bridge-send',{recursive:true});
const fixture=spawn(process.env.PYTHON||'python',['tests/bridge-browser-fixture.py','--root',root],{windowsHide:true,stdio:['ignore','pipe','pipe']});
let server,browser,fixtureError='';fixture.stderr.on('data',d=>fixtureError+=String(d));
try{
 const config=await new Promise((resolve,reject)=>{let data='';const timer=setTimeout(()=>reject(Error(fixtureError)),20000);fixture.stdout.on('data',d=>{data+=d;if(data.includes('\n')){clearTimeout(timer);resolve(JSON.parse(data.split('\n')[0]));}});});
 const port=await free(),worker=await free(),base=`http://127.0.0.1:${port}`,api=`http://127.0.0.1:${config.port}`;
 server=spawn(process.execPath,['scripts/start-release.mjs'],{windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,RADAZ_PORT:String(port),RADAZ_WORKER_PORT:String(worker),RADAZ_ARCHIVE_PORT:String(config.port)}});
 const log=createWriteStream('outputs/bridge-send/server.log');server.stdout.pipe(log);server.stderr.pipe(log);
 for(let i=0;i<150;i++){try{if((await fetch(base)).ok)break;}catch{}await delay(200);}
 browser=await chromium.launch({headless:true,channel:'msedge'});
 const context=await browser.newContext({viewport:{width:1920,height:1080}}),errors=[];context.setDefaultTimeout(25000);
 context.on('page',p=>p.on('pageerror',e=>errors.push(e.message)));
 await context.route('**/local-archive-api/license',route=>route.fulfill({json:{valid:true,required:true,kind:'owner',deviceId:'SYNTHETIC'}}));
 const archive=await context.newPage();await archive.goto(base+'/archive');
 await archive.getByRole('cell').filter({hasText:'SYNTHETIC BRIDGE'}).first().waitFor();
 await archive.getByRole('button',{name:'RADAZBRIDGE-ə göndər',exact:true}).click();
 let dialog=archive.getByRole('dialog');await dialog.getByLabel('Port',{exact:true}).fill(String(config.destination));
 await dialog.getByRole('button',{name:'Bağlantını yoxla',exact:true}).click();
 await dialog.getByText('DICOM bağlantısı işləyir.',{exact:true}).waitFor();
 await dialog.getByRole('button',{name:'Göndər',exact:true}).click();
 await dialog.getByText('Göndəriş tamamlandı',{exact:true}).waitFor();assert.match(await dialog.innerText(),/3 fayl qəbul edilib/);
 assert.equal((await (await fetch(api+'/_test/received')).json()).received.length,3);
 await archive.screenshot({path:'outputs/bridge-send/archive.png'});
 await dialog.getByRole('button',{name:'Bağla',exact:true}).last().click();
 // Persisted destination is shared by Archive and PACS, with all series selected by study.
 const pacs=await context.newPage();await pacs.addInitScript(({url,source})=>localStorage.setItem('radaz-pacs-config-v1',JSON.stringify({selected:'fixture',aeTitle:'RADAZ',listenerPort:'11114',locations:[{id:'fixture',host:'127.0.0.1',port:String(source),aeTitle:'SOURCE',description:'Synthetic PACS',dicomwebUrl:url}]})),{url:api+'/test-pacs',source:config.source});
 await pacs.goto(base+'/pacs');await pacs.getByRole('button',{name:'Axtar',exact:true}).click();
 await pacs.getByRole('checkbox',{name:'SYNTHETIC BRIDGE müayinəsini seç',exact:true}).check();
 await pacs.getByRole('button',{name:'RADAZBRIDGE-ə göndər',exact:true}).click();dialog=pacs.getByRole('dialog');
 await pacs.waitForFunction(value=>document.querySelector('.radazbridge-fields input[inputmode=numeric]')?.value===value,String(config.destination));assert.equal(await dialog.getByLabel('Port',{exact:true}).inputValue(),String(config.destination));
 await dialog.getByRole('button',{name:'Göndər',exact:true}).click();await dialog.getByText('Göndəriş tamamlandı',{exact:true}).waitFor();
 assert.equal((await (await fetch(api+'/_test/received')).json()).received.length,6);
 await pacs.screenshot({path:'outputs/bridge-send/pacs.png'});
 await dialog.getByRole('button',{name:'Bağla',exact:true}).last().click();
 // The same dialog's DIMSE branch, without downloading a study into the browser.
 await pacs.route('http://127.0.0.1:8765/**',route=>{const endpoint=new URL(route.request().url()).pathname;return route.fulfill({json:endpoint==='/health'?{version:3}:endpoint==='/studies'?{items:[{uid:config.study,patient:'SYNTHETIC BRIDGE',patientId:'TEST',date:new Date().toISOString().slice(0,10).replaceAll('-',''),modality:'CT',description:'Synthetic',seriesCount:3,instanceCount:3}],truncated:false}:{items:[],truncated:false}});});
 await pacs.evaluate(()=>{const cfg=JSON.parse(localStorage.getItem('radaz-pacs-config-v1'));cfg.locations[0].dicomwebUrl='';localStorage.setItem('radaz-pacs-config-v1',JSON.stringify(cfg));});
 // addInitScript would restore the old setting, so create a new page for DIMSE.
 const dimse=await context.newPage();await dimse.route('http://127.0.0.1:8765/**',route=>{const endpoint=new URL(route.request().url()).pathname;return route.fulfill({json:endpoint==='/health'?{version:3}:{items:[{uid:config.study,patient:'SYNTHETIC BRIDGE',patientId:'TEST',date:new Date().toISOString().slice(0,10).replaceAll('-',''),modality:'CT',description:'Synthetic',seriesCount:3,instanceCount:3}],truncated:false}});});
 await dimse.goto(base+'/pacs');await dimse.getByRole('button',{name:'Axtar',exact:true}).click();
 await dimse.getByRole('checkbox',{name:'SYNTHETIC BRIDGE müayinəsini seç',exact:true}).check();
 await dimse.getByRole('button',{name:'RADAZBRIDGE-ə göndər',exact:true}).click();dialog=dimse.getByRole('dialog');
 await dialog.getByRole('button',{name:'Göndər',exact:true}).click();await dialog.getByText('Göndəriş tamamlandı',{exact:true}).waitFor();
 const received=(await (await fetch(api+'/_test/received')).json()).received;assert.equal(received.length,9);assert.deepEqual(new Set(received.slice(0,3)),new Set(received.slice(6)));
 await dialog.getByRole('button',{name:'Bağla',exact:true}).last().click();
 // A real receiving SCP rejects the file: the UI must not say completed.
 await fetch(api+'/_test/reject',{method:'POST'});await archive.getByRole('button',{name:'RADAZBRIDGE-ə göndər',exact:true}).click();dialog=archive.getByRole('dialog');
 await dialog.getByRole('button',{name:'Göndər',exact:true}).click();await dialog.getByRole('alert').waitFor();assert.match(await dialog.innerText(),/0xA700/);assert.match(await dialog.innerText(),/0 fayl qəbul edilib/);
 assert.equal((await (await fetch(api+'/status')).json()).instanceCount,3,'Source archive unchanged');
 assert.deepEqual(errors,[]);console.log('PASS: Archive, DICOMweb and DIMSE -> real SCP; exact UIDs, shared settings, failed reception and archive preservation.');
}finally{
 await browser?.close();for(const child of [server,fixture])if(child?.pid){if(process.platform==='win32')spawnSync('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});else child.kill();}
 rmSync(root,{recursive:true,force:true});
}
