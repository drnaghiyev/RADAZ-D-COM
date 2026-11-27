type Drop=(item:HTMLElement,zone:HTMLElement,target:HTMLElement|null,after:boolean)=>void;
export function bindToolbarDrag(root:HTMLElement, itemSelector:string, zoneSelector:string, drop:Drop) {
  const doc=root.ownerDocument, win=doc.defaultView!;
  let active:HTMLElement|null=null, target:HTMLElement|null=null,zone:HTMLElement|null=null;
  let source:HTMLElement|null=null, id=-1,x=0,y=0,timer=0,after=false,blockUntil=0;
  const clear=()=>{
    win.clearTimeout(timer);active?.removeAttribute('data-moving');target?.removeAttribute('data-drop-edge');
    if(active){root.removeAttribute('data-dragging-tools');if(active.hasPointerCapture(id))active.releasePointerCapture(id);}
    active=source=target=zone=null;id=-1;
  };
  const arm=()=>{if(!source?.isConnected)return;active=source;active.dataset.moving='true';root.dataset.draggingTools='true';
    try{active.setPointerCapture(id);}catch{clear();}};
  const down=(e:PointerEvent)=>{
    if(!e.isPrimary||e.button!==0){clear();return;}
    const el=e.target as Element;
    if(el.closest('input,select,textarea,[role=dialog],[role=menu],.menu-popover'))return;
    const item=el.closest<HTMLElement>(itemSelector);if(!item||!root.contains(item))return;
    clear();source=item;id=e.pointerId;x=e.clientX;y=e.clientY;
    if(e.pointerType!=='mouse')timer=win.setTimeout(arm,460);
  };
  const move=(e:PointerEvent)=>{
    if(!source||id!==e.pointerId)return;
    if(!active && Math.hypot(e.clientX-x,e.clientY-y)>6){
      if(e.pointerType==='mouse')arm();else {clear();return;}
    }
    if(!active)return;
    e.preventDefault();e.stopImmediatePropagation();
    const el=doc.elementFromPoint(e.clientX,e.clientY),z=el?.closest<HTMLElement>(zoneSelector);
    target?.removeAttribute('data-drop-edge');
    zone=z&&root.contains(z)?z:null;target=zone?el?.closest<HTMLElement>(itemSelector)||null:null;
    if(target&&target!==active){const b=target.getBoundingClientRect();
      after=zone?.classList.contains('flat-toolbar-right')?e.clientY>b.top+b.height/2:e.clientX>b.left+b.width/2;
      target.dataset.dropEdge=after?'after':'before';}
    if(zone?.classList.contains('flat-toolbar-right')){const rail=zone.parentElement!,r=rail.getBoundingClientRect();if(e.clientY<r.top+25)rail.scrollTop-=14;else if(e.clientY>r.bottom-25)rail.scrollTop+=14;}
  };
  const up=(e:PointerEvent)=>{if(e.pointerId!==id)return;
    if(active){move(e);blockUntil=performance.now()+450;e.preventDefault();e.stopImmediatePropagation();
      if(active&&zone&&target!==active)drop(active,zone,target,after);}
    clear();
  };
  const click=(e:Event)=>{if(performance.now()<blockUntil){e.preventDefault();e.stopImmediatePropagation();}};
  const menu=(e:Event)=>{if(source){e.preventDefault();e.stopPropagation();}};
  root.addEventListener('pointerdown',down,true);doc.addEventListener('pointermove',move,true);doc.addEventListener('pointerup',up,true);
  doc.addEventListener('pointercancel',clear,true);doc.addEventListener('click',click,true);root.addEventListener('contextmenu',menu,true);
  return ()=>{clear();root.removeEventListener('pointerdown',down,true);doc.removeEventListener('pointermove',move,true);doc.removeEventListener('pointerup',up,true);doc.removeEventListener('pointercancel',clear,true);doc.removeEventListener('click',click,true);root.removeEventListener('contextmenu',menu,true);};
}
