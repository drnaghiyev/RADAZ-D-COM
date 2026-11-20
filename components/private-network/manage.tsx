'use client';
import {useState} from 'react';
import {type Act,type NetworkRequest,type NetworkState} from './api';
import {MemberDirectory} from './members';
export function NetworkMembers({state,act,request}:{state:NetworkState;act:Act;request:NetworkRequest}){
 const members=state.members||[],admin=state.membership?.role==='admin'||state.superAdmin;
 return <><MemberDirectory state={state} act={act} request={request}/>
 {admin&&state.clinic&&<article><h3>Klinikanın cihazları</h3>{(state.devices||[]).map(d=><div className="dn-item" key={d.id}><div><strong>{d.name||d.id}</strong><small>{members.find(m=>m.id===d.user)?.name||d.user} · {d.active?'Aktiv':'Deaktiv'}</small></div><button onClick={()=>act('device-set',{clinic:state.clinic,device:d.id,active:!d.active})}>{d.active?'Blokla':'Aktivləşdir'}</button></div>)}</article>}
 {state.superAdmin&&<article><h3>Şəbəkə üzrə bloklama</h3><form onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget),kind=String(f.get('kind'));void act('block_'+kind,{[kind]:f.get('id'),active:f.get('active')==='yes'});}}>
 <label>Obyekt<select name="kind"><option value="user">Hesab</option><option value="device">Cihaz</option></select></label><label>İdentifikator<input name="id" required/></label>
 <label>Əməliyyat<select name="active"><option value="no">Blokla</option><option value="yes">Bloku aç</option></select></label><button>Tətbiq et</button></form></article>}
 {state.superAdmin&&<article><h3>Klinika yarat</h3><form onSubmit={async e=>{e.preventDefault();const form=e.currentTarget,values=Object.fromEntries(new FormData(form));if(await act('create_clinic',values))form.reset();}}>
 <label>Klinikanın adı<input name="name" required/></label><label>Klinika administratorunun hesab ID-si<input name="admin" required/></label><label>Administratorun adı<input name="adminName" required/></label><button>Klinika yarat</button></form></article>}</>;
}
export function NetworkConfig({state,act}:{state:NetworkState;act:Act}){
 const [url,setUrl]=useState(state.url||''),[invite,setInvite]=useState(''),[name,setName]=useState(''),[mode,setMode]=useState(state.acceptMode||'manual'),[perClinic,setPerClinic]=useState(state.clinicModes||{}),[syncClinic,setSyncClinic]=useState(state.syncClinic||'');
 return <>{!state.configured&&<article><h3>Bu noutbukda şəxsi şəbəkə yarat</h3><form onSubmit={e=>{e.preventDefault();void act('local_setup',Object.fromEntries(new FormData(e.currentTarget)));}}><label>Administrator hesab ID-si<input name="user" required/></label><label>Ad və soyad<input name="name" required/></label><button>Yerli xidməti qur</button></form></article>}
 <article><h3>Cihaz və bağlantı</h3>{state.configured&&state.url&&<p>Şəbəkə xidmətinin ünvanı · {state.url}</p>}{state.user?.id&&<p>Hesab ID-si · {state.user.id}</p>}{state.deviceId&&<p>Cihaz ID-si · {state.deviceId}</p>}<form hidden={state.configured} onSubmit={async e=>{e.preventDefault();if(await act('register',{url,invite,name})){setInvite('');}}}>
 <label>Şəbəkə xidmətinin ünvanı<input type="url" required value={url} placeholder="https://…" onChange={e=>setUrl(e.target.value)}/></label><label>Cihazın adı<input value={name} required onChange={e=>setName(e.target.value)}/></label>
 <label>Birdəfəlik dəvət kodu<input required autoComplete="off" type="password" value={invite} onChange={e=>setInvite(e.target.value)}/></label><button>Qeydiyyata al</button></form>
 {state.configured&&!state.superAdmin&&<form onSubmit={async e=>{e.preventDefault();if(await act('link_clinic',{invite}))setInvite('');}}><label>Başqa klinikaya qoşulmaq üçün dəvət kodu<input type="password" required autoComplete="off" value={invite} onChange={e=>setInvite(e.target.value)}/></label><button>Klinikaya qoşul</button></form>}
 {state.configured&&<button onClick={()=>act('configure',{enabled:!state.enabled})}>{state.enabled?'Bu cihazda modulu dayandır':'Bu cihazda modulu aktivləşdir'}</button>}</article>
 {state.configured&&<article><h3>Qəbul ayarları</h3><form onSubmit={e=>{e.preventDefault();void act('configure',{enabled:state.enabled,acceptMode:mode,clinicModes:perClinic,syncClinic});}}>
 <label>Standart qəbul rejimi<select value={mode} onChange={e=>setMode(e.target.value)}><option value="manual">Əl ilə təsdiq</option><option value="auto">Avtomatik qəbul</option></select></label>
 {(state.clinics||[]).map(c=><label key={c.id}>{c.name}<select value={perClinic[c.id]||''} onChange={e=>{const next={...perClinic};if(e.target.value)next[c.id]=e.target.value;else delete next[c.id];setPerClinic(next);}}><option value="">Standart rejim</option><option value="manual">Əl ilə təsdiq</option><option value="auto">Avtomatik qəbul</option></select></label>)}
 <label>Bu cihazdan avtomatik göndəriş üçün klinika<select value={syncClinic} onChange={e=>setSyncClinic(e.target.value)}><option value="">Dayandırılıb</option>{(state.clinics||[]).map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
 <button>Saxla</button></form></article>}</>;
}
