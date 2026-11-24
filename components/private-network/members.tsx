'use client';
import {useEffect,useRef,useState} from 'react';
import {KeyRound,Pencil,Trash2,UserPlus} from 'lucide-react';
import {permissions,roles,type Act,type Member,type NetworkRequest,type NetworkState} from './api';

const rolePermissions:Record<string,string[]>={
  admin:['manage_schedule','view_status'],
  coordinator:Object.keys(permissions),
  radiologist:['send','receive','download','forward'],
  operator:['send','view_status'],
  viewer:['receive','download'],
};

function MemberEditor({member,members,superAdmin,lastAdmin,save,close}:{
  member?:Member;members:Member[];superAdmin:boolean;lastAdmin:boolean;
  save:(member:Member)=>Promise<void>;close:()=>void;
}){
  const [value,setValue]=useState<Member>(()=>member?{...member,active:!!member.active}:{
    id:'',name:'',role:superAdmin?'admin':'radiologist',active:true,permissions:[],
  });
  const [error,setError]=useState('');
  const allowed=rolePermissions[value.role]||[];
  function changeRole(role:string){
    setValue({...value,role,permissions:value.permissions.filter(right=>rolePermissions[role]?.includes(right))});
  }
  function submit(event:React.FormEvent){
    event.preventDefault();
    const id=value.id.trim(),name=value.name.trim();
    if(!/^[A-Za-z0-9_.@+\-]+$/.test(id)){
      setError('Hesab ID-si üçün latın hərfləri, rəqəmlər və ya _ . @ + - işarələrini istifadə edin.');return;
    }
    if(!member&&members.some(person=>person.id===id)){
      setError('Bu hesab ID-si artıq klinikada var. Mövcud əməkdaşın sətrində “Düzəliş et” seçə bilərsiniz.');return;
    }
    if(!name){setError('Ad və soyadı daxil edin.');return;}
    setError('');
    void save({...value,id,name,permissions:value.permissions.filter(right=>allowed.includes(right))});
  }
  return <form onSubmit={submit} className="dn-member-editor">
    <h3>Üzvlük və icazələr</h3>
    <label>RADAZ hesab ID-si<input autoFocus={!member} readOnly={!!member} required maxLength={128}
      value={value.id} onChange={e=>setValue({...value,id:e.target.value})}/></label>
    <label>Ad və soyad<input autoFocus={!!member} required maxLength={128} value={value.name}
      onChange={e=>setValue({...value,name:e.target.value})}/></label>
    <label>Rol<select value={value.role} onChange={e=>changeRole(e.target.value)}>
      {Object.entries(roles).filter(([id])=>superAdmin===(id==='admin')).map(([id,label])=><option key={id} value={id}>{label}</option>)}
    </select></label>
    <fieldset><legend>İcazələr</legend>{allowed.map(right=><label className="dn-check" key={right}>
      <input type="checkbox" checked={value.permissions.includes(right)} onChange={e=>setValue({...value,
        permissions:e.target.checked?[...value.permissions,right]:value.permissions.filter(id=>id!==right),
      })}/>{permissions[right]}</label>)}</fieldset>
    <label className="dn-check"><input type="checkbox" checked={value.active} disabled={lastAdmin}
      onChange={e=>setValue({...value,active:e.target.checked})}/>Klinikada aktivdir</label>
    {lastAdmin&&<small>Klinikada ən azı bir aktiv administrator qalmalıdır.</small>}
    {error&&<p role="alert">{error}</p>}
    <div className="dn-row"><button className="dn-primary" type="submit">Üzvlüyü saxla</button><button type="button" onClick={close}>Ləğv et</button></div>
  </form>;
}

function RemoveMemberDialog({member,clinicName,close,confirm}:{
  member:Member;clinicName:string;close:()=>void;confirm:()=>void;
}){
  const dialog=useRef<HTMLDialogElement>(null);
  useEffect(()=>{
    const current=dialog.current;
    current?.showModal();
    return ()=>current?.close();
  },[]);
  return <dialog className="dn dn-dialog" role="alertdialog" ref={dialog} aria-labelledby="member-remove-title"
    aria-describedby="member-remove-detail" onCancel={event=>{event.preventDefault();close();}}>
    <h2 id="member-remove-title">Əməkdaşı siyahıdan silmək istəyirsiniz?</h2>
    <p id="member-remove-detail"><strong>{member.name} ({member.id})</strong> bu klinikanın ({clinicName}) üzvlüyündən çıxarılacaq.
      {' '}Bu şəxsin həmin klinikaya aid cihaz icazələri və dəvətləri ləğv ediləcək, tamamlanmamış göndərişləri dayandırılacaq.
      {' '}Əvvəlki göndərişlərin tarixçəsi və arxivdəki müayinələr saxlanılır.</p>
    <footer><button autoFocus type="button" onClick={close}>Ləğv et</button><button className="dn-member-delete" type="button" onClick={confirm}>Siyahıdan sil</button></footer>
  </dialog>;
}

