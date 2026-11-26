'use client';
import {useMemo} from 'react';
import type {Types} from '@cornerstonejs/core';
import type {AnatomyVolumeResult} from '@/lib/anatomy-volume';
import {VrWorkbench} from './vr-workbench';
type Props={result:AnatomyVolumeResult;colors:Record<number,string>;source?:Types.IImageVolume;sourceValues?:Float32Array;sourceSlices?:number;cpuOnly?:boolean;progressiveDesktop?:boolean;previewPercent?:number;range:[number,number];onClose:()=>void;title?:string};
export function SmartVolumeSurface({result,colors,sourceValues,sourceSlices,cpuOnly,range,onClose,progressiveDesktop,previewPercent,title='3D seqmentasiya'}:Props){
 const palette=JSON.stringify(colors);
 const volume=useMemo(()=>{
   if(!sourceValues||sourceValues.length!==result.dimensions.reduce((a,b)=>a*b,1))return null;
   return {...result,values:sourceValues,sourceSlices,cpuOnly,colors:JSON.parse(palette) as Record<number,string>,identity:result.sourceFingerprint||result.sourceKey,range};
 },[result,sourceValues,sourceSlices,cpuOnly,palette,range[0],range[1]]);
 if(!volume)return <section className="shared-volume-loading"><button onClick={onClose}>Bağla</button><p role="alert">3D mənbənin həndəsəsi ilə piksel sayı uyğun gəlmir.</p></section>;
 return <VrWorkbench volume={volume} onClose={onClose} title={title} progressiveDesktop={progressiveDesktop} previewPercent={previewPercent}/>;
}
