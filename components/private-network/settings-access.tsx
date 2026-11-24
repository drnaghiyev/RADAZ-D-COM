'use client';
import {createContext,useCallback,useEffect,useRef,useState,type FormEvent,type ReactNode} from 'react';
import {KeyRound,LockKeyhole} from 'lucide-react';
import {networkCall,NetworkRequestError,type NetworkRequest} from './api';

type Grant={session:string;expiresIn:number};
type Status={passwordSet:boolean;unlocked:boolean};
const upgrade='Ayarların şifrə ilə qorunması üçün Windows RADAZ Desktop proqramını yeniləyib yenidən açın.';
const expired='Ayarların açıq qalma müddəti bitdi. Şifrənizi yenidən daxil edin.';
const explain=(error:unknown)=>error instanceof Error?error.message:String(error);
const revoke=(session:string)=>networkCall('settings_lock',{},session).catch(()=>{});

export const NetworkSettingsContext=createContext<{request:NetworkRequest;controls:ReactNode}|null>(null);

export function NetworkSettingsAccess({children,required,back}:{children:ReactNode;required:boolean;back?:()=>void}){
  const [passwordSet,setPasswordSet]=useState<boolean|null>(null),[session,setSession]=useState(''),[changing,setChanging]=useState(false);
  const [error,setError]=useState(''),[submitting,setSubmitting]=useState(false),[checking,setChecking]=useState(true);
  const grant=useRef({session:'',expiresAt:0}),generation=useRef(0),active=useRef(false);
  const notices=useRef<BroadcastChannel|null>(null);
  const lock=useCallback((message='')=>{
    const token=grant.current.session;
    ++generation.current;
    grant.current={session:'',expiresAt:0};
    setSession('');setChanging(false);setError(message);
    if(token)void revoke(token);
  },[]);
  const status=useCallback(async()=>{
    try{
      const result=await networkCall<Status>('settings_status');
      if(typeof result?.passwordSet!=='boolean'||typeof result?.unlocked!=='boolean')throw Error(upgrade);
      if(active.current)setPasswordSet(result.passwordSet);
    }catch(failure){
      const message=explain(failure);
      if(active.current)setError(/Naməlum DICOM Network əməliyyatı|Əməliyyat tapılmadı/.test(message)?upgrade:message);
    }finally{if(active.current)setChecking(false);}
  },[]);
  useEffect(()=>{
    active.current=true;
    const onHide=()=>lock();
    window.addEventListener('pagehide',onHide);
    if(typeof BroadcastChannel==='function'){
      const channel=new BroadcastChannel('radaz-network-settings-password');
      notices.current=channel;
      channel.onmessage=event=>{
        if(event.data==='changed'){lock('Bu cihazda ayarların şifrəsi dəyişdirildi.');setPasswordSet(true);}
      };
    }
    return ()=>{
      active.current=false;
      window.removeEventListener('pagehide',onHide);
      notices.current?.close();notices.current=null;
      if(grant.current.session)void revoke(grant.current.session);
      grant.current={session:'',expiresAt:0};
    };
  },[lock]);
  useEffect(()=>{
    if(!required)return;
    const check=window.setTimeout(()=>void status(),0);
    return ()=>window.clearTimeout(check);
  },[required,status]);
  useEffect(()=>{
    if(!session)return;
    const checkExpiry=()=>{if(grant.current.session&&Date.now()>=grant.current.expiresAt)lock(expired);};
    const timer=window.setTimeout(checkExpiry,Math.max(0,grant.current.expiresAt-Date.now())+1);
    document.addEventListener('visibilitychange',checkExpiry);
    return ()=>{window.clearTimeout(timer);document.removeEventListener('visibilitychange',checkExpiry);};
  },[session,lock]);
  const request:NetworkRequest=useCallback(async<T,>(action:string,body:Record<string,unknown>={})=>{
    if(!session||grant.current.session!==session||grant.current.expiresAt<=Date.now()){
      if(grant.current.session===session)lock(expired);
      throw Error(expired);
    }
    try{return await networkCall<T>(action,body,session);}
    catch(failure){
      if(failure instanceof NetworkRequestError&&failure.code==='SETTINGS_LOCKED'&&grant.current.session===session)lock(expired);
      throw failure;
    }
  },[session,lock]);

  async function submit(event:FormEvent<HTMLFormElement>){
    event.preventDefault();
    if(submitting||passwordSet===null)return;
    const form=event.currentTarget,fields=new FormData(form),creating=!passwordSet;
    const password=String(fields.get('password')||'');
    if(creating||changing){
      if(password!==String(fields.get('confirm')||'')){setError('Yeni şifrə və təkrarı uyğun gəlmir.');return;}
      if(Array.from(password).length<8||!password.trim()||new TextEncoder().encode(password).length>1024){
        setError('Ən azı 8 simvoldan ibarət şifrə daxil edin (ən çox 1024 bayt).');return;
      }
    }
    const attempt=generation.current;
    setError('');setSubmitting(true);
    try{
      const result=changing
        ?await request<Grant>('settings_change',{currentPassword:String(fields.get('current')||''),newPassword:password})
        :await networkCall<Grant>(creating?'settings_set':'settings_unlock',{password});
      if(typeof result.session!=='string'||!result.session||!Number.isFinite(result.expiresIn)||result.expiresIn<=0)throw Error(upgrade);
      if(!active.current||generation.current!==attempt){void revoke(result.session);return;}
      form.reset();
      grant.current={session:result.session,expiresAt:Date.now()+result.expiresIn*1000};
      setSession(result.session);setPasswordSet(true);setChanging(false);
      if(creating||changing)notices.current?.postMessage('changed');
    }catch(failure){
      if(active.current){
        if(failure instanceof NetworkRequestError&&failure.code==='SETTINGS_PASSWORD_EXISTS')setPasswordSet(true);
        setError(explain(failure));
      }
    }finally{if(active.current)setSubmitting(false);}
  }
  if(!required)return children;
  if(session&&!changing)return <NetworkSettingsContext.Provider value={{request,controls:<>
    <button type="button" onClick={()=>{setError('');setChanging(true);}}><KeyRound size={16}/>Şifrəni dəyiş</button>
    <button type="button" onClick={()=>lock()}><LockKeyhole size={16}/>Kilidlə</button>
  </>}}>{children}</NetworkSettingsContext.Provider>;
  const creating=passwordSet===false;
  return <main className="dn dn-page"><header className="dn-top"><div><LockKeyhole size={24}/><h1>DICOM Network ayarları</h1></div>
    {back&&<button type="button" onClick={back}>Göndərişlərə qayıt</button>}</header>
    <article className="dn-access-form" aria-busy={checking||submitting}>
      {error&&<p role="alert">{error}</p>}
      {passwordSet===null?<>{checking?<p role="status">Şifrə ayarı yoxlanılır…</p>:<button onClick={()=>{setError('');setChecking(true);void status();}}>Yenidən yoxla</button>}</>:<>
        <h2>{changing?'Şifrəni dəyiş':creating?'Bu cihaz üçün şifrə yaradın':'Ayarların kilidini açın'}</h2>
        <form key={changing?'change':creating?'create':'unlock'} onSubmit={submit} autoComplete="off">
          {changing&&<label>Cari şifrə<input name="current" type="password" required autoFocus/></label>}
          <label>{creating||changing?'Yeni şifrə':'Şifrə'}<input name="password" type="password" autoFocus={!changing} required/></label>
          {(creating||changing)&&<><small>Ən azı 8 simvol daxil edin.</small><label>Yeni şifrəni təkrarlayın<input name="confirm" type="password" required/></label></>}
          <div className="dn-row"><button className="dn-primary" type="submit" disabled={submitting}>{changing?'Yeni şifrəni saxla':creating?'Şifrəni yarat':'Kilidi aç'}</button>
            {changing&&<button type="button" disabled={submitting} onClick={()=>{setChanging(false);setError('');}}>Ləğv et</button>}</div>
        </form>
      </>}
    </article>
  </main>;
}
