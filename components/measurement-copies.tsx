'use client';
import {useEffect,useRef,useState} from 'react';
import {getMeasurementDicomSource,getViewer} from '@/lib/cornerstone';
import {captureViewport} from '@/lib/export-viewport';
import {saveMeasurementCopy} from '@/lib/measurement-copies';
export function MeasurementCopies({pane,imageId,modality,seriesName,studyId,markCount=0}:{pane:HTMLElement|null;imageId?:string;modality?:string;seriesName?:string;studyId?:string;markCount?:number}){
 const [error,setError]=useState('');
 const tracked=useRef({key:'',touched:false});
 useEffect(()=>{if(!pane||!imageId||!(['CR','DX','DR','RG','RF'].includes(modality||'')||(modality==='OT'&&seriesName?.includes('Stitched'))))return;let disposed=false,revision=0,timer:ReturnType<typeof setTimeout>;
 const key=`${studyId}/${imageId}`;if(tracked.current.key!==key)tracked.current={key,touched:false};
 const capture=async()=>{const token=++revision;try{const {core,tools}=await getViewer();const sop=core.metaData.get('sopCommonModule',imageId);const study=studyId||core.metaData.get('generalStudyModule',imageId)?.studyInstanceUID;
 if(!study||!sop?.sopInstanceUID||disposed)return;const id=study+'/'+sop.sopInstanceUID;
 const has=!!pane.querySelector('svg.measurement-overlay [data-measurement], svg.drawing-overlay [data-mark-id], .dicom-canvas svg [data-annotation-uid]');
 const modelHasMarks=markCount>0||tools.annotation.state.getAllAnnotations().some(annotation=>annotation.metadata?.referencedImageId===imageId);
 // Tool switches can briefly replace the SVG layer. The annotation model is
 // authoritative while it still contains a measurement for this image.
 if(!has&&modelHasMarks)return;
 if(!has&&!tracked.current.touched)return;tracked.current.touched=true;
 const canvas=has?await captureViewport(pane,true):null;const source=has?getMeasurementDicomSource(imageId):null;
 if(has&&!source)throw Error('Ölçülü DICOM mənbəsi tapılmadı');
 const pixels=canvas?.getContext('2d')?.getImageData(0,0,canvas.width,canvas.height).data;
 const blob=canvas&&source&&pixels?await import('@/lib/measurement-dicom').then(({createMeasurementDicom})=>createMeasurementDicom(source,canvas.width,canvas.height,pixels)):null;
 if(disposed||token!==revision)return;if(has&&!blob)throw Error('Ölçülü DICOM yaradıla bilmədi');await saveMeasurementCopy(blob?{id,study,sop:sop.sopInstanceUID,blob,updated:Date.now()}:null,id);setError('');
 }catch{if(!disposed)setError('Ölçülü DICOM saxlanmadı. Yenidən cəhd edin.');}};
 const schedule=()=>{revision++;clearTimeout(timer);timer=setTimeout(()=>void capture(),250);};const observer=new MutationObserver(schedule);observer.observe(pane,{subtree:true,childList:true,attributes:true});schedule();return()=>{disposed=true;revision++;clearTimeout(timer);observer.disconnect();};
 },[pane,imageId,modality,seriesName,studyId,markCount]);return error?<small role="alert" className="measurement-copy-error">{error}</small>:null;
}
