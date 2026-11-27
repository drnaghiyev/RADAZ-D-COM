'use client';
import {useRef, type HTMLAttributes, type PointerEvent} from 'react';
import type {SmartSliceEngine} from '@/lib/smart-volume/slice-renderer';

type Point=[number,number];
type Viewport=ReturnType<SmartSliceEngine['getViewport']>;
type Input=PointerEvent<HTMLDivElement>;
type Props=HTMLAttributes<HTMLDivElement> & {viewport:()=>Viewport|undefined; drawing:boolean};
const mid=(a:Point,b:Point):Point=>[(a[0]+b[0])/2,(a[1]+b[1])/2];

export function TabletSmartInput({viewport,drawing,onPointerDown,onPointerMove,onPointerUp,onPointerCancel,...props}:Props){
  const fingers=useRef(new Map<number,Point>()).current;
  const start=useRef<Input|null>(null);
  const primary=useRef(-1);
  const mode=useRef<'pending'|'single'|'pair'|'release'>('release');
  const gesture=useRef<{distance:number;scale:number;world:[number,number,number]}|null>(null);
  function point(e:Input):Point{
    const el=e.currentTarget,r=el.getBoundingClientRect();
    return [(e.clientX-r.left)*el.clientWidth/r.width,(e.clientY-r.top)*el.clientHeight/r.height];
  }
  function down(e:Input){
    if(e.pointerType!=='touch'){onPointerDown?.(e);return;}
    e.preventDefault();
    const el=e.currentTarget;
    el.setPointerCapture(e.pointerId);
    fingers.set(e.pointerId,point(e));
    if(fingers.size===1){
      // React clears currentTarget after dispatch. Keep the original touch location for a tap or stroke.
      primary.current=e.pointerId;
      start.current={...e,currentTarget:el,preventDefault:()=>{}} as Input;
      mode.current='pending';
    }else if(fingers.size===2){
      const vp=viewport();
      if(!vp || mode.current==='release' || (mode.current==='single' && drawing))return;
      if(mode.current==='single')onPointerUp?.(e);
      const [a,b]=fingers.values();
      gesture.current={distance:Math.max(1,Math.hypot(a[0]-b[0],a[1]-b[1])),scale:vp.getCamera().parallelScale,world:vp.canvasToWorld(mid(a,b))};
      start.current=null;mode.current='pair';
    }else if(mode.current==='pair'){gesture.current=null;mode.current='release';}
  }
  function move(e:Input){
    if(e.pointerType!=='touch'){onPointerMove?.(e);return;}
    if(!fingers.has(e.pointerId))return;
    e.preventDefault();fingers.set(e.pointerId,point(e));
    const g=gesture.current,vp=viewport();
    if(mode.current==='pair' && g && vp && fingers.size===2){
      const [a,b]=fingers.values();
      const separation=Math.max(1,Math.hypot(a[0]-b[0],a[1]-b[1]));
      vp.setCamera({parallelScale:Math.max(.01,Math.min(1e6,g.scale*g.distance/separation))});
      const under=vp.canvasToWorld(mid(a,b)),camera=vp.getCamera();
      const shift=(v:[number,number,number])=>v.map((n,i)=>n+g.world[i]-under[i]) as [number,number,number];
      vp.setCamera({position:shift(camera.position),focalPoint:shift(camera.focalPoint)});vp.render();
    }else if(primary.current===e.pointerId){
      const first=start.current;
      if(mode.current==='pending' && first && Math.hypot(first.clientX-e.clientX,first.clientY-e.clientY)>=4){
        mode.current='single';start.current=null;onPointerDown?.(first);
      }
      if(mode.current==='single')onPointerMove?.(e);
    }
  }
  function end(e:Input,cancel:boolean){
    if(e.pointerType!=='touch'){(cancel?onPointerCancel:onPointerUp)?.(e);return;}
    if(!fingers.delete(e.pointerId))return;
    const owns=e.pointerId===primary.current;
    if(owns && mode.current==='pending' && !cancel && start.current){
      onPointerDown?.(start.current);onPointerUp?.(e);
    }else if(owns && mode.current==='single'){(cancel?onPointerCancel:onPointerUp)?.(e);}
    if(owns||mode.current==='pair'||!fingers.size){
      start.current=null;gesture.current=null;mode.current='release';
    }
  }
  return <div {...props} onPointerDown={down} onPointerMove={move} onPointerUp={e=>end(e,false)}
    onPointerCancel={e=>end(e,true)} onLostPointerCapture={e=>{if(e.pointerType==='touch' && fingers.has(e.pointerId))end(e,true);}}/>;
}

