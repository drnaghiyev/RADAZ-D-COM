'use client';
import {createContext, useContext, useEffect, useRef, useState, type HTMLAttributes, type ReactNode} from 'react';
import {createPortal} from 'react-dom';
import {GripVertical, MoreHorizontal} from 'lucide-react';

type Position = {side: 'top'|'right'; order: number};
type Layout = Record<string, Position>;
type Registry = Record<string, number>;
const Context=createContext<{
  layout: Layout; dock: HTMLDivElement|null; overflow: string[]; popup: HTMLDivElement|null;
  setPopup:(element:HTMLDivElement|null)=>void;
  register:(id:string,order:number)=>()=>void;
  move:(id:string,side:'top'|'right',before?:string)=>void;
  begin:(event:React.PointerEvent<HTMLButtonElement>,id:string)=>void;
}|null>(null);

/** React owns both docks. Moving a group never manually reparents application DOM. */
export function ToolbarWorkspace({scope,children}:{scope:string;children:ReactNode}) {
  const [layout,setLayout]=useState<Layout>({}),[registry,setRegistry]=useState<Registry>({});
  const [drag,setDrag]=useState<string|null>(null),[dock,setDock]=useState<HTMLDivElement|null>(null);
  const [loaded,setLoaded]=useState('');
  const [overflow,setOverflow]=useState<string[]>([]),[popup,setPopup]=useState<HTMLDivElement|null>(null);
  const root=useRef<HTMLDivElement>(null);
  const gesture=useRef<{id:string;pointer:number;handle:HTMLButtonElement;x:number;y:number}|null>(null);
  useEffect(()=>{
    let next:Layout={};
    try {
      const saved=JSON.parse(localStorage.getItem(`radaz-toolbar-v1:${scope}`)||'{}');
      for(const [id,value] of Object.entries(saved) as [string,Position][])
        if(value&&['top','right'].includes(value.side)&&Number.isFinite(value.order))next[id]=value;
    } catch {}
    setLayout(next);setLoaded(scope);
  },[scope]);
  useEffect(()=>{if(loaded===scope)try{localStorage.setItem(`radaz-toolbar-v1:${scope}`,JSON.stringify(layout));}catch{}},[layout,loaded,scope]);
  const register=useRef((id:string,order:number)=>{
    setRegistry(current=>({...current,[id]:order}));
    return()=>setRegistry(current=>{const next={...current};delete next[id];return next;});
  }).current;
  const move=(id:string,side:'top'|'right',before?:string)=>{
    if(!(id in registry))return;
    setLayout(current=>{
      const peers=Object.keys(registry).filter(key=>key!==id&&(current[key]?.side||'top')===side)
        .sort((a,b)=>(current[a]?.order??registry[a])-(current[b]?.order??registry[b]));
      const at=before?peers.indexOf(before):-1;peers.splice(at<0?peers.length:at,0,id);
      const next={...current};peers.forEach((key,index)=>next[key]={side,order:index});return next;
    });
    setDrag(null);
  };
  const hasRight=Object.keys(registry).some(id=>layout[id]?.side==='right');
  const moveRef=useRef(move);moveRef.current=move;
  const begin=(event:React.PointerEvent<HTMLButtonElement>,id:string)=>{
    if(event.button!==0)return;
    event.preventDefault();event.stopPropagation();
    gesture.current={id,pointer:event.pointerId,handle:event.currentTarget,x:event.clientX,y:event.clientY};
    event.currentTarget.setPointerCapture(event.pointerId);setDrag(id);
  };
  useEffect(()=>{
    const finish=(event:PointerEvent)=>{
      const current=gesture.current;if(!current||current.pointer!==event.pointerId)return;
      gesture.current=null;
      if(current.handle.hasPointerCapture(event.pointerId))current.handle.releasePointerCapture(event.pointerId);
      const target=document.elementFromPoint(event.clientX,event.clientY);
      if(event.type==='pointerup'&&Math.hypot(event.clientX-current.x,event.clientY-current.y)>4){
        const side=target?.closest('.right-tool-dock')?'right':target?.closest('.topbar,.records-header,.toolbar-overflow-popup')?'top':null;
        const before=target?.closest<HTMLElement>('[data-toolbar-group]')?.dataset.toolbarGroup;
        if(side)moveRef.current(current.id,side,before);
      }
      setDrag(null);
    };
    const cancel=()=>{gesture.current=null;setDrag(null);};
    window.addEventListener('pointerup',finish,true);window.addEventListener('pointercancel',finish,true);window.addEventListener('blur',cancel);
    return()=>{window.removeEventListener('pointerup',finish,true);window.removeEventListener('pointercancel',finish,true);window.removeEventListener('blur',cancel);};
  },[]);
  useEffect(()=>{
    const header=root.current?.querySelector<HTMLElement>('.topbar,.records-header');if(!header)return;
    let frame=0;
    const measure=()=>{
      root.current?.style.setProperty('--dock-top',`${header.getBoundingClientRect().height}px`);
      const style=getComputedStyle(header),gap=parseFloat(style.columnGap)||12;
      const groups=Object.keys(registry).filter(id=>layout[id]?.side!=='right').map(id=>{
        const node=root.current?.querySelector<HTMLElement>(`[data-toolbar-group="${id}"]`);
        return {id,width:(node?.getBoundingClientRect().width||0)+gap};
      });
      const fixed=[...header.querySelectorAll<HTMLElement>('.brand,.mode-identity,.records-header-filters')]
        .reduce((sum,node)=>sum+(node.matches('.records-header-filters')?Math.min(680,header.clientWidth*.6):node.getBoundingClientRect().width)+gap,0);
      const available=header.clientWidth-fixed-(parseFloat(style.paddingLeft)||0)-(parseFloat(style.paddingRight)||0);
      let used=groups.reduce((sum,group)=>sum+group.width,0);
      const hidden:string[]=[];
      // Keep workspace switching and measurements immediately reachable when possible.
      const priority=['rotation','anatomy','annotations','contrast','window','output','cd','import','layout','measure','volume-edit','volume-display','mpr-modes','workspace','help'];
      const candidates=[...groups].sort((a,b)=>{
        const rank=(id:string)=>{const i=priority.indexOf(id);return i<0?5:i;};return rank(a.id)-rank(b.id);
      });
      if(used>available) {
        used+=(parseFloat(getComputedStyle(root.current!).getPropertyValue('--command-size'))||32)+gap;
        for(const group of candidates){if(used<=available)break;hidden.push(group.id);used-=group.width;}
      }
      setOverflow(current=>current.join('|')===hidden.join('|')?current:hidden);
    };
    const schedule=()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(measure);};
    const observer=new ResizeObserver(schedule);observer.observe(header);
    const mutations=new MutationObserver(schedule);mutations.observe(root.current!,{childList:true,subtree:true});
    window.addEventListener('resize',schedule);schedule();
    return()=>{cancelAnimationFrame(frame);observer.disconnect();mutations.disconnect();window.removeEventListener('resize',schedule);};
  },[scope,registry,layout]);
  return <Context.Provider value={{layout,dock,overflow,popup,setPopup,register,move,begin}}>
    <div ref={root} className={`toolbar-workspace ${hasRight?'has-right-dock':''} ${drag?'toolbar-dragging':''}`} data-toolbar-scope={scope}>
      {children}
      <aside className="right-tool-dock" aria-label="Sağ alət paneli" hidden={!hasRight&&!drag}>
        <div className="dock-drop-hint">Sağ panelə yerləşdir</div><div ref={setDock} className="right-tool-groups"/>
      </aside>
    </div>
  </Context.Provider>;
}

