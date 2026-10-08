// Built application gateway. DICOM control stays on loopback; the viewer is available on LAN.
import http from 'node:http';
import {spawn,spawnSync} from 'node:child_process';
import {existsSync,readFileSync,writeFileSync,renameSync,unlinkSync,mkdirSync,openSync,closeSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {verifyClientFiles,verifyClientHttp} from './release-health.mjs';
import {localAiRequest} from './local-ai-request.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
if(!existsSync(path.join(root,'dist/server/index.js')))throw new Error('Built application missing. Run START-RADAZ.cmd from a source checkout or extract the release ZIP.');
const build=JSON.parse(readFileSync(path.join(root,'dist/server/radaz-build.json'),'utf8'));
const product=JSON.parse(readFileSync(path.join(root,'public/product.json'),'utf8'));
if(build.product.version!==product.version)throw new Error('RADAZ files belong to different versions. Extract the complete release ZIP into a new folder.');
const runtime={name:'RADAZ',version:build.product.version,buildId:build.buildId,healthProtocol:1,startedAt:new Date().toISOString()};
const installRoot=process.env.RADAZ_INSTALL_ROOT;
function activeVersion(){try{return JSON.parse(readFileSync(path.join(installRoot,'active.json'),'utf8')).version;}catch{return null;}}
function recordStartup(error,phase){
 const diagnostic={phase,type:error.name||'Error',message:error.message,version:runtime.version,buildId:runtime.buildId,at:Date.now()};
 console.error('[RADAZ startup]',JSON.stringify(diagnostic));
 if(installRoot)try{writeFileSync(path.join(installRoot,`startup-error-${runtime.version}.json`),JSON.stringify(diagnostic));}catch{}
 return diagnostic;
}
try{verifyClientFiles(root,build);}catch(error){recordStartup(error,'client-files');throw error;}
const port=Number(process.env.RADAZ_PORT||5173),workerPort=Number(process.env.RADAZ_WORKER_PORT||5175),archivePort=Number(process.env.RADAZ_ARCHIVE_PORT||8766);
if(![port,workerPort,archivePort].every(p=>Number.isInteger(p)&&p>0&&p<=65535)||new Set([port,workerPort,archivePort]).size!==3)throw new Error('Invalid server ports');
const workerArgs=existsSync(path.join(root,'dist/runtime/web-server.mjs'))?['dist/runtime/web-server.mjs']:['node_modules/vinext/dist/cli.js','start','--port',String(workerPort),'--hostname','127.0.0.1'];
const worker=spawn(process.execPath,workerArgs,{cwd:root,windowsHide:true,stdio:['ignore','inherit','pipe'],env:{...process.env,NODE_ENV:'production',RADAZ_WORKER_PORT:String(workerPort)}});
let startupStderr='';worker.stderr.on('data',chunk=>{process.stderr.write(chunk);if(!health.ready)startupStderr=(startupStderr+chunk).slice(-4000);});
let health={ready:false,buildId:runtime.buildId,version:runtime.version},healthFinished=false,closing=false;
// The gateway stays unready even for older updaters until the actual worker has
// served every packaged asset and rendered all application entry routes.
void (async()=>{
 const until=Date.now()+60000;let lastError;
 while(Date.now()<until&&!closing){
  try{health=await verifyClientHttp(`http://127.0.0.1:${workerPort}`,build);healthFinished=true;return;}
  catch(error){
   lastError=error;
   if(/^(Asset |Served asset |Page |Unlisted page)/.test(error.message))break;
   health={...health,diagnostic:{phase:'client-http',message:error.message}};
   await new Promise(r=>setTimeout(r,500));
  }
 }
 if(!closing){health={...health,diagnostic:recordStartup(lastError||Error('Health check timed out'),'client-http')};healthFinished=true;stop();process.exitCode=1;}
})();
const server=http.createServer((req,res)=>{
 const pathname=new URL(req.url,'http://localhost').pathname;
 if(pathname.startsWith('/local-archive-api/ai/')&&!localAiRequest(req)){res.writeHead(403,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'AI ayarlarını serverin quraşdırıldığı kompüterdə açın.'}));return;}
 res.setHeader('X-RADAZ-Build',runtime.buildId);
 res.setHeader('Cache-Control','no-store');
 if(pathname==='/radaz-health.json'){
  res.writeHead(health.ready?200:503,{'Content-Type':'application/json'});res.end(JSON.stringify(health));return;
 }
 if(pathname==='/radaz-update'){
  // Only the local, same-origin application may wake the installed updater.
  const local=['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress);
  const origin=req.headers.origin;
  const allowedOrigin=origin&&[`http://localhost:${port}`,`http://127.0.0.1:${port}`,`http://[::1]:${port}`].includes(origin);
  if(req.method!=='POST'||!local||!allowedOrigin||!installRoot){res.writeHead(403);res.end();return;}
  let body='';
  req.on('data',chunk=>{body+=chunk;if(body.length>4096){res.writeHead(413);res.end();req.destroy();}});
  req.on('end',()=>{
  if(res.writableEnded)return;
  let request;
  try{
   const input=JSON.parse(body||'{}'),action=input.action||'check';
   if(!['check','download','apply'].includes(action))throw Error('action');
   if(action!=='check'&&(input.confirmed!==true||typeof input.version!=='string'||!/^\d+\.\d+\.\d+$/.test(input.version)))throw Error('confirmation');
   if(action==='apply'&&JSON.parse(readFileSync(path.join(installRoot,'pending.json'),'utf8')).version!==input.version)throw Error('stale version');
   request=action!=='check'?{action,confirmed:true,version:input.version}:{action};
  }catch{res.writeHead(400);res.end('Invalid update request');return;}
  try{
   const pending=path.join(installRoot,request.action==='apply'?'apply-request.json':'update-request.json');
   const temp=pending+'.tmp';writeFileSync(temp,JSON.stringify({...request,requestedAt:Date.now()}));renameSync(temp,pending);
   mkdirSync(path.join(installRoot,'logs'),{recursive:true});
   const log=openSync(path.join(installRoot,'logs/desktop.log'),'a');
   let updater;
   try{updater=spawn(path.join(root,'runtime/python/python.exe'),[path.join(root,'bridge/radaz_desktop.py'),request.action==='apply'?'apply':'watch','--install-root',installRoot],{cwd:installRoot,windowsHide:true,detached:true,stdio:['ignore',log,log]});}
   finally{closeSync(log);}
   updater.on('error',error=>{
    console.error('Updater start:',error.message);
    try{unlinkSync(pending);}catch{}
    const stateFile=path.join(installRoot,'update-state.json'),temporary=stateFile+'.tmp';
    try{writeFileSync(temporary,JSON.stringify({state:'error',message:'Yeniləmə xidməti başlamadı. RADAZ qısayolundan yenidən başladın.',diagnostic:{phase:'updater-start',type:error.name,message:error.message,at:Date.now()}}));renameSync(temporary,stateFile);}catch{}
   });updater.unref();
   res.writeHead(202,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({state:'checking',message:request.action==='download'?'Təsdiqlənmiş yeniləmə hazırlanır.':'Yeniləmələr yoxlanılır.'}));
  }catch{res.writeHead(500,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'Yeniləmə başladılmadı.'}));}
  });return;
 }
 if(pathname==='/radaz-installation.json'){
  let state={managed:!!installRoot,state:'current',message:installRoot?'Yeni versiya olduqda bildiriş göstərilir. Yükləmə yalnız təsdiqinizdən sonra başlayır.':''};
  if(installRoot)try{const saved=JSON.parse(readFileSync(path.join(installRoot,'update-state.json'),'utf8'));state={...state,state:saved.state,version:saved.version,message:saved.message,progress:saved.progress,diagnostic:saved.diagnostic};
   if(existsSync(path.join(installRoot,'update-request.json')))state={...state,state:'checking',message:'Yeniləmələr yoxlanılır…',progress:null};
  }catch{}
  if(installRoot&&existsSync(path.join(installRoot,'apply-request.json')))state={...state,state:'activating',message:'Təsdiqlənmiş yenilənmə tətbiq edilir…'};
  const active=activeVersion();
  state={...state,activeVersion:active,buildId:runtime.buildId,healthy:health.ready,activationComplete:!!installRoot&&health.ready&&active===runtime.version};
  res.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(state));return;
 }
 // Desktop lifecycle control is never forwarded from browsers or LAN clients.
 if(pathname.startsWith('/local-archive-api/_desktop/')){res.writeHead(404);res.end();return;}
 if(pathname==='/radaz-runtime.json'||pathname==='/product.json'){
  res.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});
  // Older UI clients reload on runtime.version alone. Expose that version only
  // after commit; buildId stays available to the older desktop health checker.
  const activating=!!installRoot&&(!health.ready||activeVersion()!==runtime.version);
  const visibleRuntime=activating?{...runtime,version:null,candidateVersion:runtime.version,activationComplete:false}:{...runtime,activationComplete:true};
  res.end(JSON.stringify(pathname==='/product.json'?build.product:visibleRuntime));return;
 }
 if(!health.ready){res.writeHead(503,{'Content-Type':'text/plain; charset=utf-8','Retry-After':'3'});res.end(healthFinished?'RADAZ resurs yoxlaması uğursuz oldu. Əvvəlki versiya qorunur.':'RADAZ resursları yoxlanılır…');return;}
 // Missing hashed chunks must never fall through to a 200 HTML document.
 if((pathname.startsWith('/_next/static/')||pathname.startsWith('/dicom-codecs/'))&&!build.assets[pathname]){res.writeHead(404);res.end('Resource does not belong to this RADAZ build');return;}
 const archive=req.url==='/local-archive-api'||req.url.startsWith('/local-archive-api/');
 const headers={...req.headers,host:`127.0.0.1:${archive?archivePort:workerPort}`};
 if(!archive)delete headers['accept-encoding'];
 const upstream=http.request({hostname:'127.0.0.1',port:archive?archivePort:workerPort,path:archive?req.url.slice('/local-archive-api'.length)||'/':req.url,method:req.method,headers},reply=>{
  const responseHeaders={...reply.headers,'cache-control':'no-store','x-radaz-version':runtime.version,'x-radaz-build':runtime.buildId};
  if(!archive&&reply.headers['content-type']?.includes('text/html')&&req.method!=='HEAD'){
   delete responseHeaders['content-length'];delete responseHeaders.etag;
   // A build marker and an early bootstrap guard belong to the same HTML response.
   const chunks=[];reply.on('data',chunk=>chunks.push(chunk));reply.on('end',()=>{
    const html=Buffer.concat(chunks).toString('utf8').replace('<head>',`<head><meta name="radaz-build" content="${runtime.buildId}"><script src="/radaz-boot.js?build=${runtime.buildId}"></script>`);
    res.writeHead(reply.statusCode,responseHeaders);res.end(html);
   });reply.on('error',()=>res.destroy());
  }else{res.writeHead(reply.statusCode,responseHeaders);reply.pipe(res);}
 });
 upstream.on('error',()=>{if(!res.headersSent)res.writeHead(503,{'Content-Type':'text/plain; charset=utf-8','Retry-After':'3'});res.end('RADAZ xidməti hazırlanır. Bir neçə saniyə sonra səhifəni yeniləyin.');});
 req.on('aborted',()=>upstream.destroy());req.pipe(upstream);
});
const stop=()=>{if(closing)return;closing=true;server.close();if(process.platform==='win32'&&worker.pid)spawnSync('taskkill.exe',['/PID',String(worker.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});else worker.kill();setTimeout(()=>process.exit(),1500).unref();};
worker.on('exit',code=>{if(!closing){recordStartup(Error(`RADAZ web runtime exited (${code})${startupStderr?'\n'+startupStderr:''}`),'worker-exit');stop();process.exitCode=code||1;}});worker.on('error',error=>{recordStartup(error,'worker-start');stop();});
server.on('error',error=>{recordStartup(error,'gateway-start');stop();process.exitCode=1;});
process.on('SIGINT',stop);process.on('SIGTERM',stop);
server.listen(port,'0.0.0.0',()=>console.log(`RADAZ: http://localhost:${port}`));
