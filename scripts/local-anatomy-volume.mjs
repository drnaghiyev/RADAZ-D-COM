// Private CT/MR job service. Generated paths only, bounded uploads, no identifiers.
import {spawn,spawnSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {createReadStream,existsSync,readFileSync,lstatSync,mkdirSync,writeFileSync,rmSync,truncateSync,openSync,writeSync,closeSync} from 'node:fs';
import path from 'node:path';
import {createInterface} from 'node:readline';
import {localAiRequest} from './local-ai-request.mjs';
import {anatomyAccess} from './anatomy-access.mjs';

export function anatomyVolumeService(root,installRoot,product){
 const access=anatomyAccess(product);
 const moduleRoot=process.env.RADAZ_ANATOMY_VOLUME_ROOT||(installRoot&&path.join(installRoot,'local-modules/totalseg'));
 const python=moduleRoot&&path.join(moduleRoot,'python/python.exe');
 const registry=JSON.parse(readFileSync(path.join(root,'bridge/anatomy-models.json'),'utf8')).models;
 const models=()=>{let tasks={};try{tasks=JSON.parse(readFileSync(path.join(moduleRoot,'weights-manifest.json'),'utf8')).tasks;}catch{}return registry.map(m=>({...m,available:!!python&&existsSync(python)&&m.license==='Apache-2.0'&&!!tasks[m.id]?.files&&Object.keys(tasks[m.id].files).length>0}));};
 const jobs=new Map();let current=null,creating=false;
 const enabled=()=>!!python&&existsSync(python)&&existsSync(path.join(moduleRoot,'weights-manifest.json'));
 const base=moduleRoot&&path.join(moduleRoot,'jobs');
 const safeFolder=id=>{if(!/^[a-f0-9-]{36}$/.test(id))throw Error('invalid_id');const folder=path.resolve(base,id);if(path.dirname(folder)!==path.resolve(base))throw Error('invalid_id');return folder;};
 const remove=job=>{if(job.child)return;const folder=safeFolder(job.id);try{if(existsSync(folder)&&!lstatSync(folder).isSymbolicLink())rmSync(folder,{recursive:true,force:true});jobs.delete(job.id);}catch{job.touched=0;}};
 const cancel=job=>{
  job.state='cancelled';
  if(job.child?.pid){if(process.platform==='win32')spawnSync('taskkill.exe',['/PID',String(job.child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});else job.child.kill();}
  else remove(job);
 };
 const stop=()=>{clearInterval(expiry);for(const job of jobs.values())cancel(job);};
 const expiry=setInterval(()=>{for(const job of jobs.values())if(Date.now()-job.touched>30*60*1000)cancel(job);},60000);expiry.unref();
 function validate(meta){
  const {dimensions,spacing,origin,direction,modality}=meta;
  if(!['CT','MR'].includes(modality)||![dimensions,spacing,origin,direction].every(Array.isArray)||dimensions.length!==3||spacing.length!==3||origin.length!==3||direction.length!==9)throw Error('invalid_geometry');
  if(dimensions.some(n=>!Number.isInteger(n)||n<3||n>2048)||dimensions.reduce((a,b)=>a*b,1)>32000000||[...spacing,...origin,...direction].some(n=>typeof n!=='number'||!Number.isFinite(n))||spacing.some(n=>n<.1||n>30)||origin.some(n=>Math.abs(n)>1e6)||direction.some(n=>Math.abs(n)>1.001))throw Error('invalid_geometry');
  for(let i=0;i<3;i++)for(let j=i;j<3;j++){const dot=direction.slice(i*3,i*3+3).reduce((sum,n,k)=>sum+n*direction[j*3+k],0);if(Math.abs(dot-(i===j?1:0))>1e-3)throw Error('invalid_geometry');}
  const task=meta.task||(modality==='CT'?'total':'total_mr'),model=models().find(m=>m.id===task);
  if(!model||model.modality!==modality)throw Error('unsupported_modality');
  if(model.license!=='Apache-2.0')throw Error('restricted_model');
  if(!model.available)throw Error('model_missing');
  return {dimensions,spacing,origin,direction,modality,task};
 }
 async function read(req,limit){return await new Promise((resolve,reject)=>{
  let n=0,chunks=[];const timer=setTimeout(()=>{reject(Error('timeout'));req.destroy();},30000);
  const fail=error=>{clearTimeout(timer);reject(error);};
  req.on('data',chunk=>{n+=chunk.length;if(n>limit){fail(Error('too_large'));req.destroy();}else chunks.push(chunk);});
  req.on('error',fail);req.on('aborted',()=>fail(Error('cancelled')));
  req.on('end',()=>{clearTimeout(timer);resolve(Buffer.concat(chunks));});
 });}
 function run(job){
  job.state='loading';current=job.id;
  const child=spawn(python,['-B',path.join(root,'bridge/radaz_anatomy_volume.py'),job.folder,moduleRoot],{windowsHide:true,stdio:['ignore','pipe','ignore'],env:{...process.env,PYTHONDONTWRITEBYTECODE:'1',OMP_NUM_THREADS:'4',MKL_NUM_THREADS:'4'}});
  job.child=child;
  createInterface({input:child.stdout}).on('line',line=>{
   if(job.state==='cancelled'||!line.startsWith('RADAZ_VOLUME:'))return;
   try{const value=JSON.parse(line.slice(13));if(['loading','segmenting','finishing','ready','error'].includes(value.phase)){if(value.phase!=='ready')job.state=value.phase;job.device=value.device||job.device;job.error=value.error;}}catch{}
  });
  const completed=code=>{
   if(job.child!==child)return;job.child=null;if(current===job.id)current=null;
   if(job.state==='cancelled'){remove(job);return;}
   if(code===0&&existsSync(path.join(job.folder,'result.json'))&&existsSync(path.join(job.folder,'labels.bin'))){job.state='ready';}
   else{job.state='error';job.error||='inference_failed';}
   // The source pixels have served their purpose. Keep only the temporary mask.
   try{rmSync(path.join(job.folder,'input.bin'),{force:true});}catch{}job.touched=Date.now();
  };
  child.on('error',()=>completed(1));child.on('exit',completed);
 }
 async function handle(req,res){
  const send=(status,data)=>{if(!res.destroyed&&!res.writableEnded){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));}};
  // Use the same loopback/Host/Origin checks as the local credential endpoint.
  // Mutating methods additionally require their own exact content type below.
  const gate=req.method==='GET'?req:{socket:req.socket,method:'POST',headers:{...req.headers,'content-type':'application/json'}};
  if(!localAiRequest(gate)){send(403,{error:'local_only'});return;}
  if(req.method!=='GET'&&!['POST','PUT','DELETE'].includes(req.method)){send(405,{error:'method'});return;}
  const url=new URL(req.url,'http://localhost');
  if(url.pathname==='/anatomy-volume/models'&&req.method==='GET'){send(200,{models:models()});return;}
  if(url.pathname==='/anatomy-volume/license'&&req.method==='GET'){try{send(200,await access.status());}catch{send(503,{error:'license_not_configured'});}return;}
  if(url.pathname==='/anatomy-volume/trial/start'&&req.method==='POST'){try{send(200,await access.trial());}catch{send(403,{error:'anatomy_license_required'});}return;}
  // Cancellation frees local resources even after entitlement expiry. It reveals no result.
  if(req.method==='DELETE'){const id=url.pathname.match(/^\/anatomy-volume\/jobs\/([a-f0-9-]{36})$/)?.[1];if(id){const existing=jobs.get(id);if(existing)cancel(existing);send(200,{state:'cancelled'});return;}}
  try{await access.authorize();}catch{send(403,{error:'anatomy_license_required'});return;}
  if(!enabled()){send(503,{error:'model_missing'});return;}
  if(url.pathname==='/anatomy-volume/status'&&req.method==='GET'){send(200,{available:true,ctClasses:117,mrClasses:50,modelSpacingMm:3,experimental:true});return;}
  let job;
  try{
   if(url.pathname==='/anatomy-volume/jobs'&&req.method==='POST'){
    if(req.headers['content-type']?.split(';')[0]!=='application/json')throw Error('content_type');
    if(creating||current||[...jobs.values()].some(j=>j.state==='uploading')){send(409,{error:'busy'});return;}
    creating=true;try{
    for(const old of jobs.values())if(jobs.size>=2)remove(old);
    const meta=validate(JSON.parse((await read(req,16384)).toString('utf8'))),id=randomUUID(),folder=safeFolder(id);
    mkdirSync(base,{recursive:true});if(lstatSync(base).isSymbolicLink())throw Error('invalid_path');mkdirSync(folder);
    writeFileSync(path.join(folder,'meta.json'),JSON.stringify(meta));writeFileSync(path.join(folder,'input.bin'),'');
    truncateSync(path.join(folder,'input.bin'),meta.dimensions.reduce((a,b)=>a*b,4));
    job={id,folder,meta,state:'uploading',received:new Set(),writing:new Set(),touched:Date.now(),child:null};jobs.set(id,job);send(201,{id});return;}finally{creating=false;}
   }
   const match=url.pathname.match(/^\/anatomy-volume\/jobs\/([a-f0-9-]{36})(?:\/(slices\/\d+|run|mask|result))?$/);
   if(!match){send(404,{error:'not_found'});return;}
   job=jobs.get(match[1]);if(!job){send(404,{error:'job_expired'});return;}job.touched=Date.now();
   const action=match[2];
   if(req.method==='DELETE'&&!action){cancel(job);send(200,{state:'cancelled'});return;}
   if(req.method==='GET'&&!action){send(200,{state:job.state,received:job.received.size,total:job.meta.dimensions[2],device:job.device,error:job.error});return;}
   if(req.method==='PUT'&&action?.startsWith('slices/')){
    if(req.headers['content-type']!=='application/octet-stream'||job.state!=='uploading')throw Error('invalid_upload');
    const z=Number(action.slice(7)),size=job.meta.dimensions[0]*job.meta.dimensions[1]*4;
    if(!Number.isInteger(z)||z<0||z>=job.meta.dimensions[2]||job.received.has(z)||job.writing.has(z))throw Error('invalid_slice');
    job.writing.add(z);
    try{const bytes=await read(req,size);if(bytes.length!==size||job.state!=='uploading')throw Error('invalid_slice');const fd=openSync(path.join(job.folder,'input.bin'),'r+');try{writeSync(fd,bytes,0,bytes.length,z*size);}finally{closeSync(fd);}job.received.add(z);}finally{job.writing.delete(z);}
    send(200,{received:job.received.size});return;
   }
   if(req.method==='POST'&&action==='run'){
    if(job.state!=='uploading'||job.received.size!==job.meta.dimensions[2]||job.writing.size)throw Error('incomplete_volume');
    if(current){send(409,{error:'busy'});return;}run(job);send(202,{state:job.state});return;
   }
   if(req.method==='GET'&&job.state==='ready'&&action==='result'){send(200,JSON.parse(readFileSync(path.join(job.folder,'result.json'),'utf8')));return;}
   if(req.method==='GET'&&job.state==='ready'&&action==='mask'){
    res.writeHead(200,{'Content-Type':'application/octet-stream','Cache-Control':'no-store'});const stream=createReadStream(path.join(job.folder,'labels.bin'));stream.on('error',()=>res.destroy());stream.pipe(res);res.on('close',()=>stream.destroy());return;
   }
   send(409,{error:'not_ready'});
  }catch(error){send(400,{error:['invalid_geometry','incomplete_volume','too_large','unsupported_modality','model_missing','restricted_model'].includes(error.message)?error.message:'invalid_request'});}
 }
 return {handle,stop};
}
