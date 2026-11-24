'use client';
import {useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {Send,X} from 'lucide-react';
import {NetworkSettingsLink} from './settings-link';
import {NetworkChoice} from './internet';
import {chooseNetwork,currentNetwork} from './api';
import {networkCall,usePrivateDesktop,can,type NetworkState} from './api';
import './network.css';

function deliveryStatus(state:NetworkState|null,requestId:string|undefined){
 if(!requestId)return '';
 const job=state?.queue?.find(row=>row.id===requestId);
 if(!job)return 'Göndəriş başlayır…';
 if(job.state==='error')return job.error||'Göndəriş alınmadı';
 if(job.state==='cancelled'||job.state==='closed')return 'Göndəriş bağlandı';
 if(job.state==='complete')return 'Çatdırıldı ✓';
 if(!state?.online)return 'Bağlantı gözlənilir · avtomatik davam edəcək';
 const rows=state.sent?.filter(row=>row.transfer===job.remote)||[];
 if(!rows.length)return 'Göndəriş xidmətinə qoşulur…';
 return rows.map(row=>{
  const name=state.members?.find(m=>m.id===row.recipient)?.name||row.recipient;
  const status=row.state==='complete'?'Çatdırıldı ✓':row.state==='accepted'?
   `Ötürülür · ${row.done}/${row.total} görüntü qəbul edilib`:row.state==='paused'?'Dayandırılıb':
   ['cancelled','declined'].includes(row.state)?'Göndəriş bağlandı':'Həkimin cihazının qəbulunu gözləyir';
  return name+' · '+status;
 }).join(' / ');
}

export type StudyForNetwork={uid:string;patient:string;modality:string};
type Stage={onlyUids?:string[];stageId?:string};
type Prepare=(uid:string,status:(message:string)=>void,clinic:string)=>Promise<Stage|void>;
const modes:Record<string,string>={one:'Bir radioloqa',many:'Bir neçə radioloqa',all:'Bütün səlahiyyətli radioloqlara',duty:'Növbətçiyə',auto:'Qaydaya görə',consult:'Əsas radioloq və ikinci rəy'};
export function NetworkSend({studies,busy,prepare,source,aeTitle}:{studies:StudyForNetwork[];busy:boolean;prepare?:Prepare;source:'pacs'|'archive';aeTitle?:string}){
 const [selection,setSelection]=useState<StudyForNetwork[]|null>(null);
 const desktop=usePrivateDesktop();
 if(!desktop)return null;
 return <><button type="button" title="RADAZ-a göndər" aria-label="RADAZ-a göndər" disabled={busy||!studies.length} onClick={()=>setSelection([...studies])}><Send size={16}/><span>RADAZ-a göndər</span></button>
 {selection&&createPortal(<SendDialog studies={selection} prepare={prepare} source={source} aeTitle={aeTitle} close={()=>setSelection(null)}/>,document.body)}</>;
}
function SendDialog({studies,prepare,source,aeTitle,close}:{studies:StudyForNetwork[];prepare?:Prepare;source:string;aeTitle?:string;close:()=>void}){
 const ref=useRef<HTMLDialogElement>(null);
 const [profile,setProfile]=useState(currentNetwork);
 const [clinic,setClinic]=useState(''),[mode,setMode]=useState('one'),[ids,setIds]=useState<string[]>([]),[second,setSecond]=useState('');
 const [state,setState]=useState<NetworkState|null>(null),[pending,setPending]=useState(false),[locked,setLocked]=useState(false),[message,setMessage]=useState(''),[sent,setSent]=useState<string[]>([]);
 const working=useRef(false),requestIds=useRef(new Map<string,string>());
 useEffect(()=>{ref.current?.showModal();},[]);
 useEffect(()=>{let active=true;setState(null);setIds([]);setSecond('');
  networkCall<NetworkState>('state',{clinic}).then(result=>{if(!active)return;if(!clinic&&result.clinics?.length){setClinic(result.clinic||result.clinics[0].id);return;}setState(result);setMessage(result.error||'');}).catch(e=>active&&setMessage(e instanceof Error?e.message:String(e)));return()=>{active=false;};
 },[clinic,profile]);
 useEffect(()=>{
  if(!sent.length)return;
  let live=true,timer:ReturnType<typeof setTimeout>;
  async function refresh(){
   try{const next=await networkCall<NetworkState>('state',{clinic});if(live)setState(next);}
   catch{if(live)setState(old=>old&&({...old,online:false}));}
   finally{if(live)timer=setTimeout(refresh,2500);}
  }
  void refresh();return()=>{live=false;clearTimeout(timer);};
 },[clinic,profile,sent]);
 const members=(state?.members||[]).filter(m=>m.active&&m.permissions.includes('receive'));
 const ready=!!state?.online&&can(state,'send')&&!!clinic&&(!['one','many','consult'].includes(mode)||ids.length>0)&&(mode!=='consult'||!!second&&second!==ids[0]);
 async function send(){if(working.current||!ready)return;working.current=true;setPending(true);
  try{for(const study of studies.filter(s=>!sent.includes(s.uid))){setMessage(study.patient+' · hazırlanır…');const staged=await prepare?.(study.uid,setMessage,clinic);
    const recipients=mode==='consult'?[ids[0],second]:['one','many'].includes(mode)?ids:[];
    const requestId=requestIds.current.get(study.uid)||crypto.randomUUID();requestIds.current.set(study.uid,requestId);setLocked(true);
    await networkCall('send',{...staged,requestId,clinic,mode,recipients,primary:ids[0],consultant:second,study:study.uid,source,aeTitle,modality:study.modality});setSent(prev=>[...prev,study.uid]);
   }setMessage('');}catch(e){setMessage(e instanceof Error?e.message:String(e));}finally{working.current=false;setPending(false);}
 }
 return <dialog ref={ref} className="dn dn-dialog" onCancel={e=>{if(pending)e.preventDefault();else close();}}><header><h2>RADAZ-a göndər</h2><button aria-label="Bağla" onClick={close} disabled={pending}><X size={17}/></button></header>
 <ul className="dn-studies" aria-live="polite">{studies.map(s=><li key={s.uid}>{s.patient} · {s.modality}{sent.includes(s.uid)&&<div>{deliveryStatus(state,requestIds.current.get(s.uid))}</div>}</li>)}</ul>
 <NetworkChoice profile={profile} disabled={pending||locked} onChange={next=>{chooseNetwork(next);setState(null);setClinic('');setIds([]);setProfile(next);}}/>
 <label>Klinika<select value={clinic} disabled={pending||locked} onChange={e=>setClinic(e.target.value)}>{(state?.clinics||[]).map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
 <label>Göndərmə üsulu<select value={mode} disabled={pending||locked} onChange={e=>{setMode(e.target.value);setIds([]);setSecond('');}}>{Object.entries(modes).map(([id,name])=><option key={id} value={id}>{name}</option>)}</select></label>
 {mode==='many'?<fieldset disabled={pending||locked}><legend>Radioloqlar</legend>{members.map(m=><label className="dn-check" key={m.id}><input type="checkbox" checked={ids.includes(m.id)} onChange={e=>setIds(e.target.checked?[...ids,m.id]:ids.filter(v=>v!==m.id))}/>{m.name}</label>)}</fieldset>:['one','consult'].includes(mode)&&<label>{mode==='consult'?'Əsas radioloq':'Radioloq'}<select disabled={pending||locked} value={ids[0]||''} onChange={e=>setIds(e.target.value?[e.target.value]:[])}><option value="">Seçin</option>{members.map(m=><option value={m.id} key={m.id}>{m.name}</option>)}</select></label>}
 {mode==='consult'&&<label>İkinci rəy<select value={second} disabled={pending||locked} onChange={e=>setSecond(e.target.value)}><option value="">Seçin</option>{members.filter(m=>m.id!==ids[0]).map(m=><option key={m.id} value={m.id}>{m.name}</option>)}</select></label>}
 {state&&!state.configured&&<p><NetworkSettingsLink profile={profile}/></p>}
 <footer><span role="status">{message}</span><button disabled={!ready||pending||sent.length===studies.length} onClick={()=>void send()}><Send size={16}/> Göndər</button></footer></dialog>;
}
