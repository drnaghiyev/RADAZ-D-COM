'use client';
import {useRef,useState} from 'react';
import {useTranslation} from '@/lib/i18n';
import {validateTransfer,type TransferFunction,type TransferPoint} from '@/lib/transfer-function';
import {volumePresetConfig,type VolumePreset} from '@/lib/volume-presets';

export function defaultTransfer(preset:VolumePreset,ct:boolean):TransferFunction{
 const def=volumePresetConfig[preset];
 return {schema:1,domain:ct?'ct-hu':'relative',points:def.scalar.map(([x,opacity])=>{
  const upper=def.color.findIndex(p=>p[0]>=x),b=def.color[upper<0?def.color.length-1:upper],a=def.color[Math.max(0,upper-1)];
  const factor=b[0]===a[0]?0:Math.max(0,Math.min(1,(x-a[0])/(b[0]-a[0])));
  const color='#'+[1,2,3].map(i=>Math.round((a[i]+factor*(b[i]-a[i]))*255).toString(16).padStart(2,'0')).join('');
  return {x:ct?x:Math.max(0,Math.min(1,(x+1024)/4095)),opacity,color};
 }).filter((p,i,array)=>!i||p.x>array[i-1].x)};
}
export function TransferFunctionEditor({preset,ct,value,onChange}:{preset:VolumePreset;ct:boolean;value?:TransferFunction;onChange:(value:TransferFunction|undefined)=>void}){
 const {t}=useTranslation(),file=useRef<HTMLInputElement>(null),svg=useRef<SVGSVGElement>(null),drag=useRef<number|null>(null);
 const [selected,setSelected]=useState(0),[message,setMessage]=useState('');
 const current=value??defaultTransfer(preset,ct),points=current.points,index=Math.min(selected,points.length-1),point=points[index];
 const min=ct?Math.min(-1024,points[0].x):0,max=ct?Math.max(3071,points.at(-1)!.x):1,span=max-min;
 const update=(at:number,patch:Partial<TransferPoint>)=>{
  const next=points.map(p=>({...p}));next[at]={...next[at],...patch};
  const epsilon=ct?.01:.00001;
  next[at].x=Math.max(at?next[at-1].x+epsilon:min,Math.min(at<next.length-1?next[at+1].x-epsilon:max,next[at].x));
  next[at].opacity=Math.max(0,Math.min(1,next[at].opacity));onChange(validateTransfer({...current,points:next}));
 };
 const pointer=(clientX:number,clientY:number)=>{if(drag.current===null||!svg.current)return;const rect=svg.current.getBoundingClientRect();update(drag.current,{x:min+Math.max(0,Math.min(1,(clientX-rect.left)/rect.width))*span,opacity:1-Math.max(0,Math.min(1,(clientY-rect.top)/rect.height))});};
 const accept=(text:string)=>{try{onChange(validateTransfer(JSON.parse(text),ct?'ct-hu':'relative'));setSelected(0);setMessage('');}catch{setMessage(t('transfer.invalid'));}};
 return <fieldset className="transfer-editor"><legend>{t('transfer.title')}</legend>
  <label className="volume-check"><input type="checkbox" checked={!!value} onChange={e=>onChange(e.target.checked?defaultTransfer(preset,ct):undefined)}/>{t('transfer.custom')}</label>
  <svg ref={svg} viewBox="0 0 300 130" preserveAspectRatio="none" aria-label={t('transfer.title')} onPointerMove={e=>pointer(e.clientX,e.clientY)} onPointerUp={()=>{drag.current=null;}} onPointerCancel={()=>{drag.current=null;}}>
   <polyline fill="none" stroke="#53c5df" strokeWidth="2" points={points.map(p=>`${(p.x-min)/span*300},${(1-p.opacity)*130}`).join(' ')}/>
   {points.map((p,i)=><circle key={i} cx={(p.x-min)/span*300} cy={(1-p.opacity)*130} r={i===index?6:4} fill={p.color} stroke="white" tabIndex={0} role="slider" aria-label={t('transfer.point',{index:i+1})} aria-valuemin={min} aria-valuemax={max} aria-valuenow={p.x} aria-valuetext={`${p.x.toFixed(ct?0:3)} / ${Math.round(p.opacity*100)}%`} onFocus={()=>setSelected(i)} onPointerDown={e=>{e.preventDefault();setSelected(i);drag.current=i;svg.current?.setPointerCapture(e.pointerId);}} onKeyDown={e=>{if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)){e.preventDefault();update(i,e.key==='ArrowLeft'||e.key==='ArrowRight'?{x:p.x+(e.key==='ArrowLeft'?-1:1)*span/200}:{opacity:p.opacity+(e.key==='ArrowDown'?-.01:.01)});}}}/>) }
  </svg>
  <div className="transfer-axis"><span>{min} {ct?'HU':t('transfer.intensity')}</span><span>{max}</span></div>
  <label>{ct?'HU':t('transfer.intensity')}<input type="number" value={Number(point.x.toFixed(4))} step={ct?1:.01} min={min} max={max} onChange={e=>{if(Number.isFinite(e.target.valueAsNumber))update(index,{x:e.target.valueAsNumber});}}/></label>
  <label>{t('transfer.opacity')}<input type="range" min={0} max={1} step={.01} value={point.opacity} onChange={e=>update(index,{opacity:+e.target.value})}/></label>
  <label>{t('transfer.color')}<input type="color" value={point.color} onChange={e=>update(index,{color:e.target.value})}/></label>
  <div className="transfer-actions"><button type="button" disabled={points.length>=32} onClick={()=>{const gaps=points.slice(1).map((p,i)=>p.x-points[i].x),i=gaps.indexOf(Math.max(...gaps));const next=[...points];next.splice(i+1,0,{x:(points[i].x+points[i+1].x)/2,opacity:(points[i].opacity+points[i+1].opacity)/2,color:points[i].color});onChange({...current,points:next});setSelected(i+1);}}>{t('transfer.add')}</button>
   <button type="button" disabled={points.length<=2} onClick={()=>{onChange({...current,points:points.filter((_,i)=>i!==index)});setSelected(0);}}>{t('common.delete')}</button>
   <button type="button" onClick={()=>{try{localStorage.setItem(`radaz.transfer.${current.domain}`,JSON.stringify(current));setMessage(t('transfer.saved'));}catch{setMessage(t('transfer.storageError'));}}}>{t('common.save')}</button>
   <button type="button" onClick={()=>{try{accept(localStorage.getItem(`radaz.transfer.${current.domain}`)||'');}catch{setMessage(t('transfer.invalid'));}}}>{t('transfer.load')}</button>
   <button type="button" onClick={()=>{const url=URL.createObjectURL(new Blob([JSON.stringify(current,null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download=`RADAZ-transfer-${current.domain}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}}>{t('common.export')}</button>
   <button type="button" onClick={()=>file.current?.click()}>{t('common.import')}</button>
   <button type="button" onClick={()=>{onChange(undefined);setSelected(0);setMessage('');}}>{t('common.reset')}</button>
  </div><input hidden ref={file} type="file" accept=".json,application/json" onChange={async e=>{const f=e.target.files?.[0];e.target.value='';if(!f)return;if(f.size>16384){setMessage(t('transfer.invalid'));return;}try{accept(await f.text());}catch{setMessage(t('transfer.invalid'));}}}/>
  <small>{t('transfer.help')}</small>{message&&<p role="status">{message}</p>}
 </fieldset>;
}
