'use client';
import {useCallback,useContext,useEffect,useRef,useState} from 'react';
import {Network,Inbox,Send,Users,CalendarDays,Workflow,Settings,History,RefreshCw} from 'lucide-react';
import {networkCall,usePrivateDesktop,can,type NetworkState,type Delivery} from '@/components/private-network/api';
import {NetworkPreview} from '@/components/private-network/preview';
import {NetworkConfig,NetworkMembers} from '@/components/private-network/manage';
import {NetworkPolicy} from '@/components/private-network/policy';
import {NetworkSettingsLink} from '@/components/private-network/settings-link';
import {NetworkSettingsAccess,NetworkSettingsContext} from '@/components/private-network/settings-access';
import {openStudyInViewer} from '@/lib/viewer-session';
import '@/components/private-network/network.css';
const connection=['settings','Bağlantı və qəbul ayarları',Settings] as const;
const management=[
 ['people','Klinikalar və radioloqlar',Users],['schedule','Növbə cədvəli',CalendarDays],['rules','Avtomatik göndərmə',Workflow],
] as const;
const configurationSections=[connection,...management] as const;
const sections=[['inbox','Mənə göndərilənlər',Inbox],['sent','Göndərilənlər',Send],...management,connection,['history','Ötürmə tarixçəsi',History]] as const;
type Section=typeof sections[number][0];
const statuses:Record<string,string>={queued:'Növbədə',offered:'Qəbul gözlənilir',pending:'Gözləyir',accepted:'Qəbul edilib',sending:'Göndərilir',transferring:'Ötürülür',paused:'Dayandırılıb',cancelled:'Ləğv edilib',completed:'Tamamlanıb',delivered:'Çatdırılıb',complete:'Tamamlanıb',ready:'Hazır',error:'Xəta'};
function Transfers({rows,inbox,state,act}:{rows:Delivery[];inbox:boolean;state:NetworkState;act:(action:string,payload:Record<string,unknown>)=>Promise<boolean>}){
 const [preview,setPreview]=useState('');
 const [forward,setForward]=useState(''),[to,setTo]=useState('');
 if(!rows.length)return <p>{inbox?'Qəbul gözləyən göndəriş yoxdur.':'Göndəriş yoxdur.'}</p>;
 return <div>{rows.map(row=>{const status=row.status||row.state,finished=['completed','complete','delivered'].includes(status),closed=finished||status==='cancelled',who=inbox?row.sender:row.recipient;
 return <article key={row.id}><header><div><strong>{state.members?.find(m=>m.id===who)?.name||who}</strong><small>{row.study}{row.kind==='primary'?' · Əsas radioloq':row.kind==='consultant'?' · İkinci rəy':''}</small></div><span>{statuses[status]||status}</span></header>
 {row.total>0&&<div className="dn-progress"><progress value={row.done} max={row.total}/><span>{row.done}/{row.total} · {Math.round(row.done/row.total*100)}%</span></div>}
 {preview===row.id&&<NetworkPreview delivery={row} clinic={state.clinic||''} close={()=>setPreview('')}/>}
 <div className="dn-row">{inbox?<>{!can(state,'download')&&can(state,'receive')&&status!=='cancelled'&&<button onClick={()=>setPreview(row.id)}>Ön baxış</button>}{!closed&&['pending','offered','queued','waiting'].includes(status)&&can(state,'download')&&<button onClick={()=>act('accept',{clinic:state.clinic,delivery:row.id})}>Arxivə qəbul et</button>}
 {finished&&can(state,'download')&&<button onClick={()=>void openStudyInViewer(row.study)}>Viewer-də aç</button>}
 {finished&&can(state,'forward')&&<button onClick={()=>{setForward(row.id);setTo('');}}>Yönləndir</button>}</>:!closed&&<>
 <button onClick={()=>act('control',{clinic:state.clinic,delivery:row.id,action:status==='paused'?'resume':'pause'})}>{status==='paused'?'Davam et':'Dayandır'}</button>
 <button onClick={()=>act('control',{clinic:state.clinic,delivery:row.id,action:'cancel'})}>Ləğv et</button></>}</div>
 {forward===row.id&&<form onSubmit={async e=>{e.preventDefault();if(await act('send',{study:row.study,clinic:state.clinic,mode:'one',forwardOf:row.id,recipients:[to]}))setForward('');}}><label>Radioloq<select required value={to} onChange={e=>setTo(e.target.value)}><option value="">Seçin</option>{(state.members||[]).filter(m=>m.active&&m.permissions.includes('receive')&&m.id!==state.user?.id).map(m=><option key={m.id} value={m.id}>{m.name}</option>)}</select></label><button>Göndər</button></form>}</article>;})}</div>;
}
export function NetworkWorkspace({settings=false}:{settings?:boolean}){
 const title=settings?'DICOM Network ayarları':'DICOM Network';
 const desktop=usePrivateDesktop(),[section,setSection]=useState<Section>(settings?'settings':'inbox'),[clinic,setClinic]=useState('');
 useEffect(()=>{document.title=title+' · RADAZ';},[title]);
 if(!desktop)return <main className="dn dn-page"><h1>{title}</h1><p>Windows RADAZ Desktop proqramında açın.</p></main>;
 const shared={title,settings,section,setSection,clinic,setClinic};
 if(settings||configurationSections.some(([id])=>section===id)){
   return <NetworkSettingsAccess back={settings?undefined:()=>setSection('inbox')}><NetworkPanel {...shared}/></NetworkSettingsAccess>;
 }
 return <NetworkPanel {...shared}/>;
}
function NetworkPanel({title,settings,section,setSection,clinic,setClinic}:{
 title:string;settings:boolean;section:Section;setSection:(value:Section)=>void;clinic:string;setClinic:(value:string)=>void;
}){
 const access=useContext(NetworkSettingsContext),request=access?.request??networkCall,controls=access?.controls,stateAction=access?'settings_state':'state';
 const [state,setState]=useState<NetworkState|null>(null),[message,setMessage]=useState(''),[busy,setBusy]=useState(false);
 const [loadError,setLoadError]=useState('');
 const sequence=useRef({id:0}),mutating=useRef(false);
 const refresh=useCallback(async()=>{const id=++sequence.current.id;try{const data=await request<NetworkState>(stateAction,{clinic});if(sequence.current.id!==id)return;setState(data);setLoadError('');
   if(!clinic&&data.clinics?.length){const requested=new URLSearchParams(location.search).get('clinic');setClinic(data.clinics.find(c=>c.id===requested)?.id||data.clinic||data.clinics[0].id);}
   if(!data.configured&&stateAction==='settings_state')setSection('settings');
  }catch(e){if(sequence.current.id===id){setState(null);setLoadError(e instanceof Error?e.message:String(e));}}
 },[clinic,request,setClinic,setSection,stateAction]);
 useEffect(()=>{
   const current=sequence.current;
   const initial=window.setTimeout(()=>void refresh(),0);
   const timer=window.setInterval(()=>{if(!mutating.current)void refresh();},7000);
   return ()=>{window.clearTimeout(initial);window.clearInterval(timer);++current.id;};
 },[refresh]);
 async function act(action:string,payload:Record<string,unknown>){if(mutating.current)return false;mutating.current=true;setBusy(true);setMessage('');try{await request(action,payload);await refresh();setMessage('Əməliyyat tamamlandı.');return true;}catch(e){setMessage(e instanceof Error?e.message:String(e));return false;}finally{setBusy(false);mutating.current=false;}}
 return <main className="dn dn-page"><header className="dn-top"><div><Network size={25}/><h1>{title}</h1></div>{state&&<span role="status" className={state.online?'dn-online':''}>{state.online?'Qoşulub':state.enabled?'Əlaqə yoxdur':'Deaktiv'}</span>}{!settings&&<NetworkSettingsLink clinic={clinic}/>}{controls}<button onClick={()=>void refresh()} aria-label="Yenilə"><RefreshCw size={17}/></button></header>
 <div className="dn-layout"><aside><label>Klinika<select value={clinic} disabled={busy} onChange={e=>{++sequence.current.id;setClinic(e.target.value);setState(null);setMessage('');}}>{!clinic&&<option value="">Seçin</option>}{(state?.clinics||[]).map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
 <nav aria-label={title}>{(settings?configurationSections:sections).map(([id,label,Icon])=><button key={id} disabled={settings&&id!=='settings'&&!state?.configured} aria-current={section===id?'page':undefined} onClick={()=>{setSection(id);setMessage('');}}><Icon size={17}/>{label}</button>)}</nav></aside>
 <section className="dn-body"><h2>{sections.find(s=>s[0]===section)?.[1]}</h2>{(loadError||state?.error)&&<p role="alert">{loadError||state?.error}</p>}{message&&<p role="status">{message}</p>}
 {state?<fieldset disabled={busy} key={state.clinic||'-'} className="dn-fields">
 {section==='settings'&&<NetworkConfig key={String(state.configured)+String(state.enabled)} state={state} act={act}/>}
 {section==='people'&&<NetworkMembers state={state} act={act} request={request}/>}
 {(section==='schedule'||section==='rules')&&<NetworkPolicy key={section} state={state} section={section} act={act}/>}
 {section==='sent'&&!!state.queue?.some(job=>['queued','paused','error'].includes(job.state))&&<article><h3>Lokal növbə</h3>{state.queue.filter(job=>['queued','paused','error'].includes(job.state)).map(job=><div className="dn-item" key={job.id}><div><strong>{statuses[job.state]||job.state}</strong><small>{job.study} {job.error}</small></div><div className="dn-row"><button onClick={()=>act('control',{job:job.id,action:job.state==='queued'?'pause':'resume'})}>{job.state==='queued'?'Dayandır':'Davam et'}</button><button onClick={()=>act('control',{job:job.id,action:'cancel'})}>Ləğv et</button></div></div>)}</article>}
 {(section==='inbox'||section==='sent')&&<Transfers rows={(section==='inbox'?state.deliveries:state.sent)||[]} inbox={section==='inbox'} state={state} act={act}/>}
 {section==='history'&&!!state.statuses?.length&&<article><h3>Klinika üzrə göndərişlər</h3><table><thead><tr><th>Göndərən</th><th>Qəbul edən</th><th>Vəziyyət</th></tr></thead><tbody>{state.statuses.map(s=><tr key={s.id}><td>{s.sender}</td><td>{s.recipient}</td><td>{statuses[s.state]||s.state}
 {state.membership?.role==='coordinator'&&can(state,'forward')&&can(state,'view_status')&&s.state==='queued'&&<form onSubmit={e=>{e.preventDefault();void act('reassign',{clinic:state.clinic,delivery:s.id,recipient:String(new FormData(e.currentTarget).get('recipient'))});}}>
 <label>Yeni radioloq<select name="recipient" defaultValue="" required><option value="">Seçin</option>{(state.members||[]).filter(m=>m.id!==s.recipient&&m.active&&m.permissions.includes('receive')).map(m=><option key={m.id} value={m.id}>{m.name}</option>)}</select></label><button>Bölüşdür</button></form>}</td></tr>)}</tbody></table></article>}
 {section==='history'&&(state.history?.length?<table><thead><tr><th>Vaxt</th><th>İstifadəçi</th><th>Əməliyyat</th></tr></thead><tbody>{state.history.map((h,i)=><tr key={i}><td>{new Date(typeof h.time==='number'&&h.time<1e12?h.time*1000:h.time).toLocaleString('az-AZ')}</td><td>{h.actor}</td><td>{h.action}</td></tr>)}</tbody></table>:<p>Ötürmə tarixçəsi boşdur.</p>)}</fieldset>:!loadError&&<p>Bağlantı yoxlanılır…</p>}</section></div></main>;
}
