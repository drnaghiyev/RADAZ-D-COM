'use client';
import {ToolbarDividers} from './toolbar-dividers';
import {useEffect,useLayoutEffect,useRef,useState,type PointerEvent as ReactPointer,type ReactNode} from 'react';
import {Rotate3D,RotateCw,Move,ZoomIn,Contrast,Scissors,Ruler,MoveUpRight,Camera,Save,Printer,Undo2,Redo2,Maximize,Settings,Box,Layers,Eye,RotateCcw,X,SlidersHorizontal,List,Trash2,FolderOpen,ChevronLeft,ChevronRight,PanelTop} from 'lucide-react';
import {VrOrientation} from './vr-orientation';
import {VrCloseButton} from './vr-close-button';
import {createVrRenderer,type Engine,type Quality} from '@/lib/vr/renderer';
import {add,clamp,cutPlane,faces,fit,initialStyle,orbitDrag,panZoom,pointAt,presets,snapshotValid,turn,type Frame,type Mark,type P,type Snapshot,type Volume,type VrPreset} from '@/lib/vr/scene';
import {bitmapBlob,download,hitMark,imageBlob,drawMarks,drawOrientation} from '@/lib/vr/output';
import {recordVrMovie,type MovieOptions} from '@/lib/vr/movie';
import './vr-workbench.css';
type Tool='rotate'|'roll'|'pan'|'zoom'|'window'|'cut'|'length'|'arrow';
const tools=[['rotate','Fırlat','R',Rotate3D],['roll','Görünüş oxunda döndər','T',RotateCw],['pan','Sürüşdür','M',Move],['zoom','Yaxınlaşdır','Z',ZoomIn],['window','Rəng və şəffaflıq','W',Contrast],['cut','Skalpel','S',Scissors],['length','Proyeksiyada uzunluq','L',Ruler],['arrow','Ox','Y',MoveUpRight]] as const;
type Drag={id:number;tool:Tool;at:P;last:P;start:Snapshot;index?:number;part?:'a'|'b'|'body'|'label'};
const distance=(a:P,b:P)=>Math.max(1,Math.hypot(a[0]-b[0],a[1]-b[1]));
const midpoint=(a:P,b:P):P=>[(a[0]+b[0])/2,(a[1]+b[1])/2];
export function VrWorkbench({volume:v,onClose,title,progressiveDesktop=false,previewPercent}:{volume:Volume;onClose:()=>void;title:string;progressiveDesktop?:boolean;previewPercent?:number}){
 const preview=previewPercent!==undefined;
 const sourceLifecycle=progressiveDesktop?v.identity:v;
 const renderedVolume=useRef<Volume|null>(null);
 const root=useRef<HTMLElement>(null),host=useRef<HTMLDivElement>(null),stage=useRef<HTMLDivElement>(null),overlayRef=useRef<HTMLCanvasElement>(null),file=useRef<HTMLInputElement>(null);
 const api=useRef<ReturnType<typeof createVrRenderer>|null>(null),lastCuts=useRef<Snapshot['cuts']|null>(null);
 const initial=():Snapshot=>({camera:fit(v,1),style:initialStyle(v,v.range),cuts:[],marks:[],duration:3});
 const [s,set]=useState(initial),live=useRef(s);live.current=s;
 const [tool,setTool]=useState<Tool>('rotate'),[menu,setMenu]=useState(''),[hidden,setHidden]=useState(false),[labels,setLabels]=useState(true),[selected,select]=useState(-1);
 const [path,setPath]=useState<P[]>([]),pathRef=useRef(path);pathRef.current=path;
 const [bindings,setBindings]=useState<Record<number,Tool>>({1:'window',2:'zoom',3:'pan',4:'length'});
 const [arrowPrefs,setArrowPrefs]=useState<Record<string,Partial<Mark>>>(()=>{try{return JSON.parse(localStorage.getItem('radaz-vr-arrow-styles')||'{}');}catch{return {};}}),[presetName,setPresetName]=useState('');
 const changeMark=(patch:Partial<Mark>)=>{const cur=live.current;update({...cur,marks:cur.marks.map((m,i)=>i===selected?{...m,...patch}:m)});};
 const storeArrow=(name:string)=>{const mark=live.current.marks[selected];if(!mark||!name.trim())return;const prefs={...arrowPrefs,[name.trim().slice(0,40)]:{color:mark.color||'#66e2e3',lineWidth:mark.lineWidth??2,alpha:mark.alpha??1,head:mark.head||'filled'}};setArrowPrefs(prefs);try{localStorage.setItem('radaz-vr-arrow-styles',JSON.stringify(prefs));}catch{}setPresetName('');};
 const [redo,setRedo]=useState<Snapshot['cuts']>([]),cutFloor=useRef(0);
 const [shots,setShots]=useState<Snapshot[]>([]),[shot,chooseShot]=useState(-1);
 const [engine,setEngine]=useState<Engine>('auto'),[backend,setBackend]=useState(''),[quality,setQuality]=useState<Quality>('balanced'),[message,notice]=useState('');
 const [moving,setMoving]=useState(false),[size,setSize]=useState<P>([1,1]),[progress,setProgress]=useState(-1),[movie,setMovie]=useState<MovieOptions>({mode:'spin',axis:'vertical',arc:'360',duration:5,fps:20,size:960,bitrate:5,loop:false,reverse:false});
 const recording=useRef<AbortController|null>(null),abortOnClose=useRef(false);
 const drag=useRef<Drag|null>(null),touches=useRef(new Map<number,P>()),pinch=useRef<{cam:Frame;a:P;b:P}|null>(null),release=useRef(false),timer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
 const sz=()=>[Math.max(1,stage.current!.clientWidth),Math.max(1,stage.current!.clientHeight)] as P;
 const evt=(e:ReactPointer):P=>{const r=stage.current!.getBoundingClientRect();return [e.clientX-r.left,e.clientY-r.top];};
 const update=(next:Snapshot)=>{live.current=next;set(next);};
 const camera=(cam:Frame)=>update({...live.current,camera:cam});
 const style=(patch:Partial<Snapshot['style']>)=>update({...live.current,style:{...live.current.style,...patch}});
 const setPoly=(points:P[])=>{pathRef.current=points;setPath(points);};
 const choose=(t:Tool)=>{setTool(t);setMenu(t==='cut'?'cut':'');setPoly([]);};
 const toggle=(m:string)=>setMenu(n=>n===m?'':m);
 const reset=()=>{const [w,h]=sz();update({...initial(),camera:fit(v,w/h)});setRedo([]);cutFloor.current=0;setPoly([]);select(-1);};
 const fitView=()=>{const [w,h]=sz(),c=live.current.camera;camera(fit(v,w/h,{...faces[0],normal:c.normal,up:c.up}));};
 const face=(i:number)=>{const [w,h]=sz();camera(fit(v,w/h,faces[i]));setMenu('');};
 const activity=()=>{setMoving(true);clearTimeout(timer.current);timer.current=setTimeout(()=>setMoving(false),160);};
 const applyCut=(inside:boolean)=>{const polygon=pathRef.current;if(polygon.length<3){notice('Kəsiləcək sahəni konturla çəkin.');return;}if(live.current.cuts.length>=128){notice('Bu görünüşdə skalpel limiti dolub.');return;}const cut=cutPlane(v,live.current.camera,polygon,...sz(),inside);update({...live.current,cuts:[...live.current.cuts,cut]});setRedo([]);setPoly([]);};
 const undo=()=>{const a=live.current.cuts;if(a.length<=cutFloor.current)return;setRedo(r=>[...r,a.at(-1)!]);update({...live.current,cuts:a.slice(0,-1)});};
 const redoCut=()=>{if(!redo.length)return;update({...live.current,cuts:[...live.current.cuts,redo.at(-1)!]});setRedo(redo.slice(0,-1));};
 const restoreVolume=()=>{update({...live.current,cuts:[]});setRedo([]);cutFloor.current=0;setPoly([]);};
 const clearHist=()=>{cutFloor.current=live.current.cuts.length;setRedo([]);notice('Skalpel tarixçəsi təmizləndi.');};
 const deleteMark=()=>{if(selected>=0)update({...live.current,marks:live.current.marks.filter((_,i)=>i!==selected)});select(-1);};
 const take=()=>{if(shots.length>=64){notice('Görünüş siyahısı dolub.');return;}setShots(a=>[...a,structuredClone(live.current)]);chooseShot(shots.length);notice('3D görünüş saxlanıldı.');};
 const recall=(i:number)=>{if(i<0||i>=shots.length)return;update(structuredClone(shots[i]));chooseShot(i);select(-1);setRedo([]);cutFloor.current=0;setPoly([]);};
 const identity=JSON.stringify([v.identity,v.dimensions,v.origin,v.spacing,v.direction]);
 const saveShots=()=>download(root.current!.ownerDocument,new Blob([JSON.stringify({format:'radaz-vr-1',identity,shots})],{type:'application/json'}),'RADAZ-3D.radazvr');
 const loadShots=async(f?:File)=>{if(!f)return;try{if(f.size>8e6)throw Error('Görünüş faylı çox böyükdür.');const a=JSON.parse(await f.text());
   if(a.format!=='radaz-vr-1'||a.identity!==identity)throw Error('Bu görünüş faylı seçilmiş seriyaya uyğun deyil.');
   if(!Array.isArray(a.shots)||!a.shots.length||a.shots.length>64||!a.shots.every(snapshotValid))throw Error('Görünüş faylı oxunmadı.');
   setShots(a.shots);chooseShot(0);update(a.shots[0]);setRedo([]);cutFloor.current=0;select(-1);setPoly([]);setMenu('shots');
 }catch(e){notice(String(e));}finally{if(file.current)file.current.value='';}};
 const fullscreen=async()=>{const el=root.current!,doc=el.ownerDocument;if(doc.fullscreenElement)await doc.exitFullscreen();else await el.requestFullscreen();};
 useLayoutEffect(()=>{
   abortOnClose.current=false;const el=stage.current!;let first=true;
   const sizeChanged=()=>{const [w,h]=sz();if(first){first=false;camera(fit(v,w/h));}setSize([w,h]);};
   const doc=el.ownerDocument,view=doc.defaultView!;
   sizeChanged();const resize=new view.ResizeObserver(sizeChanged);resize.observe(el);
   const clearPrint=()=>{doc.querySelector('.vr-print-image')?.remove();};view.addEventListener('afterprint',clearPrint);
   return ()=>{clearPrint();view.removeEventListener('afterprint',clearPrint);abortOnClose.current=true;recording.current?.abort();clearTimeout(timer.current);resize.disconnect();};
 },[sourceLifecycle]);
 useLayoutEffect(()=>{
   setBackend('');lastCuts.current=null;
   const handle=createVrRenderer(host.current!,v,engine,setBackend,notice);
   api.current=handle;renderedVolume.current=v;
   return ()=>{api.current=null;renderedVolume.current=null;handle.dispose();};
 },[sourceLifecycle,engine]);
 useLayoutEffect(()=>{
   if(renderedVolume.current===v || !api.current)return;
   api.current.replacePreview(v);renderedVolume.current=v;lastCuts.current=null;setBackend('');
   update({...live.current,style:initialStyle(v,v.range)});
 },[v]);
 const render=(frame:Snapshot,interaction:boolean)=>{const handle=api.current;if(!handle)return;
   if(lastCuts.current!==frame.cuts){if(frame.cuts.length||lastCuts.current?.length)handle.cut(frame.cuts);lastCuts.current=frame.cuts;}
   handle.draw({cam:frame.camera,style:frame.style,quality,moving:interaction||preview,provisional:preview});
 };
 useLayoutEffect(()=>{if(!recording.current)render(live.current,moving);},[s,moving,quality,size,engine,v]);
 useLayoutEffect(()=>{const canvas=overlayRef.current!,[w,h]=size;if(canvas.width!==w)canvas.width=w;if(canvas.height!==h)canvas.height=h;
   const ctx=canvas.getContext('2d');if(ctx){ctx.clearRect(0,0,w,h);drawMarks(ctx,w,h,s.camera,s.marks,labels,selected,path);}
 },[size,s,labels,selected,path]);
 const frameCanvas=async(frame:Snapshot,width?:number)=>{
   const handle=api.current;if(!handle)throw Error('3D hazır deyil.');
   render(frame,false);const image=await handle.capture(),doc=root.current!.ownerDocument,[w,h]=sz();
   const canvas=doc.createElement('canvas');canvas.width=width||w;canvas.height=Math.max(1,Math.round(canvas.width*h/w));
   const ctx=canvas.getContext('2d')!;ctx.drawImage(image,0,0,canvas.width,canvas.height);ctx.scale(canvas.width/w,canvas.height/h);if(labels)drawOrientation(ctx,w,h,frame.camera,frame.style);drawMarks(ctx,w,h,frame.camera,frame.marks,labels);return canvas;
 };
 const output=async(kind:string)=>{try{
   const doc=root.current!.ownerDocument,canvas=await frameCanvas(live.current);
   if(kind==='print'){const img=doc.createElement('img');img.className='vr-print-image';img.src=canvas.toDataURL('image/png');doc.querySelector('.vr-print-image')?.remove();doc.body.appendChild(img);await img.decode();doc.defaultView!.print();return;}
   if(kind==='copy'){const blob=await imageBlob(canvas,'image/png');await doc.defaultView!.navigator.clipboard.write([new ClipboardItem({'image/png':blob})]);notice('3D görüntü kopyalandı.');return;}
   const blob=kind==='bmp'?bitmapBlob(canvas):await imageBlob(canvas,kind==='jpg'?'image/jpeg':'image/png');download(doc,blob,'RADAZ-3D.'+kind);
 }catch(e){notice(String(e));}};
 const runMovie=async()=>{if(recording.current)return;const control=new AbortController();recording.current=control;setProgress(0);
   try{const doc=root.current!.ownerDocument,blob=await recordVrMovie(doc,live.current,shots,movie,frameCanvas,setProgress,control.signal);download(doc,blob,'RADAZ-3D.'+(blob.type.includes('mp4')?'mp4':'webm'));}
   catch(e){if(!control.signal.aborted)notice(String(e));}finally{recording.current=null;if(!abortOnClose.current){setProgress(-1);render(live.current,false);}}};
 const start=(e:ReactPointer<HTMLDivElement>)=>{
   if(recording.current)return;e.preventDefault();e.currentTarget.setPointerCapture(e.pointerId);const at=evt(e);
   if(e.pointerType==='touch'){touches.current.set(e.pointerId,at);if(touches.current.size>=2){const [a,b]=touches.current.values();
     if(drag.current?.tool==='length'||drag.current?.tool==='arrow')update(drag.current.start);
     pinch.current={cam:live.current.camera,a,b};drag.current=null;setPoly([]);setMoving(true);return;}}
   if(release.current)return;
   const saved=live.current;let t=tool;
   if(e.button!==0)t=bindings[e.button]||tool;else if(e.ctrlKey&&e.altKey)t='roll';else if(e.ctrlKey)t='window';else if(e.altKey||(e.pointerType==='pen'&&tool==='rotate'))t='cut';else if(e.shiftKey&&tool!=='length'&&tool!=='arrow')t='pan';
   if(preview && !['rotate','roll','pan','zoom'].includes(t))t='rotate';
   const hit=labels&&t!=='cut'?hitMark(saved.camera,saved.marks,at,...sz(),e.pointerType==='touch'?15:7):null;
   if(hit){select(hit.i);drag.current={id:e.pointerId,tool:saved.marks[hit.i].kind,at,last:at,start:saved,index:hit.i,part:hit.part};return;}
   select(-1);drag.current={id:e.pointerId,tool:t,at,last:at,start:saved};if(t==='cut'){setMenu('cut');setPoly([at]);return;}
   if(t==='length'||t==='arrow'){if(saved.marks.length>=512)return;const a=pointAt(saved.camera,at,...sz());drag.current.index=saved.marks.length;select(saved.marks.length);setLabels(true);update({...saved,marks:[...saved.marks,{...(t==='arrow'&&arrowPrefs['*']),a,b:a,kind:t}]});}
   else {if(menu)setMenu('');setMoving(true);}
 };
 const move=(e:ReactPointer<HTMLDivElement>)=>{
   const at=evt(e);
   if(touches.current.has(e.pointerId))touches.current.set(e.pointerId,at);
   if(pinch.current&&touches.current.size===2){const [a,b]=touches.current.values(),p=pinch.current;camera(panZoom(p.cam,midpoint(p.a,p.b),midpoint(a,b),distance(p.a,p.b)/distance(a,b),...sz()));return;}
   const g=drag.current;if(!g||e.pointerId!==g.id||release.current)return;
   const [w,h]=sz(),dx=at[0]-g.last[0],dy=at[1]-g.last[1],cam=live.current.camera;g.last=at;
   if(g.tool==='rotate')camera(orbitDrag(g.start.camera,g.at,at,w,h));
   else if(g.tool==='roll')camera(turn(cam,0,0,-dx*.012));
   else if(g.tool==='pan')camera(panZoom(g.start.camera,g.at,at,1,w,h));
   else if(g.tool==='zoom')camera(panZoom(g.start.camera,g.at,g.at,Math.exp((at[1]-g.at[1])*.009),w,h));
   else if(g.tool==='window'){const st=g.start.style,f=Math.max(1,st.ww)*2/Math.min(w,h);style({ww:clamp(st.ww+(at[0]-g.at[0])*f,1,1e6),wl:clamp(st.wl+(at[1]-g.at[1])*f,-1e6,1e6)});}
   else if(g.tool==='cut'){const p=pathRef.current;if(p.length<4096&&distance(p.at(-1)!,at)>2)setPoly([...p,at]);}
   else if(g.index!==undefined){const constrained:P=e.shiftKey&&!g.part?(Math.abs(at[0]-g.at[0])>=Math.abs(at[1]-g.at[1])?[at[0],g.at[1]]:[g.at[0],at[1]]):at;
     const end=pointAt(cam,constrained,w,h),idx=g.index,current=live.current,mark=current.marks[idx];if(!mark)return;
     const original=g.start.marks[idx],delta=add(end,pointAt(cam,g.at,w,h),-1);let change:Partial<Mark>={b:end};
     if(g.part==='body')change={a:add(original.a,delta),b:add(original.b,delta),labelPoint:original.labelPoint?add(original.labelPoint,delta):undefined};else if(g.part==='label')change={labelPoint:end};else if(g.part)change={[g.part]:add(original[g.part],delta)};
     update({...current,marks:current.marks.map((m,i)=>i===idx?{...m,...change}:m)});
   }
 };
 const end=(e:ReactPointer<HTMLDivElement>)=>{
   if(e.type==='pointercancel'&&drag.current?.id===e.pointerId){if(drag.current.tool==='length'||drag.current.tool==='arrow')update(drag.current.start);setPoly([]);}
   if(touches.current.delete(e.pointerId)&&pinch.current){pinch.current=null;release.current=touches.current.size>0;}
   if(!touches.current.size)release.current=false;
   if(drag.current?.id===e.pointerId){const g=drag.current;if((g.tool==='length'||g.tool==='arrow')&&!g.part&&distance(g.at,g.last)<3){update(g.start);select(-1);}drag.current=null;}
   if(!drag.current&&!pinch.current)setMoving(false);if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId);
 };
 const handleKey=(e:KeyboardEvent)=>{
   if((e.target as HTMLElement)?.closest?.('input,select,textarea')||recording.current)return;
   const k=e.key.toLowerCase(),ctrl=e.ctrlKey||e.metaKey,cam=live.current.camera,[w,h]=sz();
   if(preview){
     if(k==='escape')onClose();
     if(k==='escape'||ctrl&&['p','s','c','e'].includes(k)){e.preventDefault();e.stopImmediatePropagation();}
     return;
   }
   if(ctrl&&e.altKey&&k==='f3')setHidden(x=>!x);
   else if(ctrl&&e.altKey&&e.shiftKey&&k==='z')clearHist();
   else if(ctrl&&e.altKey&&k==='0')restoreVolume();
   else if(ctrl&&k==='z')undo();else if(ctrl&&k==='y')redoCut();else if(ctrl&&k==='s')style({shading:!live.current.style.shading});
   else if(ctrl&&k==='r')reset();else if(ctrl&&k==='0')fitView();
   else if(ctrl&&k==='f11')setMenu('window');else if(ctrl&&k==='f3')file.current?.click();
   else if(e.shiftKey&&k==='f3')saveShots();else if(k==='f3')toggle('shots');
   else if(ctrl&&k==='c')void output('copy');else if(ctrl&&k==='e')void output('jpg');else if(ctrl&&k==='p')void output('print');
   else if(k==='f2'){setMovie(m=>({...m,mode:ctrl?'snapshots':'spin'}));setMenu('movie');}
   else if(k.startsWith('arrow')){const x=k==='arrowleft'?-1:k==='arrowright'?1:0,y=k==='arrowup'?-1:k==='arrowdown'?1:0;if(ctrl)camera(panZoom(cam,[0,0],[x*12,y*12],1,w,h));else camera(turn(cam,-x*.09,-y*.09));}
   else if(ctrl&&['+','=','-'].includes(k))camera(panZoom(cam,[w/2,h/2],[w/2,h/2],k==='-'?1.15:1/1.15,w,h));
   else if(k===','||k==='<'||k==='.'||k==='>')camera(turn(cam,0,0,k===','||k==='<'?-.09:.09));
   else if(/^[1-6]$/.test(k))face(+k-1);else if(k==='0'){const def=initialStyle(v,v.range);style({ww:def.ww,wl:def.wl});}
   else if(k==='delete'){if(pathRef.current.length)applyCut(true);else deleteMark();}else if(k==='enter'&&pathRef.current.length)applyCut(false);
   else if(k==='escape'){if(drag.current){update(drag.current.start);drag.current=null;setMoving(false);}setMenu('');setPoly([]);select(-1);}else if(k==='f12')setLabels(a=>!a);else if(k==='f')void fullscreen().catch(e=>notice(String(e)));
   else if(k==='k')take();else if(k===']')recall(Math.min(shots.length-1,shot+1));else if(k==='[')recall(Math.max(0,shot-1));
   else{const found=tools.find(t=>t[2].toLowerCase()===k);if(!found)return;choose(found[0]);}
   e.preventDefault();e.stopImmediatePropagation();
 };
 const keyRef=useRef(handleKey);keyRef.current=handleKey;
 useEffect(()=>{const win=root.current!.ownerDocument.defaultView!,key=(e:KeyboardEvent)=>keyRef.current(e);
   win.addEventListener('keydown',key,true);return ()=>win.removeEventListener('keydown',key,true);},[]);
 const btn=(name:string,icon:ReactNode,action:()=>void,selected?:boolean,disabled=false)=><button type="button" aria-label={name} title={name} onClick={action} aria-pressed={selected} disabled={disabled}>{icon}</button>;
 const option=(name:string,fn:()=>void,disabled=false)=><button type="button" onClick={fn} disabled={disabled}>{name}</button>;
 const docKey=(e:React.DragEvent)=>{e.preventDefault();if(!preview)void loadShots(e.dataTransfer.files[0]);};
 return <section ref={root} className="radaz-vr" aria-label={title} data-volume-preview={preview?'true':undefined} data-source-slices={v.sourceSlices} data-volume-depth={v.dimensions[2]} data-backend={backend} onDrop={docKey} onDragOver={e=>{if(e.dataTransfer.types.includes('Files'))e.preventDefault();}}>
 <div className="vr-tools" hidden={hidden} inert={preview?true:undefined} role="toolbar" aria-label="3D alətləri">
 {btn('Səhnəni sıfırla · Ctrl+R',<RotateCcw/>,reset)}{btn('Şəkil və video ixracı',<Save/>,()=>toggle('output'),menu==='output')}
 {btn('Çap · Ctrl+P',<Printer/>,()=>void output('print'))}{btn('3D görünüşlər · F3',<Camera/>,()=>toggle('shots'),menu==='shots')}
 {btn('Yazılar və istiqamət kubu · F12',<Eye/>,()=>setLabels(a=>!a),labels)}
 {btn('Baxış istiqaməti',<Box/>,()=>toggle('views'),menu==='views')}
 {tools.map(([id,name,key,Icon])=><button type="button" key={id} aria-pressed={tool===id} aria-label={name} title={name+' · '+key} onClick={()=>choose(id)}><Icon/></button>)}
 {btn('3D rəng rejimləri',<Layers/>,()=>toggle('presets'),menu==='presets')}{btn('WW/WL ayarları · Ctrl+F11',<SlidersHorizontal/>,()=>toggle('window'),menu==='window')}
 {btn('3D görüntüləmə ayarları',<Settings/>,()=>toggle('settings'),menu==='settings')}{btn('Ekrana sığdır · Ctrl+0',<Maximize/>,fitView)}
 {btn('Tam ekran · F',<PanelTop/>,()=>void fullscreen().catch(e=>notice(String(e))))}
 <ToolbarDividers scope="vr"/>
 </div><VrCloseButton onClose={onClose}/>{hidden&&<button className="vr-unhide" aria-label="Alət panelini göstər" onClick={()=>setHidden(false)}><List/></button>}
 {menu&&<aside className="vr-menu" aria-label="3D seçimləri"><button className="vr-dismiss" aria-label="Menyunu bağla" onClick={()=>setMenu('')}><X/></button>
 {menu==='views'&&<><strong>Görünüş istiqaməti</strong>{faces.map((f,i)=><button key={f.key} onClick={()=>face(i)}>{f.key} · {f.name}</button>)}</>}
 {menu==='presets'&&<><strong>3D rəng rejimi</strong>{Object.entries(presets).filter(([k])=>v.modality==='MR'?k==='mr'||k.includes('mip'):k!=='mr').map(([key,label])=><button key={key} aria-pressed={s.style.preset===key} onClick={()=>{const def=initialStyle(v,v.range);style({preset:key as VrPreset,wl:def.wl,ww:def.ww});setMenu('');}}>{label}</button>)}</>}
 {menu==='window'&&<><strong>Rəng və şəffaflıq</strong>{(['wl','ww'] as const).map(k=><label key={k}>{k.toUpperCase()}<input type="number" value={Math.round(s.style[k])} onChange={e=>{if(e.target.value)style({[k]:k==='ww'?Math.max(1,+e.target.value):+e.target.value});}}/></label>)}{option('Başlanğıc pəncərə',()=>{const def=initialStyle(v,v.range);style({ww:def.ww,wl:def.wl});})}</>}
 {menu==='cut'&&<><strong>Skalpel</strong>{option('Konturun içini kəs · Del',()=>applyCut(true),path.length<3)}{option('Konturun xaricini kəs · Enter',()=>applyCut(false),path.length<3)}
 {btn('Son kəsimi geri al · Ctrl+Z',<Undo2/>,undo,undefined,s.cuts.length<=cutFloor.current)}{btn('Kəsimi təkrarla · Ctrl+Y',<Redo2/>,redoCut,undefined,!redo.length)}
 {option('Konturu təmizlə',()=>setPoly([]),!path.length)}{option('Həcmi bərpa et',restoreVolume,!s.cuts.length)}{option('Skalpel tarixçəsini təmizlə',clearHist,!s.cuts.length&&!redo.length)}</>}
 {menu==='settings'&&<><strong>3D görüntüləmə</strong><label>Hesablama<select value={engine} onChange={e=>setEngine(e.target.value as Engine)}><option value="auto">Avtomatik</option><option value="gpu">GPU</option><option value="cpu">CPU</option></select></label>
 <label>Hərəkət zamanı keyfiyyət<select value={quality} onChange={e=>setQuality(e.target.value as Quality)}><option value="speed">Sürətli</option><option value="balanced">Balanslı</option><option value="detail">Yüksək detal</option></select></label>
 <label><input type="checkbox" checked={s.style.shading} onChange={e=>style({shading:e.target.checked})}/>Kölgələndirmə</label>
 <label>İşıq<input type="range" min=".05" max=".9" step=".01" value={s.style.brightness} onChange={e=>style({brightness:+e.target.value})}/></label>
 <label>Şəffaflıq<input type="range" min=".01" max="1" step=".01" value={s.style.opacity} onChange={e=>style({opacity:+e.target.value})}/></label>
 {v.mask.length>0&&<><label><input type="checkbox" checked={s.style.context} onChange={e=>style({context:e.target.checked})}/>Anatomik həcm</label><label><input type="checkbox" checked={s.style.segments} onChange={e=>style({segments:e.target.checked})}/>Seqmentlər</label></>}
 {([1,2,3,4] as const).map((n,i)=><label key={n}>{['Orta düymə','Sağ düymə','Siçan geri','Siçan irəli'][i]}<select value={bindings[n]} onChange={e=>setBindings(b=>({...b,[n]:e.target.value as Tool}))}>{tools.map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></label>)}
 {option('Alət panelini gizlət',()=>{setMenu('');setHidden(true);})}{option('Seçilmiş ölçünü və ya oxu sil',deleteMark,selected<0)}</>}
 {menu==='mark'&&s.marks[selected]&&<><strong>İşarənin görünüşü</strong>{s.marks[selected].kind==='arrow'&&<label>Mətn<input maxLength={160} value={s.marks[selected].text||''} onChange={e=>changeMark({text:e.target.value})}/></label>}<label>Rəng<input type="color" value={s.marks[selected].color||'#66e2e3'} onChange={e=>changeMark({color:e.target.value})}/></label><label>Qalınlıq<input type="range" min="1" max="8" value={s.marks[selected].lineWidth??2} onChange={e=>changeMark({lineWidth:+e.target.value})}/></label><label>Görünmə<input type="range" min=".1" max="1" step=".1" value={s.marks[selected].alpha??1} onChange={e=>changeMark({alpha:+e.target.value})}/></label>{s.marks[selected].kind==='arrow'&&<><label>Ox ucu<select value={s.marks[selected].head||'filled'} onChange={e=>changeMark({head:e.target.value as Mark['head']})}><option value="filled">Dolu</option><option value="open">Açıq</option><option value="both">Hər iki uc</option></select></label><label>Üslub adı<input maxLength={40} value={presetName} onChange={e=>setPresetName(e.target.value)}/></label>{option('Üslubu saxla',()=>storeArrow(presetName),!presetName.trim())}{option('Yeni oxlar üçün istifadə et',()=>storeArrow('*'))}{Object.keys(arrowPrefs).filter(k=>k!=='*').map(k=><button key={k} onClick={()=>changeMark(arrowPrefs[k])}>{k}</button>)}</>}{option('İşarəni sil',()=>{deleteMark();setMenu('');})}</>}
 {menu==='shots'&&<><strong>3D görünüşlər</strong><div>{btn('Görünüşü yadda saxla · K',<Camera/>,take)}{btn('Əvvəlki görünüş',<ChevronLeft/>,()=>recall(shot-1),undefined,shot<1)}{btn('Sonrakı görünüş',<ChevronRight/>,()=>recall(shot+1),undefined,shot+1>=shots.length)}</div>
 {shots.map((entry,i)=><div className="vr-shot" key={i}><button aria-pressed={i===shot} onClick={()=>recall(i)}>Görünüş {i+1}</button><label>san<input aria-label={'Görünüş '+(i+1)+' müddəti'} type="number" min=".1" max="300" step=".5" value={entry.duration} onChange={e=>setShots(a=>a.map((t,j)=>i===j?{...t,duration:clamp(+e.target.value,.1,300)}:t))}/></label></div>)}
 <div>{btn('Görünüşü siyahıdan sil',<Trash2/>,()=>{setShots(a=>a.filter((_,i)=>i!==shot));chooseShot(-1);},undefined,shot<0)}{btn('Görünüşləri fayldan aç',<FolderOpen/>,()=>file.current?.click())}{btn('Görünüşləri fayla yaz',<Save/>,saveShots,undefined,!shots.length)}</div></>}
 {menu==='output'&&<><strong>Şəkil və video</strong>{option('JPEG kimi saxla',()=>void output('jpg'))}{option('PNG kimi saxla',()=>void output('png'))}{option('BMP kimi saxla',()=>void output('bmp'))}{option('Görüntünü kopyala',()=>void output('copy'))}{option('Çap et',()=>void output('print'))}{option('Fırlanma videosu · F2',()=>{setMovie(m=>({...m,mode:'spin'}));setMenu('movie');})}{option('Görünüşlərdən video · Ctrl+F2',()=>{setMovie(m=>({...m,mode:'snapshots'}));setMenu('movie');},shots.length<2)}</>}
 {menu==='movie'&&<><strong>3D video</strong><label>Hərəkət<select value={movie.mode} onChange={e=>setMovie({...movie,mode:e.target.value as MovieOptions['mode']})}><option value="spin">360° fırlanma</option><option value="snapshots" disabled={shots.length<2}>Saxlanmış görünüşlər</option></select></label>
 {movie.mode==='spin'?<><label>Fırlanma bucağı<select value={movie.arc} onChange={e=>setMovie({...movie,arc:e.target.value as MovieOptions['arc']})}><option value="360">360°</option><option value="180">180°</option><option value="loop180">180° · geri qayıt</option></select></label><label>Ox<select value={movie.axis} onChange={e=>setMovie({...movie,axis:e.target.value as MovieOptions['axis']})}><option value="vertical">Şaquli</option><option value="horizontal">Üfüqi</option><option value="combined">Hər iki müstəvi</option><option value="roll">Görünüş oxu</option></select></label><label><input type="checkbox" checked={movie.reverse} onChange={e=>setMovie({...movie,reverse:e.target.checked})}/>Əks istiqamət</label><label>Müddət (san)<input type="number" min="1" max="120" value={movie.duration} onChange={e=>setMovie({...movie,duration:clamp(+e.target.value,1,120)})}/></label></>:<label><input type="checkbox" checked={movie.loop} onChange={e=>setMovie({...movie,loop:e.target.checked})}/>İlk görünüşə qayıt</label>}
 {([['fps','Kadr/s',[10,15,20,25,30]],['size','En (piksel)',[480,720,960,1280,1920]],['bitrate','Bit sürəti (Mbit/s)',[2,5,10,16]]] as const).map(([key,label,values])=><label key={key}>{label}<select value={movie[key]} onChange={e=>setMovie({...movie,[key]:+e.target.value})}>{values.map(x=><option key={x}>{x}</option>)}</select></label>)}
 {progress<0?option('Videonu saxla',()=>void runMovie(),movie.mode==='snapshots'&&shots.length<2):<><progress value={progress} max={100}/>{option('Dayandır',()=>recording.current?.abort())}</>}</>}
 </aside>}
 <input ref={file} type="file" hidden accept=".radazvr,.json" onChange={e=>void loadShots(e.target.files?.[0])}/>
 <div className="vr-stage" ref={stage} data-tool={tool} onPointerDown={start} onPointerMove={move} onPointerUp={end} onPointerCancel={end} onLostPointerCapture={e=>{if(drag.current?.id===e.pointerId||touches.current.has(e.pointerId))end(e);}} onWheel={e=>{if(recording.current)return;const r=stage.current!.getBoundingClientRect(),p:P=[e.clientX-r.left,e.clientY-r.top];activity();camera(panZoom(live.current.camera,p,p,Math.exp(clamp(e.deltaY,-200,200)*.0015),...sz()));}} onDoubleClick={e=>{const r=stage.current!.getBoundingClientRect(),hit=hitMark(live.current.camera,live.current.marks,[e.clientX-r.left,e.clientY-r.top],...sz(),14);if(hit){select(hit.i);setMenu('mark');}else fitView();}} onContextMenu={e=>e.preventDefault()}>
 <div className="vr-raster" ref={host} data-ready={!!backend}/><canvas className="vr-overlay" ref={overlayRef}/>{labels&&<VrOrientation camera={s.camera} style={s.style}/>}
 </div><footer><span>{preview?`3D ön baxış · Tam həcm hazırlanır (${previewPercent}%)`:`${backend||'3D hazırlanır…'} · ${v.dimensions.join(' × ')}`}{!preview&&progressiveDesktop&&v.sourceSlices&&` · ${v.sourceSlices} kəsik`}</span><span aria-live="polite">{message}</span>{selected>=0&&<span>{btn('İşarənin xüsusiyyətləri',<SlidersHorizontal/>,()=>toggle('mark'))}{btn('Seçilmiş işarəni sil',<Trash2/>,deleteMark)}</span>}</footer></section>;
}
