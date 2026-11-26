'use client';
import {ToolbarDividers} from './toolbar-dividers';
import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import type {KeyboardEvent as ReactKeyboardEvent,PointerEvent as ReactPointerEvent,WheelEvent as ReactWheelEvent} from 'react';
import {ArrowDown, ArrowUp, Circle, Crop as CropIcon, Eraser, Focus, Hand, Maximize2, Minimize2, Minus, Move, RotateCcw, Ruler, Save, SunMoon, Triangle, Waypoints, X, ZoomIn, ZoomOut} from 'lucide-react';
import {Dialog,DialogContent,DialogHeader,DialogTitle} from './ui/dialog';
import {getOriginalDicom} from '@/lib/cornerstone';
import {parseDicomFile} from '@/lib/dicom-file';
import {readDicomPixels} from '@/lib/dicom-pixels';
import {createStitchedDicom,type MeasurementDicomSource} from '@/lib/measurement-dicom';
import {drawStitch,emptyCrop,makeStitchCanvas,renderStitch,sanitizeCrop,stitchLayout,type Crop,type StitchOptions,type StitchRaster,type StitchRect} from '@/lib/xray-stitch';
import {drawStitchMeasures,measurePointCount,nearestStitchMark,type StitchMeasure,type StitchMeasureKind,type StitchPoint} from '@/lib/stitch-measurements';
import {measureTools,type Tool} from '@/app/page';
import {StitchMeasurementViewport,type StitchMeasurementHandle} from './stitch-measurement-viewport';

type Item={id:string;name:string;modality:string;studyId:string;imageIds:string[]};
type Raster=StitchRaster&{source:MeasurementDicomSource;spacing?:[number,number];burnedIn:boolean};
type Mode='none'|'align'|'crop'|'pan'|'window'|StitchMeasureKind|'erase';
type Gesture={mode:Mode|'view';startX:number;startY:number;offsetX:number;offsetY:number;brightness:number;contrast:number;crop:Crop;edges:('left'|'right'|'top'|'bottom')[];layer:0|1;scale:number};
const number=(value:string|undefined)=>{const parsed=Number(value);return Number.isFinite(parsed)&&parsed>0?parsed:0;};

async function load(id:string):Promise<Raster>{
 const bytes=await getOriginalDicom(id);if(!bytes)throw Error('Orijinal DICOM görüntüsü tapılmadı');
 const ds=parseDicomFile(bytes),file=new File([Uint8Array.from(bytes).buffer],'source.dcm',{type:'application/dicom'});
 const image=await readDicomPixels(file)??await import('@/lib/cornerstone').then(({dicomMediaPreview})=>dicomMediaPreview(bytes));
 if(!image)throw Error('Rentgen görüntüsü oxunmadı');
 const spacing=(ds.string('x00280030')||ds.string('x00181164')||'').split('\\').map(number);
 return {width:image.columns,height:image.rows,pixels:image.pixels,
  source:{studyUID:ds.string('x0020000d')||'',sopUID:ds.string('x00080018')||'',sopClassUID:ds.string('x00080016')||'',patientName:ds.string('x00100010')||'',patientId:ds.string('x00100020')||'',studyDate:ds.string('x00080020')||'',studyTime:ds.string('x00080030')||'',accessionNumber:ds.string('x00080050')||'',studyDescription:ds.string('x00081030')||'',birthDate:ds.string('x00100030')||'',patientSex:ds.string('x00100040')||'',instanceNumber:ds.string('x00200013')||'1'},
  spacing:image.spacing||(spacing.length===2&&spacing.every(Boolean)?spacing as [number,number]:undefined),
  burnedIn:ds.string('x00280301')!=='NO'};
}
function inside(x:number,y:number,r:StitchRect){return x>=r.x&&x<=r.x+r.width&&y>=r.y&&y<=r.y+r.height;}
function cropEdges(x:number,y:number,r:StitchRect,tolerance:number){
 const horizontal=x>=r.x-tolerance&&x<=r.x+r.width+tolerance,vertical=y>=r.y-tolerance&&y<=r.y+r.height+tolerance;
 const edges:Gesture['edges']=[];
 if(vertical&&Math.abs(x-r.x)<=tolerance)edges.push('left');
 else if(vertical&&Math.abs(x-r.x-r.width)<=tolerance)edges.push('right');
 if(horizontal&&Math.abs(y-r.y)<=tolerance)edges.push('top');
 else if(horizontal&&Math.abs(y-r.y-r.height)<=tolerance)edges.push('bottom');
 return edges;
}

