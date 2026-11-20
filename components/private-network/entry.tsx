'use client';
import {useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {Send,X} from 'lucide-react';
import {networkCall,usePrivateDesktop,can,type NetworkState} from './api';
import './network.css';

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
 const [clinic,setClinic]=useState(''),[mode,setMode]=useState('one'),[ids,setIds]=useState<string[]>([]),[second,setSecond]=useState('');
 const [state,setState]=useState<NetworkState|null>(null),[pending,setPending]=useState(false),[locked,setLocked]=useState(false),[message,setMessage]=useState(''),[sent,setSent]=useState<string[]>([]);
 const working=useRef(false),requestIds=useRef(new Map<string,string>());
 useEffect(()=>{ref.current?.showModal();},[]);
 useEffect(()=>{let active=true;setState(null);setIds([]);setSecond('');
  networkCall<NetworkState>('state',{clinic}).then(result=>{if(!active)return;if(!clinic&&result.clinics?.length){setClinic(result.clinic||result.clinics[0].id);return;}setState(result);setMessage(result.error||'');}).catch(e=>active&&setMessage(String(e)));return()=>{active=false;};
 },[clinic]);
 const members=(state?.members||[]).filter(m=>m.active&&m.permissions.includes('receive'));
 const ready=!!state?.online&&can(state,'send')&&!!clinic&&(!['one','many','consult'].includes(mode)||ids.length>0)&&(mode!=='consult'||!!second&&second!==ids[0]);
 async function send(){if(working.current||!ready)return;working.current=true;setPending(true);
  try{for(const study of studies.filter(s=>!sent.includes(s.uid))){setMessage(study.patient+' · hazırlanır…');const staged=await prepare?.(study.uid,setMessage,clinic);
    const recipients=mode==='consult'?[ids[0],second]:['one','many'].includes(mode)?ids:[];
    const requestId=requestIds.current.get(study.uid)||crypto.randomUUID();requestIds.current.set(study.uid,requestId);setLocked(true);
    await networkCall('send',{...staged,requestId,clinic,mode,recipients,primary:ids[0],consultant:second,study:study.uid,source,aeTitle,modality:study.modality});setSent(prev=>[...prev,study.uid]);
   }setMessage('Göndərişlər növbəyə əlavə edildi.');}catch(e){setMessage(e instanceof Error?e.message:String(e));}finally{working.current=false;setPending(false);}
 }
 return <dialog ref={ref} className="dn dn-dialog" onCancel={e=>{if(pending)e.preventDefault();else close();}}><header><h2>RADAZ-a göndər</h2><button aria-label="Bağla" onClick={close} disabled={pending}><X size={17}/></button></header>
 <ul className="dn-studies">{studies.map(s=><li key={s.uid}>{s.patient} · {s.modality}{sent.includes(s.uid)?' ✓':''}</li>)}</ul>
 <label>Klinika<select value={clinic} disabled={pending||locked} onChange={e=>setClinic(e.target.value)}>{(state?.clinics||[]).map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
 <label>Göndərmə üsulu<select value={mode} disabled={pending||locked} onChange={e=>{setMode(e.target.value);setIds([]);setSecond('');}}>{Object.entries(modes).map(([id,name])=><option key={id} value={id}>{name}</option>)}</select></label>
 {mode==='many'?<fieldset disabled={pending||locked}><legend>Radioloqlar</legend>{members.map(m=><label className="dn-check" key={m.id}><input type="checkbox" checked={ids.includes(m.id)} onChange={e=>setIds(e.target.checked?[...ids,m.id]:ids.filter(v=>v!==m.id))}/>{m.name}</label>)}</fieldset>:['one','consult'].includes(mode)&&<label>{mode==='consult'?'Əsas radioloq':'Radioloq'}<select disabled={pending||locked} value={ids[0]||''} onChange={e=>setIds(e.target.value?[e.target.value]:[])}><option value="">Seçin</option>{members.map(m=><option value={m.id} key={m.id}>{m.name}</option>)}</select></label>}
 {mode==='consult'&&<label>İkinci rəy<select value={second} disabled={pending||locked} onChange={e=>setSecond(e.target.value)}><option value="">Seçin</option>{members.filter(m=>m.id!==ids[0]).map(m=><option key={m.id} value={m.id}>{m.name}</option>)}</select></label>}
 {state&&!state.configured&&<p>Cihazı <a href="/private-network" target="radaz-private-network">DICOM Network ayarlarında</a> qoşun.</p>}
 <footer><span role="status">{message}</span><button disabled={!ready||pending||sent.length===studies.length} onClick={()=>void send()}><Send size={16}/> Göndər</button></footer></dialog>;
}
