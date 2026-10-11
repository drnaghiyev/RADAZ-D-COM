// Private offline worker: loopback + same-origin only; one bounded request at a time.
import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import {createInterface} from 'node:readline';
import path from 'node:path';
import {localAiRequest} from './local-ai-request.mjs';

export function anatomyService(root, installRoot, product) {
 const moduleRoot=process.env.RADAZ_ANATOMY_ROOT||(installRoot&&path.join(installRoot,'local-modules/flexray'));
 const python=moduleRoot&&path.join(moduleRoot,'python/python.exe');
 const available=()=>product.channel==='local-anatomy'&&product.localModules?.includes('anatomy-atlas')&&!!python&&existsSync(python)&&existsSync(path.join(moduleRoot,'model.onnx'));
 let worker=null,pending=null,busy=false,idle=null;
 const stop=()=>{clearTimeout(idle);if(worker){worker.kill();worker=null;}if(pending){pending.reject(Error('worker_stopped'));pending=null;}};
 function infer(input){
  clearTimeout(idle);
  return new Promise((resolve,reject)=>{
   if(!worker){
    const child=spawn(python,['-B',path.join(root,'bridge/radaz_anatomy.py'),moduleRoot],{windowsHide:true,stdio:['pipe','pipe','ignore'],env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}});
    worker=child;
    createInterface({input:child.stdout}).on('line',line=>{if(worker!==child||!pending)return;const current=pending;pending=null;try{current.resolve(JSON.parse(line));}catch{current.reject(Error('invalid_response'));}});
    const exited=()=>{if(worker===child){worker=null;if(pending){pending.reject(Error('worker_stopped'));pending=null;}}};
    child.on('error',exited);child.on('exit',exited);child.stdin.on('error',exited);
   }
   pending={resolve,reject};
   worker.stdin.write(JSON.stringify(input)+'\n');
  });
 }
 async function handle(req,res){
  const send=(status,data)=>{if(!res.destroyed&&!res.writableEnded){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));}};
  if(!localAiRequest(req)){send(403,{error:'local_only'});return;}
  if(req.url==='/anatomy-auto/status'&&req.method==='GET'){send(200,{available:available(),experimental:true,structures:60,license:'CC BY-NC 4.0'});return;}
  if(req.url!=='/anatomy-auto/recognize'||req.method!=='POST'){send(404,{error:'not_found'});return;}
  if(!available()){send(503,{error:'model_missing'});return;}
  if(busy){send(429,{error:'busy'});return;}
  busy=true;
  let timeout;
  try{
   const input=await new Promise((resolve,reject)=>{
    let size=0,chunks=[];
    timeout=setTimeout(()=>{reject(Error('read_timeout'));req.destroy();},30000);
    req.on('data',chunk=>{size+=chunk.length;if(size>90*1024*1024){reject(Error('too_large'));req.destroy();}else chunks.push(chunk);});
    req.on('aborted',()=>reject(Error('aborted')));req.on('error',reject);
    req.on('end',()=>{clearTimeout(timeout);try{resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));}catch{reject(Error('invalid_request'));}});
   });
   if(!input||typeof input!=='object'||typeof input.pixels!=='string'||input.pixels.length>89478488)throw Error('invalid_request');
   const result=await Promise.race([infer(input),new Promise((_,reject)=>{timeout=setTimeout(()=>{stop();reject(Error('timeout'));},180000);})]);
   send(result.error?422:200,result);
  }catch(error){send(400,{error:['too_large','timeout'].includes(error.message)?error.message:'inference_failed'});}
  finally{clearTimeout(timeout);busy=false;idle=setTimeout(stop,5*60*1000);idle.unref();}
 }
 return {handle,stop};
}
