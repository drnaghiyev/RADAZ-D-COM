'use client';
import {useEffect,useState} from 'react';
import {getMeasurementDicomSource,getViewer} from '@/lib/cornerstone';
import {captureViewport} from '@/lib/export-viewport';
import {saveMeasurementCopy} from '@/lib/measurement-copies';
export function MeasurementCopies({pane,imageId,modality,studyId}:{pane:HTMLElement|null;imageId?:string;modality?:string;studyId?:string}){
 const [error,setError]=useState('');
 useEffect(()=>{if(!pane||!imageId||!['CR','DX','DR','RG'].includes(modality||''))return;let disposed=false,touched=false,revision=0,timer:ReturnType<typeof setTimeout>;
 const capture=async()=>{const token=++revision;try{const {core}=await getViewer();const sop=core.metaData.get('sopCommonModule',imageId);const study=studyId||core.metaData.get('generalStudyModule',imageId)?.studyInstanceUID;
 if(!study||!sop?.sopInstanceUID||disposed)return;const id=study+'/'+sop.sopInstanceUID;
 const has=!!pane.querySelector('svg.measurement-overlay [data-measurement], svg.drawing-overlay [data-mark-id], .dicom-canvas svg [data-annotation-uid]');
 if(!has&&!touched)return;touched=true;
 const canvas=has?await captureViewport(pane,true):null;const source=has?getMeasurementDicomSource(imageId):null;
 if(has&&!source)throw Error('Ölçülü DICOM mənbəsi tapılmadı');
 const pixels=canvas?.getContext('2d')?.getImageData(0,0,canvas.width,canvas.height).data;
 const blob=canvas&&source&&pixels?await import('@/lib/measurement-dicom').then(({createMeasurementDicom})=>createMeasurementDicom(source,canvas.width,canvas.height,pixels)):null;
 if(disposed||token!==revision)return;if(has&&!blob)throw Error('Ölçülü DICOM yaradıla bilmədi');await saveMeasurementCopy(blob?{id,study,sop:sop.sopInstanceUID,blob,updated:Date.now()}:null,id);setError('');
 }catch{if(!disposed)setError('Ölçülü DICOM saxlanmadı. Yenidən cəhd edin.');}};
 const schedule=()=>{revision++;clearTimeout(timer);timer=setTimeout(()=>void capture(),250);};const observer=new MutationObserver(schedule);observer.observe(pane,{subtree:true,childList:true,attributes:true});schedule();return()=>{disposed=true;revision++;clearTimeout(timer);observer.disconnect();};
 },[pane,imageId,modality,studyId]);return error?<small role="alert" className="measurement-copy-error">{error}</small>:null;
}
