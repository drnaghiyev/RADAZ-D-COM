'use client';
import {useEffect,useMemo,useRef,useState} from 'react';
import type {PointerEvent as ReactPointerEvent,WheelEvent as ReactWheelEvent} from 'react';
import {Dialog,DialogContent,DialogHeader,DialogTitle} from './ui/dialog';
import {getOriginalDicom} from '@/lib/cornerstone';
import {parseDicomFile} from '@/lib/dicom-file';
import {readDicomPixels} from '@/lib/dicom-pixels';
import {createStitchedDicom,type MeasurementDicomSource} from '@/lib/measurement-dicom';
import {drawStitch,emptyCrop,makeStitchCanvas,renderStitch,sanitizeCrop,stitchLayout,type Crop,type StitchOptions,type StitchRaster,type StitchRect} from '@/lib/xray-stitch';

type Item={id:string;name:string;modality:string;studyId:string;imageIds:string[]};
type Raster=StitchRaster&{source:MeasurementDicomSource;spacing?:[number,number];burnedIn:boolean};
type Mode='align'|'crop'|'pan';
type Gesture={mode:Mode;startX:number;startY:number;offsetX:number;offsetY:number;panX:number;panY:number;crop:Crop;edges:('left'|'right'|'top'|'bottom')[];layer:0|1;scale:number};
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

