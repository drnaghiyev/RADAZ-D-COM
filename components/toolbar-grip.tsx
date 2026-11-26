'use client';
import {useEffect,useRef,type PointerEvent} from 'react';
import {GripVertical} from 'lucide-react';

export function ToolbarGrip({label,drop}:{label:string;drop:(zone:string,target?:string,after?:boolean)=>void}) {
  const cleanup=useRef<()=>void>(()=>{});
  useEffect(()=>()=>cleanup.current(),[]);
  function begin(e:PointerEvent<HTMLButtonElement>){
    if(e.button!==0||!e.isPrimary)return;
    const handle=e.currentTarget,doc=handle.ownerDocument,win=doc.defaultView!;
    const dialog=handle.closest<HTMLElement>('[role="dialog"]');
    if(!dialog)return;
    e.preventDefault();cleanup.current();
    const pointer=e.pointerId;
    handle.setPointerCapture(pointer);
    let x=e.clientX,y=e.clientY,frame=0,marked:HTMLElement|null=null;
    const hit=()=>{
      const el=doc.elementFromPoint(x,y);
      const zone=el?.closest<HTMLElement>('[data-layout-zone]');
      if(!zone||!dialog.contains(zone))return;
      const row=el?.closest<HTMLElement>('[data-layout-id]');
      const rect=row?.getBoundingClientRect();
      return {zone:zone.dataset.layoutZone!,id:row?.dataset.layoutId,after:rect?y>rect.top+rect.height/2:true,node:row||zone};
    };
    const paint=()=>{
      const box=dialog!.getBoundingClientRect();
      if(x>=box.left && x<=box.right){
        if(y>box.bottom-42)dialog!.scrollTop+=10;
        else if(y<box.top+42)dialog!.scrollTop-=10;
      }
      const h=hit();if(marked!==h?.node)marked?.removeAttribute('data-drop-edge');
      marked=h?.node||null;if(h)h.node.dataset.dropEdge=h.after?'after':'before';
      frame=win.requestAnimationFrame(paint);
    };
    const update=(ev:globalThis.PointerEvent)=>{if(ev.pointerId===pointer){x=ev.clientX;y=ev.clientY;}};
    const finish=(ev:globalThis.PointerEvent)=>{if(ev.pointerId!==pointer)return;update(ev);const h=hit();stop();if(h)drop(h.zone,h.id,h.after);};
    const stop=()=>{win.cancelAnimationFrame(frame);marked?.removeAttribute('data-drop-edge');
      handle.removeEventListener('pointermove',update);handle.removeEventListener('pointerup',finish);
      handle.removeEventListener('lostpointercapture',stop);handle.removeEventListener('pointercancel',stop);
      if(handle.hasPointerCapture(pointer))handle.releasePointerCapture(pointer);cleanup.current=()=>{};
    };
    handle.addEventListener('pointermove',update);handle.addEventListener('pointerup',finish);
    handle.addEventListener('pointercancel',stop);handle.addEventListener('lostpointercapture',stop);
    cleanup.current=stop;frame=win.requestAnimationFrame(paint);
  }
  return <button className="toolbar-grip" type="button" aria-label={label+' · sürüşdür'} title="Tutub yerini dəyiş" onPointerDown={begin}><GripVertical size={16}/></button>;
}
