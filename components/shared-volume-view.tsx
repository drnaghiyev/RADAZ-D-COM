'use client';
import {useEffect,useState} from 'react';
import {tabletDisplayVolume} from '@/lib/cornerstone';
import {gpuCapabilities} from '@/lib/gpu-capabilities';
import {sampleAnatomyPlane,type AnatomyVolumeResult} from '@/lib/anatomy-volume';
import {VrCloseButton} from './vr-close-button';
import {SmartVolumeSurface} from './smart-volume-surface';

type Series={id:string;imageIds:string[];modality:string;loading?:boolean;discovered?:number};
type Props={series?:Series;anatomy?:AnatomyVolumeResult|null;onClose:()=>void};
type Display=Awaited<ReturnType<typeof tabletDisplayVolume>>;
type Loaded={data:Display;geometry:AnatomyVolumeResult;preview:boolean};

function geometryFor(data:Display, source:Series, anatomy:Props['anatomy']):AnatomyVolumeResult {
  const {dimensions,spacing,origin,direction}=data;
  return {dimensions,spacing,origin,direction,modality:source.modality==='MR'?'MR':'CT',mask:new Uint8Array(0),
    classes:anatomy?.classes||{},sourceKey:source.id,task:'context',device:'local',seconds:0,modelSpacingMm:null,experimental:true};
}

export function SharedVolumeView({series,anatomy,onClose}:Props){
  const [loaded,setLoaded]=useState<Loaded|null>(null),[percent,setPercent]=useState(0),[error,setError]=useState('');
  const tablet=typeof location!=='undefined' && location.origin==='https://appassets.androidplatform.net';
  useEffect(()=>{
    const controller=new AbortController(),{signal}=controller;
    setLoaded(null);setPercent(0);setError('');
    if(!series){setError('3D üçün KT və ya MRT seriyası seçin.');return;}
    if(!tablet && series.loading)return;
    async function open(source:Series){
      let limit=256,budget=24;
      try{const gpu=gpuCapabilities();limit=Math.min(gpu.max3DTextureSize,tablet?384:1536);
        budget=tablet?(gpu.tier==='low'?20:48):(gpu.tier==='low'?64:gpu.tier==='high'?320:160);}catch{/* A bounded CPU volume is available without WebGL. */}
      const showPreview=(data:Display)=>{
        if(!signal.aborted)setLoaded({data,geometry:geometryFor(data,source,anatomy),preview:true});
      };
      const data=await tabletDisplayVolume(source.imageIds,limit,budget*1024**2,signal,setPercent,true,tablet?undefined:showPreview);
      const geometry=geometryFor(data,source,anatomy);
      if(anatomy?.mask.length){
        const {dimensions,origin,direction,spacing}=geometry;
        const [w,h,d]=dimensions;geometry.mask=new Uint8Array(w*h*d);
        const at=(x:number,y:number,z:number)=>origin.map((n,i)=>n+x*spacing[0]*direction[i]+y*spacing[1]*direction[3+i]+z*spacing[2]*direction[6+i]) as typeof origin;
        for(let z=0;z<d;z++){signal.throwIfAborted();geometry.mask.set(sampleAnatomyPlane(anatomy,at(0,0,z),at(1,0,z),at(0,1,z),w,h),z*w*h);if(z%8===0)await new Promise(r=>setTimeout(r,0));}
      }
      if(!signal.aborted)setLoaded({data,geometry,preview:false});
    }
    void open(series).catch(e=>{if(!signal.aborted){setLoaded(null);setError(String(e.message||e));}});
    return ()=>controller.abort();
  },[series?.id,series?.imageIds,series?.loading,anatomy,tablet]);
  if(!tablet && series?.loading)return <section className="shared-volume-loading"><VrCloseButton loading onClose={onClose}/><p role="status">Seriya oxunur · {series.imageIds.length}{series.discovered?` / ${series.discovered}`:''} kəsik</p></section>;
  if(!loaded)return <section className="shared-volume-loading"><VrCloseButton loading onClose={onClose}/><p role="status">{error||`3D hazırlanır… ${percent}%`}</p></section>;
  return <SmartVolumeSurface key={loaded.geometry.sourceKey} sourceValues={loaded.data.values} result={loaded.geometry} colors={{}} range={loaded.data.range} sourceSlices={loaded.data.sourceSlices} cpuOnly={loaded.data.cpuOnly}
    progressiveDesktop={!tablet} previewPercent={loaded.preview?percent:undefined} title="3D həcm görüntüləmə" onClose={onClose}/>;
}