export function MemberDirectory({state,act,request}:{state:NetworkState;act:Act;request:NetworkRequest}){
  // Empty ID opens a new record. Existing IDs identify a row across background refreshes.
  const [editor,setEditor]=useState<string|null>(null);
  const [removing,setRemoving]=useState<string|null>(null);
  const [invite,setInvite]=useState<{user:string;code:string}|null>(null);
  const [inviting,setInviting]=useState(false),[inviteError,setInviteError]=useState('');
  const members=state.members||[],superAdmin=!!state.superAdmin;
  const manages=!!state.clinic&&(superAdmin||(state.membership?.role==='admin'&&!!state.membership.active));
  const supported=(state.memberManagementVersion||0)>=2;
  const writable=manages&&state.online&&supported;
  const activeAdmins=members.filter(member=>member.role==='admin'&&member.active).length;
  const isLastAdmin=(member:Member)=>member.role==='admin'&&!!member.active&&activeAdmins===1;
  const editable=(member:Member)=>writable&&superAdmin===(member.role==='admin');
  const mayInvite=(member:Member)=>!state.internet&&manages&&state.online&&!!member.active&&
    (superAdmin?member.role==='admin':member.role!=='admin'||member.id===state.user?.id);
  const selected=members.find(member=>member.id===editor);
  const removed=members.find(member=>member.id===removing);
  const invited=members.find(member=>member.id===invite?.user);
  const clinicName=state.clinics?.find(clinic=>clinic.id===state.clinic)?.name||state.clinic||'';
  async function createInvite(member:Member){
    setInviting(true);setInvite(null);setInviteError('');
    try{
      const result=await request<{invite:string}>('invite',{clinic:state.clinic,user:member.id});
      setInvite({user:member.id,code:result.invite});
    }catch(error){setInviteError(error instanceof Error?error.message:String(error));}
    finally{setInviting(false);}
  }
  async function save(member:Member){
    const mode=editor===''?'create':'edit';
    if(await act('member',{clinic:state.clinic,user:member.id,name:member.name,role:member.role,
      active:member.active,permissions:member.permissions,mode})){
      setEditor(null);setInvite(null);
    }
  }
  function remove(member:Member){
    setRemoving(null);
    void act('remove_member',{clinic:state.clinic,user:member.id}).then(ok=>{
      if(ok&&editor===member.id)setEditor(null);
      if(ok&&invite?.user===member.id)setInvite(null);
    });
  }
  return <article><header><h3>Radioloqlar və əməkdaşlar</h3>
    {writable&&!state.internet&&<button type="button" disabled={editor===''} onClick={()=>setEditor('')}><UserPlus size={16}/>{superAdmin?'Yeni klinika administratoru':'Yeni əməkdaş'}</button>}</header>
    {manages&&state.online&&!supported&&<p role="alert">Əməkdaşları əlavə etmək, redaktə etmək və silmək üçün DICOM Network xidmətini 0.2.92 və ya daha yeni versiyaya yeniləyin.</p>}
    {superAdmin&&state.clinic&&<p>Radioloq və operatorları klinika administratoru idarə edir. Administratoru qoşmaq üçün onun sətrində dəvət kodu yaradın.</p>}
    {!manages&&state.clinic&&<p>Əməkdaşları bu klinikanın administratoru idarə edir.</p>}
    {writable&&editor!==null&&(editor===''||(selected&&editable(selected)))&&<MemberEditor key={editor}
      member={selected} members={members} superAdmin={superAdmin} lastAdmin={!!selected&&isLastAdmin(selected)}
      save={save} close={()=>setEditor(null)}/>}
    {members.length?<div className="dn-member-table"><table><thead><tr><th>Ad</th><th>Rol</th><th>Vəziyyət</th>{manages&&<th>Əməliyyatlar</th>}</tr></thead>
      <tbody>{members.map(member=><tr key={member.id}><td>{member.name}<small>{member.id}</small></td><td>{roles[member.role]||member.role}</td>
        <td>{member.active?'Aktiv':'Deaktiv'}</td>{manages&&<td><div className="dn-row">
          {editable(member)&&<>
            <button type="button" aria-label={'Düzəliş et: '+member.name} title="Düzəliş et" onClick={()=>setEditor(member.id)}><Pencil size={15}/></button>
            <button type="button" aria-label={'Siyahıdan sil: '+member.name} title={isLastAdmin(member)?'Klinikada ən azı bir aktiv administrator qalmalıdır.':'Siyahıdan sil'}
              disabled={isLastAdmin(member)} onClick={()=>setRemoving(member.id)}><Trash2 size={15}/></button>
          </>}
          {mayInvite(member)&&<button type="button" disabled={inviting} aria-label={'Dəvət kodu yarat: '+member.name}
            title="Cihaz üçün birdəfəlik dəvət kodu yarat" onClick={()=>void createInvite(member)}><KeyRound size={15}/></button>}
        </div></td>}</tr>)}</tbody></table></div>:<p>Üzv siyahısı boşdur.</p>}
    {inviteError&&<p role="alert">{inviteError}</p>}
    {invited&&invite&&mayInvite(invited)&&<div><p>{invited.name} üçün birdəfəlik cihaz dəvəti</p><label>Dəvət kodu<input readOnly value={invite.code}/></label></div>}
    {removed&&editable(removed)&&!isLastAdmin(removed)&&<RemoveMemberDialog member={removed} clinicName={clinicName}
      close={()=>setRemoving(null)} confirm={()=>remove(removed)}/>}
  </article>;
}
