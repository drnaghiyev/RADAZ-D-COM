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
 mkdirSync('outputs/native-electron',{recursive:true});await page.screenshot({path:'outputs/native-electron/boot.png'});
 console.log('PASS packaged Electron version, sandboxed hidden launch and explicit system-browser report handoff');
}finally{await electron.close();}
