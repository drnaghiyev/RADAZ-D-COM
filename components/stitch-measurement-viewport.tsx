'use client';
import {forwardRef,useEffect,useImperativeHandle,useRef,useState} from 'react';
import {ViewportPane,type Tool} from '@/app/page';
import {addLocalDicom,getViewer,releaseLocalDicoms} from '@/lib/cornerstone';
import {WindowLevels} from '@/lib/image-windowing';
import {captureViewport} from '@/lib/export-viewport';
import type {LocalMark} from './measurement-overlay';
import {parseDicomFile} from '@/lib/dicom-file';

export type StitchMeasurementHandle={capture:()=>Promise<{canvas:HTMLCanvasElement;spacing?:[number,number]}>};
/** The actual Viewer pane, mounted inside stitch rather than a second Viewer workspace. */
export const StitchMeasurementViewport=forwardRef<StitchMeasurementHandle,{file:File;tool:Tool}>(function StitchMeasurementViewport({file,tool},ref){
 const [id,setId]=useState(''),[error,setError]=useState(''),[marks,setMarks]=useState<LocalMark[]>([]),[selected,setSelected]=useState<string|null>(null);
 const root=useRef<HTMLDivElement>(null),levels=useRef(new WindowLevels());
 useEffect(()=>{let cancelled=false,owned='';void(async()=>{await getViewer();const bytes=new Uint8Array(await file.arrayBuffer());owned=await addLocalDicom(bytes,parseDicomFile(bytes));if(cancelled){releaseLocalDicoms([owned]);return;}setMarks([]);setId(owned);})().catch(reason=>setError(String(reason)));return()=>{cancelled=true;if(owned)releaseLocalDicoms([owned]);};},[file]);
 useImperativeHandle(ref,()=>({capture:async()=>{const pane=root.current?.querySelector<HTMLElement>('[data-panel="STITCH"]'),element=pane?.querySelector<HTMLDivElement>('.dicom-canvas');if(!pane||!element)throw Error('Ölçü görüntüsü hazır deyil');const canvas=await captureViewport(pane,true,false),viewer=await getViewer(),vp=viewer.core.getEnabledElement(element)?.viewport;let spacing:[number,number]|undefined;if(vp){const a=vp.canvasToWorld([0,0]),b=vp.canvasToWorld([1,0]),c=vp.canvasToWorld([0,1]),rect=element.getBoundingClientRect();spacing=[Math.hypot(...c.map((value,index)=>value-a[index]))*rect.height/canvas.height,Math.hypot(...b.map((value,index)=>value-a[index]))*rect.width/canvas.width];}return {canvas,spacing};}}),[]);
 return <div ref={root} className="stitch-inline-measurements">{error&&<span role="alert">{error}</span>}{id&&<ViewportPane id="STITCH" ready selected tool={tool} hideText={false} cursor={null} onCursor={()=>{}} windowLevels={levels.current} series={{id:'stitch-inline',studyId:'stitch-inline',name:'Stitched',modality:'OT',patient:'',patientId:'',birth:'',date:'',number:'',imageIds:[id]}} preset={null} resetToken={0} clearToken={0} marks={marks} selectedMarkId={selected} localizers={false} otherImages={[]} onImageChange={()=>{}} onMoveSource={()=>{}} onAddMark={mark=>setMarks(current=>[...current,mark])} onUpdateMark={(key,patch)=>setMarks(current=>current.map(mark=>mark.id===key?{...mark,...patch}:mark))} onRemoveMark={key=>setMarks(current=>current.filter(mark=>mark.id!==key))} onClearImage={()=>setMarks([])} onSelectMark={setSelected} onSelect={()=>{}} onToggleMaximize={()=>{}} onDropSeries={()=>{}}/>}</div>;
});
