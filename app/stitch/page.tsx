'use client';
import {useEffect,useRef,useState} from 'react';
import {StitchDialog} from '@/components/stitch-dialog';
import {borrowLocalDicoms,releaseLocalDicoms} from '@/lib/cornerstone';
import {readDetachedSource} from '@/lib/detached-viewer';
import Home from '@/app/page';
import {ArrowLeft,Save} from 'lucide-react';
import {captureViewport} from '@/lib/export-viewport';
import {getMeasurementDicomSource} from '@/lib/cornerstone';
import {createMeasurementDicom} from '@/lib/measurement-dicom';

type StitchSeries={id:string;studyId:string;name:string;modality:string;imageIds:string[]};
export default function StitchPage(){
 const [series,setSeries]=useState<StitchSeries[]>([]),[initial,setInitial]=useState<string>();
 const [error,setError]=useState('');
 const [measurementFiles,setMeasurementFiles]=useState<File[]|null>(null),[saving,setSaving]=useState(false);
 const channel=useRef<BroadcastChannel|null>(null),ids=useRef<string[]>([]),revision=useRef('');
 useEffect(()=>{
  const token=new URLSearchParams(location.search).get('handoff');
  if(!token){setError('Mənbə Viewer tapılmadı. Stitch-i əsas pəncərədən açın.');return;}
  const link=new BroadcastChannel(`radaz-${token}`);channel.current=link;
  const sync=()=>{const snapshot=readDetachedSource(token);if(!snapshot)return;if(snapshot.revision===revision.current)return;revision.current=snapshot.revision;
   const next=snapshot.series.map(item=>({...item,imageIds:borrowLocalDicoms(item.images)}));
   const old=ids.current;ids.current=next.flatMap(item=>item.imageIds);setSeries(next);
   const preferred=next.find(item=>item.id===snapshot.preferredSeriesId);
   const originalIndex=snapshot.series.find(item=>item.id===snapshot.preferredSeriesId)?.images.findIndex(item=>item.key.endsWith(`/${snapshot.preferredImageId}`))??-1;
   setInitial(originalIndex>=0?preferred?.imageIds[originalIndex]:preferred?.imageIds[0]||next[0]?.imageIds[0]);
   const retained=new Set(ids.current);setTimeout(()=>releaseLocalDicoms(old.filter(id=>!retained.has(id))),100);
  };
  sync();link.postMessage({kind:'READY'});const timer=setInterval(sync,750);document.title='RADAZ Stitch';
  return()=>{clearInterval(timer);link.close();channel.current=null;releaseLocalDicoms(ids.current);};
 },[]);
 const save=(file:File)=>new Promise<void>((resolve,reject)=>{
  const link=channel.current;if(!link){reject(Error('Əsas Viewer ilə əlaqə kəsildi'));return;}
  const requestId=crypto.randomUUID();const timeout=setTimeout(()=>{link.removeEventListener('message',onMessage);reject(Error('Saxlama cavabı alınmadı'));},30000);
  function onMessage(event:MessageEvent){if(event.data?.requestId!==requestId)return;clearTimeout(timeout);link!.removeEventListener('message',onMessage);if(event.data.kind==='STITCH_SAVED')resolve();else reject(Error(event.data.message||'DICOM saxlanmadı'));}
  link.addEventListener('message',onMessage);link.postMessage({kind:'STITCH_SAVE',requestId,file});
 });
 if(error&&!measurementFiles)return <main style={{padding:24,color:'#f5c6c6'}}>{error}</main>;
 if(!series.length)return <main style={{padding:24,color:'#b9d4df'}}>Rentgen görüntüləri gözlənilir…</main>;
 const saveMeasured=async()=>{setSaving(true);setError('');try{
  const pane=document.querySelector<HTMLElement>('.stitch-measure-editor [data-panel="A"]');if(!pane)throw Error('Ölçü görüntüsü tapılmadı');
  const imageId=pane.dataset.imageId;const {getViewer}=await import('@/lib/cornerstone');const viewer=await getViewer();
  const element=pane.querySelector<HTMLDivElement>('.dicom-canvas');if(!element)throw Error('Görüntü tapılmadı');
  const enabled=viewer.core.getEnabledElement(element);if(!enabled)throw Error('Görüntü hazır deyil');const id=imageId||(enabled.viewport as any).getCurrentImageId();
  const source=getMeasurementDicomSource(id);if(!source)throw Error('DICOM mənbəsi tapılmadı');
  const canvas=await captureViewport(pane,true,false),ctx=canvas.getContext('2d');if(!ctx)throw Error('Görüntü saxlanmadı');
  ctx.fillStyle='#fff';ctx.font='16px Arial';ctx.fillText([source.patientName,source.patientId,source.studyDate].filter(Boolean).join(' · '),12,22);
  const blob=await createMeasurementDicom(source,canvas.width,canvas.height,ctx.getImageData(0,0,canvas.width,canvas.height).data);
  await save(new File([blob],`RADAZ-Stitch-Measured-${Date.now()}.dcm`,{type:'application/dicom'}));window.close();
 }catch(reason){setError(String(reason));}finally{setSaving(false);}};
 return <><div style={{display:measurementFiles?'none':undefined}}><StitchDialog open onOpenChange={open=>{if(!open)window.close();}} series={series} initialImage={initial} onCreated={save} onMeasure={file=>setMeasurementFiles([file])} standalone/></div>{measurementFiles&&<div className="stitch-measure-editor"><div className="stitch-measure-actions"><button title="Stitch-ə qayıt" onClick={()=>setMeasurementFiles(null)}><ArrowLeft/></button><button title="Ölçülərlə DICOM saxla" aria-label="Ölçülərlə DICOM saxla" disabled={saving} onClick={()=>void saveMeasured()}><Save/></button>{error&&<span role="alert">{error}</span>}</div><Home initialFiles={measurementFiles}/></div>}</>;
}
