'use client';
import {useEffect,useMemo,useState} from 'react';
import {getSeriesVolume,tabletDisplayVolume} from '@/lib/cornerstone';
import {gpuCapabilities} from '@/lib/gpu-capabilities';
import {sampleAnatomyPlane,type AnatomyVolumeResult} from '@/lib/anatomy-volume';
import {SmartVolumeSurface} from './smart-volume-surface';
type Props={series?:{id:string;imageIds:string[];modality:string};anatomy?:AnatomyVolumeResult|null;onClose:()=>void};
export function SharedVolumeView(props:Props){
 return typeof window!=='undefined' && location.origin==='https://appassets.androidplatform.net'
   ? <TabletVolumeView {...props}/> : <DesktopVolumeView {...props}/>;
}
function TabletVolumeView({series,anatomy,onClose}:Props){
 const [volume,setVolume]=useState<{data:Awaited<ReturnType<typeof tabletDisplayVolume>>;result:AnatomyVolumeResult}|null>(null);
 const [percent,setPercent]=useState(0),[error,setError]=useState('');
 useEffect(()=>{
   const controller=new AbortController();setPercent(0);setError('');setVolume(null);
   if(!series){setError('3D üçün KT və ya MRT seriyası seçin.');return;}
   const build=async()=>{
     const caps=gpuCapabilities(),low=caps.tier==='low';
     const data=await tabletDisplayVolume(series.imageIds,Math.min(caps.max3DTextureSize,low?192:256),(low?12:24)*1024**2,controller.signal,setPercent);
     const {dimensions,spacing,origin,direction}=data;
     const result:AnatomyVolumeResult={dimensions,spacing,origin,direction,modality:series.modality==='MR'?'MR':'CT',classes:anatomy?.classes||{},mask:new Uint8Array(0),sourceKey:series.id,task:'context',device:'local',seconds:0,modelSpacingMm:null,experimental:true};
     if(anatomy?.mask.length){
       const [width,height,depth]=dimensions;
       result.mask=new Uint8Array(width*height*depth);
       const point=(x:number,y:number,z:number)=>origin.map((n,i)=>n+x*spacing[0]*direction[i]+y*spacing[1]*direction[3+i]+z*spacing[2]*direction[6+i]) as typeof origin;
       for(let z=0;z<depth;z++){
         controller.signal.throwIfAborted();
         result.mask.set(sampleAnatomyPlane(anatomy,point(0,0,z),point(1,0,z),point(0,1,z),width,height),z*width*height);
         if(z%8===0)await new Promise(r=>setTimeout(r,0));
       }
     }
     if(!controller.signal.aborted)setVolume({data,result});
   };
   void build().catch(e=>{if(!controller.signal.aborted)setError(String(e.message||e));});
   return ()=>controller.abort();
 },[series?.id,series?.imageIds.length,anatomy]);
 if(!volume)return <section className="shared-volume-loading"><button onClick={onClose}>Bağla</button><p role="status">{error||`3D hazırlanır… ${percent}%`}</p></section>;
 return <SmartVolumeSurface result={volume.result} colors={{}} sourceValues={volume.data.values} range={volume.data.range} sourceSlices={volume.data.sourceSlices} title="3D həcm görüntüləmə" onClose={onClose}/>;
}
function DesktopVolumeView({series,anatomy,onClose}:Props){
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
