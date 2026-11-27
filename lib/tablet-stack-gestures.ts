import type {Types} from '@cornerstonejs/core';

type Point=[number,number];
type Vec=[number,number,number];
type Options={
  root:HTMLElement; element:HTMLElement; viewport:Types.IStackViewport;
  mode:()=>string; single:()=>'scroll'|'wl'; protectedTarget:(event:PointerEvent)=>boolean;
  checkpoint:()=>void; cancelTool:()=>void; select:()=>void; navigate:(steps:number)=>void; allowed:()=>boolean;
};

/** One owner for a whole contact sequence. A finger remaining after a pinch cannot start WW/WL. */
export function attachTabletStackGestures(o:Options) {
  const {root,element,viewport}=o, fingers=new Map<number,Point>();
  let owner:'single'|'pair'|'release'|'tool'|null=null;
  let previous:Point=[0,0], initialRange={lower:0,upper:1}, initialScale=1, separation=1, anchor:Vec=[0,0,0];
  let single:'scroll'|'wl'='wl';
  const stop=(e:Event)=>{if(e.cancelable)e.preventDefault();e.stopImmediatePropagation();};
  const point=(e:PointerEvent):Point=>{const rect=element.getBoundingClientRect();return [e.clientX-rect.left,e.clientY-rect.top];};
  const pair=()=>{const [a,b]=Array.from(fingers.values());return {center:[(a[0]+b[0])/2,(a[1]+b[1])/2] as Point,distance:Math.max(1,Math.hypot(a[0]-b[0],a[1]-b[1]))};};
  const down=(e:PointerEvent)=>{
    if(e.pointerType!=='touch'||!o.allowed())return;
    if(!owner){
      if((e.target as Element).closest('button,input,select,textarea,[role=menu]'))return;
      if(!['wl','scroll'].includes(o.mode())||o.protectedTarget(e)){
        o.checkpoint();owner='tool';fingers.set(e.pointerId,point(e));return;
      }
      const start=point(e);
      single=o.single();previous=start;
      initialRange={...(viewport.getProperties().voiRange||{lower:0,upper:255})};
      owner='single';o.select();
    }
    if(owner==='tool')o.cancelTool();
    stop(e);fingers.set(e.pointerId,point(e));root.setPointerCapture(e.pointerId);
    root.dataset.suppressMaximizeUntil=String(performance.now()+800);
    if(fingers.size===2){
      const p=pair();anchor=viewport.canvasToWorld(p.center) as Vec;separation=p.distance;
      initialScale=viewport.getCamera().parallelScale!;owner='pair';
    }
    if(fingers.size>2)owner='release';
  };
  const move=(e:PointerEvent)=>{
    if(!fingers.has(e.pointerId))return;
    if(owner==="tool"){fingers.set(e.pointerId,point(e));return;}
    stop(e);const at=point(e);fingers.set(e.pointerId,at);
    if(owner==='pair'){
      const p=pair();
      viewport.setCamera({parallelScale:Math.max(.0001,Math.min(1e7,initialScale*separation/p.distance))});
      const under=viewport.canvasToWorld(p.center),cam=viewport.getCamera();
      const shifted=(v:Vec)=>v.map((n,i)=>n+anchor[i]-under[i]) as Vec;
      viewport.setCamera({position:shifted(cam.position!),focalPoint:shifted(cam.focalPoint!)});viewport.render();
    }else if(owner==='single'){
      const dx=at[0]-previous[0],dy=at[1]-previous[1];
      if(single==='scroll'){
        const steps=Math.trunc(dy/14);
        if(steps){previous[1]+=steps*14;o.navigate(steps);}
      }else if(Math.hypot(dx,dy)>3){
        const span=Math.max(1,initialRange.upper-initialRange.lower),k=span/Math.max(60,Math.min(element.clientWidth,element.clientHeight)*.45);
        const center=(initialRange.lower+initialRange.upper)/2+dy*k,width=Math.max(1,span+dx*k);
        viewport.setProperties({voiRange:{lower:center-width/2,upper:center+width/2}});viewport.render();
      }
    }
  };
  const end=(e:PointerEvent)=>{
    if(!fingers.delete(e.pointerId))return;
    if(owner==='tool'){owner=null;return;}
    stop(e);owner=fingers.size?'release':null;
    if(root.hasPointerCapture(e.pointerId))root.releasePointerCapture(e.pointerId);
    root.dataset.suppressMaximizeUntil=String(performance.now()+650);
  };
  const touch=(e:TouchEvent)=>{if(owner&&owner!=='tool')stop(e);};
  const reset=()=>{const ids=[...fingers.keys()];fingers.clear();owner=null;for(const id of ids)if(root.hasPointerCapture(id))root.releasePointerCapture(id);};
  const win=root.ownerDocument.defaultView!;
  root.addEventListener('pointerdown',down,true);root.addEventListener('pointermove',move,true);
  root.addEventListener('pointerup',end,true);root.addEventListener('pointercancel',end,true);root.addEventListener('lostpointercapture',end,true);
  for(const type of ['touchstart','touchmove','touchend'] as const)root.addEventListener(type,touch,{capture:true,passive:false});
  win.addEventListener('blur',reset);
  return ()=>{reset();root.removeEventListener('pointerdown',down,true);root.removeEventListener('pointermove',move,true);
    root.removeEventListener('pointerup',end,true);root.removeEventListener('pointercancel',end,true);root.removeEventListener('lostpointercapture',end,true);
    for(const type of ['touchstart','touchmove','touchend'] as const)root.removeEventListener(type,touch,true);win.removeEventListener('blur',reset);};
}
