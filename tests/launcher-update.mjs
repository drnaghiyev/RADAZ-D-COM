import assert from 'node:assert/strict';
import http from 'node:http';
import {spawn,spawnSync} from 'node:child_process';
import {cpSync,mkdtempSync,mkdirSync,readFileSync,writeFileSync,symlinkSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
if(process.platform!=='win32'){console.log('Windows launcher test skipped on this OS');process.exit(0);}
const source=process.cwd(), temp=mkdtempSync(path.join(tmpdir(),'radaz-launcher-'));
const root=path.join(temp,'new package with spaces'),old=path.join(temp,'old','scripts');
const children=[];
const listen=s=>new Promise(r=>s.listen(0,'127.0.0.1',()=>r(s.address().port)));
const freePort=async()=>{const s=http.createServer();const p=await listen(s);await new Promise(r=>s.close(r));return p;};
const archive=http.createServer((req,res)=>{res.writeHead(200,{'Content-Type':'application/json'});res.end('{"synthetic":true}');});
const archivePort=await listen(archive),port=await freePort(),workerPort=await freePort(),base=`http://127.0.0.1:${port}`;
const launch=(command,args,env={})=>{const c=spawn(command,args,{windowsHide:true,env:{...process.env,...env},stdio:['ignore','pipe','pipe']});c.output='';c.stdout.on('data',x=>c.output+=x);c.stderr.on('data',x=>c.output+=x);children.push(c);return c;};
const powershell=(file,args=[])=>launch('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',file,...args],{RADAZ_PORT:String(port),RADAZ_WORKER_PORT:String(workerPort),RADAZ_ARCHIVE_PORT:String(archivePort)});
const exit=async c=>{for(let i=0;i<150&&c.exitCode===null;i++)await delay(200);assert.notEqual(c.exitCode,null,c.output);return c.exitCode;};
const waitFor=async(test,child)=>{for(let i=0;i<150;i++){if(child.exitCode!==null)throw new Error(child.output);try{if(await test())return;}catch{}await delay(200);}throw new Error(child.output||'Timeout');};
try{
 mkdirSync(path.join(root,'scripts'),{recursive:true});mkdirSync(path.join(root,'public'));mkdirSync(old,{recursive:true});
 cpSync(path.join(source,'dist'),path.join(root,'dist'),{recursive:true});cpSync(path.join(source,'public/product.json'),path.join(root,'public/product.json'));
 // An extracted release must not accidentally compile leftover source from an older folder.
 mkdirSync(path.join(root,'app'));writeFileSync(path.join(root,'app/page.tsx'),'obsolete source');writeFileSync(path.join(root,'SHA256SUMS.json'),'{}');
 symlinkSync(path.join(source,'node_modules'),path.join(root,'node_modules'),'junction');
 for(const name of ['start-radaz.ps1','start-release.mjs','release-health.mjs','stop-web-server.ps1'])cpSync(path.join(source,'scripts',name),path.join(root,'scripts',name));
 writeFileSync(path.join(root,'scripts/start-archive.ps1'),'exit 0');
 const oldScript=path.join(old,'start-release.mjs');
 writeFileSync(oldScript,`import http from 'node:http';http.createServer((q,s)=>{s.setHeader('Content-Type','application/json');s.end(JSON.stringify({name:'RADAZ',version:'0.2.7'}));}).listen(${port},'127.0.0.1');`);
 const previous=launch(process.execPath,[oldScript]);await waitFor(async()=>(await fetch(base)).ok,previous);
 const launcher=path.join(root,'scripts/start-radaz.ps1');const started=powershell(launcher,['-NoBrowser']);
 await waitFor(async()=>{const r=await(await fetch(base+'/radaz-runtime.json')).json();return !!r.buildId&&(await fetch(base+'/')).status===200;},started);
 assert.notEqual(previous.exitCode,null,'Old gateway must stop');
 assert.equal((await fetch(base+'/')).status,200);
 const runtime=await(await fetch(base+'/radaz-runtime.json')).json();
 assert.equal(runtime.version,JSON.parse(readFileSync(path.join(root,'public/product.json'))).version);
 assert.deepEqual(await(await fetch(base+'/local-archive-api/status')).json(),{synthetic:true},'Independent receiver stays available');
 console.log('New ZIP launcher replaced an old server that falsely reported the new product version');
 const repeated=powershell(launcher,['-NoBrowser']);assert.equal(await exit(repeated),0,repeated.output);
 assert.equal((await(await fetch(base+'/radaz-runtime.json')).json()).startedAt,runtime.startedAt,'Same build reuses running server');
 const productFile=path.join(root,'public/product.json');const product=JSON.parse(readFileSync(productFile));writeFileSync(productFile,JSON.stringify({...product,version:'99.0.0'}));
 assert.equal((await(await fetch(base+'/product.json')).json()).version,product.version,'Running version must be immutable after files are replaced');
 const mixed=powershell(launcher,['-NoBrowser']);assert.notEqual(await exit(mixed),0,'Mixed old build/new product must fail');
 assert.equal((await(await fetch(base+'/radaz-runtime.json')).json()).buildId,runtime.buildId,'Invalid package must not stop running server');
 console.log('Same build reuse, immutable runtime version and mixed-package rejection passed');
 // Another application may hold the port. It must never be killed by the updater.
 const foreignPort=await freePort();const foreignScript=path.join(temp,'foreign.mjs');writeFileSync(foreignScript,`import http from 'node:http';http.createServer((q,s)=>s.end('unrelated')).listen(${foreignPort},'127.0.0.1');`);
 const foreign=launch(process.execPath,[foreignScript]);await waitFor(async()=>(await fetch(`http://127.0.0.1:${foreignPort}`)).ok,foreign);
 const refused=powershell(path.join(root,'scripts/stop-web-server.ps1'),['-Port',String(foreignPort)]);assert.notEqual(await exit(refused),0);assert.equal(foreign.exitCode,null);console.log('Unrelated port owner preserved');
}finally{
 for(const c of children.reverse())if(c.exitCode===null)spawnSync('taskkill.exe',['/PID',String(c.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});
 await new Promise(r=>archive.close(r));await delay(500);
 assert.ok(path.resolve(temp).startsWith(path.join(tmpdir(),'radaz-launcher-')));rmSync(temp,{recursive:true,force:true,maxRetries:3,retryDelay:300});
}
