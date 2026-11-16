'use client';
import {useEffect,useMemo,useState} from 'react';
import {getSeriesVolume} from '@/lib/cornerstone';
import {gpuCapabilities} from '@/lib/gpu-capabilities';
import type {AnatomyVolumeResult} from '@/lib/anatomy-volume';
import {SmartVolumeSurface} from './smart-volume-surface';
export function SharedVolumeView({series,anatomy,onClose}:{series?:{id:string;imageIds:string[];modality:string};anatomy?:AnatomyVolumeResult|null;onClose:()=>void}){
 const [loaded,setLoaded]=useState<Awaited<ReturnType<typeof getSeriesVolume>>|null>(null),[error,setError]=useState('');
 useEffect(()=>{let cancelled=false;setLoaded(null);setError('');if(!series)return;
  void (async()=>{const v=await getSeriesVolume(series.imageIds,{maxDimension:gpuCapabilities().max3DTextureSize,budgetBytes:Infinity,preserveSlices:true});
   const deadline=Date.now()+180000;while(!v.volume.loadStatus?.loaded){if(cancelled)return;if(Date.now()>deadline)throw Error('Seriyanın yüklənməsi tamamlanmadı.');await new Promise(r=>setTimeout(r,30));}
   if(!cancelled)setLoaded(v);
  })().catch(e=>{if(!cancelled)setError(String(e.message||e));});return()=>{cancelled=true;};
 },[series?.id,series?.imageIds.length]);
 const geometry=useMemo<AnatomyVolumeResult|null>(()=>{
  if(!loaded||!series)return null;if(anatomy)return anatomy;const v=loaded.volume;
  return {dimensions:[...v.dimensions],spacing:[...v.spacing],origin:[...v.origin],direction:[...v.direction],modality:series.modality==='MR'?'MR':'CT',mask:new Uint8Array(0),classes:{},sourceKey:series.id,task:'context',device:'local',seconds:0,modelSpacingMm:null,experimental:true};
 },[loaded,anatomy,series?.id,series?.modality]);
 if(!loaded||!series||!geometry)return <section className="shared-volume-loading"><button onClick={onClose}>Bağla</button><p role="status">{error||'3D hazırlanır…'}</p></section>;
 const v=loaded.volume;
 return <SmartVolumeSurface key={loaded.volumeId} result={geometry} colors={{}} source={v} range={loaded.range} title="3D həcm görüntüləmə" onClose={onClose}/>;
}
