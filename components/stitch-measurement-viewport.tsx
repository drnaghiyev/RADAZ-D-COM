'use client';
import {forwardRef,useCallback,useEffect,useImperativeHandle,useRef,useState} from 'react';
import {ViewportPane,type Tool} from '@/app/page';
import {addLocalDicom,getViewer,releaseLocalDicoms} from '@/lib/cornerstone';
import {WindowLevels} from '@/lib/image-windowing';
import {captureViewport} from '@/lib/export-viewport';
import type {LocalMark} from './measurement-overlay';
import {parseDicomFile} from '@/lib/dicom-file';
import {moveStitchPoint,type StitchAnnotationGeometry} from '@/lib/stitch-annotation-geometry';

export type StitchMeasurementHandle={capture:()=>Promise<{canvas:HTMLCanvasElement;spacing?:[number,number]}>;zoom:(ratio:number)=>void;center:()=>void;project:(x:number,y:number)=>{x:number;y:number;scale:number}|null};
const noop=()=>{};
/** The actual Viewer pane, mounted inside stitch rather than a second Viewer workspace. */
export const StitchMeasurementViewport=forwardRef<StitchMeasurementHandle,{file:File;tool:Tool;geometry:StitchAnnotationGeometry}>(function StitchMeasurementViewport({file,tool,geometry},ref){
 const [id,setId]=useState(''),[error,setError]=useState(''),[marks,setMarks]=useState<LocalMark[]>([]),[selected,setSelected]=useState<string|null>(null);
 const root=useRef<HTMLDivElement>(null),levels=useRef(new WindowLevels());
 const viewerRef=useRef<Awaited<ReturnType<typeof getViewer>>|null>(null),current=useRef<{id:string;geometry:StitchAnnotationGeometry}|null>(null),owned=useRef<string[]>([]),epoch=useRef(0),geometryRef=useRef(geometry),marksRef=useRef(marks);geometryRef.current=geometry;marksRef.current=marks;
 const pending=useRef<{id:string;annotations:any[];marks:LocalMark[]}|null>(null);
 const viewport=()=>{const element=root.current?.querySelector<HTMLDivElement>('.dicom-canvas');return element&&viewerRef.current?.core.getEnabledElement(element)?.viewport;};
 const onImageChange=useCallback((_panel:string,imageId:string)=>{const job=pending.current,viewer=viewerRef.current,element=root.current?.querySelector<HTMLDivElement>('.dicom-canvas');if(!job||job.id!==imageId||!viewer||!element)return;pending.current=null;for(const annotation of job.annotations)viewer.tools.annotation.state.addAnnotation(annotation,element);setMarks(job.marks);viewport()?.render();},[]);
 useEffect(()=>{const token=++epoch.current;void(async()=>{const viewer=await getViewer();viewerRef.current=viewer;const bytes=new Uint8Array(await file.arrayBuffer()),newId=await addLocalDicom(bytes,parseDicomFile(bytes));owned.current.push(newId);if(token!==epoch.current)return;
  const old=current.current,next=geometryRef.current,annotations:any[]=[];let nextMarks:LocalMark[]=[];
  if(old&&old.geometry.sourceKey===next.sourceKey){
   const map=(point:any,layer?:0|1)=>{const pixel=viewer.core.utilities.worldToImageCoords(old.id,point);if(!pixel)return {point,layer};const moved=moveStitchPoint(pixel,old.geometry,next,layer);return {point:viewer.core.utilities.imageToWorldCoords(newId,moved.point as [number,number])||point,layer:moved.layer};};
   for(const annotation of viewer.tools.annotation.state.getAllAnnotations().filter(item=>item.metadata?.referencedImageId===old.id)){
    const copy=structuredClone(annotation) as any,handles=copy.data?.handles;
    if(handles?.points){const layers=handles.radazStitchLayers||[];handles.points=handles.points.map((point:any,index:number)=>{const moved=map(point,layers[index]);layers[index]=moved.layer;return moved.point;});handles.radazStitchLayers=layers;}
    if(handles?.textBox?.worldPosition)handles.textBox.worldPosition=map(handles.textBox.worldPosition,handles.radazStitchLayers?.[0]).point;
    copy.metadata.referencedImageId=newId;copy.metadata.FrameOfReferenceUID=viewer.core.metaData.get('imagePlaneModule',newId)?.frameOfReferenceUID;copy.invalidated=true;copy.data.cachedStats={};viewer.tools.annotation.state.removeAnnotation(annotation.annotationUID!);annotations.push(copy);
   }
   nextMarks=marksRef.current.map(mark=>({...mark,imageId:newId,points:mark.points.map(point=>map(point).point as [number,number,number])}));
  }
  current.current={id:newId,geometry:next};pending.current={id:newId,annotations,marks:nextMarks};setId(newId);
 })().catch(reason=>setError(String(reason)));},[file]);
 useEffect(()=>()=>{epoch.current++;releaseLocalDicoms(owned.current);},[]);
 useImperativeHandle(ref,()=>({zoom:ratio=>{const vp=viewport() as any;if(vp){vp.setZoom(vp.getZoom()*ratio);vp.render();}},center:()=>{const vp=viewport();vp?.resetCamera();vp?.render();},project:(x,y)=>{const vp=viewport(),viewer=viewerRef.current,state=current.current;if(!vp||!viewer||!state)return null;const p=viewer.core.utilities.worldToImageCoords(state.id,vp.canvasToWorld([x,y])),q=viewer.core.utilities.worldToImageCoords(state.id,vp.canvasToWorld([x+1,y]));if(!p||!q)return null;return {x:p[0]+state.geometry.left,y:p[1]+state.geometry.topEdge,scale:1/(Math.hypot(q[0]-p[0],q[1]-p[1])||1)};},capture:async()=>{const pane=root.current?.querySelector<HTMLElement>('[data-panel="STITCH"]'),element=pane?.querySelector<HTMLDivElement>('.dicom-canvas');if(!pane||!element)throw Error('Ölçü görüntüsü hazır deyil');const canvas=await captureViewport(pane,true,false),viewer=await getViewer(),vp=viewer.core.getEnabledElement(element)?.viewport;let spacing:[number,number]|undefined;if(vp){const a=vp.canvasToWorld([0,0]),b=vp.canvasToWorld([1,0]),c=vp.canvasToWorld([0,1]),rect=element.getBoundingClientRect();spacing=[Math.hypot(...c.map((value,index)=>value-a[index]))*rect.height/canvas.height,Math.hypot(...b.map((value,index)=>value-a[index]))*rect.width/canvas.width];}return {canvas,spacing};}}),[]);
 return <div ref={root} className="stitch-inline-measurements">{error&&<span role="alert">{error}</span>}{id&&<ViewportPane id="STITCH" ready selected tool={tool} hideText={false} cursor={null} onCursor={noop} windowLevels={levels.current} series={{id:'stitch-inline',studyId:'stitch-inline',name:'Stitched',modality:'OT',patient:'',patientId:'',birth:'',date:'',number:'',imageIds:[id]}} preset={null} resetToken={0} clearToken={0} marks={marks} selectedMarkId={selected} localizers={false} otherImages={[]} onImageChange={onImageChange} onMoveSource={()=>{}} onAddMark={mark=>setMarks(current=>[...current,mark])} onUpdateMark={(key,patch)=>setMarks(current=>current.map(mark=>mark.id===key?{...mark,...patch}:mark))} onRemoveMark={key=>setMarks(current=>current.filter(mark=>mark.id!==key))} onClearImage={()=>setMarks([])} onSelectMark={setSelected} onSelect={()=>{}} onToggleMaximize={()=>{}} onDropSeries={()=>{}}/>}</div>;
});
