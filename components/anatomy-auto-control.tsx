'use client';
import {useTranslation as useUiTranslation,translate as tr} from '@/lib/i18n';

import {useEffect,useRef,useState} from 'react';
import type * as Core from '@cornerstonejs/core';
import {getAnatomyPixels} from '@/lib/cornerstone';
import {autoAnatomyNames,requestAutoAnatomy,type AnatomyPixels} from '@/lib/anatomy-auto';
import type {Point3} from '@/lib/localizer';
import type {LocalMark} from './measurement-overlay';

export function useAutomaticAnatomy({viewport,imageId,enabled,clearToken,onAdd}:{viewport:Core.Types.IStackViewport|null;imageId:string;enabled:boolean;clearToken:number;onAdd:(mark:LocalMark)=>void}) {
 const [message,setMessage]=useState('');
 const [busy,setBusy]=useState(false);
 const request=useRef<AbortController|null>(null);
 const latest=useRef({imageId,enabled,clearToken});latest.current={imageId,enabled,clearToken};
 const cache=useRef<{imageId:string;image:AnatomyPixels}|null>(null);
 useEffect(()=>{request.current?.abort();request.current=null;setBusy(false);setMessage('');cache.current=null;return()=>{request.current?.abort();request.current=null;};},[imageId,enabled,clearToken]);
 useEffect(()=>{
  const clear=()=>{request.current?.abort();request.current=null;setBusy(false);setMessage('');};
  viewport?.element.addEventListener('radaz-clear-measurements',clear);
  return()=>viewport?.element.removeEventListener('radaz-clear-measurements',clear);
 },[viewport]);
 const recognize=async(point:Point3,tail:Point3)=>{
  if(!enabled||!viewport||!imageId||request.current)return;
  const controller=new AbortController();request.current=controller;
  const context={imageId,clearToken};
  const current=()=>!controller.signal.aborted&&latest.current.enabled&&latest.current.imageId===context.imageId&&latest.current.clearToken===context.clearToken&&viewport.getCurrentImageId()===context.imageId;
  setBusy(true);setMessage('Anatomiya tanınır… İlk nəticə bir qədər vaxt ala bilər.');
  try{
   const data=viewport.getImageData();
   if(!data?.imageData?.worldToIndex)throw Error('Görüntü hələ hazır deyil.');
   const [x,y]=data.imageData.worldToIndex(point);
   if(!cache.current||cache.current.imageId!==imageId){const image=await getAnatomyPixels(imageId);if(!current())return;cache.current={imageId,image};}
   const image=cache.current.image;
   if(x<0||x>=image.width||y<0||y>=image.height)throw Error('Görüntünün daxilində bir nöqtə seçin.');
   const labels=await requestAutoAnatomy(image,x,y,controller.signal);
   if(!current())return;
   if(!labels.length){setMessage('Bu nöqtədə struktur tanınmadı. Başqa nöqtəni sınayın.');return;}
   const names=labels.map(id=>autoAnatomyNames[id]);
   setMessage(names.length>1?`Bu nöqtə üçün bir neçə ehtimal: ${names.join('; ')}. Strukturlar üst-üstə düşə bilər.`:`Ehtimal edilən struktur: ${names[0]}.`);
   onAdd({id:`auto-anatomy-${crypto.randomUUID()}`,imageId,kind:'arrow',points:[tail,point],labelOffset:[0,0],anatomyId:`auto:${labels.join(',')}`,comment:`Sınaq · ${names.slice(0,4).join('\n')}${names.length>4?`\n+${names.length-4} struktur`:''}\nHəkim yoxlaması tələb olunur`});
  }catch(error){if(current())setMessage(error instanceof Error?error.message:'Tanıma alınmadı.');}
  finally{if(request.current===controller){request.current=null;setBusy(false);}}
 };
 return {recognize,busy,message};
}

export function AutomaticAnatomyStatus({busy,message}:{busy:boolean;message:string}) {
  useUiTranslation();
 return <div className="anatomy-auto-status" role="status" aria-live="polite" onClick={e=>e.stopPropagation()}>
  <strong>{busy?'Anatomiya tanınır…':'Kliklə anatomiyanı tanı · Sınaq'}</strong>
  <span>{message||'Rentgen görüntüsündə strukturun üzərinə klikləyin.'}</span>
  <small>{tr('ui.non_clinical_research_only_60_structure_group_180d2')}</small>
 </div>;
}
