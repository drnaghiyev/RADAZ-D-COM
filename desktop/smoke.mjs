import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdirSync,readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import http from 'node:http';
const {_electron}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE);
const free=()=>new Promise(resolve=>{const s=http.createServer();s.listen(0,'127.0.0.1',()=>{const port=s.address().port;s.close(()=>resolve(port));});});
const port=await free(),worker=await free(),archive=await free();
const output=path.resolve('outputs/desktop-test');mkdirSync(output,{recursive:true});
const data=path.join(output,'archive');mkdirSync(data,{recursive:true});
writeFileSync(path.join(data,'config.json'),JSON.stringify({enabled:false,port:await free(),aeTitle:'RADAZ_TEST'}));
let app,page;const errors=[];
try{
 app=await _electron.launch({executablePath:path.resolve('outputs/desktop-test/install/versions/0.2.29/runtime/electron/RADAZ.exe'),env:{...process.env,PATH:process.env.SystemRoot+'/System32',RADAZ_PORT:String(port),RADAZ_WORKER_PORT:String(worker),RADAZ_ARCHIVE_PORT:String(archive),RADAZ_ARCHIVE_DATA:data,RADAZ_DESKTOP_SKIP_PACS:'1',RADAZ_DESKTOP_PROFILE:path.join(output,'profile')},timeout:150000});
 console.log('Native shell launched');
 page=await app.firstWindow({timeout:150000});page.setDefaultTimeout(30000);
 app.on('window',w=>w.on('pageerror',e=>errors.push(e.message)));
 await page.context().route('**/local-archive-api/license',route=>route.fulfill({json:{valid:true,required:true,kind:'owner',deviceId:'SYNTHETIC-TEST'}}));
 await page.waitForURL('http://localhost:'+port+'/**',{waitUntil:'domcontentloaded'});await page.reload({waitUntil:'domcontentloaded'});await page.locator('.topbar').waitFor();
 assert.equal(await page.evaluate(()=>typeof window.require),'undefined');
 assert.equal((await (await fetch(`http://localhost:${port}/product.json`)).json()).version,'0.2.29');
 assert.equal((await (await fetch(`http://localhost:${port}/radaz-installation.json`)).json()).managed,true);
 console.log('Viewer ready');await page.screenshot({path:path.join(output,'desktop-home.png')});
 const files=readdirSync('outputs/desktop-fixture').filter(x=>x.endsWith('.dcm')).map(x=>path.resolve('outputs/desktop-fixture',x));
 await page.locator('input[type=file]').first().setInputFiles(files);
 await page.waitForFunction(()=>document.querySelector('.statusbar')?.textContent.includes('DICOM görüntüsü yükləndi'),null,{timeout:60000});
 await page.locator('[data-panel="A"][data-has-image="true"]').waitFor();
 await page.screenshot({path:path.join(output,'desktop-dicom.png')});
 const popup=app.waitForEvent('window');await page.getByRole('button',{name:'MPR rekonstruksiya',exact:true}).click();const mpr=await popup;
 await mpr.waitForFunction(()=>document.querySelectorAll('[data-panel][data-has-image="true"]').length===3&&!document.querySelector('.viewport-loading'),null,{timeout:60000});
 assert.equal(await mpr.evaluate(()=>!!window.opener),true);
 await mpr.screenshot({path:path.join(output,'desktop-mpr.png')});
 await mpr.close();
 const volumeWindow=app.waitForEvent('window');await page.getByRole('button',{name:'3D həcm görüntüləmə',exact:true}).click();const volume=await volumeWindow;
 await volume.locator('.cornerstone-volume-stage[data-ready="true"]').waitFor({timeout:60000});
 assert.equal(Number(await volume.locator('.cornerstone-volume-host').getAttribute('data-source-slices')),files.length);
 await volume.screenshot({path:path.join(output,'desktop-3d.png')});await volume.close();
 const pdf=await app.evaluate(async({BrowserWindow})=>{const bytes=await BrowserWindow.getAllWindows().find(w=>!w.isDestroyed()&&!w.webContents.isDestroyed()&&new URL(w.webContents.getURL()).pathname==='/').webContents.printToPDF({pageSize:'A4'});return {header:bytes.subarray(0,5).toString(),length:bytes.length};});
 assert.equal(pdf.header,'%PDF-');assert.ok(pdf.length>1000);

 const records=app.waitForEvent('window');await page.getByRole('button',{name:'Local arxiv',exact:true}).click();const ar=await records;
 await ar.waitForURL('**/archive?**',{waitUntil:'domcontentloaded'});await ar.getByRole('combobox',{name:'Tarix üçün sürətli seçim'}).selectOption('all');await ar.getByText('SYNTHETIC VOLUME',{exact:false}).first().waitFor();
 await ar.screenshot({path:path.join(output,'desktop-archive.png')});await ar.close();
 for(const route of ['/pacs','/report','/print','/printer-settings','/media']){
  console.log('Checking native route',route);
  await page.evaluate(route=>{const button=document.createElement('button');button.id='native-test-open';button.textContent='Native route test';button.style='position:fixed;top:0;left:0;z-index:999999';button.onclick=()=>window.open(route,'_blank');document.body.append(button);},route);
  const opened=app.waitForEvent('window');await page.locator('#native-test-open').click();const child=await opened;
  await page.evaluate(()=>document.querySelector('#native-test-open').remove());
  await child.waitForLoadState('domcontentloaded');assert.ok((await child.locator('body').innerText()).includes('RADAZ'));await child.close();
 }
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>!w.isDestroyed()&&!w.webContents.isDestroyed()&&new URL(w.webContents.getURL()).pathname==='/').close());
 assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>!w.isDestroyed()&&!w.webContents.isDestroyed()&&new URL(w.webContents.getURL()).pathname==='/').isVisible()),false,'Close minimizes to tray');
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>!w.isDestroyed()&&!w.webContents.isDestroyed()&&new URL(w.webContents.getURL()).pathname==='/').show());
 assert.deepEqual(errors,[]);
 writeFileSync(path.join(output,'result.json'),JSON.stringify({passed:true,version:'0.2.29',nativeElectron:true,systemPathOnly:true,syntheticDicomSlices:files.length,mprPlanes:3,volume3d:true,pdfExport:true,managedUpdater:true,clinicalValidation:false},null,2));
 console.log('PASS: packaged native RADAZ, isolated archive, DICOM import, MPR handoff, routes, tray and sandbox');
}catch(error){if(page)await page.screenshot({path:path.join(output,'failure.png')}).catch(()=>{});throw error;}
finally{
 await app?.close();
 // Only this test's generated ports/root; never stop the clinical installation.
 const runtime=path.resolve('outputs/desktop-test/install');
 spawnSync('powershell.exe',['-NoProfile','-Command',`Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and $_.CommandLine.Contains('${runtime.replaceAll("'","''")}') -and $_.ProcessId -ne $PID -and $_.Name -match '^(python|node|powershell)\\.exe$' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`],{windowsHide:true,stdio:'ignore'});
}
