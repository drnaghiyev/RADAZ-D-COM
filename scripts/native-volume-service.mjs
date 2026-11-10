// Optional local experiment. Never enabled by a public build or remote request.
import path from 'node:path';
import {existsSync} from 'node:fs';
import {spawn} from 'node:child_process';
import {localAiRequest} from './local-ai-request.mjs';

export function nativeVolumeService(root,{env=process.env,launch=spawn}={}) {
 const python=env.RADAZ_NATIVE_PYTHON,archive=env.RADAZ_NATIVE_ARCHIVE;
 const script=path.join(root,'bridge/native_volume_app.py');
 const available=()=>!!(python&&archive&&existsSync(python)&&existsSync(script)&&existsSync(path.join(archive,'archive.sqlite3')));
 let child=null;
 const send=(res,status,body)=>{if(!res.writableEnded&&!res.destroyed){res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(body));}};
 async function handle(req,res){
  if(!localAiRequest(req)){send(res,403,{error:'Bu əməliyyat yalnız lokal RADAZ-da mümkündür.'});return;}
  const route=new URL(req.url,'http://localhost').pathname;
  if(route==='/native-volume-api/status'&&req.method==='GET'){send(res,200,{available:available(),busy:!!child});return;}
  if(route!=='/native-volume-api/open'||req.method!=='POST'){send(res,404,{error:'route'});return;}
  if(!available()){send(res,503,{error:'Native 3D lokal sınaq modulu hazır deyil.'});return;}
  if(child){send(res,409,{error:'Native 3D pəncərəsi artıq açıqdır. Yeni seriya üçün onu bağlayın.'});return;}
  let text='';try{for await(const chunk of req){text+=chunk;if(text.length>2048){send(res,413,{error:'Sorğu çox böyükdür.'});return;}}}catch{send(res,400,{error:'Sorğu tamamlanmadı.'});return;}
  let body;try{body=JSON.parse(text);}catch{send(res,400,{error:'Yanlış sorğu.'});return;}
  if(!body||typeof body!=='object'||Array.isArray(body)||typeof body.seriesUID!=='string'||body.seriesUID.length>64||!/^\d+(?:\.\d+)+$/.test(body.seriesUID)||
     !['bone','organ','abdomen-color','brain','vessel','angio','soft','lung','airway','skin','transparent','mip','minip','mr'].includes(body.preset||'bone')){send(res,400,{error:'Seriya və ya preset düzgün deyil.'});return;}
  // Another upload may have finished while this request body was arriving.
  if(child){send(res,409,{error:'Native 3D pəncərəsi artıq açıqdır.'});return;}
  try{
   const processChild=launch(python,['-B',script,'--archive-root',archive,'--series',body.seriesUID,'--preset',body.preset||'bone'],{cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...env,PYTHONIOENCODING:'utf-8'}});
   child=processChild;let output='',ready=false;
   const timer=setTimeout(()=>{if(!ready){processChild.kill();send(res,504,{error:'Native 3D vaxtında açılmadı. Veb 3D-dən istifadə edə bilərsiniz.'});}},120000);
   processChild.stdout.on('data',chunk=>{
    output=(output+chunk).slice(-1024);
    if(output.includes('RADAZ_NATIVE_ERROR:')){
     clearTimeout(timer);
     send(res,422,{error:output.includes('RADAZ_NATIVE_ERROR:memory')?'Bu həcm üçün hazırda kifayət qədər boş yaddaş yoxdur. Digər 3D pəncərələrini bağlayıb yenidən yoxlayın.':'Seriya disk arxivində tapılmadı və ya native 3D üçün uyğun deyil. Mövcud veb 3D-dən istifadə edə bilərsiniz.'});return;
    }
    if(!ready&&output.includes('RADAZ_NATIVE_READY')){ready=true;clearTimeout(timer);send(res,200,{opened:true});}
   });
   // Do not expose Python paths or patient identifiers in a browser error.
   processChild.stderr.on('data',()=>{});
   processChild.on('error',()=>{clearTimeout(timer);if(child===processChild)child=null;send(res,503,{error:'Native 3D başlatmaq mümkün olmadı.'});});
   processChild.on('exit',()=>{clearTimeout(timer);if(child===processChild)child=null;if(!ready)send(res,422,{error:'Seriya disk arxivində tapılmadı və ya 3D həcm üçün uyğun deyil. Əvvəl lokal arxivə tam idxal edin.'});});
  }catch{child=null;send(res,503,{error:'Native 3D başlatmaq mümkün olmadı.'});}
 }
 return {handle,stop(){child?.kill();child=null;}};
}
