import {useEffect,useState} from 'react';

export type Member={id:string;name:string;role:string;active:boolean;permissions:string[]};
export type Device={id:string;name:string;user:string;active:boolean};
export type Delivery={id:string;transfer:string;study:string;recipient:string;device:string;sender:string;status:string;state:string;clinic:string;kind?:string;files?:{sha256:string}[];done:number;total:number};
export type Shift={days:number[];start:string;end:string;recipients:string[]};
export type Exception={date:string;off:string[];recipients?:string[];substitutes:Record<string,string>};
export type Rule={enabled:boolean;days:number[];start:string;end:string;modalities:string[];sources:string[];aeTitles:string[];recipients:string[];devices?:string[];leastLoaded:boolean};
export type Policy={timezone:string;shifts:Shift[];exceptions:Exception[];rules:Rule[];fallback:string[];autoEnabled:boolean};
export const initialPolicy:Policy={timezone:'Asia/Baku',shifts:[],exceptions:[],rules:[],fallback:[],autoEnabled:false};
export type NetworkState={
  enabled:boolean;configured:boolean;online:boolean;error?:string;url?:string;deviceId?:string;
  user?:{id:string;name:string};superAdmin?:boolean;clinic?:string;clinics?:{id:string;name:string}[];
  membership?:Member;members?:Member[];devices?:Device[];policy?:Partial<Policy>;
  deliveries?:Delivery[];sent?:Delivery[];history?:{time:number|string;actor:string;action:string;detail?:unknown}[];
  queue?:{id:string;clinic:string;study:string;state:string;error?:string;remote?:string}[];statuses?:{id:string;sender:string;recipient:string;state:string}[];localCoordinator?:boolean;syncClinic?:string;acceptMode?:string;clinicModes?:Record<string,string>;
};
export function isPrivateDesktop(){return typeof window!=='undefined'&&['localhost','127.0.0.1','[::1]'].includes(window.location.hostname)&&/Windows NT/i.test(navigator.userAgent)&&/Electron\//i.test(navigator.userAgent);}
export function usePrivateDesktop(){const [allowed,setAllowed]=useState(false);useEffect(()=>{setAllowed(isPrivateDesktop());},[]);return allowed;}
export async function networkCall<T>(action:string,body:Record<string,unknown>={}):Promise<T>{
  if(!isPrivateDesktop())throw Error('Bu modul Windows RADAZ Desktop üçün nəzərdə tutulub.');
  const response=await fetch('/local-archive-api/private-network/'+encodeURIComponent(action),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),cache:'no-store'});
  const data=await response.json().catch(()=>null) as {error?:string}|null;
  if(!response.ok||!data||data.error&&action!=='state')throw Error(String(data?.error||'DICOM Network xidməti cavab vermir.'));
  return data as T;
}
export const can=(state:NetworkState,permission:string)=>!!state.membership?.active&&state.membership.permissions.includes(permission);
export type Act=(action:string,body:Record<string,unknown>)=>Promise<boolean>;
export const roles:Record<string,string>={admin:'Klinika administratoru',coordinator:'Baş radioloq',radiologist:'Radioloq',operator:'Operator',viewer:'Yalnız baxış'};
export const permissions:Record<string,string>={send:'Göndərmə',receive:'Qəbul',download:'Arxivə endirmə',forward:'Yönləndirmə',manage_schedule:'Növbə cədvəli',view_status:'Göndəriş statusları'};
