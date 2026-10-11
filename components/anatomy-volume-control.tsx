'use client';
import {useEffect,useRef,useState} from 'react';
import type * as Core from '@cornerstonejs/core';
import {anatomyVolumeSource} from '@/lib/cornerstone';
import {anatomyVolumeError,volumeSourceKey,volumeRequest,volumeLabelAt,sampleAnatomyPlane,type AnatomyVolumeResult} from '@/lib/anatomy-volume';
import type {Point3} from '@/lib/localizer';
import {useTranslation,type MessageKey} from '@/lib/i18n';
import {anatomyTerm,anatomyCategory} from '@/lib/anatomy-terms';
import {initialAppearance,labelHex,brushIndices,correct,structureCenter,type AnatomyAppearance} from '@/lib/anatomy-editing';
import {sha256,sourceFingerprint,exportSegmentation,importSegmentation} from '@/lib/anatomy-file';
import type {LocalMark} from './measurement-overlay';

type Source={id:string;imageIds:string[];modality:string;loading?:boolean};
type State={phase:string;progress?:number;error?:string;device?:string};
const sleep=(ms:number,signal:AbortSignal)=>new Promise<void>((resolve,reject)=>{const id=setTimeout(done,ms);function done(){signal.removeEventListener('abort',abort);resolve();}function abort(){clearTimeout(id);reject(new DOMException('Cancelled','AbortError'));}signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();});
export function useAnatomyVolume(){
 const [state,setState]=useState<State>({phase:'idle'}),[result,setResult]=useState<AnatomyVolumeResult|null>(null);
 const {t}=useTranslation();
 const [appearance,setAppearance]=useState<AnatomyAppearance>(initialAppearance);
 const [mode,setMode]=useState<'pick'|'brush'|'erase'>('pick'),[brushRadius,setBrushRadius]=useState(3);
 const [history,setHistory]=useState<Map<number,number>[]>([]),[future,setFuture]=useState<Map<number,number>[]>([]);
 const [task,setTask]=useState('');
 const painting=useRef(false);
 const [visible,setVisible]=useState(true),[opacity,setOpacity]=useState(.22);
 const active=useRef<{controller:AbortController;id?:string}|null>(null);
 const cancel=()=>{const previous=active.current;active.current=null;previous?.controller.abort();if(previous?.id)void volumeRequest(`/jobs/${previous.id}`,{method:'DELETE'}).catch(()=>{});setState({phase:'idle'});};
 useEffect(()=>()=>{const previous=active.current;previous?.controller.abort();if(previous?.id)void volumeRequest(`/jobs/${previous.id}`,{method:'DELETE',keepalive:true}).catch(()=>{});},[]);
 const start=async(source:Source)=>{
  cancel();setVisible(true);const controller=new AbortController(),run={controller,id:undefined as string|undefined};active.current=run;
  const {signal}=controller;const current=()=>active.current===run&&!signal.aborted;
  try{
   setState({phase:'preparing'});
   if(source.loading)throw Error(t('anatomy.waitSeries'));
   const sourceIds=[...source.imageIds],input=anatomyVolumeSource(sourceIds),sourceKey=volumeSourceKey(sourceIds);
   const job=await volumeRequest<{id:string}>('/jobs',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...input.geometry,task:task||undefined}),signal});run.id=job.id;
   const hashes:string[]=[];
   for(let z=0;z<input.geometry.dimensions[2];z++){
    signal.throwIfAborted();const pixels=await input.slice(z,signal);hashes.push(await sha256(new Uint8Array(pixels.buffer as ArrayBuffer)));
    await volumeRequest(`/jobs/${job.id}/slices/${z}`,{method:'PUT',headers:{'Content-Type':'application/octet-stream'},body:pixels.buffer as ArrayBuffer,signal});
    if(current())setState({phase:'uploading',progress:(z+1)/input.geometry.dimensions[2]});
   }
   await volumeRequest(`/jobs/${job.id}/run`,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}',signal});
   while(current()){
    const status=await volumeRequest<{state:string;device?:string;error?:string}>(`/jobs/${job.id}`,{signal});
    if(status.state==='error')throw Error(anatomyVolumeError(status.error||''));
    if(status.state==='ready')break;
    if(status.state==='cancelled')throw new DOMException('Cancelled','AbortError');
    if(current())setState({phase:status.state,device:status.device});await sleep(1200,signal);
   }
   signal.throwIfAborted();
   const meta=await volumeRequest<Omit<AnatomyVolumeResult,'mask'|'sourceKey'>>(`/jobs/${job.id}/result`,{signal});
   // Never attach a result whose physical mapping differs from the uploaded volume.
   for(const key of ['dimensions','spacing','origin','direction'] as const)if(meta[key].length!==input.geometry[key].length||meta[key].some((n,i)=>!Number.isFinite(n)||Math.abs(n-input.geometry[key][i])>1e-5))throw Error(anatomyVolumeError('output_geometry_mismatch'));
   const response=await fetch(`/anatomy-volume/jobs/${job.id}/mask`,{signal,cache:'no-store'});if(!response.ok)throw Error(anatomyVolumeError('job_expired'));
   const mask=new Uint8Array(await response.arrayBuffer());if(mask.length!==meta.dimensions.reduce((a,b)=>a*b,1))throw Error(anatomyVolumeError('output_geometry_mismatch'));
   const fingerprint=await sourceFingerprint(input.geometry,hashes);
   if(current()){setResult({...meta,mask,sourceKey,sourceFingerprint:fingerprint});setAppearance(initialAppearance());setHistory([]);setFuture([]);setState({phase:'ready',device:meta.device});}
  }catch(error){if(current())setState({phase:'error',error:error instanceof Error?error.message:t('anatomy.inference_failed')});}
  finally{if(run.id)void volumeRequest(`/jobs/${run.id}`,{method:'DELETE'}).catch(()=>{});if(active.current===run)active.current=null;}
 };
 const paint=(center:Point3,normal:Point3)=>{
  if(!result||mode==='pick'||mode==='brush'&&!appearance.selected)return;
  try{const before=result.corrections??new Map<number,number>(),next=correct(result,brushIndices(result,center,normal,brushRadius),mode==='erase'?0:appearance.selected);
   // Keep snapshot history bounded by both count and total sparse entries.
   if(!painting.current)setHistory(current=>{const entries=[...current,before];while(entries.length>20||entries.reduce((n,item)=>n+item.size,0)>200000)entries.shift();return entries;});painting.current=true;setFuture([]);setResult({...result,corrections:next});
  }catch{setState({phase:'error',error:t('anatomy.out_of_memory')});}
 };
 const undo=()=>{if(!result||!history.length)return;setFuture(current=>[...current,result.corrections??new Map()]);setResult({...result,corrections:history.at(-1)!});setHistory(history.slice(0,-1));};
 const redo=()=>{if(!result||!future.length)return;setHistory(current=>[...current,result.corrections??new Map()]);setResult({...result,corrections:future.at(-1)!});setFuture(future.slice(0,-1));};
 const save=async()=>{if(!result)return;try{const url=URL.createObjectURL(await exportSegmentation(result)),a=document.createElement('a');a.href=url;a.download='RADAZ-anatomy.radazseg';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch{setState({phase:'error',error:t('anatomy.invalidImport')});}};
 const load=async(file:File,source:Source)=>{cancel();const run={controller:new AbortController(),id:undefined as string|undefined};active.current=run;try{
  setState({phase:'preparing'});if(source.loading)throw Error(t('anatomy.waitSeries'));
  const input=anatomyVolumeSource(source.imageIds),hashes:string[]=[];
  for(let z=0;z<input.geometry.dimensions[2];z++){run.controller.signal.throwIfAborted();const pixels=await input.slice(z,run.controller.signal);hashes.push(await sha256(new Uint8Array(pixels.buffer as ArrayBuffer)));}
  const loaded=await importSegmentation(file,input.geometry,await sourceFingerprint(input.geometry,hashes),volumeSourceKey(source.imageIds));
  if(active.current===run&&!run.controller.signal.aborted){setResult(loaded);setHistory([]);setFuture([]);setAppearance(initialAppearance());setState({phase:'ready'});}
 }catch{if(active.current===run&&!run.controller.signal.aborted)setState({phase:'error',error:t('anatomy.invalidImport')});}finally{if(active.current===run)active.current=null;}};
 return {state,result,receive:(value:AnatomyVolumeResult|null)=>{setResult(value);setState({phase:value?'ready':'idle'});setAppearance(initialAppearance());setHistory([]);setFuture([]);},start,cancel,visible,setVisible,opacity,setOpacity,appearance,setAppearance,mode,setMode,brushRadius,setBrushRadius,beginPaint:()=>{painting.current=false;},endPaint:()=>{painting.current=false;},paint,undo,redo,canUndo:!!history.length,canRedo:!!future.length,save,load,task,setTask,clear:()=>{cancel();setResult(null);setHistory([]);setFuture([]);setAppearance(initialAppearance());}};
}

