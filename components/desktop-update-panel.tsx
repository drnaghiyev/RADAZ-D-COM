'use client';
import {useEffect,useRef,useState} from 'react';
import {activatedBuild,reloadBuild,reportUpdateDiagnostic,type InstallationState as State} from '@/lib/update-activation';
export function DesktopUpdatePanel({fallback,onCheck,busy}:{fallback:React.ReactNode;onCheck:()=>void;busy:boolean}){
 const [state,setState]=useState<State|null>(null),[starting,setStarting]=useState(false),[error,setError]=useState('');
 const managed=useRef(false),restartInProgress=useRef(false);
 const [applying,setApplying]=useState(false);
 useEffect(()=>{
  let alive=true,timer:ReturnType<typeof setTimeout>;
  const poll=async()=>{
   try{const response=await fetch('/radaz-installation.json',{cache:'no-store'});if(!response.ok)throw Error('status');const value=await response.json() as State;reportUpdateDiagnostic(value);if(alive){managed.current=!!value.managed;if(!restartInProgress.current)setState(value);}}
   catch{if(alive&&managed.current&&!restartInProgress.current)setError('Yeniləmə xidməti ilə əlaqə kəsildi. Yenidən cəhd edin.');}
   finally{if(alive)timer=setTimeout(poll,750);}
  };void poll();return()=>{alive=false;clearTimeout(timer);};
 },[]);
 const active=!!state&&['checking','downloading','verifying','installing','activating','rolling-back'].includes(state.state);
 const start=async(version?:string)=>{
  if(!state?.managed){onCheck();return;}
  setStarting(true);setError('');
  try{const response=await fetch('/radaz-update',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(version?{action:'download',version,confirmed:true}:{action:'check'})});
   if(!response.ok)throw Error('Yeniləmə başladılmadı. RADAZ-ı iş masasındakı qısayoldan başladın.');
   setState({...state,state:'checking',message:version?'Yeniləmə avtomatik yüklənib hazırlanır…':'Yeniləmələr yoxlanılır…',progress:null});
  }catch(cause){setError(cause instanceof Error?cause.message:String(cause));}finally{setStarting(false);}
 };
 const apply=async()=>{
  if(!state?.version)return;restartInProgress.current=true;setApplying(true);setError('');
  try{
   const target=state.version,response=await fetch('/radaz-update',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'apply',version:target,confirmed:true})});
   if(!response.ok)throw Error('Yenidən başlatma qəbul edilmədi. Yenilənmələri yenidən yoxlayın.');
   for(let i=0;i<240;i++){
    await new Promise(r=>setTimeout(r,1000));
    try{const buildId=await activatedBuild(target);if(buildId){const channel=new BroadcastChannel('radaz-update-applied');channel.postMessage({version:target});channel.close();reloadBuild(buildId);return;}
    }catch(cause){if((cause as {terminal?:boolean}).terminal)throw cause;}
   }
   throw Error('Açılış təsdiqlənmədi. RADAZ qısayolunu açın; əvvəlki versiya qorunur.');
  }catch(cause){console.error('[RADAZ update: apply]',cause);restartInProgress.current=false;setError(cause instanceof Error?cause.message:String(cause));setApplying(false);}
 };
 const done=state?.progress?.done||(state?.state==='ready'?1:0),total=state?.progress?.total||(state?.state==='ready'?1:0);
 const success=state?.state==='ready'||state?.state==='current';
 return <>
  {state?.managed?<div className="desktop-update-progress" data-state={state.state}>
   <p role={state.state==='error'?'alert':'status'}>{state.message}</p>
   {(active||state.state==='ready')&&<><progress aria-label="Yenilənmə prosesi" max={total||1} value={total?Math.min(done,total):undefined}/>
    <span>{total?`${Math.round(done/total*100)}%`:'Hazırlanır…'}{state.progress?.unit==='bayt'&&total>0?` · ${(done/1048576).toFixed(1)} / ${(total/1048576).toFixed(1)} MB`:''}</span></>}
   {success&&<p className="update-confirmation">{state.state==='ready'?'Endirmə tamamlandı. Yeni versiyanı tətbiq etmək üçün yenidən başladın.':'RADAZ yenilənmə vəziyyəti təsdiqləndi.'}</p>}
  </div>:fallback}
  {error&&<p role="alert">{error}</p>}
  <p className="product-note">“Yenilə” yeni versiyanı avtomatik yükləyib hazırlayır. Hazır olduqda “Proqramı yenidən aç” düyməsini basın. Lokal arxiv saxlanılır.</p>
  {state?.managed&&['ready','deferred'].includes(state.state)&&<div className="update-approval">
   <p>İşinizi bitirdikdən sonra proqramı yenidən açın.</p>
   <button disabled={applying||starting} onClick={()=>void apply()}>{applying?'RADAZ yenidən başlayır…':'Proqramı yenidən aç'}</button>
  </div>}
  {!(state?.managed&&['ready','deferred'].includes(state.state))&&<button disabled={starting||active||busy||applying} onClick={()=>void start(state?.state==='available'?state.version:undefined)}>
   {starting||active?'Hazırlanır…':state?.state==='available'?'Yenilə':'Yeniləmələri yoxla'}
  </button>}
 </>;
}
