'use client';
import {useTranslation as useUiTranslation,translate as tr} from '@/lib/i18n';

import {useEffect,useRef,useState,type RefObject} from 'react';
import type * as Core from '@cornerstonejs/core';
import {getViewer} from '@/lib/cornerstone';
import type {LocalMark,Point3} from './measurement-overlay';

type Target={kind:'local'|'native';id:string};
type Props={container:RefObject<HTMLElement|null>;element:HTMLDivElement|null;viewport:Core.Types.IStackViewport|null;
 imageId:string;disabled:boolean;marks:LocalMark[];onSelect:()=>void;onRemove:(id:string)=>void;
 onClear:(imageId:string)=>void;onEditArrow:(id:string)=>void};

/** Secondary gestures also work over SVG drawings, which sit above Cornerstone's canvas. */
export function ViewportMouseControls(props:Props){
  useUiTranslation();
 const current=useRef(props);current.current=props;
 const [menu,setMenu]=useState<{x:number;y:number;target:Target|null}|null>(null);
 const viewer=useRef<Awaited<ReturnType<typeof getViewer>>|null>(null);
 useEffect(()=>{let alive=true;void getViewer().then(v=>{if(alive)viewer.current=v;});return()=>{alive=false;};},[]);
 useEffect(()=>{
  const root=props.container.current,element=props.element,viewport=props.viewport;
  if(!root||!element||!viewport||!props.imageId)return;
  setMenu(null);
  let gesture:{pointer:number;button:number;x:number;y:number;scale:number;anchor:Point3;moved:boolean;target:Target|null}|null=null;
  const point=(event:PointerEvent):[number,number]=>{const r=element.getBoundingClientRect();return [event.clientX-r.left,event.clientY-r.top];};
  const hit=(event:PointerEvent):Target|null=>{
   const target=event.target instanceof Element?event.target:null;
   const local=target?.closest('[data-measurement],[data-mark-id]');
   const id=local?.getAttribute('data-measurement')||local?.getAttribute('data-mark-id');
   if(id&&current.current.marks.some(m=>m.id===id&&m.imageId===current.current.imageId))return {kind:'local',id};
   const tools=viewer.current?.tools;
   const annotation=tools?.utilities.getAnnotationNearPoint(element,point(event),8);
   if(annotation?.annotationUID&&tools?.annotation.visibility.isAnnotationVisible(annotation.annotationUID))return {kind:'native',id:annotation.annotationUID};
   return null;
  };
  const isControl=(event:Event)=>event.target instanceof Element&&!!event.target.closest('button,input,textarea,select,.measurement-menu,.arrow-comment-editor,.hu-editor');
  const down=(event:PointerEvent)=>{
   if(current.current.disabled||isControl(event))return;
   setMenu(null);
   if(event.button!==1&&event.button!==2)return;
   root.dataset.suppressMaximizeUntil=String(performance.now()+750);
   event.preventDefault();event.stopPropagation();
   current.current.onSelect();
   gesture={pointer:event.pointerId,button:event.button,x:event.clientX,y:event.clientY,scale:viewport.getCamera().parallelScale!,
    anchor:viewport.canvasToWorld(point(event)) as Point3,moved:false,target:hit(event)};
   root.setPointerCapture(event.pointerId);
  };
  const move=(event:PointerEvent)=>{
   if(current.current.disabled)return;
   if(!gesture){root.dataset.measurementHover=String(!event.buttons&&!isControl(event)&&!!hit(event));return;}
   if(event.pointerId!==gesture.pointer)return;
   event.preventDefault();event.stopPropagation();
   if(Math.hypot(event.clientX-gesture.x,event.clientY-gesture.y)>4)gesture.moved=true;
   if(!gesture.moved)return;
   root.dataset.measurementHover='false';root.dataset.mouseGesture=gesture.button===1?'pan':tr('ui.zoom_d21bb');
   if(gesture.button===2){
    viewport.setCamera({parallelScale:Math.max(.00001,Math.min(1e8,gesture.scale*Math.exp((event.clientY-gesture.y)*.008)))});
   }else{
    const under=viewport.canvasToWorld(point(event)),camera=viewport.getCamera();
    const offset=gesture.anchor.map((v,i)=>v-under[i]);
    viewport.setCamera({position:camera.position!.map((v,i)=>v+offset[i]) as Point3,focalPoint:camera.focalPoint!.map((v,i)=>v+offset[i]) as Point3});
   }
   viewport.render();
  };
  const end=(event:PointerEvent)=>{
   if(!gesture||gesture.pointer!==event.pointerId)return;
   event.preventDefault();event.stopPropagation();
   const saved=gesture;gesture=null;delete root.dataset.mouseGesture;
   if(root.hasPointerCapture(event.pointerId))root.releasePointerCapture(event.pointerId);
   if(event.type==='pointerup'&&saved.button===2&&!saved.moved){
    root.dataset.suppressMaximizeUntil=String(performance.now()+750);
    const r=root.getBoundingClientRect();setMenu({x:Math.max(4,Math.min(event.clientX-r.left,r.width-254)),y:Math.max(4,Math.min(event.clientY-r.top,r.height-130)),target:saved.target});
   }
  };
  const leave=()=>{root.dataset.measurementHover='false';};
  const blur=()=>{gesture=null;delete root.dataset.mouseGesture;leave();setMenu(null);};
  const mouseDown=(e:MouseEvent)=>{if(!current.current.disabled&&!isControl(e)&&(e.button===1||e.button===2)){e.preventDefault();e.stopPropagation();}};
  root.addEventListener('pointerdown',down,true);root.addEventListener('pointermove',move,true);
  root.addEventListener('pointerup',end,true);root.addEventListener('pointercancel',end,true);root.addEventListener('pointerleave',leave);
  root.addEventListener('mousedown',mouseDown,true);window.addEventListener('blur',blur);
  return()=>{root.removeEventListener('pointerdown',down,true);root.removeEventListener('pointermove',move,true);root.removeEventListener('pointerup',end,true);
   root.removeEventListener('pointercancel',end,true);root.removeEventListener('pointerleave',leave);root.removeEventListener('mousedown',mouseDown,true);window.removeEventListener('blur',blur);blur();};
 },[props.container,props.element,props.viewport,props.imageId]);
 useEffect(()=>{
  if(!menu)return;
  const outside=(e:Event)=>{if(!(e.target instanceof Element)||!e.target.closest('.measurement-menu'))setMenu(null);};
  const key=(e:KeyboardEvent)=>{if(e.key==='Escape')setMenu(null);};
  document.addEventListener('pointerdown',outside);document.addEventListener('keydown',key);
  return()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',key);};
 },[menu]);
 if(!menu||props.disabled)return null;
 const remove=()=>{
  const target=menu.target,tools=viewer.current?.tools;
  if(target?.kind==='local')props.onRemove(target.id);
  else if(target&&tools?.annotation.state.getAnnotation(target.id)?.metadata?.referencedImageId===props.imageId){
   tools.annotation.state.removeAnnotation(target.id);tools.utilities.triggerAnnotationRender(props.element!);
  }
  setMenu(null);
 };
 const clear=()=>{
  const tools=viewer.current?.tools;
   if(tools&&props.element){tools.cancelActiveManipulations(props.element);props.element.dispatchEvent(new Event('radaz-clear-measurements'));}
  tools?.annotation.state.getAllAnnotations().filter(a=>a.metadata?.referencedImageId===props.imageId).forEach(a=>tools.annotation.state.removeAnnotation(a.annotationUID!));
  props.onClear(props.imageId);if(tools&&props.element)tools.utilities.triggerAnnotationRender(props.element);setMenu(null);
 };
 const arrow=menu.target?.kind==='local'&&props.marks.find(m=>m.id===menu.target!.id&&m.kind==='arrow');
 return <div className="measurement-menu" role="menu" aria-label={tr('ui.measurement_menu_cbd9f')} style={{left:menu.x,top:menu.y}}
  onPointerDown={e=>{e.stopPropagation();if(props.container.current)props.container.current.dataset.suppressMaximizeUntil=String(performance.now()+750);}}
  onDoubleClick={e=>e.stopPropagation()} onClick={e=>e.stopPropagation()}>
  <button role="menuitem" disabled={!menu.target} onClick={remove}>{tr('ui.delete_f698e')}</button>
  {arrow&&<button role="menuitem" onClick={()=>{props.onEditArrow(arrow.id);setMenu(null);}}>{tr('ui.edit_comment_c09e7')}</button>}
  <button role="menuitem" onClick={clear}>{tr('ui.delete_all_on_current_slice_cc1ac')}<kbd>Ctrl+D</kbd></button>
 </div>;
}