export function AnatomyVolumeControls({control,source,onPick,onClose,onFocus,editing=true}:{editing?:boolean;control:ReturnType<typeof useAnatomyVolume>;source?:Source;onPick:()=>void;onClose:()=>void;onFocus?:(point:Point3)=>void}){
 const {t,language}=useTranslation(),{state,result,appearance}=control,busy=!['idle','error','ready'].includes(state.phase);
 const matching=!!source&&result?.sourceKey===volumeSourceKey(source.imageIds);
 const [models,setModels]=useState<{id:string;modality:string;available:boolean}[]>([]),[query,setQuery]=useState(''),[category,setCategory]=useState('all');const file=useRef<HTMLInputElement>(null);
 useEffect(()=>{const controller=new AbortController();void volumeRequest<{models:typeof models}>('/models',{signal:controller.signal}).then(value=>setModels(value.models)).catch(()=>{});return()=>controller.abort();},[]);
 const setTask=control.setTask;
 useEffect(()=>{setTask(source?.modality==='MR'?'total_mr':'total');},[source?.modality,setTask]);
 const entries=matching?Object.entries(result.classes):[],hidden=(ids:number[])=>control.setAppearance({...appearance,hidden:new Set(ids)});
 const selectedTask=models.find(m=>m.id===control.task);
 return <div className="anatomy-volume-panel" aria-label={t('anatomy.title')} aria-busy={busy} data-phase={state.phase}>
  <div><strong>{t('anatomy.title')}</strong><span className="anatomy-research-badge">{t('anatomy.research')}</span><button onClick={onClose} aria-label={t('common.close')}>×</button></div>
  <label>{t('anatomy.model')}<select value={control.task} disabled={busy} onChange={e=>control.setTask(e.target.value)}>{models.filter(m=>m.modality===source?.modality).map(m=><option key={m.id} value={m.id} disabled={!m.available}>{m.id}{m.available?'':` · ${t('anatomy.unavailable')}`}</option>)}</select></label>
  <p role={state.error?'alert':'status'}>{state.error||t(`anatomy.${state.phase}` as MessageKey)}{state.progress!==undefined?` ${Math.round(state.progress*100)}%`:''}{state.device?` · ${state.device==='gpu'?'GPU':'CPU'}`:''}</p>
  {state.progress!==undefined&&<progress value={state.progress} max={1}/>}
  <div className="anatomy-volume-actions">
   <button disabled={busy||!source||source.loading||!selectedTask?.available} onClick={()=>source&&void control.start(source)}>{t(matching?'anatomy.retry':'anatomy.start')}</button>
   {busy&&<button onClick={control.cancel}>{t('common.cancel')}</button>}
   <button disabled={busy||!source||source.loading||!['CT','MR'].includes(source.modality)} onClick={()=>file.current?.click()}>{t('anatomy.import')}</button>
   {matching&&<>{editing&&<><button onClick={()=>{control.setMode('pick');onPick();}}>{t('anatomy.pick')}</button><label><input type="checkbox" checked={control.visible} onChange={e=>control.setVisible(e.target.checked)}/>{t('anatomy.overlay')}</label><label>{t('transfer.opacity')}<input aria-label={t('transfer.opacity')} type="range" min={.05} max={.8} step={.05} value={control.opacity} onChange={e=>control.setOpacity(+e.target.value)}/></label></>}<button onClick={control.clear}>{t('anatomy.clear')}</button><button onClick={()=>void control.save()}>{t('anatomy.export')}</button></>}
  </div>
  <input hidden type="file" accept=".radazseg" ref={file} onChange={e=>{const f=e.target.files?.[0];e.target.value='';if(f&&source)void control.load(f,source);}}/>
  {result&&!matching&&<p>{t('anatomy.otherSeries')}</p>}
  {matching&&<><small>{t('anatomy.summary',{count:entries.length,seconds:result.seconds})} · {result.task}</small><p>{t('anatomy.unverified')}</p>
   <div className="anatomy-volume-actions"><button onClick={()=>hidden([])}>{t('anatomy.showAll')}</button><button onClick={()=>hidden(entries.map(([id])=>+id))}>{t('anatomy.hideAll')}</button><button onClick={()=>control.setAppearance(initialAppearance())}>{t('common.reset')}</button><label><input type="checkbox" checked={appearance.contoursOnly} onChange={e=>control.setAppearance({...appearance,contoursOnly:e.target.checked})}/>{t('anatomy.contours')}</label></div>
   <input type="search" aria-label={t('anatomy.search')} placeholder={t('anatomy.search')} value={query} onChange={e=>setQuery(e.target.value)}/>
   <select aria-label={t('anatomy.category')} value={category} onChange={e=>setCategory(e.target.value)}>{['all','organ','bone','vessel','muscle','nervous'].map(key=><option key={key} value={key}>{t(`anatomy.category.${key}` as MessageKey)}</option>)}</select>
   <div className="anatomy-structure-list" aria-label={t('anatomy.structures')}>
    {entries.filter(([,key])=>category==='all'||anatomyCategory(key)===category).filter(([,key])=>`${anatomyTerm(key,language)} ${key}`.toLocaleLowerCase(language).includes(query.toLocaleLowerCase(language))).map(([id,key])=><div key={id} className={appearance.selected===+id?'selected':''}>
     <label><input type="checkbox" checked={!appearance.hidden.has(+id)} onChange={e=>{const next=new Set(appearance.hidden);if(e.target.checked)next.delete(+id);else next.add(+id);control.setAppearance({...appearance,hidden:next});}}/><button className="anatomy-structure-name" onClick={()=>control.setAppearance({...appearance,selected:+id})}>{anatomyTerm(key,language)}</button></label>
     <input type="color" aria-label={`${anatomyTerm(key,language)} · ${t('transfer.color')}`} value={appearance.colors[+id]??labelHex(+id)} onChange={e=>control.setAppearance({...appearance,colors:{...appearance.colors,[id]:e.target.value}})}/>
     <input type="range" aria-label={`${anatomyTerm(key,language)} · ${t('transfer.opacity')}`} min={0} max={1} step={.05} value={appearance.opacities[+id]??1} onChange={e=>control.setAppearance({...appearance,opacities:{...appearance.opacities,[id]:+e.target.value}})}/>
     <button title={t('anatomy.isolate')} onClick={()=>control.setAppearance({...appearance,selected:+id,hidden:new Set(entries.filter(([other])=>other!==id).map(([other])=>+other))})}>{t('anatomy.isolate')}</button>
     {onFocus&&<button title={t('anatomy.focus')} onClick={()=>{const point=structureCenter(result,+id);if(point)onFocus(point);}}>{t('anatomy.focus')}</button>}
    </div>)}
   </div>
   {editing&&<fieldset><legend>{t('anatomy.corrections')}</legend><div className="anatomy-volume-actions"><button aria-pressed={control.mode==='brush'} disabled={!appearance.selected} onClick={()=>{control.setMode('brush');onPick();}}>{t('anatomy.brush')}</button><button aria-pressed={control.mode==='erase'} onClick={()=>{control.setMode('erase');onPick();}}>{t('anatomy.eraser')}</button><button disabled={!control.canUndo} onClick={control.undo}>{t('anatomy.undo')}</button><button disabled={!control.canRedo} onClick={control.redo}>{t('anatomy.redo')}</button><label>{t('anatomy.brushSize')}<input type="range" min={.5} max={20} step={.5} value={control.brushRadius} onChange={e=>control.setBrushRadius(+e.target.value)}/>{control.brushRadius}</label></div></fieldset>}
  </>}
  <small>{t('anatomy.warning')}</small>
 </div>;
}

