import http from 'node:http';
import path from 'node:path';
import {existsSync} from 'node:fs';
import {spawn} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {createInterface} from 'node:readline';
import {localAiRequest} from './local-ai-request.mjs';

export function smartVolumeService(root,installRoot,{env=process.env}={}) {
 const moduleRoot=env.RADAZ_SMART_VOLUME_ROOT||path.join(installRoot||path.join(env.LOCALAPPDATA||root,'RADAZ'),'local-modules','smart-volume');
 const python=path.join(moduleRoot,'python','python.exe');
 const token=randomBytes(32).toString('hex');
 let child=null,installer=null,port=null,starting=null,closing=false,setup={state:'idle',message:''};
 const installed=()=>existsSync(python)&&existsSync(path.join(moduleRoot,'ready.json'));
 function send(res,code,value){if(!res.destroyed&&!res.writableEnded){res.writeHead(code,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(value));}}
 async function start(){
  if(port)return;
  if(starting)return starting;
  if(!installed())throw Error('MedSAM2 qurulmayıb. Ayarlar → Smart Volume bölməsindən tədqiqat modulunu quraşdırın.');
  starting=new Promise((resolve,reject)=>{
   const processChild=spawn(python,['-B',path.join(root,'bridge/smart_volume_service.py')],{windowsHide:true,stdio:['ignore','pipe','pipe'],cwd:root,env:{...env,PYTHONDONTWRITEBYTECODE:'1',RADAZ_SMART_VOLUME_ROOT:moduleRoot,RADAZ_SMART_VOLUME_TOKEN:token,RADAZ_SMART_VOLUME_PORT:'0'}});
   child=processChild;let errorText='';
   const timer=setTimeout(()=>{processChild.kill();reject(Error('MedSAM2 başlama vaxtı bitdi'));},60000);
   processChild.stderr.on('data',chunk=>{errorText=(errorText+chunk).slice(-1500);});
   createInterface({input:processChild.stdout}).on('line',line=>{if(line.startsWith('RADAZ_SMART_PORT:')){const value=Number(line.split(':')[1]);if(Number.isInteger(value)&&value>0&&value<65536){port=value;clearTimeout(timer);resolve();}}});
   processChild.on('error',error=>{clearTimeout(timer);reject(error);});
   processChild.on('exit',()=>{clearTimeout(timer);if(child===processChild){child=null;port=null;starting=null;}reject(Error(errorText||'MedSAM2 dayandı'));});
  });
  try{await starting;}catch(error){starting=null;throw error;}
 }
 async function handle(req,res){
  const gate=req.method==='DELETE'?{socket:req.socket,method:'POST',headers:{...req.headers,'content-type':'application/json'}}:req;
  if(!localAiRequest(gate,['application/json','application/octet-stream'])){send(res,403,{error:'local_only'});return;}
  const pathname=new URL(req.url,'http://localhost').pathname;
  if(pathname==='/smart-volume-api/setup'&&req.method==='GET'){send(res,200,{...setup,installed:installed(),researchOnly:true});return;}
  if(pathname==='/smart-volume-api/setup'&&req.method==='POST'){
   if(installer||child){send(res,409,{error:'MedSAM2 işləyir və ya quraşdırılır'});return;}
   let body='';for await(const chunk of req){body+=chunk;if(body.length>1024){send(res,413,{error:'body'});return;}}
   let accepted=false;try{accepted=JSON.parse(body).researchAccepted===true;}catch{}
   if(!accepted){send(res,400,{error:'Tədqiqat və təhsil şərtləri qəbul edilməlidir'});return;}
   const bootstrap=path.join(root,'runtime/python/python.exe');
   if(!existsSync(bootstrap)){send(res,503,{error:'Modul quraşdırılması Windows Setup versiyasında mövcuddur'});return;}
   setup={state:'installing',message:'MedSAM2 quraşdırılır…'};
   installer=spawn(bootstrap,['-B',path.join(root,'scripts/install-smart-volume.py'),'--module-root',moduleRoot,'--research-accepted'],{windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...env,PYTHONIOENCODING:'utf-8'}});
   let lastError='';installer.stderr.on('data',chunk=>{lastError=(lastError+chunk).slice(-1500);});
   createInterface({input:installer.stdout}).on('line',line=>{setup.message=line.slice(0,300);});
   installer.on('error',error=>{setup={state:'error',message:error.message};installer=null;});
   installer.on('exit',code=>{setup=code===0?{state:'ready',message:'MedSAM2 hazırdır'}:{state:'error',message:lastError||'Quraşdırma tamamlanmadı. Yenidən cəhd edin.'};installer=null;});
   send(res,202,setup);return;
  }
  if(!/^\/smart-volume-api\/(health|jobs(?:\/[a-f0-9-]{36}(?:\/mask)?)?)$/.test(pathname)||!['GET','POST','DELETE'].includes(req.method)){send(res,404,{error:'route'});return;}
  try{
   await start();if(closing)throw Error('RADAZ bağlanır');
   // Wait for the owned service to finish binding; never use another process's port.
   for(let i=0;i<40;i++){try{const r=await fetch(`http://127.0.0.1:${port}/health`,{headers:{'x-radaz-local-token':token},signal:AbortSignal.timeout(1000)});if(r.ok)break;if(i===39)throw Error('MedSAM2 hazır deyil');}catch(error){if(i===39)throw error;}await new Promise(r=>setTimeout(r,100));}
   const upstream=http.request({hostname:'127.0.0.1',port,path:req.url.slice('/smart-volume-api'.length),method:req.method,headers:{'content-type':req.headers['content-type']||'application/json','x-radaz-local-token':token}},reply=>{res.writeHead(reply.statusCode,{...reply.headers,'cache-control':'no-store'});reply.pipe(res);});
   upstream.on('error',()=>send(res,503,{error:'MedSAM2 lokal servisi dayandı'}));req.on('aborted',()=>upstream.destroy());res.on('close',()=>{if(!res.writableEnded)upstream.destroy();});req.pipe(upstream);
  }catch(error){send(res,503,{error:error.message});}
 }
 return {handle,stop(){closing=true;child?.kill();/* Allow explicit module installation to finish safely across viewer restart. */}};
}
