// Observe contacts before tool listeners consume them, without claiming single taps.
export function watchPaneDoubleTap(element:HTMLElement, activate:()=>void, enabled:()=>boolean) {
  let start:{id:number;x:number;y:number;t:number}|undefined, prior:typeof start;
  const contacts=new Set<number>();
  const down=(e:PointerEvent)=>{
    if(e.pointerType!=='touch')return;
    contacts.add(e.pointerId);
    if(contacts.size!==1 || !enabled() || (e.target as Element).closest('button,input,select,[role=button],.measurement-overlay,.drawing-overlay,.localizer-center,.localizer-line,.vertical-stack-scroll')){
      start=prior=undefined;return;
    }
    start={id:e.pointerId,x:e.clientX,y:e.clientY,t:e.timeStamp};
  };
  const move=(e:PointerEvent)=>{if(start?.id===e.pointerId && Math.hypot(e.clientX-start.x,e.clientY-start.y)>8)start=prior=undefined;};
  const cancel=(e:PointerEvent)=>{contacts.delete(e.pointerId); start=prior=undefined;};
  const up=(e:PointerEvent)=>{
    if(!contacts.delete(e.pointerId)||!start||e.pointerId!==start.id)return;
    const tap=start;start=undefined;
    if(e.timeStamp-tap.t>250){prior=undefined;return;}
    if(prior && e.timeStamp-prior.t<340 && Math.hypot(e.clientX-prior.x,e.clientY-prior.y)<24){
      prior=undefined;element.dataset.suppressMaximizeUntil=String(performance.now()+700);activate();
    }else prior=tap;
  };
  const doc=element.ownerDocument;
  const begin=(e:PointerEvent)=>{if(element.contains(e.target as Node))down(e);};
  doc.addEventListener('pointerdown',begin,true);doc.addEventListener('pointermove',move,true);
  doc.addEventListener('pointerup',up,true);doc.addEventListener('pointercancel',cancel,true);
  return ()=>{doc.removeEventListener('pointerdown',begin,true);doc.removeEventListener('pointermove',move,true);
    doc.removeEventListener('pointerup',up,true);doc.removeEventListener('pointercancel',cancel,true);};
}
