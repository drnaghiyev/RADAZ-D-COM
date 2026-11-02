'use client';
import {useTranslation as useUiTranslation,translate as tr} from '@/lib/i18n';

import {useEffect,useRef,useState,type RefObject} from 'react';
import type * as Core from '@cornerstonejs/core';
import {cancelMeasurementInteraction,annotationBelongsToPane} from '@/lib/measurement-tools';
import {getViewer} from '@/lib/cornerstone';
import type {LocalMark,Point3} from './measurement-overlay';

type Target={kind:'local'|'native';id:string};
type Props={tool:string;container:RefObject<HTMLElement|null>;element:HTMLDivElement|null;viewport:Core.Types.IStackViewport|null;
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
  let hold:ReturnType<typeof setTimeout>|null=null;
  let heldPointer:number|null=null;
  let holdStart:{id:number;x:number;y:number}|null=null;
  const cancelHold=()=>{if(hold!==null)clearTimeout(hold);hold=null;holdStart=null;};
  const showMenu=(x:number,y:number,target:Target)=>{
   const r=root.getBoundingClientRect();
   setMenu({x:Math.max(4,Math.min(x-r.left,r.width-254)),y:Math.max(4,Math.min(y-r.top,r.height-154)),target});
  };
  const point=(event:PointerEvent):[number,number]=>{const r=element.getBoundingClientRect();return [event.clientX-r.left,event.clientY-r.top];};
  const hit=(event:PointerEvent):Target|null=>{
   const target=event.target instanceof Element?event.target:null;
   const local=target?.closest('[data-measurement],[data-mark-id]');
   const id=local?.getAttribute('data-measurement')||local?.getAttribute('data-mark-id');
   if(id&&current.current.marks.some(m=>m.id===id&&m.imageId===current.current.imageId))return {kind:'local',id};
   const tools=viewer.current?.tools;
   const annotation=tools?.utilities.getAnnotationNearPoint(element,point(event),event.pointerType==='touch'||event.pointerType==='pen'?24:8);
   if(annotation?.annotationUID&&annotationBelongsToPane(annotation,element)&&tools?.annotation.visibility.isAnnotationVisible(annotation.annotationUID))return {kind:'native',id:annotation.annotationUID};
   return null;
  };
  const isControl=(event:Event)=>event.target instanceof Element&&!!event.target.closest('button,input,textarea,select,.measurement-menu,.arrow-comment-editor,.hu-editor');
  const down=(event:PointerEvent)=>{
   if(current.current.disabled||isControl(event))return;
   setMenu(null);
   const hadHold=holdStart!==null;cancelHold();
   if(!hadHold&&event.isPrimary&&event.button===0&&current.current.tool!=='erase'){
    const target=hit(event);
    if(target){
     const pressedTool=current.current.tool;
     holdStart={id:event.pointerId,x:event.clientX,y:event.clientY};
     hold=setTimeout(()=>{
      cancelHold();if(current.current.disabled||current.current.tool!==pressedTool)return;
      const tools=viewer.current?.tools;
      if(tools)cancelMeasurementInteraction(tools.ToolGroupManager.getToolGroupForViewport(viewport.id),element);
      gesture=null;delete root.dataset.mouseGesture;
      heldPointer=event.pointerId;
      root.dataset.suppressMaximizeUntil=String(performance.now()+1000);
      showMenu(event.clientX,event.clientY,target);
     },600);
    }
   }
   if(event.button===0&&current.current.tool==='erase'){
    event.preventDefault();event.stopPropagation();
    root.dataset.suppressMaximizeUntil=String(performance.now()+750);
    const target=hit(event),tools=viewer.current?.tools;
    if(target?.kind==='local')current.current.onRemove(target.id);
    else if(target&&tools){
     const annotation=tools.annotation.state.getAnnotation(target.id);
     if(annotation&&annotationBelongsToPane(annotation,element)&&annotation.metadata?.referencedImageId===current.current.imageId){
      tools.annotation.state.removeAnnotation(target.id);tools.utilities.triggerAnnotationRender(element);
     }
    }
    return;
   }
   const touch=event.button===0;
   const touchButton=touch&&current.current.tool==='pan'?1:touch&&current.current.tool==='zoom'?2:event.button;
   if(touchButton!==1&&touchButton!==2)return;
   root.dataset.suppressMaximizeUntil=String(performance.now()+750);
   event.preventDefault();event.stopPropagation();
   current.current.onSelect();
   const tools=viewer.current?.tools;
   if(tools)cancelMeasurementInteraction(tools.ToolGroupManager.getToolGroupForViewport(viewport.id),element);
   gesture={pointer:event.pointerId,button:touchButton,x:event.clientX,y:event.clientY,scale:viewport.getCamera().parallelScale!,
    anchor:viewport.canvasToWorld(point(event)) as Point3,moved:false,target:hit(event)};
   root.setPointerCapture(event.pointerId);
  };
  const move=(event:PointerEvent)=>{
   if(holdStart&&event.pointerId===holdStart.id&&Math.hypot(event.clientX-holdStart.x,event.clientY-holdStart.y)>8)cancelHold();
   if(heldPointer===event.pointerId){event.preventDefault();event.stopPropagation();return;}
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
   cancelHold();
   if(heldPointer===event.pointerId){heldPointer=null;return;}
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
  const blur=()=>{cancelHold();heldPointer=null;if(gesture&&root.hasPointerCapture(gesture.pointer))root.releasePointerCapture(gesture.pointer);gesture=null;delete root.dataset.mouseGesture;leave();setMenu(null);};
  const mouseDown=(e:MouseEvent)=>{if(!current.current.disabled&&!isControl(e)&&(e.button===1||e.button===2||(e.button===0&&['pan','zoom','erase'].includes(current.current.tool)))){e.preventDefault();e.stopPropagation();}};
  const suppressEraseTouch=(e:TouchEvent)=>{if(!current.current.disabled&&(current.current.tool==='erase'||heldPointer!==null)&&!isControl(e)){e.preventDefault();e.stopPropagation();}};
  const preventContext=(e:Event)=>e.preventDefault();
  root.addEventListener('contextmenu',preventContext);
  root.addEventListener('touchmove',suppressEraseTouch,{capture:true,passive:false});
  root.addEventListener('touchstart',suppressEraseTouch,{capture:true,passive:false});
  root.addEventListener('pointerdown',down,true);root.addEventListener('pointermove',move,true);
  root.addEventListener('pointerup',end,true);root.addEventListener('pointercancel',end,true);root.addEventListener('pointerleave',leave);
  root.addEventListener('mousedown',mouseDown,true);window.addEventListener('blur',blur);
  return()=>{root.removeEventListener('contextmenu',preventContext);root.removeEventListener('touchmove',suppressEraseTouch,true);root.removeEventListener('touchstart',suppressEraseTouch,true);root.removeEventListener('pointerdown',down,true);root.removeEventListener('pointermove',move,true);root.removeEventListener('pointerup',end,true);
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
  tools?.annotation.state.getAllAnnotations().filter(a=>a.metadata?.referencedImageId===props.imageId&&!!props.element&&annotationBelongsToPane(a,props.element)).forEach(a=>tools.annotation.state.removeAnnotation(a.annotationUID!));
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
