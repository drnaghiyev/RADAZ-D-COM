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
 const sendButton=page=>page.getByRole('button',{name:'SYNTHETIC BRIDGE: RADAZBRIDGE-ə göndər',exact:true});
 const row=page=>page.getByRole('row').filter({has:sendButton(page)});
 const settings=async page=>{await page.getByRole('button',{name:'RADAZBRIDGE ayarları',exact:true}).click();return page.getByRole('dialog');};
 let dialog=await settings(archive);await dialog.getByLabel('Port',{exact:true}).fill(String(config.destination));
 assert.equal(await dialog.getByRole('button',{name:'Göndər',exact:true}).count(),0,'Settings never sends patient data');
 await dialog.getByRole('button',{name:'Saxla və bağlantını yoxla',exact:true}).click();
 await dialog.getByText('DICOM bağlantısı işləyir. Ayarlar saxlanıldı.',{exact:true}).waitFor();
 await archive.screenshot({path:'outputs/bridge-send/settings.png'});
 await dialog.getByRole('button',{name:'Bağla',exact:true}).last().click();
 // Checked studies must not change the row button's destination study.
 await archive.getByRole('checkbox',{name:'OTHER BRIDGE müayinəsini seç',exact:true}).check();
 await sendButton(archive).click();
 assert.equal(await archive.getByRole('dialog').count(),0,'Row sends directly, without a settings/send modal');
 await archive.waitForFunction(()=>{const p=document.querySelector('.radazbridge-row progress');return p&&p.value>0&&p.value<100;});
 assert.equal(await archive.getByRole('button',{name:'OTHER BRIDGE: RADAZBRIDGE-ə göndər',exact:true}).isDisabled(),true);
 await archive.screenshot({path:'outputs/bridge-send/archive-progress.png'});
 // Filtering the active row out must not cancel the transfer or lose its result.
 await archive.getByRole('textbox',{name:'Bütün müayinələrdə axtar'}).fill('OTHER');
 await delay(2500);
 await archive.getByRole('textbox',{name:'Bütün müayinələrdə axtar'}).fill('');
 await row(archive).getByText('Göndərildi',{exact:true}).waitFor();
 assert.equal(await row(archive).getByRole('progressbar').getAttribute('value'),'100');
 assert.match(await row(archive).innerText(),/3 \/ 3 fayl qəbul edilib/);
 assert.equal((await (await fetch(api+'/_test/received')).json()).received.length,3);
 await archive.screenshot({path:'outputs/bridge-send/archive.png'});
 // Shared settings persist independently of sending, on both screens.
 const pacs=await context.newPage();await pacs.addInitScript(({url,source})=>localStorage.setItem('radaz-pacs-config-v1',JSON.stringify({selected:'fixture',aeTitle:'RADAZ',listenerPort:'11114',locations:[{id:'fixture',host:'127.0.0.1',port:String(source),aeTitle:'SOURCE',description:'Synthetic PACS',dicomwebUrl:url}]})),{url:api+'/test-pacs',source:config.source});
 await pacs.goto(base+'/pacs');dialog=await settings(pacs);
 await pacs.waitForFunction(value=>document.querySelector('.radazbridge-fields input[inputmode=numeric]')?.value===value,String(config.destination));
 assert.equal(await dialog.getByLabel('Port',{exact:true}).inputValue(),String(config.destination));
 await dialog.getByRole('button',{name:'Saxla',exact:true}).click();await dialog.getByText('Bağlantı ayarları saxlanıldı.',{exact:true}).waitFor();
 await dialog.getByRole('button',{name:'Bağla',exact:true}).last().click();
 await pacs.getByRole('button',{name:'Axtar',exact:true}).click();await sendButton(pacs).click();
 await row(pacs).getByText('Göndərildi',{exact:true}).waitFor();
 assert.equal((await (await fetch(api+'/_test/received')).json()).received.length,6);
 assert.equal(await row(pacs).getByRole('progressbar').getAttribute('value'),'100');
 await pacs.screenshot({path:'outputs/bridge-send/pacs.png'});
 // DIMSE forwards the clicked study without retrieving the archive into the browser.
 await pacs.evaluate(()=>{const cfg=JSON.parse(localStorage.getItem('radaz-pacs-config-v1'));cfg.locations[0].dicomwebUrl='';localStorage.setItem('radaz-pacs-config-v1',JSON.stringify(cfg));});
 const dimse=await context.newPage();await dimse.route('http://127.0.0.1:8765/**',route=>{const endpoint=new URL(route.request().url()).pathname;return route.fulfill({json:endpoint==='/health'?{version:3}:{items:[{uid:config.study,patient:'SYNTHETIC BRIDGE',patientId:'TEST',date:new Date().toISOString().slice(0,10).replaceAll('-',''),modality:'CT',description:'Synthetic',seriesCount:3,instanceCount:3}],truncated:false}});});
 await dimse.goto(base+'/pacs');await dimse.getByRole('button',{name:'Axtar',exact:true}).click();await sendButton(dimse).click();
 await row(dimse).getByText('Göndərildi',{exact:true}).waitFor();
 const received=(await (await fetch(api+'/_test/received')).json()).received;assert.equal(received.length,9);assert.deepEqual(new Set(received.slice(0,3)),new Set(received.slice(6)));
 // Real receiver failure stays in its own row and never claims completion.
 await fetch(api+'/_test/reject',{method:'POST'});await sendButton(archive).click();
 await row(archive).getByRole('alert').waitFor();assert.match(await row(archive).innerText(),/0xA700/);assert.match(await row(archive).innerText(),/0 \/ 3 fayl qəbul edilib/);
 assert.equal(await row(archive).getByRole('progressbar').getAttribute('value'),'0');
 await archive.screenshot({path:'outputs/bridge-send/archive-error.png'});
 await fetch(api+'/_test/warn',{method:'POST'});await sendButton(archive).click();
 await row(archive).getByText('Xəbərdarlıqla göndərildi',{exact:true}).waitFor();
 await fetch(api+'/_test/reset',{method:'POST'});await fetch(api+'/_test/hold',{method:'POST'});await sendButton(archive).click();
 await archive.waitForFunction(()=>{const p=document.querySelector('.radazbridge-row progress');return p&&p.value>0&&p.value<100;});
 const cancelledResponse=archive.waitForResponse(response=>response.url().endsWith('/bridge/cancel')&&response.request().method()==='POST');
 await archive.getByRole('button',{name:'SYNTHETIC BRIDGE: Dayandır',exact:true}).click();
 assert.equal((await (await cancelledResponse).json()).cancelled,true);
 await fetch(api+'/_test/release',{method:'POST'});
 try { await row(archive).getByText('Dayandırıldı',{exact:true}).waitFor(); } catch(error) { console.log(await archive.locator('.radazbridge-row').allInnerTexts()); await archive.screenshot({path:'outputs/bridge-send/cancel-error.png'}); throw error; }
 assert.ok(Number(await row(archive).getByRole('progressbar').getAttribute('value'))<100);
 assert.equal((await (await fetch(api+'/status')).json()).instanceCount,4,'Source archive unchanged');
 // The action remains visible at common monitor widths, including horizontal scrolling.
 for(const width of [1920,1366]){
   await archive.setViewportSize({width,height:1080});
   await archive.locator('.records-upper').evaluate(element=>{element.scrollLeft=element.scrollWidth;});
   const button=await sendButton(archive).boundingBox();assert.ok(button.x>=0&&button.x+button.width<=width);
   await archive.screenshot({path:`outputs/bridge-send/archive-${width}.png`});
 }
 assert.deepEqual(errors,[]);console.log('PASS: separate settings, direct row sends, real acknowledgement percentages, filter retention, DICOMweb/DIMSE, error/warning/cancel and archive preservation.');

}finally{
 await browser?.close();for(const child of [server,fixture])if(child?.pid){if(process.platform==='win32')spawnSync('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});else child.kill();}
 rmSync(root,{recursive:true,force:true});
}
