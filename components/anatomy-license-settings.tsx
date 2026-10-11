'use client';
import {useEffect,useState} from 'react';
import {useTranslation} from '@/lib/i18n';
type Status={status:string;allowed:boolean;remainingTrialDays?:number;expiresAt?:number};
export function AnatomyLicenseSettings(){
 const {t,language}=useTranslation(),[status,setStatus]=useState<Status|null>(null),[error,setError]=useState(false),[busy,setBusy]=useState(false);
 const read=async(path:string,init?:RequestInit)=>{const response=await fetch('/anatomy-volume/'+path,{cache:'no-store',...init});if(!response.ok)throw Error('license_unavailable');return await response.json() as Status;};
 useEffect(()=>{let alive=true;void read('license').then(value=>{if(alive)setStatus(value);}).catch(()=>{if(alive)setError(true);});return()=>{alive=false;};},[]);
 return <fieldset className="language-settings"><legend>{t('license.anatomy')}</legend>
  {error?<p role="alert">{t('license.unavailable')}</p>:!status?<p>{t('license.checking')}</p>:<><p>{status.status==='local-research'?t('anatomy.research'):t(`license.${['inactive','trial','active','expired','suspended'].includes(status.status)?status.status:'inactive'}` as 'license.inactive')}</p>
   {status.remainingTrialDays!==undefined&&status.status==='trial'&&<p>{t('license.remaining',{days:status.remainingTrialDays})}</p>}
   {status.expiresAt&&<p>{new Date(status.expiresAt*1000).toLocaleString(language)}</p>}
   {status.status==='inactive'&&<button disabled={busy} onClick={async()=>{setBusy(true);try{setStatus(await read('trial/start',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'}));}catch{setError(true);}finally{setBusy(false);}}}>{t('license.startTrial')}</button>}
  </>}
 </fieldset>;
}