export function StitchDialog({open,onOpenChange,series,initialImage,onCreated,onMeasure,standalone=false}:{open:boolean;onOpenChange:(open:boolean)=>void;series:Item[];initialImage?:string;onCreated:(file:File)=>Promise<void>;onMeasure?:(file:File)=>void;standalone?:boolean}){
 const options=series.flatMap(item=>item.imageIds.map((id,index)=>({id,label:`${item.name} · ${index+1}/${item.imageIds.length}`})));
 const optionsKey=options.map(item=>item.id).join('|');
 const [first,setFirst]=useState(''),[second,setSecond]=useState(''),[rasters,setRasters]=useState<[Raster,Raster]|null>(null);
 const [crops,setCrops]=useState<[Crop,Crop]>([emptyCrop(),emptyCrop()]),[offsetX,setOffsetX]=useState(0),[offsetY,setOffsetY]=useState(0),[lowerScale,setLowerScale]=useState(1);
 const [topOffset,setTopOffset]=useState({x:0,y:0}),[topScale,setTopScale]=useState(1);
 const [brightness,setBrightness]=useState<[number,number]>([0,0]),[contrast,setContrast]=useState<[number,number]>([1,1]),[feather,setFeather]=useState(true);
 const [mode,setMode]=useState<Mode>('align'),[selected,setSelected]=useState<0|1>(1),[viewPan,setViewPan]=useState({x:0,y:0});
 const [viewFit,setViewFit]=useState(1);
 const [measurementFile,setMeasurementFile]=useState<File|null>(null),[measurementTool,setMeasurementTool]=useState<Tool|null>(null);
 const measurementViewport=useRef<StitchMeasurementHandle>(null);
 const renderedGeometry=useRef('');
 const [measurementFileGeometry,setMeasurementFileGeometry]=useState<import('@/lib/stitch-annotation-geometry').StitchAnnotationGeometry|null>(null);
 const measurementGeometry=JSON.stringify([first,second,crops,offsetX,offsetY,lowerScale,topOffset,topScale,brightness,contrast,feather]);
 useEffect(()=>{setMeasurementFile(null);setMeasurementTool(null);},[first,second]);
 const [marks,setMarks]=useState<StitchMeasure[]>([]),[draft,setDraft]=useState<StitchMeasure|null>(null),[selectedMark,setSelectedMark]=useState<string|null>(null);
 const markDrag=useRef<{id:string;point:number;start:StitchPoint;original:StitchPoint[]}|null>(null);
 const [error,setError]=useState(''),[busy,setBusy]=useState(false),[maximized,setMaximized]=useState(true),[minimized,setMinimized]=useState(false);
 const stage=useRef<HTMLDivElement>(null),canvas=useRef<HTMLCanvasElement>(null),gesture=useRef<Gesture|null>(null);
 const [stageNode,setStageNode]=useState<HTMLDivElement|null>(null),[canvasNode,setCanvasNode]=useState<HTMLCanvasElement|null>(null);
 const bindStage=useCallback((node:HTMLDivElement|null)=>{stage.current=node;setStageNode(node);},[]);
 const bindCanvas=useCallback((node:HTMLCanvasElement|null)=>{canvas.current=node;setCanvasNode(node);},[]);
 const layers=useMemo(()=>rasters?[makeStitchCanvas(rasters[0]),makeStitchCanvas(rasters[1])] as [HTMLCanvasElement,HTMLCanvasElement]:null,[rasters]);
 const stitch:StitchOptions={crops,offsetX,offsetY,lowerScale,topOffsetX:topOffset.x,topOffsetY:topOffset.y,topScale,brightness,contrast,feather};
 const layout=rasters?stitchLayout(rasters,stitch):null;
 const annotationGeometry=layout?{sourceKey:first+'|'+second,left:layout.left,topEdge:layout.topEdge,origins:[topOffset,{x:offsetX,y:offsetY}] as [{x:number;y:number},{x:number;y:number}],scales:[topScale,lowerScale] as [number,number],rects:layout.rects,selected}:null;
 const sourceScale=rasters?.[0].spacing&&rasters?.[1].spacing?rasters[1].spacing[0]/rasters[0].spacing[0]*topScale:1;
 const calibrated=!!rasters?.[0].spacing&&!!rasters?.[1].spacing&&Math.abs(lowerScale-sourceScale)/sourceScale<.01&&Math.abs(rasters[1].spacing[1]/rasters[0].spacing[1]*topScale-sourceScale)<.01;

 useEffect(()=>{if(!open){setMinimized(false);return;}const i=Math.max(0,options.findIndex(item=>item.id===initialImage));setFirst(options[i]?.id||'');setSecond(options[i+1]?.id||options[i-1]?.id||'');setError('');setMode('align');setSelected(1);setMaximized(true);},[open,initialImage,optionsKey]);
 useEffect(()=>{if(!open||!first||!second||first===second){setRasters(null);return;}let cancelled=false;setError('');void Promise.all([load(first),load(second)]).then(value=>{
  if(cancelled)return;const pair=value as [Raster,Raster];if(pair[0].source.studyUID!==pair[1].source.studyUID||pair[0].source.patientId!==pair[1].source.patientId)throw Error('Yalnız eyni pasiyent və müayinənin kadrlarını seçin');
  const scale=pair[0].spacing&&pair[1].spacing?pair[1].spacing[0]/pair[0].spacing[0]:1;
  setRasters(pair);setCrops([emptyCrop(),emptyCrop()]);setOffsetX(0);setOffsetY(Math.round(pair[0].height-Math.min(pair[0].height,pair[1].height*scale)*.12));setLowerScale(Math.max(.25,Math.min(4,scale)));setTopOffset({x:0,y:0});setTopScale(1);setBrightness([0,0]);setContrast([1,1]);setMarks([]);setDraft(null);setSelectedMark(null);
 }).catch(reason=>{if(!cancelled){setRasters(null);setError(reason instanceof Error?reason.message:String(reason));}});return()=>{cancelled=true;};},[open,first,second]);

 const view=()=>{if(!stage.current||!rasters)return null;const width=stage.current.clientWidth,height=stage.current.clientHeight,baseWidth=Math.max(rasters[0].width,rasters[1].width),baseHeight=rasters[0].height+rasters[1].height*.88,scale=Math.min(width/baseWidth,height/baseHeight)*viewFit;
  return {width,height,scale,x:(width-baseWidth*scale)/2+viewPan.x,y:(height-baseHeight*scale)/2+viewPan.y};};
 useEffect(()=>{if(!rasters||!layers||!layout||!canvasNode||!stageNode||minimized||!open)return;const redraw=()=>{
  const v=view(),target=canvasNode;if(!v||!target)return;const dpr=Math.min(2,window.devicePixelRatio||1);target.width=Math.max(1,Math.round(v.width*dpr));target.height=Math.max(1,Math.round(v.height*dpr));
  const ctx=target.getContext('2d');if(!ctx)return;ctx.scale(dpr,dpr);ctx.fillStyle='#000';ctx.fillRect(0,0,v.width,v.height);
  ctx.save();ctx.translate(v.x,v.y);ctx.scale(v.scale,v.scale);drawStitch(ctx,rasters,layers,stitch);
  const spacing=calibrated&&rasters[0].spacing?[rasters[0].spacing[0]/topScale,rasters[0].spacing[1]/topScale] as [number,number]:undefined;
  drawStitchMeasures(ctx,draft?[...marks,draft]:marks,spacing,selectedMark||undefined,v.scale);
  if(mode==='crop'){for(const i of [0,1] as const){const r=layout.rects[i];ctx.strokeStyle=i===selected?'#58e6f0':'#e4ad5b';ctx.lineWidth=2/v.scale;ctx.setLineDash([8/v.scale,5/v.scale]);ctx.strokeRect(r.x,r.y,r.width,r.height);ctx.setLineDash([]);
    for(const [x,y] of [[r.x+r.width/2,r.y],[r.x+r.width/2,r.y+r.height],[r.x,r.y+r.height/2],[r.x+r.width,r.y+r.height/2]]){ctx.fillStyle=ctx.strokeStyle;ctx.fillRect(x-5/v.scale,y-5/v.scale,10/v.scale,10/v.scale);}}}
  ctx.restore();};redraw();const observer=new ResizeObserver(redraw);observer.observe(stageNode);return()=>observer.disconnect();
 },[rasters,layers,crops,offsetX,offsetY,lowerScale,topOffset,topScale,brightness,contrast,feather,mode,selected,maximized,minimized,open,stageNode,canvasNode,viewPan,viewFit,marks,draft,selectedMark]);

 const pointer=(event:ReactPointerEvent<HTMLDivElement>)=>{const v=view(),bounds=stage.current?.getBoundingClientRect();if(!v||!bounds||!layout)return null;
  const x=event.clientX-bounds.left,y=event.clientY-bounds.top,projected=measurementFile?measurementViewport.current?.project(x,y):null;return {x,y,worldX:projected?.x??(x-v.x)/v.scale,worldY:projected?.y??(y-v.y)/v.scale,view:projected?{...v,scale:projected.scale}:v};};
 const onDown=(event:ReactPointerEvent<HTMLDivElement>)=>{if(!rasters||!layout||event.button!==0&&event.button!==1)return;const p=pointer(event);if(!p)return;event.preventDefault();stage.current?.setPointerCapture(event.pointerId);
  if(mode==='none')return;
  if(['length','angle','cobb','ellipse','erase'].includes(mode)){
   const hit=nearestStitchMark(marks,{x:p.worldX,y:p.worldY},12/p.view.scale);
   if(mode==='erase'){if(hit){setMarks(current=>current.filter(mark=>mark.id!==hit.id));setSelectedMark(null);}return;}
   if(hit&&!draft){const found=marks.find(mark=>mark.id===hit.id)!;setSelectedMark(hit.id);markDrag.current={id:hit.id,point:hit.point,start:{x:p.worldX,y:p.worldY},original:found.points.map(point=>({...point}))};return;}
   const kind=mode as StitchMeasureKind,nextPoints=[...(draft?.kind===kind?draft.points:[]),{x:p.worldX,y:p.worldY}];
   if(nextPoints.length>=measurePointCount[kind]){const mark={id:crypto.randomUUID(),kind,points:nextPoints};setMarks(current=>[...current,mark]);setSelectedMark(mark.id);setDraft(null);}
   else setDraft({id:'draft',kind,points:nextPoints});return;
  }
  const clicked:0|1=inside(p.worldX,p.worldY,layout.rects[selected])?selected:inside(p.worldX,p.worldY,layout.rects[1-selected])?1-selected as 0|1:selected;
  let layer=selected,edges=mode==='crop'?cropEdges(p.worldX,p.worldY,layout.rects[selected],12/p.view.scale):[];
  if(mode==='crop'&&!edges.length){const other=1-selected as 0|1;edges=cropEdges(p.worldX,p.worldY,layout.rects[other],12/p.view.scale);if(edges.length)layer=other;else{setSelected(clicked);return;}}
  const actualMode=event.button===1?'pan':mode;
  if(actualMode!=='crop'&&!inside(p.worldX,p.worldY,layout.rects[clicked])){gesture.current={mode:'view',startX:event.clientX,startY:event.clientY,offsetX:viewPan.x,offsetY:viewPan.y,brightness:0,contrast:1,crop:emptyCrop(),edges:[],layer:clicked,scale:p.view.scale};return;}
  if(actualMode!=='crop')layer=clicked;setSelected(layer);
  gesture.current={mode:actualMode,startX:event.clientX,startY:event.clientY,offsetX:layer===0?topOffset.x:offsetX,offsetY:layer===0?topOffset.y:offsetY,brightness:brightness[layer],contrast:contrast[layer],crop:{...crops[layer]},edges,layer,scale:p.view.scale};};
 const onMove=(event:ReactPointerEvent<HTMLDivElement>)=>{const drag=markDrag.current;if(drag){const p=pointer(event);if(!p)return;const dx=p.worldX-drag.start.x,dy=p.worldY-drag.start.y;setMarks(current=>current.map(mark=>mark.id===drag.id?{...mark,points:drag.original.map((point,index)=>drag.point<0||drag.point===index?{x:point.x+dx,y:point.y+dy}:point)}:mark));return;}const g=gesture.current;if(!g||!rasters)return;const dx=(event.clientX-g.startX)/g.scale,dy=(event.clientY-g.startY)/g.scale;
  if(g.mode==='view'){setViewPan({x:g.offsetX+event.clientX-g.startX,y:g.offsetY+event.clientY-g.startY});return;}
  if(g.mode==='pan'||g.mode==='align'){if(g.layer===0)setTopOffset({x:Math.round(g.offsetX+dx),y:Math.round(g.offsetY+dy)});else{setOffsetX(Math.round(g.offsetX+dx));setOffsetY(Math.round(g.offsetY+dy));}return;}
  if(g.mode==='window'){const b=Math.max(-80,Math.min(80,Math.round(g.brightness+dx*.4))),c=Math.max(.5,Math.min(2,Math.round((g.contrast-dy*.004)*100)/100));setBrightness(current=>g.layer===0?[b,current[1]]:[current[0],b]);setContrast(current=>g.layer===0?[c,current[1]]:[current[0],c]);return;}
  const factor=g.layer===0?topScale:lowerScale,base={...g.crop};
  if(g.edges.includes('left'))base.left+=dx/factor;if(g.edges.includes('right'))base.right-=dx/factor;
  if(g.edges.includes('top'))base.top+=dy/factor;if(g.edges.includes('bottom'))base.bottom-=dy/factor;
  const next=sanitizeCrop(base,rasters[g.layer]);setCrops(old=>g.layer===0?[next,old[1]]:[old[0],next]);};
 const scaleSelected=(ratio:number)=>{if(measurementFile){measurementViewport.current?.zoom(ratio);return;}if(selected===0)setTopScale(value=>Math.max(.25,Math.min(4,Math.round(value*ratio*100)/100)));else setLowerScale(value=>Math.max(.25,Math.min(4,Math.round(value*ratio*100)/100)));};
 const onWheel=(event:ReactWheelEvent<HTMLDivElement>)=>{event.preventDefault();const p=pointer(event as unknown as ReactPointerEvent<HTMLDivElement>);if(!p||!layout)return;const clicked=inside(p.worldX,p.worldY,layout.rects[selected])?selected:inside(p.worldX,p.worldY,layout.rects[1-selected])?1-selected as 0|1:selected;setSelected(clicked);
  const ratio=event.deltaY>0?.9:1.1,old=clicked===0?topScale:lowerScale,next=Math.max(.25,Math.min(4,Math.round(old*ratio*100)/100)),factor=next/old;
  if(clicked===0){setTopOffset(current=>({x:Math.round(p.worldX-(p.worldX-current.x)*factor),y:Math.round(p.worldY-(p.worldY-current.y)*factor)}));setTopScale(next);}
  else{setOffsetX(value=>Math.round(p.worldX-(p.worldX-value)*factor));setOffsetY(value=>Math.round(p.worldY-(p.worldY-value)*factor));setLowerScale(next);}};
 const reset=()=>{if(!rasters)return;setCrops([emptyCrop(),emptyCrop()]);setOffsetX(0);setOffsetY(Math.round(rasters[0].height-Math.min(rasters[0].height,rasters[1].height)*.12));setLowerScale(1);setTopOffset({x:0,y:0});setTopScale(1);setBrightness([0,0]);setContrast([1,1]);setViewPan({x:0,y:0});setMarks([]);setDraft(null);setSelectedMark(null);setMeasurementFile(null);setMeasurementTool(null);};
 const centerFrames=()=>{const v=view();if(!v||!layout||!rasters)return;const baseWidth=Math.max(rasters[0].width,rasters[1].width),baseHeight=rasters[0].height+rasters[1].height*.88,scale=Math.min(v.width/layout.width,v.height/layout.height)*.96;setViewFit(scale/Math.min(v.width/baseWidth,v.height/baseHeight));setViewPan({x:(baseWidth/2-layout.left-layout.width/2)*scale,y:(baseHeight/2-layout.topEdge-layout.height/2)*scale});};
 const save=async(measure=false)=>{if(!rasters||!layers||busy)return;setBusy(true);setError('');try{
  const measured=!measure&&measurementFile&&measurementViewport.current?await measurementViewport.current.capture():null;
  const merged=measured?measured.canvas:renderStitch(rasters,layers,stitch),ctx=merged.getContext('2d');if(!ctx)throw Error('Birləşmiş görüntü hazırlanmadı');
  const spacing=calibrated?(measured?measured.spacing:rasters[0].spacing?[rasters[0].spacing[0]/topScale,rasters[0].spacing[1]/topScale] as [number,number]:undefined):undefined;
  if(!measured)drawStitchMeasures(ctx,marks,spacing);
  const rgba=ctx.getImageData(0,0,merged.width,merged.height).data;
  const blob=await createStitchedDicom([rasters[0].source,rasters[1].source],merged.width,merged.height,rgba,spacing,true);
  const file=new File([blob],`RADAZ-Stitch-${Date.now()}.dcm`,{type:'application/dicom'});
  if(measure){renderedGeometry.current=measurementGeometry;setMeasurementFileGeometry(annotationGeometry);setMeasurementFile(file);return;}
  await onCreated(file);onOpenChange(false);
 }catch(reason){setError(reason instanceof Error?reason.message:String(reason));}finally{setBusy(false);}};
 useEffect(()=>{if(!measurementFile||!rasters||busy||renderedGeometry.current===measurementGeometry)return;const timer=setTimeout(()=>void save(true),100);return()=>clearTimeout(timer);},[measurementGeometry,busy,measurementFile]);
 const toggleMode=(next:Mode)=>{setMeasurementTool(null);setMode(current=>current===next?'none':next);};

 const onShortcut=(event:ReactKeyboardEvent)=>{if(event.altKey||event.ctrlKey||event.metaKey||event.target instanceof HTMLElement&&event.target.closest('input,select,textarea'))return;const key=event.key.toLowerCase();const modes:Record<string,Mode>={'1':'align','2':'crop','3':'pan','4':'window','l':'length','a':'angle','b':'cobb','r':'ellipse','e':'erase'};
  const measurement=measureTools.find(item=>item.hint.toLowerCase()===key);if(measurement){event.preventDefault();setMeasurementTool(measurement.id);if(!measurementFile)void save(true);return;}
  if(modes[key]){setMeasurementTool(null);setMode(modes[key]);setDraft(null);}else if(key==='delete'&&selectedMark){setMarks(current=>current.filter(mark=>mark.id!==selectedMark));setSelectedMark(null);}else if(key==='escape'){setDraft(null);setSelectedMark(null);}else if(key==='w')setSelected(1);else if(key==='+'||key==='=')scaleSelected(1.1);else if(key==='-')scaleSelected(.9);else if(key==='0')reset();else if(key==='f'){setMeasurementTool(null);centerFrames();}else if(key==='f11'&&!standalone)setMaximized(value=>!value);else return;event.preventDefault();};
 const content=<>
  <div className="stitch-body"><div className="stitch-stage-wrap"><div className="stitch-stage-toolbar" role="toolbar" aria-label="Stitch ön baxış alətləri">
    <button className={mode==='align'?'active':''} title="Kadrı sürüşdür · 1" onClick={()=>toggleMode('align')}><Move size={16}/>Kadrı sürüşdür</button><button className={mode==='crop'?'active':''} title="Kənardan kəs · 2" onClick={()=>toggleMode('crop')}><CropIcon size={16}/>Kənardan kəs</button><button className={mode==='pan'?'active':''} title="Seçilmiş kadrı hərəkət etdir · 3" onClick={()=>toggleMode('pan')}><Hand size={16}/>Pan</button>
    <button className={mode==='window'?'active':''} title="Seçilmiş kadrın parlaqlığı və kontrastı · 4" onClick={()=>toggleMode('window')}><SunMoon size={16}/>Parlaqlıq / kontrast</button>
    <button aria-label="Yaxınlaşdır" title="Seçilmiş kadrı yaxınlaşdır · +" onClick={()=>scaleSelected(1.1)}><ZoomIn size={16}/></button><button aria-label="Uzaqlaşdır" title="Seçilmiş kadrı uzaqlaşdır · −" onClick={()=>scaleSelected(.9)}><ZoomOut size={16}/></button><button title="Seçilmiş kadrın miqyasını sıfırla" onClick={()=>{if(selected===0)setTopScale(1);else setLowerScale(1);}}><Maximize2 size={16}/>Miqyası sıfırla</button>
    <button title="Görüntüləri mərkəzləşdir · F" onClick={()=>{if(measurementFile)measurementViewport.current?.center();else centerFrames();}}><Focus size={16}/>Görüntüləri mərkəzləşdir</button>
    
    {measureTools.map(item=><button key={item.id} aria-label={item.label} title={`${item.label} · ${item.hint}`} className={measurementTool===item.id?'active':''} disabled={!rasters||busy} onClick={()=>{setMode("none");setMeasurementTool(current=>current===item.id?null:item.id);if(!measurementFile)void save(true);}}><item.icon size={16}/></button>)}  <ToolbarDividers scope="stitch"/></div><div ref={bindStage} className={`stitch-preview stitch-mode-${mode}`} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={()=>{gesture.current=null;markDrag.current=null;}} onPointerCancel={()=>{gesture.current=null;markDrag.current=null;}} onWheel={onWheel}><canvas ref={bindCanvas} aria-label="Birləşmiş rentgen ön baxışı"/>{measurementFile&&annotationGeometry&&<div className="stitch-measure-layer" style={{pointerEvents:measurementTool||mode==="pan"||mode==="window"?"auto":"none"}} onWheelCapture={event=>{event.preventDefault();event.stopPropagation();measurementViewport.current?.zoom(event.deltaY>0?.9:1.1);}} onPointerDown={event=>event.stopPropagation()} onPointerMove={event=>event.stopPropagation()} onPointerUp={event=>event.stopPropagation()} onWheel={event=>event.stopPropagation()}><StitchMeasurementViewport ref={measurementViewport} file={measurementFile} geometry={measurementFileGeometry!} tool={measurementTool||(mode==="pan"?"pan":mode==="window"?"wl":"scroll")}/></div>}</div>
  <p id="stitch-guidance" className="stitch-guidance">{mode==='align'?'Seçilmiş kadrı digər kadra uyğunlaşdırın.':mode==='crop'?'Kadrın yuxarı, aşağı və yan kənarından tutub kəsim sahəsini dəyişin.':mode==='window'?'Seçilmiş kadrda sağa-sola sürükləyin: parlaqlıq; yuxarı-aşağı: kontrast.':mode==='pan'?'Seçilmiş kadrı sürüşdürün. Siçan çarxı ilə yalnız həmin kadrı yaxınlaşdırın.':mode==='erase'?'Ölçünü silmək üçün xəttin üzərinə basın.':'Ölçü nöqtələrini ardıcıl qoyun; xətti və ya ucunu sürüşdürərək düzəldin.'} Q/W: kadr seçimi · C: ümumi mərkəz · L/A/B/R: ölçülər · Delete: sil.</p></div>
  <aside className="stitch-controls"><label>Yuxarı kadr<select value={first} onChange={event=>setFirst(event.target.value)}>{options.map(item=><option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
   <label>Aşağı kadr<select value={second} onChange={event=>setSecond(event.target.value)}>{options.map(item=><option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
   <small data-testid="stitch-offset">Seçilmiş: {selected===0?'yuxarı':'aşağı'} · X {selected===0?topOffset.x:offsetX} px · Y {selected===0?topOffset.y:offsetY} px · miqyas {Math.round((selected===0?topScale:lowerScale)*100)}%</small>
   <div className="stitch-layer-select"><button className={selected===0?'active':''} aria-label="Yuxarı kadr" title="Yuxarı kadr · Q" onClick={()=>setSelected(0)}><ArrowUp size={15}/></button><button className={selected===1?'active':''} aria-label="Aşağı kadr" title="Aşağı kadr · W" onClick={()=>setSelected(1)}><ArrowDown size={15}/></button></div>
   {rasters&&<><small>Kəsim, px: sol {crops[selected].left} · sağ {crops[selected].right} · yuxarı {crops[selected].top} · aşağı {crops[selected].bottom}</small>
    <button aria-label="Seçilən kəsimi sıfırla" title="Seçilən kəsimi sıfırla" onClick={()=>setCrops(current=>selected===0?[emptyCrop(),current[1]]:[current[0],emptyCrop()])}><RotateCcw size={15}/></button>
    <small>Parlaqlıq {brightness[selected]} · kontrast {contrast[selected].toFixed(2)} · miqyas {(selected===0?topScale:lowerScale).toFixed(2)}</small>
    <label className="stitch-check"><input type="checkbox" checked={feather} onChange={event=>setFeather(event.target.checked)}/>Birləşmə xəttini yumşalt</label>
    <small>{calibrated?'Piksel kalibrləməsi uyğunlaşdırılıb; mm ölçüsü saxlanacaq.':'Kalibrləmə qeyri-müəyyəndir; yanlış mm ölçüsü yazılmayacaq.'}</small>
    {rasters.some(item=>item.burnedIn)&&<small>Kadr yazıları DICOM pikselindədirsə, kənarlarını kəsin; anatomiyanın üstündəki yazını avtomatik silmək mümkün deyil.</small>}
   </>}
   {error&&<span role="alert" className="stitch-side-error">{error}</span>}
   <div className="stitch-side-actions"><button aria-label="Hamısını sıfırla" onClick={reset} disabled={!rasters||busy} title="Bərpa et · 0"><RotateCcw size={17}/></button><button aria-label="Ayrıca DICOM kimi saxla" title={busy?'Saxlanır…':'Ayrıca DICOM kimi saxla'} className="stitch-save" disabled={!rasters||busy||first===second} onClick={()=>void save()}><Save size={17}/></button></div>
  </aside></div></>;
 if(standalone)return <div className="stitch-dialog stitch-standalone" onKeyDown={onShortcut} tabIndex={-1}>{content}</div>;
 return <>{open&&minimized&&<button className="stitch-restore" onClick={()=>setMinimized(false)}><Maximize2 size={16}/>Stitch pəncərəsini aç</button>}<Dialog open={open&&!minimized} onOpenChange={busy?undefined:onOpenChange}><DialogContent className={`stitch-dialog ${maximized?'stitch-maximized translate-x-0 translate-y-0':''}`} showCloseButton={false} aria-describedby="stitch-guidance" onKeyDown={onShortcut}><DialogHeader className="stitch-window-header"><DialogTitle>İki rentgen görüntüsünü birləşdir</DialogTitle><div className="stitch-window-actions"><button aria-label="Pəncərəni kiçilt" title="Pəncərəni kiçilt" onClick={()=>setMinimized(true)}><Minus size={17}/></button><button aria-label={maximized?'Pəncərəni bərpa et':'Pəncərəni böyüt'} title={maximized?'Pəncərəni bərpa et · F11':'Tam ekran · F11'} onClick={()=>setMaximized(value=>!value)}>{maximized?<Minimize2 size={17}/>:<Maximize2 size={17}/>}</button><button aria-label="Stitch pəncərəsini bağla" title="Bağla" onClick={()=>onOpenChange(false)}><X size={17}/></button></div></DialogHeader>{content}</DialogContent></Dialog></>;
}
