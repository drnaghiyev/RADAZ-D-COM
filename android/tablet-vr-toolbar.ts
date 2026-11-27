/** Android can send a complete tap without a click after a touch drag on the volume. */
export function bindTabletVolumeButtons(root:HTMLElement){
  type Tap={button:HTMLButtonElement;id:number;x:number;y:number;start:number};
  let tap:Tap|null=null, last:HTMLButtonElement|null=null, lastTime=0;
  const buttonAt=(target:EventTarget|null)=>{
    const b=target instanceof Element?target.closest<HTMLButtonElement>('button'):null;
    return b && !b.disabled && !b.matches('.vr-close') && b.closest('.vr-tools,.vr-menu') ? b : null;
  };
  const down=(e:PointerEvent)=>{
    tap=null;
    if(!e.isPrimary || e.pointerType!=='touch' || e.button!==0)return;
    const button=buttonAt(e.target);
    if(button)tap={button,id:e.pointerId,x:e.clientX,y:e.clientY,start:e.timeStamp};
  };
  const move=(e:PointerEvent)=>{
    if(tap?.id===e.pointerId && Math.hypot(e.clientX-tap.x,e.clientY-tap.y)>8)tap=null;
  };
  const cancel=()=>{tap=null;};
  const up=(e:PointerEvent)=>{
    const t=tap;tap=null;
    if(!t || t.id!==e.pointerId || e.timeStamp-t.start>=450 ||
       Math.hypot(e.clientX-t.x,e.clientY-t.y)>8 ||
       buttonAt(root.ownerDocument.elementFromPoint(e.clientX,e.clientY))!==t.button)return;
    last=t.button;lastTime=performance.now();
    t.button.click();
  };
  const click=(e:MouseEvent)=>{
    // Keep mouse, keyboard and accessibility activation. Consume only a second
    // touch-generated click for the tap that we already delivered.
    const fromTouch=(e instanceof PointerEvent && e.pointerType==='touch') ||
      (e as MouseEvent & {sourceCapabilities?:{firesTouchEvents:boolean}}).sourceCapabilities?.firesTouchEvents;
    if(e.isTrusted && e.detail>0 && fromTouch &&
       buttonAt(e.target)===last && performance.now()-lastTime<700){
      last=null;e.preventDefault();e.stopImmediatePropagation();
    }
  };
  root.addEventListener('pointerdown',down);
  root.addEventListener('pointermove',move);
  root.addEventListener('pointercancel',cancel);
  root.addEventListener('pointerup',up);
  root.addEventListener('click',click,true);
  return ()=>{
    root.removeEventListener('pointerdown',down);
    root.removeEventListener('pointermove',move);
    root.removeEventListener('pointercancel',cancel);
    root.removeEventListener('pointerup',up);
    root.removeEventListener('click',click,true);
  };
}
