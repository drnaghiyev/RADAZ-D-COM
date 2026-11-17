'use client';
import {useEffect,useMemo,useRef,useState} from 'react';
import type {KeyboardEvent as ReactKeyboardEvent,PointerEvent as ReactPointerEvent,WheelEvent as ReactWheelEvent} from 'react';
import {Crop as CropIcon,Hand,Maximize2,Move,RotateCcw,Save,SunMoon,ZoomIn,ZoomOut} from 'lucide-react';
import {Dialog,DialogContent,DialogHeader,DialogTitle} from './ui/dialog';
import {getOriginalDicom} from '@/lib/cornerstone';
import {parseDicomFile} from '@/lib/dicom-file';
import {readDicomPixels} from '@/lib/dicom-pixels';
import {createStitchedDicom,type MeasurementDicomSource} from '@/lib/measurement-dicom';
import {drawStitch,emptyCrop,makeStitchCanvas,renderStitch,sanitizeCrop,stitchLayout,type Crop,type StitchOptions,type StitchRaster,type StitchRect} from '@/lib/xray-stitch';

type Item={id:string;name:string;modality:string;studyId:string;imageIds:string[]};
type Raster=StitchRaster&{source:MeasurementDicomSource;spacing?:[number,number];burnedIn:boolean};
type Mode='align'|'crop'|'pan'|'window';
type Gesture={mode:Mode;startX:number;startY:number;offsetX:number;offsetY:number;brightness:number;contrast:number;crop:Crop;edges:('left'|'right'|'top'|'bottom')[];layer:0|1;scale:number};
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
 const [topOffset,setTopOffset]=useState({x:0,y:0}),[topScale,setTopScale]=useState(1);
 const [brightness,setBrightness]=useState<[number,number]>([0,0]),[contrast,setContrast]=useState<[number,number]>([1,1]),[feather,setFeather]=useState(true);
 const [mode,setMode]=useState<Mode>('align'),[selected,setSelected]=useState<0|1>(1);
 const [error,setError]=useState(''),[busy,setBusy]=useState(false);
 const stage=useRef<HTMLDivElement>(null),canvas=useRef<HTMLCanvasElement>(null),gesture=useRef<Gesture|null>(null);
 const layers=useMemo(()=>rasters?[makeStitchCanvas(rasters[0]),makeStitchCanvas(rasters[1])] as [HTMLCanvasElement,HTMLCanvasElement]:null,[rasters]);
 const stitch:StitchOptions={crops,offsetX,offsetY,lowerScale,topOffsetX:topOffset.x,topOffsetY:topOffset.y,topScale,brightness,contrast,feather};
 const layout=rasters?stitchLayout(rasters,stitch):null;
 const sourceScale=rasters?.[0].spacing&&rasters?.[1].spacing?rasters[1].spacing[0]/rasters[0].spacing[0]*topScale:1;
 const calibrated=!!rasters?.[0].spacing&&!!rasters?.[1].spacing&&Math.abs(lowerScale-sourceScale)/sourceScale<.01&&Math.abs(rasters[1].spacing[1]/rasters[0].spacing[1]*topScale-sourceScale)<.01;

 useEffect(()=>{if(!open)return;const i=Math.max(0,options.findIndex(item=>item.id===initialImage));setFirst(options[i]?.id||'');setSecond(options[i+1]?.id||options[i-1]?.id||'');setError('');setMode('align');setSelected(1);},[open,initialImage,optionsKey]);
 useEffect(()=>{if(!open||!first||!second||first===second){setRasters(null);return;}let cancelled=false;setError('');void Promise.all([load(first),load(second)]).then(value=>{
  if(cancelled)return;const pair=value as [Raster,Raster];if(pair[0].source.studyUID!==pair[1].source.studyUID||pair[0].source.patientId!==pair[1].source.patientId)throw Error('Yalnız eyni pasiyent və müayinənin kadrlarını seçin');
  const scale=pair[0].spacing&&pair[1].spacing?pair[1].spacing[0]/pair[0].spacing[0]:1;
  setRasters(pair);setCrops([emptyCrop(),emptyCrop()]);setOffsetX(0);setOffsetY(Math.round(pair[0].height-Math.min(pair[0].height,pair[1].height*scale)*.12));setLowerScale(Math.max(.25,Math.min(4,scale)));setTopOffset({x:0,y:0});setTopScale(1);setBrightness([0,0]);setContrast([1,1]);
 }).catch(reason=>{if(!cancelled){setRasters(null);setError(reason instanceof Error?reason.message:String(reason));}});return()=>{cancelled=true;};},[open,first,second]);

 const view=()=>{if(!stage.current||!rasters)return null;const width=stage.current.clientWidth,height=stage.current.clientHeight,baseWidth=Math.max(rasters[0].width,rasters[1].width),baseHeight=rasters[0].height+rasters[1].height*.88,scale=Math.min(width/baseWidth,height/baseHeight);
  return {width,height,scale,x:(width-baseWidth*scale)/2,y:(height-baseHeight*scale)/2};};
 useEffect(()=>{if(!rasters||!layers||!layout||!canvas.current||!stage.current)return;const redraw=()=>{
  const v=view(),target=canvas.current;if(!v||!target)return;const dpr=Math.min(2,window.devicePixelRatio||1);target.width=Math.max(1,Math.round(v.width*dpr));target.height=Math.max(1,Math.round(v.height*dpr));
  const ctx=target.getContext('2d');if(!ctx)return;ctx.scale(dpr,dpr);ctx.fillStyle='#000';ctx.fillRect(0,0,v.width,v.height);
  ctx.save();ctx.translate(v.x,v.y);ctx.scale(v.scale,v.scale);drawStitch(ctx,rasters,layers,stitch);
  if(mode==='crop'){for(const i of [0,1] as const){const r=layout.rects[i];ctx.strokeStyle=i===selected?'#58e6f0':'#e4ad5b';ctx.lineWidth=2/v.scale;ctx.setLineDash([8/v.scale,5/v.scale]);ctx.strokeRect(r.x,r.y,r.width,r.height);ctx.setLineDash([]);
    for(const [x,y] of [[r.x+r.width/2,r.y],[r.x+r.width/2,r.y+r.height],[r.x,r.y+r.height/2],[r.x+r.width,r.y+r.height/2]]){ctx.fillStyle=ctx.strokeStyle;ctx.fillRect(x-5/v.scale,y-5/v.scale,10/v.scale,10/v.scale);}}}
  ctx.restore();};redraw();const observer=new ResizeObserver(redraw);observer.observe(stage.current);return()=>observer.disconnect();
 },[rasters,layers,crops,offsetX,offsetY,lowerScale,topOffset,topScale,brightness,contrast,feather,mode,selected]);

 const pointer=(event:ReactPointerEvent<HTMLDivElement>)=>{const v=view(),bounds=stage.current?.getBoundingClientRect();if(!v||!bounds||!layout)return null;
  const x=event.clientX-bounds.left,y=event.clientY-bounds.top;return {x,y,worldX:(x-v.x)/v.scale,worldY:(y-v.y)/v.scale,view:v};};
 const onDown=(event:ReactPointerEvent<HTMLDivElement>)=>{if(!rasters||!layout||event.button!==0&&event.button!==1)return;const p=pointer(event);if(!p)return;event.preventDefault();stage.current?.setPointerCapture(event.pointerId);
  const clicked:0|1=inside(p.worldX,p.worldY,layout.rects[selected])?selected:inside(p.worldX,p.worldY,layout.rects[1-selected])?1-selected as 0|1:selected;
  let layer=selected,edges=mode==='crop'?cropEdges(p.worldX,p.worldY,layout.rects[selected],12/p.view.scale):[];
  if(mode==='crop'&&!edges.length){const other=1-selected as 0|1;edges=cropEdges(p.worldX,p.worldY,layout.rects[other],12/p.view.scale);if(edges.length)layer=other;else{setSelected(clicked);return;}}
  const actualMode=event.button===1?'pan':mode;
  if(actualMode!=='crop'&&!inside(p.worldX,p.worldY,layout.rects[clicked]))return;
  if(actualMode!=='crop')layer=clicked;setSelected(layer);
  gesture.current={mode:actualMode,startX:event.clientX,startY:event.clientY,offsetX:layer===0?topOffset.x:offsetX,offsetY:layer===0?topOffset.y:offsetY,brightness:brightness[layer],contrast:contrast[layer],crop:{...crops[layer]},edges,layer,scale:p.view.scale};};
 const onMove=(event:ReactPointerEvent<HTMLDivElement>)=>{const g=gesture.current;if(!g||!rasters)return;const dx=(event.clientX-g.startX)/g.scale,dy=(event.clientY-g.startY)/g.scale;
  if(g.mode==='pan'||g.mode==='align'){if(g.layer===0)setTopOffset({x:Math.round(g.offsetX+dx),y:Math.round(g.offsetY+dy)});else{setOffsetX(Math.round(g.offsetX+dx));setOffsetY(Math.round(g.offsetY+dy));}return;}
  if(g.mode==='window'){const b=Math.max(-80,Math.min(80,Math.round(g.brightness+dx*.4))),c=Math.max(.5,Math.min(2,Math.round((g.contrast-dy*.004)*100)/100));setBrightness(current=>g.layer===0?[b,current[1]]:[current[0],b]);setContrast(current=>g.layer===0?[c,current[1]]:[current[0],c]);return;}
  const factor=g.layer===0?topScale:lowerScale,base={...g.crop};
  if(g.edges.includes('left'))base.left+=dx/factor;if(g.edges.includes('right'))base.right-=dx/factor;
  if(g.edges.includes('top'))base.top+=dy/factor;if(g.edges.includes('bottom'))base.bottom-=dy/factor;
  const next=sanitizeCrop(base,rasters[g.layer]);setCrops(old=>g.layer===0?[next,old[1]]:[old[0],next]);};
 const scaleSelected=(ratio:number)=>{if(selected===0)setTopScale(value=>Math.max(.25,Math.min(4,Math.round(value*ratio*100)/100)));else setLowerScale(value=>Math.max(.25,Math.min(4,Math.round(value*ratio*100)/100)));};
 const onWheel=(event:ReactWheelEvent<HTMLDivElement>)=>{event.preventDefault();const p=pointer(event as unknown as ReactPointerEvent<HTMLDivElement>);if(!p||!layout)return;const clicked=inside(p.worldX,p.worldY,layout.rects[selected])?selected:inside(p.worldX,p.worldY,layout.rects[1-selected])?1-selected as 0|1:selected;setSelected(clicked);
  const ratio=event.deltaY>0?.9:1.1,old=clicked===0?topScale:lowerScale,next=Math.max(.25,Math.min(4,Math.round(old*ratio*100)/100)),factor=next/old;
  if(clicked===0){setTopOffset(current=>({x:Math.round(p.worldX-(p.worldX-current.x)*factor),y:Math.round(p.worldY-(p.worldY-current.y)*factor)}));setTopScale(next);}
  else{setOffsetX(value=>Math.round(p.worldX-(p.worldX-value)*factor));setOffsetY(value=>Math.round(p.worldY-(p.worldY-value)*factor));setLowerScale(next);}};
 const reset=()=>{if(!rasters)return;setCrops([emptyCrop(),emptyCrop()]);setOffsetX(0);setOffsetY(Math.round(rasters[0].height-Math.min(rasters[0].height,rasters[1].height)*.12));setLowerScale(1);setTopOffset({x:0,y:0});setTopScale(1);setBrightness([0,0]);setContrast([1,1]);};
 const save=async()=>{if(!rasters||!layers||busy)return;setBusy(true);setError('');try{
  const merged=renderStitch(rasters,layers,stitch),rgba=merged.getContext('2d')?.getImageData(0,0,merged.width,merged.height).data;if(!rgba)throw Error('Birləşmiş görüntü hazırlanmadı');
  const spacing=calibrated&&rasters[0].spacing?[rasters[0].spacing[0]/topScale,rasters[0].spacing[1]/topScale] as [number,number]:undefined;
  const blob=await createStitchedDicom([rasters[0].source,rasters[1].source],merged.width,merged.height,rgba,spacing,rasters.some(item=>item.burnedIn));
  await onCreated(new File([blob],`RADAZ-Stitch-${Date.now()}.dcm`,{type:'application/dicom'}));onOpenChange(false);
 }catch(reason){setError(reason instanceof Error?reason.message:String(reason));}finally{setBusy(false);}};

 const onShortcut=(event:ReactKeyboardEvent)=>{if(event.altKey||event.ctrlKey||event.metaKey||event.target instanceof HTMLElement&&event.target.closest('input,select,textarea'))return;const key=event.key.toLowerCase();const modes:Record<string,Mode>={'1':'align','2':'crop','3':'pan','4':'window'};
  if(modes[key])setMode(modes[key]);else if(key==='q')setSelected(0);else if(key==='w')setSelected(1);else if(key==='+'||key==='=')scaleSelected(1.1);else if(key==='-')scaleSelected(.9);else if(key==='0')reset();else return;event.preventDefault();};
 return <Dialog open={open} onOpenChange={busy?undefined:onOpenChange}><DialogContent className="stitch-dialog" aria-describedby="stitch-guidance" onKeyDown={onShortcut}><DialogHeader><DialogTitle>İki rentgen görüntüsünü birləşdir</DialogTitle></DialogHeader>
  <div className="stitch-body"><div className="stitch-stage-wrap"><div className="stitch-stage-toolbar" role="toolbar" aria-label="Stitch ön baxış alətləri">
    <button className={mode==='align'?'active':''} title="Kadrı sürüşdür · 1" onClick={()=>setMode('align')}><Move size={16}/>Kadrı sürüşdür</button><button className={mode==='crop'?'active':''} title="Kənardan kəs · 2" onClick={()=>setMode('crop')}><CropIcon size={16}/>Kənardan kəs</button><button className={mode==='pan'?'active':''} title="Seçilmiş kadrı hərəkət etdir · 3" onClick={()=>setMode('pan')}><Hand size={16}/>Pan</button>
    <button className={mode==='window'?'active':''} title="Seçilmiş kadrın parlaqlığı və kontrastı · 4" onClick={()=>setMode('window')}><SunMoon size={16}/>Parlaqlıq / kontrast</button>
    <button aria-label="Yaxınlaşdır" title="Seçilmiş kadrı yaxınlaşdır · +" onClick={()=>scaleSelected(1.1)}><ZoomIn size={16}/></button><button aria-label="Uzaqlaşdır" title="Seçilmiş kadrı uzaqlaşdır · −" onClick={()=>scaleSelected(.9)}><ZoomOut size={16}/></button><button title="Seçilmiş kadrın miqyasını sıfırla" onClick={()=>{if(selected===0)setTopScale(1);else setLowerScale(1);}}><Maximize2 size={16}/>Miqyası sıfırla</button>
  </div><div ref={stage} className={`stitch-preview stitch-mode-${mode}`} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={()=>gesture.current=null} onPointerCancel={()=>gesture.current=null} onWheel={onWheel}><canvas ref={canvas} aria-label="Birləşmiş rentgen ön baxışı"/></div>
  <p id="stitch-guidance" className="stitch-guidance">{mode==='align'?'Seçilmiş kadrı digər kadra uyğunlaşdırın.':mode==='crop'?'Kadrın yuxarı, aşağı və yan kənarından tutub kəsim sahəsini dəyişin.':mode==='window'?'Seçilmiş kadrda sağa-sola sürükləyin: parlaqlıq; yuxarı-aşağı: kontrast.':'Seçilmiş kadrı sürüşdürün. Siçan çarxı ilə yalnız həmin kadrı yaxınlaşdırın.'} Q/W: kadr seçimi · 1–4: alətlər · +/−: miqyas · 0: sıfırla.</p></div>
  <aside className="stitch-controls"><label>Yuxarı kadr<select value={first} onChange={event=>setFirst(event.target.value)}>{options.map(item=><option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
   <label>Aşağı kadr<select value={second} onChange={event=>setSecond(event.target.value)}>{options.map(item=><option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
   <small data-testid="stitch-offset">Seçilmiş: {selected===0?'yuxarı':'aşağı'} · X {selected===0?topOffset.x:offsetX} px · Y {selected===0?topOffset.y:offsetY} px · miqyas {Math.round((selected===0?topScale:lowerScale)*100)}%</small>
   <div className="stitch-layer-select"><button className={selected===0?'active':''} title="Yuxarı kadr · Q" onClick={()=>setSelected(0)}><CropIcon size={15}/>Yuxarı kadr</button><button className={selected===1?'active':''} title="Aşağı kadr · W" onClick={()=>setSelected(1)}><CropIcon size={15}/>Aşağı kadr</button></div>
   {rasters&&<><small>Kəsim, px: sol {crops[selected].left} · sağ {crops[selected].right} · yuxarı {crops[selected].top} · aşağı {crops[selected].bottom}</small>
    <button onClick={()=>setCrops(current=>selected===0?[emptyCrop(),current[1]]:[current[0],emptyCrop()])}><RotateCcw size={15}/>Seçilən kəsimi sıfırla</button>
    <small>Parlaqlıq {brightness[selected]} · kontrast {contrast[selected].toFixed(2)} · miqyas {(selected===0?topScale:lowerScale).toFixed(2)}</small>
    <label className="stitch-check"><input type="checkbox" checked={feather} onChange={event=>setFeather(event.target.checked)}/>Birləşmə xəttini yumşalt</label>
    <small>{calibrated?'Piksel kalibrləməsi uyğunlaşdırılıb; mm ölçüsü saxlanacaq.':'Kalibrləmə qeyri-müəyyəndir; yanlış mm ölçüsü yazılmayacaq.'}</small>
    {rasters.some(item=>item.burnedIn)&&<small>Kadr yazıları DICOM pikselindədirsə, kənarlarını kəsin; anatomiyanın üstündəki yazını avtomatik silmək mümkün deyil.</small>}
   </>}
  </aside></div><footer className="stitch-footer"><button onClick={reset} disabled={!rasters||busy} title="Hamısını sıfırla · 0"><RotateCcw size={15}/>Hamısını sıfırla</button>{error&&<span role="alert">{error}</span>}<button className="stitch-save" disabled={!rasters||busy||first===second} onClick={()=>void save()}><Save size={15}/>{busy?'Saxlanır…':'Ayrıca DICOM kimi saxla'}</button></footer>
 </DialogContent></Dialog>;
}
