'use client';
import {useState} from 'react';
import {Plus,Trash2} from 'lucide-react';
import {initialPolicy,type Policy,type Member,type Act,type NetworkState} from './api';

const week=['B.e.','Ç.a.','Ç.','C.a.','C.','Ş.','B.'];
function Days({value,change}:{value:number[];change:(v:number[])=>void}){
 return <fieldset><legend>Həftənin günləri</legend><div className="dn-row">{week.map((day,i)=><label className="dn-check" key={day}><input type="checkbox" checked={value.includes(i+1)} onChange={e=>change(e.target.checked?[...value,i+1]:value.filter(v=>v!==i+1))}/>{day}</label>)}</div></fieldset>;
}
function People({label,members,value,change}:{label:string;members:Member[];value:string[];change:(v:string[])=>void}){
 return <fieldset><legend>{label}</legend><div className="dn-row">{members.map(m=><label key={m.id} className="dn-check"><input type="checkbox" checked={value.includes(m.id)} onChange={e=>change(e.target.checked?[...value,m.id]:value.filter(v=>v!==m.id))}/>{m.name}</label>)}</div></fieldset>;
}
const removeButton=(fn:()=>void)=><button type="button" aria-label="Sil" onClick={fn}><Trash2 size={16}/></button>;
export function NetworkPolicy({state,section,act}:{state:NetworkState;section:'schedule'|'rules';act:Act}){
 const [draft,setDraft]=useState<Policy>(()=>({...initialPolicy,...state.policy}));
 const [saved,setSaved]=useState('');
 const members=(state.members||[]).filter(m=>m.active&&m.role==='radiologist'&&m.permissions.includes('receive'));
 const update=<K extends keyof Policy>(k:K,v:Policy[K])=>{setSaved('');setDraft(d=>({...d,[k]:v}));};
 const isAdmin=state.membership?.role==='admin';
 const editable=!!state.online&&(isAdmin||section==='schedule'&&state.membership?.permissions.includes('manage_schedule'));
 const simpleTime=(name:string,value:string,change:(v:string)=>void)=><label>{name}<input type="time" required value={value} onChange={e=>change(e.target.value)}/></label>;
 return <form onSubmit={async e=>{e.preventDefault();
   const policy=section==='schedule'
     ? {shifts:draft.shifts,exceptions:draft.exceptions,...(isAdmin?{timezone:draft.timezone,fallback:draft.fallback}:{})}
     : {rules:draft.rules,autoEnabled:draft.autoEnabled};
   if(await act('policy',{clinic:state.clinic,policy}))setSaved('Saxlanıldı.');
 }}>
 <fieldset disabled={!editable} className="dn-fields">
 {section==='schedule'?<>
 <label>Saat qurşağı<input required readOnly={!isAdmin} value={draft.timezone} onChange={e=>update('timezone',e.target.value)}/></label>
 {draft.shifts.map((shift,i)=>{const patch=(v:Partial<typeof shift>)=>update('shifts',draft.shifts.map((s,j)=>j===i?{...s,...v}:s));return <article key={i}><header><h3>Növbə {i+1}</h3>{removeButton(()=>update('shifts',draft.shifts.filter((_,j)=>j!==i)))}</header>
 <Days value={shift.days} change={days=>patch({days})}/><div className="dn-row">{simpleTime('Başlanğıc',shift.start,start=>patch({start}))}{simpleTime('Son',shift.end,end=>patch({end}))}</div><People label="Növbətçilər" members={members} value={shift.recipients} change={recipients=>patch({recipients})}/></article>;})}
 <button type="button" onClick={()=>update('shifts',[...draft.shifts,{days:[1,2,3,4,5],start:'09:00',end:'18:00',recipients:[]}])}><Plus size={15}/>Növbə əlavə et</button>
 <h3>Tarix üzrə dəyişikliklər</h3>{draft.exceptions.map((ex,i)=>{const patch=(v:Partial<typeof ex>)=>update('exceptions',draft.exceptions.map((s,j)=>i===j?{...s,...v}:s));return <article key={i}><header><label>Tarix<input required type="date" value={ex.date} onChange={e=>patch({date:e.target.value})}/></label>{removeButton(()=>update('exceptions',draft.exceptions.filter((_,j)=>j!==i)))}</header>
 <People label="Məzuniyyətdə və ya qeyri-iş günündə" members={members} value={ex.off||[]} change={off=>patch({off})}/>
 <label className="dn-check"><input type="checkbox" checked={ex.recipients!==undefined} onChange={e=>patch({recipients:e.target.checked?[]:undefined})}/>Bu tarix üçün ayrıca növbə</label>{ex.recipients!==undefined&&<People label="Növbətçi" members={members} value={ex.recipients} change={recipients=>patch({recipients})}/>}
 <fieldset><legend>Müvəqqəti əvəzetmə</legend>{members.map(m=><label key={m.id}>{m.name}<select value={ex.substitutes?.[m.id]||''} onChange={e=>{const subs={...ex.substitutes};if(e.target.value)subs[m.id]=e.target.value;else delete subs[m.id];patch({substitutes:subs});}}><option value="">Əvəzləyici yoxdur</option>{members.filter(o=>o.id!==m.id).map(o=><option key={o.id} value={o.id}>{o.name}</option>)}</select></label>)}</fieldset></article>;})}
 <button type="button" onClick={()=>update('exceptions',[...draft.exceptions,{date:'',off:[],substitutes:{}}])}><Plus size={15}/>Tarix əlavə et</button>
 {isAdmin&&<People label="Növbətçi olmadıqda ehtiyat radioloqlar" members={members} value={draft.fallback} change={v=>update('fallback',v)}/>}
 </>:<>
 <label className="dn-check"><input type="checkbox" checked={draft.autoEnabled} onChange={e=>update('autoEnabled',e.target.checked)}/>Klinika üçün avtomatik göndərmə</label>
 {draft.rules.map((rule,i)=>{const patch=(v:Partial<typeof rule>)=>update('rules',draft.rules.map((r,j)=>j===i?{...r,...v}:r));return <article key={i}><header><label className="dn-check"><input type="checkbox" checked={rule.enabled} onChange={e=>patch({enabled:e.target.checked})}/>Qayda {i+1}</label>{removeButton(()=>update('rules',draft.rules.filter((_,j)=>j!==i)))}</header>
 <label>Modalıqlar (vergüllə ayırın)<input defaultValue={rule.modalities.join(', ')} onBlur={e=>patch({modalities:e.target.value.toUpperCase().split(',').map(v=>v.trim()).filter(Boolean)})} placeholder="CT, MR, CR, DX"/></label>
 <label>Cihaz identifikatorları (vergüllə ayırın)<input defaultValue={(rule.devices||[]).join(', ')} onBlur={e=>patch({devices:e.target.value.split(',').map(v=>v.trim()).filter(Boolean)})}/></label>
 <label>AE Title (vergüllə ayırın)<input defaultValue={rule.aeTitles.join(', ')} onBlur={e=>patch({aeTitles:e.target.value.split(',').map(v=>v.trim()).filter(Boolean)})}/></label>
 <fieldset><legend>Mənbələr</legend>{['archive','pacs'].map(source=><label className="dn-check" key={source}><input type="checkbox" checked={rule.sources.includes(source)} onChange={e=>patch({sources:e.target.checked?[...rule.sources,source]:rule.sources.filter(s=>s!==source)})}/>{source==='pacs'?'PACS':'Local arxiv'}</label>)}</fieldset>
 <Days value={rule.days} change={days=>patch({days})}/><div className="dn-row">{simpleTime('Başlanğıc',rule.start,start=>patch({start}))}{simpleTime('Son',rule.end,end=>patch({end}))}</div>
 <People label="Radioloqlar (boş seçim növbə cədvəlini tətbiq edir)" members={members} value={rule.recipients} change={recipients=>patch({recipients})}/>
 <label className="dn-check"><input type="checkbox" checked={rule.leastLoaded} onChange={e=>patch({leastLoaded:e.target.checked})}/>Ən az iş yükü olan radioloqa göndər</label></article>;})}
 <button type="button" onClick={()=>update('rules',[...draft.rules,{enabled:true,days:[],start:'00:00',end:'00:00',modalities:[],sources:[],aeTitles:[],recipients:[],leastLoaded:false}])}><Plus size={15}/>Qayda əlavə et</button>
 </>}<button type="submit" className="dn-primary">Saxla</button></fieldset><output>{saved}</output></form>;
}
