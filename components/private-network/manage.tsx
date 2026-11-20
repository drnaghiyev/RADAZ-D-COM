'use client';
import {useState} from 'react';
import {networkCall,permissions,roles,type Act,type Member,type NetworkState} from './api';
export function NetworkMembers({state,act}:{state:NetworkState;act:Act}){
 const [chosen,setChosen]=useState(''),[invite,setInvite]=useState(''),[message,setMessage]=useState('');
 const members=state.members||[],admin=state.membership?.role==='admin'||state.superAdmin;
 const selected=members.find(m=>m.id===chosen);
 return <><article><h3>Radioloqlar və əməkdaşlar</h3>{members.length?<table><thead><tr><th>Ad</th><th>Rol</th><th>Vəziyyət</th></tr></thead><tbody>{members.map(m=><tr key={m.id}><td>{m.name}</td><td>{roles[m.role]||m.role}</td><td>{m.active?'Aktiv':'Deaktiv'}</td></tr>)}</tbody></table>:<p>Üzv siyahısı boşdur.</p>}</article>
 {admin&&state.clinic&&<article><h3>Üzvlük və icazələr</h3><label>Əməkdaş<select value={chosen} onChange={e=>{setChosen(e.target.value);setInvite('');setMessage('');}}><option value="">Yeni əməkdaş</option>{members.map(m=><option key={m.id} value={m.id}>{m.name}</option>)}</select></label>
 <MemberEditor key={chosen} member={selected} canAssignAdmin={!!state.superAdmin} save={m=>act('member',{clinic:state.clinic,user:m.id,name:m.name,role:m.role,active:m.active,permissions:m.permissions})}/>
 {selected?.active&&<button onClick={async()=>{try{const data=await networkCall<{invite:string}>('invite',{clinic:state.clinic,user:selected.id});setInvite(data.invite);setMessage('');}catch(e){setMessage(String(e));}}}>Cihaz üçün birdəfəlik dəvət kodu yarat</button>}
 {invite&&<label>Dəvət kodu<input readOnly value={invite}/></label>}<output>{message}</output></article>}
 {admin&&state.clinic&&<article><h3>Klinikanın cihazları</h3>{(state.devices||[]).map(d=><div className="dn-item" key={d.id}><div><strong>{d.name||d.id}</strong><small>{members.find(m=>m.id===d.user)?.name||d.user} · {d.active?'Aktiv':'Deaktiv'}</small></div><button onClick={()=>act('device-set',{clinic:state.clinic,device:d.id,active:!d.active})}>{d.active?'Blokla':'Aktivləşdir'}</button></div>)}</article>}
 {state.superAdmin&&<article><h3>Şəbəkə üzrə bloklama</h3><form onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget),kind=String(f.get('kind'));void act('block_'+kind,{[kind]:f.get('id'),active:f.get('active')==='yes'});}}>
 <label>Obyekt<select name="kind"><option value="user">Hesab</option><option value="device">Cihaz</option></select></label><label>İdentifikator<input name="id" required/></label>
 <label>Əməliyyat<select name="active"><option value="no">Blokla</option><option value="yes">Bloku aç</option></select></label><button>Tətbiq et</button></form></article>}
 {state.superAdmin&&<article><h3>Klinika yarat</h3><form onSubmit={async e=>{e.preventDefault();const form=e.currentTarget,values=Object.fromEntries(new FormData(form));if(await act('create_clinic',values))form.reset();}}>
 <label>Klinikanın adı<input name="name" required/></label><label>Klinika administratorunun hesab ID-si<input name="admin" required/></label><label>Administratorun adı<input name="adminName" required/></label><button>Klinika yarat</button></form></article>}</>;
}
function MemberEditor({member,canAssignAdmin,save}:{member?:Member;canAssignAdmin:boolean;save:(m:Member)=>Promise<boolean>}){
 const [value,setValue]=useState<Member>(member||{id:'',name:'',role:'radiologist',active:true,permissions:[]});
 return <form onSubmit={e=>{e.preventDefault();void save(value);}}><label>RADAZ hesab ID-si<input readOnly={!!member} value={value.id} required onChange={e=>setValue({...value,id:e.target.value})}/></label>
 <label>Ad və soyad<input required value={value.name} onChange={e=>setValue({...value,name:e.target.value})}/></label>
 <label>Rol<select value={value.role} onChange={e=>setValue({...value,role:e.target.value})}>{Object.entries(roles).filter(([id])=>canAssignAdmin||id!=='admin'||member?.role==='admin').map(([id,label])=><option value={id} key={id}>{label}</option>)}</select></label>
 <fieldset><legend>İcazələr</legend>{Object.entries(permissions).map(([id,label])=><label key={id} className="dn-check"><input type="checkbox" checked={value.permissions.includes(id)} onChange={e=>setValue({...value,permissions:e.target.checked?[...value.permissions,id]:value.permissions.filter(p=>p!==id)})}/>{label}</label>)}</fieldset>
 <label className="dn-check"><input type="checkbox" checked={value.active} onChange={e=>setValue({...value,active:e.target.checked})}/>Klinikada aktivdir</label><button type="submit">Üzvlüyü saxla</button></form>;
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
