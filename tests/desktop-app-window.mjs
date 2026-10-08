// Exercise the production app command in an isolated browser profile/window.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {spawn,spawnSync} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {setTimeout as delay} from 'node:timers/promises';
if(process.platform!=='win32')process.exit(0);
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=mkdtempSync(path.join(tmpdir(),'radaz-app-window-'));
const server=http.createServer((req,res)=>{res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>RADAZ application window test</title><h1>RADAZ test</h1>');});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;
const probe=http.createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const debug=probe.address().port;await new Promise(r=>probe.close(r));
const result=spawnSync(process.env.PYTHON||'python',['-c',"import sys,json;from pathlib import Path;sys.path.insert(0,'bridge');import radaz_desktop as d;d.run_hidden=lambda command,root:print(json.dumps(command));d.open_app(Path('.'),'synthetic-build')"],{encoding:'utf8',windowsHide:true,env:{...process.env,RADAZ_PORT:String(port)}});
assert.equal(result.status,0,result.stderr);const command=JSON.parse(result.stdout);
assert.ok(command.includes(`--app=http://localhost:${port}/?radaz-build=synthetic-build`));
const child=spawn(command[0],[...command.slice(1),`--user-data-dir=${root}`,`--remote-debugging-port=${debug}`,'--no-default-browser-check','--disable-background-networking','--window-position=-20000,-20000','--window-size=1000,700'],{windowsHide:true,stdio:'ignore'});
let browser;
try{
 for(let i=0;i<80;i++){try{if((await fetch(`http://127.0.0.1:${debug}/json/version`)).ok)break;}catch{}await delay(250);}
 browser=await chromium.connectOverCDP(`http://127.0.0.1:${debug}`);
 const context=browser.contexts()[0];let page;
 for(let i=0;i<40&&!page;i++){page=context.pages().find(p=>p.url().includes(`localhost:${port}/`));if(!page)await delay(100);}
 assert.ok(page,'Dedicated RADAZ app window opened');await page.getByRole('heading',{name:'RADAZ test',exact:true}).waitFor();
 const frame=await page.evaluate(()=>({outside:outerHeight,inside:innerHeight}));
 assert.ok(frame.outside-frame.inside<65,`App window must not show the browser tab/address bars: ${JSON.stringify(frame)}`);
 assert.equal(new URL(page.url()).hostname,'localhost');
 console.log('PASS: Windows launches a real RADAZ app window without tab/address bars; production profile and localhost origin are preserved');
}finally{
 if(browser){const session=await browser.newBrowserCDPSession();await session.send('Browser.close').catch(()=>{});await browser.close().catch(()=>{});}
 assert.equal(path.dirname(root),path.resolve(tmpdir()));assert.ok(path.basename(root).startsWith('radaz-app-window-'));
 await new Promise(r=>server.close(r));await delay(500);
 assert.equal(path.dirname(root),path.resolve(tmpdir()));assert.ok(path.basename(root).startsWith('radaz-app-window-'));rmSync(root,{recursive:true,force:true,maxRetries:6,retryDelay:500});
}
