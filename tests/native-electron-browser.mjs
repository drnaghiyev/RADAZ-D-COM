import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync,mkdirSync} from 'node:fs';
import path from 'node:path';
const {_electron}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'playwright');
const install=process.argv[2],version=JSON.parse(readFileSync(path.join(install,'active.json'))).version;
const runtime=path.join(install,'versions',version),profile=path.join(install,'synthetic-electron-profile');
assert.equal(JSON.parse(readFileSync(path.join(runtime,'runtime/electron/resources/app/package.json'))).version,version);
const electron=await _electron.launch({executablePath:path.join(runtime,'runtime/electron/RADAZ.exe'),args:['--background'],timeout:90000,env:{...process.env,RADAZ_DESKTOP_RUNTIME:install,RADAZ_DESKTOP_PROFILE:profile,RADAZ_DESKTOP_SKIP_PACS:'1'}});
try{
 const page=await electron.firstWindow({timeout:90000});await page.waitForURL(`http://localhost:${process.env.RADAZ_PORT}/`,{timeout:90000,waitUntil:'domcontentloaded'});
 assert.equal(await electron.evaluate(({app})=>app.getVersion()),version);
 const settings=await electron.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows()[0];const p=w.webContents.getLastWebPreferences();return {sandbox:p.sandbox,node:p.nodeIntegration,isolated:p.contextIsolation,visible:w.isVisible()};});
 assert.deepEqual(settings,{sandbox:true,node:false,isolated:true,visible:false});
 await electron.evaluate(({shell})=>{globalThis.radazTestExternal=[];shell.openExternal=async url=>{globalThis.radazTestExternal.push(url);};});
 await page.evaluate(()=>window.open('/report?archive-study=2.25.111&provider=chatgpt','radaz-system-report'));
 assert.deepEqual(await electron.evaluate(()=>globalThis.radazTestExternal),[`http://localhost:${process.env.RADAZ_PORT}/report?archive-study=2.25.111&provider=chatgpt`]);
 assert.equal(await electron.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().length),1);
 const token='RADAZ_RECORDS_'+ 'a'.repeat(32);
 const popupPromise=electron.waitForEvent('window');
 const registration=electron.context().waitForEvent('response',{predicate:r=>r.url().endsWith('/window/register-records'),timeout:45000});
 await page.evaluate(token=>window.open('/mpr?records='+token,token,'popup=yes,resizable=yes,width=1100,height=740'),token);
 const mpr=await popupPromise;await mpr.waitForLoadState('domcontentloaded');
 await mpr.waitForFunction(()=>document.title.includes('RADAZ DICOM Viewer'));
 assert.equal((await registration).status(),200);
 const before=await electron.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().length);
 await electron.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('/mpr')).minimize());
 await page.evaluate(()=>new Promise((resolve,reject)=>{const c=new BroadcastChannel('radaz-records-windows-v1'),timer=setTimeout(()=>{c.close();reject(Error('MPR focus acknowledgment missing'));},10000);c.onmessage=event=>{if(event.data?.kind==='FOCUSED'&&event.data.request==='native-maximize'){clearTimeout(timer);c.close();resolve(true);}};c.postMessage({kind:'FOCUS',page:'mpr',request:'native-maximize'});}));
 for(let n=0;n<100;n++){
   if(await electron.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('/mpr')).isMaximized()))break;
   await new Promise(r=>setTimeout(r,100));
 }
 assert.equal(await electron.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('/mpr')).isMaximized()),true);
 assert.equal(await electron.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().length),before);
 // A minimized Electron renderer can suspend screenshots independently of
 // the native window state; the HWND maximize/restore assertions above are required.
 mkdirSync('outputs/native-electron',{recursive:true});await mpr.screenshot({path:'outputs/native-electron/mpr-maximized.png',timeout:5000}).catch(()=>console.log('Optional native screenshot unavailable'));
 await mpr.close();
 console.log('PASS native MPR window restores maximized without duplication');
 console.log('PASS packaged Electron version, sandboxed hidden launch and explicit system-browser report handoff');
}finally{await electron.close();}
