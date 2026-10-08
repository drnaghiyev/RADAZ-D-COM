// Windows regression: the updater may be spawned by the gateway it must replace.
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,rmSync} from 'node:fs';
import path from 'node:path';
import {tmpdir} from 'node:os';
import http from 'node:http';
import {setTimeout as delay} from 'node:timers/promises';
if(process.platform!=='win32'){console.log('Windows process-tree regression skipped');process.exit(0);}
const root=mkdtempSync(path.join(tmpdir(),'radaz-process-tree-'));
const socket=http.createServer();await new Promise(r=>socket.listen(0,'127.0.0.1',r));const port=socket.address().port;await new Promise(r=>socket.close(r));
const ps=path.join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe');
const python=process.env.RADAZ_TEST_PYTHON||path.resolve('outputs/desktop-stage/runtime/python/python.exe');
const helper=path.resolve('scripts/stop-web-server.ps1'),marker=path.join(root,'restart-survived.json');
for(const dir of ['scripts','dist/runtime'])mkdirSync(path.join(root,dir),{recursive:true});
writeFileSync(path.join(root,'dist/runtime/web-server.mjs'),'setInterval(()=>{},1000);');
writeFileSync(path.join(root,'archive-fixture.mjs'),'setInterval(()=>{},1000);');
writeFileSync(path.join(root,'config.json'),JSON.stringify({ps,helper,port,marker}));
writeFileSync(path.join(root,'updater.py'),`import json,subprocess\nfrom pathlib import Path\nc=json.loads(Path(__file__).with_name('config.json').read_text())\nr=subprocess.run([c['ps'],'-NoProfile','-ExecutionPolicy','Bypass','-File',c['helper'],'-Port',str(c['port'])],stdout=subprocess.PIPE,stderr=subprocess.STDOUT,creationflags=0x08000000)\nPath(c['marker']).write_text(json.dumps({'code':r.returncode,'output':r.stdout.decode('utf-8',errors='replace')}))\n`);
writeFileSync(path.join(root,'scripts/start-release.mjs'),`import http from 'node:http';import{spawn}from'node:child_process';
const options={cwd:${JSON.stringify(root)},windowsHide:true,detached:true,stdio:'ignore'};
const worker=spawn(process.execPath,['dist/runtime/web-server.mjs'],options),archive=spawn(process.execPath,['archive-fixture.mjs'],options);
http.createServer((req,res)=>{res.setHeader('Content-Type','application/json');if(req.url==='/apply'){const updater=spawn(${JSON.stringify(python)},[${JSON.stringify(path.join(root,'updater.py'))}],options);updater.unref();res.end(JSON.stringify({worker:worker.pid,archive:archive.pid,updater:updater.pid}));}else res.end(JSON.stringify({name:'RADAZ',version:'0.2.24'}));}).listen(${port},'127.0.0.1');`);
const gateway=spawn(process.execPath,[path.join(root,'scripts/start-release.mjs')],{cwd:root,windowsHide:true,stdio:'ignore'});
let children={};
const alive=pid=>{try{process.kill(pid,0);return true;}catch{return false;}};
try{
 for(let i=0;i<60;i++){try{if((await fetch(`http://127.0.0.1:${port}/product.json`)).ok)break;}catch{}await delay(100);}
 children=await fetch(`http://127.0.0.1:${port}/apply`).then(r=>r.json());
 for(let i=0;i<150&&!existsSync(marker);i++){if(!alive(children.updater)){await delay(300);break;}await delay(100);}
 assert.ok(existsSync(marker),'Gateway tree kill also killed its updater: no process remained to start the new server');
 const result=JSON.parse(readFileSync(marker));assert.equal(result.code,0,result.output);
 assert.equal(alive(gateway.pid),false,'Old gateway must stop');
 assert.equal(alive(children.worker),false,'Only the old renderer must stop with the gateway');
 assert.equal(alive(children.archive),true,'Other child processes must survive');
 console.log('PASS: gateway-owned updater survives restart; old renderer stops; unrelated child survives');
}finally{
 for(const pid of [gateway.pid,...Object.values(children)])if(pid&&alive(pid))spawnSync('taskkill.exe',['/PID',String(pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});
 await delay(300);assert.equal(path.dirname(root),path.resolve(tmpdir()));assert.ok(path.basename(root).startsWith('radaz-process-tree-'));rmSync(root,{recursive:true,force:true,maxRetries:3,retryDelay:200});
}