export function ToolbarGroup({groupId,order=0,children,className='',...props}:HTMLAttributes<HTMLDivElement>&{groupId:string;order?:number;children?:ReactNode}) {
  const context=useContext(Context),register=context?.register;
  useEffect(()=>register?.(groupId,order),[register,groupId,order]);
  if(!context)return <div {...props} className={`toolbar-group ${className}`}>{children}</div>;
  const position=context?.layout[groupId]||{side:'top',order};
  const element=<div {...props} className={`toolbar-group dockable-tool-group ${className}`} data-toolbar-group={groupId} data-dock={position.side} style={{...props.style,order:position.order,'--group-order':position.order} as React.CSSProperties}>
    <button type="button" className="toolbar-drag-handle" onPointerDown={event=>context.begin(event,groupId)} aria-label={`${props['aria-label']||groupId} — qrupu daşı`}
      title="Tutub üst paneldə və ya sağ kənarda yerləşdirin. İki klik: paneli dəyiş."
      onDoubleClick={()=>context?.move(groupId,position.side==='top'?'right':'top')}
      onKeyDown={event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();context?.move(groupId,position.side==='top'?'right':'top');}}}><GripVertical/></button>
    {children}
  </div>;
  const target=position.side==='right'?context.dock:context.overflow.includes(groupId)?context.popup:null;
  return target?createPortal(element,target,groupId):element;
}

export function ToolbarOverflow() {
  const context=useContext(Context),[open,setOpen]=useState(false);
  const ref=useRef<HTMLDivElement>(null);
  useEffect(()=>{
    if(!open)return;
    const close=(event:Event)=>{if(event instanceof KeyboardEvent?event.key==='Escape':!ref.current?.contains(event.target as Node))setOpen(false);};
    document.addEventListener('pointerdown',close);document.addEventListener('keydown',close);
    return()=>{document.removeEventListener('pointerdown',close);document.removeEventListener('keydown',close);};
  },[open]);
  if(!context)return null;
  return <div className="toolbar-overflow" ref={ref}>
    {!!context.overflow.length&&<button className="toolbar-overflow-trigger" aria-label="Əlavə alətlər" title="Əlavə alətlər" aria-expanded={open} onClick={()=>setOpen(value=>!value)}><MoreHorizontal/></button>}
    <div ref={context.setPopup} className={`toolbar-overflow-popup ${open&&context.overflow.length?'is-open':''}`} inert={!open||!context.overflow.length} aria-hidden={!open||!context.overflow.length}/>
  </div>;
}