export function AnatomyVolumeOverlay({viewport,element,imageId,result,opacity,visible,picking,onAdd,control}:{control?:ReturnType<typeof useAnatomyVolume>;viewport:Core.Types.IStackViewport|null;element:HTMLDivElement|null;imageId:string;result:AnatomyVolumeResult|null;opacity:number;visible:boolean;picking:boolean;onAdd:(mark:LocalMark)=>void}){
 const {t,language}=useTranslation();
 const canvas=useRef<HTMLCanvasElement>(null),[message,setMessage]=useState<{imageId:string;result:AnatomyVolumeResult;text:string}|null>(null);
 const appearance=control?.appearance;
 useEffect(()=>{
  if(!viewport||!element||!canvas.current||!result||!visible)return;
  let frame=0,disposed=false;
  const draw=()=>{
   frame=0;if(disposed||!canvas.current)return;
   const width=Math.min(560,Math.round(element.clientWidth)),height=Math.round(element.clientHeight*width/Math.max(1,element.clientWidth));if(!width||!height)return;
   const c=canvas.current;c.width=width;c.height=height;const ctx=c.getContext('2d');if(!ctx)return;
   const a=viewport.canvasToWorld([0,0]),b=viewport.canvasToWorld([element.clientWidth/width,0]),d=viewport.canvasToWorld([0,element.clientHeight/height]);
   const labels=sampleAnatomyPlane(result,a as Point3,b as Point3,d as Point3,width,height);
   const image=ctx.createImageData(width,height);
   for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const p=y*width+x,id=labels[p];if(!id||appearance?.hidden.has(id))continue;
    const edge=x===0||y===0||x===width-1||y===height-1||labels[p-1]!==id||labels[p+1]!==id||labels[p-width]!==id||labels[p+width]!==id;
    const color=appearance?.colors[id]??labelHex(id),rgb=color.slice(1).match(/../g)!.map(h=>parseInt(h,16));
    image.data[p*4]=rgb[0];image.data[p*4+1]=rgb[1];image.data[p*4+2]=rgb[2];image.data[p*4+3]=Math.round(255*(edge?.85:appearance?.contoursOnly?0:opacity)*(appearance?.opacities[id]??1));
    if(appearance?.selected===id&&edge)image.data[p*4+3]=255;
   }ctx.putImageData(image,0,0);
  };
  const schedule=()=>{if(!frame)frame=requestAnimationFrame(draw);};schedule();
  element.addEventListener('CORNERSTONE_IMAGE_RENDERED',schedule);const resize=new ResizeObserver(schedule);resize.observe(element);
  return()=>{disposed=true;cancelAnimationFrame(frame);resize.disconnect();element.removeEventListener('CORNERSTONE_IMAGE_RENDERED',schedule);};
 },[viewport,element,imageId,result,visible,opacity,appearance]);
 if(!result||!viewport||!imageId)return null;
 return <>
  {visible&&<canvas ref={canvas} className="anatomy-volume-overlay" aria-label={t('anatomy.overlay')}/>}
  {picking&&<div tabIndex={-1} className="anatomy-volume-pick" onPointerDown={e=>{if(e.button!==0||!element)return;e.preventDefault();e.stopPropagation();e.currentTarget.focus({preventScroll:true});
   const rect=element.getBoundingClientRect(),x=e.clientX-rect.left,y=e.clientY-rect.top,point=viewport.canvasToWorld([x,y]) as Point3,id=volumeLabelAt(result,point),key=result.classes[String(id)];
   if(control&&control.mode!=='pick'){const normal=viewport.getCamera().viewPlaneNormal as Point3;control.beginPaint();e.currentTarget.setPointerCapture(e.pointerId);control.paint(point,normal);return;}
   if(!key){setMessage({imageId,result,text:t('anatomy.noLabel')});return;}
   if(control)control.setAppearance({...control.appearance,selected:id});
   const name=anatomyTerm(key,language);setMessage({imageId,result,text:`${name} · ${result.task} · ${t('anatomy.unverified')}`});
   const tail=viewport.canvasToWorld([Math.max(12,Math.min(rect.width-300,x+45)),Math.max(12,y-60)]) as Point3;
   onAdd({id:`volume-anatomy-${crypto.randomUUID()}`,imageId,kind:'arrow',points:[tail,point],labelOffset:[0,0],anatomyId:`auto:volume:${key}`,comment:`${name}\n${result.task}\n${t('anatomy.unverified')}`});
  }} onPointerMove={e=>{if(!e.buttons||!control||control.mode==='pick'||!element)return;e.preventDefault();const rect=element.getBoundingClientRect();control.paint(viewport.canvasToWorld([e.clientX-rect.left,e.clientY-rect.top]) as Point3,viewport.getCamera().viewPlaneNormal as Point3);}} onPointerUp={()=>control?.endPaint()} onPointerCancel={()=>control?.endPaint()} onClick={e=>e.stopPropagation()} onDoubleClick={e=>e.stopPropagation()}/>}
  {picking&&<div className="anatomy-volume-hint" role="status">{message?.imageId===imageId&&message.result===result?message.text:t('anatomy.pickHelp')}</div>}
 </>;
}
