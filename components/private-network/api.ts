import {useSyncExternalStore} from 'react';

export type Member={id:string;name:string;role:string;active:boolean;permissions:string[]};
export type Device={id:string;name:string;user:string;active:boolean};
export type Delivery={id:string;transfer:string;study:string;recipient:string;device:string;sender:string;status:string;state:string;clinic:string;kind?:string;files?:{sha256:string}[];done:number;total:number};
export type Shift={days:number[];start:string;end:string;recipients:string[]};
export type Exception={date:string;off:string[];recipients?:string[];substitutes:Record<string,string>};
export type Rule={enabled:boolean;days:number[];start:string;end:string;modalities:string[];sources:string[];aeTitles:string[];recipients:string[];devices?:string[];leastLoaded:boolean};
export type Policy={timezone:string;shifts:Shift[];exceptions:Exception[];rules:Rule[];fallback:string[];autoEnabled:boolean};
export const initialPolicy:Policy={timezone:'Asia/Baku',shifts:[],exceptions:[],rules:[],fallback:[],autoEnabled:false};
export type NetworkState={
  internet?:boolean;ownsClinic?:boolean;inviteCount?:number;inviteNotice?:string;
  invitations?:{id:string;clinic:string;sender:string;doctor:string;expires:number}[];
  outgoingInvites?:{id:string;doctor:string;target:string;expires:number}[];
  enabled:boolean;configured:boolean;online:boolean;error?:string;url?:string;deviceId?:string;
  user?:{id:string;name:string};superAdmin?:boolean;clinic?:string;clinics?:{id:string;name:string}[];
  membership?:Member;members?:Member[];devices?:Device[];policy?:Partial<Policy>;memberManagementVersion?:number;
  deliveries?:Delivery[];sent?:Delivery[];history?:{time:number|string;actor:string;action:string;detail?:unknown}[];
  queue?:{id:string;clinic:string;study:string;state:string;error?:string;remote?:string}[];statuses?:{id:string;sender:string;recipient:string;state:string}[];localCoordinator?:boolean;syncClinic?:string;acceptMode?:string;clinicModes?:Record<string,string>;
};
export function isPrivateDesktop(){return typeof window!=='undefined'&&['localhost','127.0.0.1','[::1]'].includes(window.location.hostname)&&/Windows NT/i.test(navigator.userAgent)&&/Electron\//i.test(navigator.userAgent);}
const subscribeDesktop=()=>()=>{};
export function usePrivateDesktop(){return useSyncExternalStore(subscribeDesktop,isPrivateDesktop,()=>false);}
export type NetworkRequest=<T>(action:string,body?:Record<string,unknown>)=>Promise<T>;
export type NetworkProfile='private'|'internet';
let selectedProfile:NetworkProfile|undefined;
export function currentNetwork():NetworkProfile{
  if(typeof window==='undefined')return 'private';
  if(!selectedProfile){
    const requested=new URLSearchParams(location.search).get('network');
    selectedProfile=(requested||localStorage.getItem('radaz-network-profile'))==='internet'?'internet':'private';
  }
  return selectedProfile;
}
export function chooseNetwork(profile:NetworkProfile){
  selectedProfile=profile;
  localStorage.setItem('radaz-network-profile',profile);
}
export class NetworkRequestError extends Error{
  constructor(message:string,readonly code?:string){super(message);}
}
export async function networkCall<T>(action:string,body:Record<string,unknown>={},session?:string):Promise<T>{
  if(!isPrivateDesktop())throw Error('Bu modul Windows RADAZ Desktop üçün nəzərdə tutulub.');
  const headers:Record<string,string>={'Content-Type':'application/json'};
  if(session)headers['X-RADAZ-Settings-Session']=session;
  const payload=currentNetwork()==='internet'?{_profile:'internet',...body}:body;
  const response=await fetch('/local-archive-api/private-network/'+encodeURIComponent(action),{method:'POST',headers,body:JSON.stringify(payload),cache:'no-store',keepalive:action==='settings_lock'});
  const data=await response.json().catch(()=>null) as {error?:string;code?:string}|null;
  if(response.status===403&&(data?.code==='NETWORK_DESKTOP_REQUIRED'||data?.code==='NETWORK_DESKTOP_IDENTITY'||data?.error==='Bu əməliyyat yalnız Windows RADAZ Desktop üçün açıqdır.')){
    const recovery=data?.code==='NETWORK_DESKTOP_IDENTITY'
      ? 'Aktiv DICOM göndərişləri tamamlandıqdan sonra Windows-u yenidən başladın və Windows Başlat menyusundan RADAZ-ı açın.'
      : 'Saatın yanındakı RADAZ işarəsindən “Çıxış” seçin və Windows Başlat menyusundan RADAZ-ı yenidən açın.';
    throw Error('RADAZ bu pəncərənin Desktop bağlantısını təsdiqləyə bilmədi. İşinizi saxlayın. '+recovery+' Xəta təkrarlanarsa, Windows üçün RADAZ Setup ilə quraşdırmanı yeniləyin.');
  }
  if(!response.ok||!data||data.error&&!['state','settings_state'].includes(action))throw new NetworkRequestError(String(data?.error||'DICOM Network xidməti cavab vermir.'),data?.code);
  return data as T;
}
export const can=(state:NetworkState,permission:string)=>!!state.membership?.active&&state.membership.permissions.includes(permission);
export type Act=(action:string,body:Record<string,unknown>)=>Promise<boolean>;
export const roles:Record<string,string>={admin:'Klinika administratoru',coordinator:'Baş radioloq',radiologist:'Radioloq',operator:'Operator',viewer:'Yalnız baxış'};
export const permissions:Record<string,string>={send:'Göndərmə',receive:'Qəbul',download:'Arxivə endirmə',forward:'Yönləndirmə',manage_schedule:'Növbə cədvəli',view_status:'Göndəriş statusları'};
