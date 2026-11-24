'use client';
import {useState} from 'react';
import type {Act,NetworkProfile,NetworkState} from './api';

export function NetworkChoice({profile,onChange,disabled}:{profile:NetworkProfile;onChange:(profile:NetworkProfile)=>void;disabled?:boolean}){
  return <label>Bağlantı<select aria-label="Şəbəkə bağlantısı" disabled={disabled} value={profile}
    onChange={e=>onChange(e.currentTarget.value as NetworkProfile)}>
    <option value="private">Mövcud şəxsi şəbəkə</option><option value="internet">RADAZ İnternet · klinika və həkimlər</option>
  </select></label>;
}

export function InternetPairing({state,act}:{state:NetworkState;act:Act}){
  const [note,setNote]=useState('');
  const id=state.deviceId||'';
  const code=id?'RD-'+(id.toUpperCase().match(/.{1,4}/g)||[]).join('-'):'';
  if(!state.configured)return <article><h3>Bu kompüteri internetlə qoş</h3>
    <form onSubmit={e=>{e.preventDefault();void act('enroll_pc',Object.fromEntries(new FormData(e.currentTarget)));}}>
      <label>Həkimin və ya klinika kompüterinin adı<input name="name" maxLength={128} required/></label>
      <button>Qoşul və kompüter ID-si al</button>
    </form></article>;
  return <>
    <article><h3>Bu kompüterin RADAZ ID-si</h3>
      <label>Bu kodu göndərən klinikaya verin<input readOnly value={code} onFocus={e=>e.target.select()}/></label>
      <button onClick={()=>{void navigator.clipboard.writeText(code).then(()=>setNote('ID kopyalandı.'),()=>setNote('ID-ni sahədən seçib kopyalayın.'));}}>ID-ni kopyala</button>
      <span role="status">{note}</span>
    </article>
    {(state.invitations||[]).map(i=><article key={i.id}><h3>{i.clinic} klinikasından dəvət</h3>
      <p>{i.sender} sizi {i.doctor} adı ilə bu kompüterdə müayinə qəbul etməyə dəvət edir.</p>
      <div className="dn-row"><button onClick={()=>void act('answer_invite',{id:i.id,accept:true})}>Dəvəti qəbul et</button>
        <button onClick={()=>void act('answer_invite',{id:i.id,accept:false})}>İmtina et</button></div></article>)}
    {state.online&&!state.ownsClinic&&<article><h3>Klinikanın göndərən kompüteri</h3><form onSubmit={e=>{
      e.preventDefault();void act('open_clinic',Object.fromEntries(new FormData(e.currentTarget)));
    }}><label>Klinikanın adı<input name="name" maxLength={128} required/></label><button>Bu kompüter üçün klinika yarat</button></form></article>}
    {state.membership?.role==='admin'&&state.clinic&&<article><h3>Həkimin kompüterinə dəvət göndər</h3>
      <form onSubmit={async e=>{e.preventDefault();const form=e.currentTarget;
        if(await act('invite_pc',{...Object.fromEntries(new FormData(form)),clinic:state.clinic}))form.reset();
      }}><label>Həkimin adı<input name="name" maxLength={128} required/></label>
        <label>Həkimin RADAZ kompüter ID-si və ya qoşulma kodu<input name="target" autoComplete="off" maxLength={80} required/></label>
        <button>Dəvəti həkimin RADAZ-ına göndər</button></form>
      {(state.outgoingInvites||[]).map(i=><div key={i.id} className="dn-item"><span>{i.doctor} · qəbul gözlənilir</span>
        <button onClick={()=>void act('cancel_invite',{id:i.id,clinic:state.clinic})}>Dəvəti geri götür</button></div>)}
    </article>}
  </>;
}