export function StitchDialog({open,onOpenChange,series,initialImage,onCreated}:{open:boolean;onOpenChange:(open:boolean)=>void;series:Item[];initialImage?:string;onCreated:(file:File)=>Promise<void>}){
 const options=series.flatMap(item=>item.imageIds.map((id,index)=>({id,label:`${item.name} · ${index+1}/${item.imageIds.length}`})));
 const optionsKey=options.map(item=>item.id).join('|');
 const [first,setFirst]=useState(''),[second,setSecond]=useState(''),[rasters,setRasters]=useState<[Raster,Raster]|null>(null);
 const [crops,setCrops]=useState<[Crop,Crop]>([emptyCrop(),emptyCrop()]),[offsetX,setOffsetX]=useState(0),[offsetY,setOffsetY]=useState(0),[lowerScale,setLowerScale]=useState(1);
 const [brightness,setBrightness]=useState<[number,number]>([0,0]),[contrast,setContrast]=useState<[number,number]>([1,1]),[feather,setFeather]=useState(true);
 const [mode,setMode]=useState<Mode>('align'),[selected,setSelected]=useState<0|1>(1),[zoom,setZoom]=useState(1),[pan,setPan]=useState({x:0,y:0});
 const [error,setError]=useState(''),[busy,setBusy]=useState(false);
 const stage=useRef<HTMLDivElement>(null),canvas=useRef<HTMLCanvasElement>(null),gesture=useRef<Gesture|null>(null);
 const layers=useMemo(()=>rasters?[makeStitchCanvas(rasters[0]),makeStitchCanvas(rasters[1])] as [HTMLCanvasElement,HTMLCanvasElement]:null,[rasters]);
 const stitch:StitchOptions={crops,offsetX,offsetY,lowerScale,brightness,contrast,feather};
 const layout=rasters?stitchLayout(rasters,stitch):null;
 const sourceScale=rasters?.[0].spacing&&rasters?.[1].spacing?rasters[1].spacing[0]/rasters[0].spacing[0]:1;
 const calibrated=!!rasters?.[0].spacing&&!!rasters?.[1].spacing&&Math.abs(lowerScale-sourceScale)/sourceScale<.01&&Math.abs(rasters[1].spacing[1]/rasters[0].spacing[1]-sourceScale)<.01;

 useEffect(()=>{if(!open)return;const i=Math.max(0,options.findIndex(item=>item.id===initialImage));setFirst(options[i]?.id||'');setSecond(options[i+1]?.id||options[i-1]?.id||'');setError('');setMode('align');setSelected(1);setZoom(1);setPan({x:0,y:0});},[open,initialImage,optionsKey]);
 useEffect(()=>{if(!open||!first||!second||first===second){setRasters(null);return;}let cancelled=false;setError('');void Promise.all([load(first),load(second)]).then(value=>{
  if(cancelled)return;const pair=value as [Raster,Raster];if(pair[0].source.studyUID!==pair[1].source.studyUID||pair[0].source.patientId!==pair[1].source.patientId)throw Error('Yalnız eyni pasiyent və müayinənin kadrlarını seçin');
  const scale=pair[0].spacing&&pair[1].spacing?pair[1].spacing[0]/pair[0].spacing[0]:1;
  setRasters(pair);setCrops([emptyCrop(),emptyCrop()]);setOffsetX(0);setOffsetY(Math.round(pair[0].height-Math.min(pair[0].height,pair[1].height*scale)*.12));setLowerScale(Math.max(.25,Math.min(4,scale)));setBrightness([0,0]);setContrast([1,1]);setZoom(1);setPan({x:0,y:0});
 }).catch(reason=>{if(!cancelled){setRasters(null);setError(reason instanceof Error?reason.message:String(reason));}});return()=>{cancelled=true;};},[open,first,second]);

 const view=()=>{if(!stage.current||!layout)return null;const width=stage.current.clientWidth,height=stage.current.clientHeight,fit=Math.min(width/layout.width,height/layout.height),scale=fit*zoom;
  return {width,height,scale,x:(width-layout.width*scale)/2+pan.x,y:(height-layout.height*scale)/2+pan.y};};
 useEffect(()=>{if(!rasters||!layers||!layout||!canvas.current||!stage.current)return;const redraw=()=>{
  const v=view(),target=canvas.current;if(!v||!target)return;const dpr=Math.min(2,window.devicePixelRatio||1);target.width=Math.max(1,Math.round(v.width*dpr));target.height=Math.max(1,Math.round(v.height*dpr));
  const ctx=target.getContext('2d');if(!ctx)return;ctx.scale(dpr,dpr);ctx.fillStyle='#000';ctx.fillRect(0,0,v.width,v.height);
  ctx.save();ctx.translate(v.x,v.y);ctx.scale(v.scale,v.scale);ctx.translate(-layout.left,-layout.topEdge);drawStitch(ctx,rasters,layers,stitch);
  if(mode==='crop'){const r=layout.rects[selected];ctx.strokeStyle='#58e6f0';ctx.lineWidth=2/v.scale;ctx.setLineDash([8/v.scale,5/v.scale]);ctx.strokeRect(r.x,r.y,r.width,r.height);ctx.setLineDash([]);
    for(const [x,y] of [[r.x+r.width/2,r.y],[r.x+r.width/2,r.y+r.height],[r.x,r.y+r.height/2],[r.x+r.width,r.y+r.height/2]]){ctx.fillStyle='#58e6f0';ctx.fillRect(x-5/v.scale,y-5/v.scale,10/v.scale,10/v.scale);}}
  ctx.restore();};redraw();const observer=new ResizeObserver(redraw);observer.observe(stage.current);return()=>observer.disconnect();
 },[rasters,layers,crops,offsetX,offsetY,lowerScale,brightness,contrast,feather,mode,selected,zoom,pan]);

 const pointer=(event:ReactPointerEvent<HTMLDivElement>)=>{const v=view(),bounds=stage.current?.getBoundingClientRect();if(!v||!bounds||!layout)return null;
  const x=event.clientX-bounds.left,y=event.clientY-bounds.top;return {x,y,worldX:(x-v.x)/v.scale+layout.left,worldY:(y-v.y)/v.scale+layout.topEdge,view:v};};
 const onDown=(event:ReactPointerEvent<HTMLDivElement>)=>{if(!rasters||!layout||event.button!==0&&event.button!==1)return;const p=pointer(event);if(!p)return;event.preventDefault();stage.current?.setPointerCapture(event.pointerId);
  const selectedRect=layout.rects[selected],clicked:0|1=inside(p.worldX,p.worldY,layout.rects[1])?1:0;
  const edges=mode==='crop'?cropEdges(p.worldX,p.worldY,selectedRect,12/p.view.scale):[];
  if(mode==='crop'&&!edges.length){setSelected(clicked);return;}
  const actualMode=event.button===1?'pan':mode;
  if(actualMode==='align'&&!inside(p.worldX,p.worldY,layout.rects[1]))return;
  gesture.current={mode:actualMode,startX:event.clientX,startY:event.clientY,offsetX,offsetY,panX:pan.x,panY:pan.y,crop:{...crops[selected]},edges,layer:selected,scale:p.view.scale};};
 const onMove=(event:ReactPointerEvent<HTMLDivElement>)=>{const g=gesture.current;if(!g||!rasters)return;const dx=(event.clientX-g.startX)/g.scale,dy=(event.clientY-g.startY)/g.scale;
  if(g.mode==='pan'){setPan({x:g.panX+event.clientX-g.startX,y:g.panY+event.clientY-g.startY});return;}
  if(g.mode==='align'){setOffsetX(Math.round(g.offsetX+dx));setOffsetY(Math.round(g.offsetY+dy));return;}
  const factor=g.layer===0?1:lowerScale,base={...g.crop};
  if(g.edges.includes('left'))base.left+=dx/factor;if(g.edges.includes('right'))base.right-=dx/factor;
  if(g.edges.includes('top'))base.top+=dy/factor;if(g.edges.includes('bottom'))base.bottom-=dy/factor;
  const next=sanitizeCrop(base,rasters[g.layer]);setCrops(old=>g.layer===0?[next,old[1]]:[old[0],next]);};
 const onWheel=(event:ReactWheelEvent<HTMLDivElement>)=>{event.preventDefault();const p=pointer(event as unknown as ReactPointerEvent<HTMLDivElement>);if(!p||!layout)return;
  const next=Math.max(.2,Math.min(8,zoom*(event.deltaY>0?.9:1.1))),newScale=p.view.scale*next/zoom;
  setPan({x:pan.x+(p.x-p.view.x)*(1-newScale/p.view.scale),y:pan.y+(p.y-p.view.y)*(1-newScale/p.view.scale)});setZoom(next);};
 const reset=()=>{if(!rasters)return;setCrops([emptyCrop(),emptyCrop()]);setOffsetX(0);setOffsetY(Math.round(rasters[0].height-Math.min(rasters[0].height,rasters[1].height*lowerScale)*.12));setBrightness([0,0]);setContrast([1,1]);setPan({x:0,y:0});setZoom(1);};
 const save=async()=>{if(!rasters||!layers||busy)return;setBusy(true);setError('');try{
  const merged=renderStitch(rasters,layers,stitch),rgba=merged.getContext('2d')?.getImageData(0,0,merged.width,merged.height).data;if(!rgba)throw Error('Birləşmiş görüntü hazırlanmadı');
  const blob=await createStitchedDicom([rasters[0].source,rasters[1].source],merged.width,merged.height,rgba,calibrated?rasters[0].spacing:undefined,rasters.some(item=>item.burnedIn));
  await onCreated(new File([blob],`RADAZ-Stitch-${Date.now()}.dcm`,{type:'application/dicom'}));onOpenChange(false);
 }catch(reason){setError(reason instanceof Error?reason.message:String(reason));}finally{setBusy(false);}};

 return <Dialog open={open} onOpenChange={busy?undefined:onOpenChange}><DialogContent className="stitch-dialog" aria-describedby="stitch-guidance"><DialogHeader><DialogTitle>İki rentgen görüntüsünü birləşdir</DialogTitle></DialogHeader>
  <div className="stitch-body"><div className="stitch-stage-wrap"><div className="stitch-stage-toolbar" role="toolbar" aria-label="Stitch ön baxış alətləri">
    <button className={mode==='align'?'active':''} onClick={()=>setMode('align')}>Kadrı sürüşdür</button><button className={mode==='crop'?'active':''} onClick={()=>setMode('crop')}>Kənardan kəs</button><button className={mode==='pan'?'active':''} onClick={()=>setMode('pan')}>Pan</button>
    <button aria-label="Yaxınlaşdır" onClick={()=>setZoom(value=>Math.min(8,value*1.2))}>＋</button><button aria-label="Uzaqlaşdır" onClick={()=>setZoom(value=>Math.max(.2,value/1.2))}>−</button><button onClick={()=>{setZoom(1);setPan({x:0,y:0});}}>Ekrana sığdır</button>
  </div><div ref={stage} className={`stitch-preview stitch-mode-${mode}`} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={()=>gesture.current=null} onPointerCancel={()=>gesture.current=null} onWheel={onWheel}><canvas ref={canvas} aria-label="Birləşmiş rentgen ön baxışı"/></div>
  <p id="stitch-guidance" className="stitch-guidance">{mode==='align'?'Aşağı kadrı tutub yuxarı kadra uyğunlaşdırın.':mode==='crop'?'Kadrı seçin, sonra işarələnən kənarından tutub kəsim sahəsini dəyişin.':'Görüntünü sürüşdürün. Siçan çarxı ilə yaxınlaşdırın.'}</p></div>
  <aside className="stitch-controls"><label>Yuxarı kadr<select value={first} onChange={event=>setFirst(event.target.value)}>{options.map(item=><option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
   <label>Aşağı kadr<select value={second} onChange={event=>setSecond(event.target.value)}>{options.map(item=><option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
   <small data-testid="stitch-offset">Uyğunluq: X {offsetX} px · Y {offsetY} px · ön baxış {Math.round(zoom*100)}%</small>
   <div className="stitch-layer-select"><button className={selected===0?'active':''} onClick={()=>{setSelected(0);setMode('crop');}}>Yuxarı kəsim</button><button className={selected===1?'active':''} onClick={()=>{setSelected(1);setMode('crop');}}>Aşağı kəsim</button></div>
   {rasters&&<><small>Kəsim, px: sol {crops[selected].left} · sağ {crops[selected].right} · yuxarı {crops[selected].top} · aşağı {crops[selected].bottom}</small>
    <button onClick={()=>setCrops(current=>selected===0?[emptyCrop(),current[1]]:[current[0],emptyCrop()])}>Seçilən kəsimi sıfırla</button>
    <label>Yuxarı parlaqlıq: {brightness[0]}<input type="range" min="-80" max="80" value={brightness[0]} onChange={event=>setBrightness([Number(event.target.value),brightness[1]])}/></label>
    <label>Aşağı parlaqlıq: {brightness[1]}<input type="range" min="-80" max="80" value={brightness[1]} onChange={event=>setBrightness([brightness[0],Number(event.target.value)])}/></label>
    <label>Yuxarı kontrast: {contrast[0].toFixed(2)}<input type="range" min="0.5" max="2" step="0.05" value={contrast[0]} onChange={event=>setContrast([Number(event.target.value),contrast[1]])}/></label>
    <label>Aşağı kontrast: {contrast[1].toFixed(2)}<input type="range" min="0.5" max="2" step="0.05" value={contrast[1]} onChange={event=>setContrast([contrast[0],Number(event.target.value)])}/></label>
    <label>Aşağı kadr miqyası: {lowerScale.toFixed(2)}<input type="range" min="0.25" max="4" step="0.01" value={lowerScale} onChange={event=>setLowerScale(Number(event.target.value))}/></label>
    <label className="stitch-check"><input type="checkbox" checked={feather} onChange={event=>setFeather(event.target.checked)}/>Birləşmə xəttini yumşalt</label>
    <small>{calibrated?'Piksel kalibrləməsi uyğunlaşdırılıb; mm ölçüsü saxlanacaq.':'Kalibrləmə qeyri-müəyyəndir; yanlış mm ölçüsü yazılmayacaq.'}</small>
    {rasters.some(item=>item.burnedIn)&&<small>Kadr yazıları DICOM pikselindədirsə, kənarlarını kəsin; anatomiyanın üstündəki yazını avtomatik silmək mümkün deyil.</small>}
   </>}
  </aside></div><footer className="stitch-footer"><button onClick={reset} disabled={!rasters||busy}>Hamısını sıfırla</button>{error&&<span role="alert">{error}</span>}<button className="stitch-save" disabled={!rasters||busy||first===second} onClick={()=>void save()}>{busy?'Saxlanır…':'Ayrıca DICOM kimi saxla'}</button></footer>
 </DialogContent></Dialog>;
}
