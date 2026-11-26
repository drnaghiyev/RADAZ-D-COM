'use client';
import {useCallback,useEffect,useMemo,useRef,useState,type HTMLAttributes,type ReactNode} from 'react';
import {createPortal} from 'react-dom';
import {MoreHorizontal} from 'lucide-react';
import {FlatToolbarContext,ToolbarCustomizeButton,ToolSource} from './toolbar-customization';
import {emptyLayout,placements,readLayouts,type Dock,type Legacy,type Tool} from '@/lib/toolbar-layout';
import './flat-toolbar.css';

const noLegacy:Legacy={items:{},groups:{}};
export function ToolbarWorkspace({scope,children}:{scope:string;children:ReactNode}){
  const root=useRef<HTMLDivElement>(null),[header,setHeader]=useState<HTMLElement|null>(null);
  const [top,setTop]=useState<HTMLDivElement|null>(null),[bottom,setBottom]=useState<HTMLDivElement|null>(null);
  const [right,setRight]=useState<HTMLDivElement|null>(null),[popup,setPopup]=useState<HTMLDivElement|null>(null);
  const [layout,setLayout]=useState(emptyLayout),[legacy,setLegacy]=useState(noLegacy),[defaults,setDefaults]=useState(noLegacy);
  const [loaded,setLoaded]=useState(''),[tools,setTools]=useState<Record<string,Tool>>({});
  const [overflow,setOverflow]=useState<string[]>([]),[open,setOpen]=useState(false);
  const trigger=useRef<HTMLButtonElement>(null);
  useEffect(()=>{
    const node=root.current?.querySelector<HTMLElement>('.topbar,.records-header');
    setHeader(node||null);
    if(!node)return;
    try{
      const current=readLayouts(node.ownerDocument.defaultView!.localStorage,scope,node.ownerDocument.location.origin==='https://appassets.androidplatform.net');
      setLayout(current.layout);setLegacy(current.legacy);setDefaults({groups:current.defaults,items:{}});
    }catch{setLayout(emptyLayout());setLegacy(noLegacy);setDefaults(noLegacy);}
    setLoaded(scope);
  },[scope]);
  useEffect(()=>{if(loaded===scope&&header)try{header.ownerDocument.defaultView!.localStorage.setItem('radaz-toolbar-flat-v1:'+scope,JSON.stringify(layout));}catch{}},[scope,loaded,header,layout]);
  const register=useCallback((id:string,tool:Tool)=>{
    setTools(prev=>({...prev,[id]:tool}));
    return ()=>setTools(prev=>{const next={...prev};delete next[id];return next;});
  },[]);
  const all=useMemo(()=>placements(tools,layout,layout.ignoreLegacy?defaults:legacy),[tools,layout,legacy,defaults]);

  const hasRight=Object.values(all).some(item=>item.dock==='right'),twoRows=Object.values(all).some(item=>item.dock==='bottom');
  useEffect(()=>{
    if(!header||!top||!popup)return;
    const win=header.ownerDocument.defaultView!;
    let frame=0;
    const measure=()=>{
      root.current?.style.setProperty('--dock-top',header.getBoundingClientRect().height+'px');
      const nodes=[...top.children,...popup.children].filter((n):n is HTMLElement=>n instanceof win.HTMLElement && !n.hidden && n.hasAttribute('data-toolbar-item'));
      const ordered=nodes.sort((a,b)=>Number(a.style.order)-Number(b.style.order));
      const gap=parseFloat(win.getComputedStyle(top).columnGap)||0;
      const widths=ordered.map(n=>n.getBoundingClientRect().width);
      const used=widths.reduce((sum,width)=>sum+width,0)+Math.max(0,widths.length-1)*gap;
      const hidden:string[]=[];
      if(used>top.clientWidth){
        const available=top.clientWidth-40;
        let end=0;
        ordered.forEach((n,index)=>{end+=widths[index]+(index?gap:0);if(end>available)hidden.push(n.dataset.toolbarItem!);});
      }
      setOverflow(prev=>prev.length===hidden.length&&prev.every((id,i)=>id===hidden[i])?prev:hidden);
      if(!hidden.length)setOpen(false);
    };
    const schedule=()=>{win.cancelAnimationFrame(frame);frame=win.requestAnimationFrame(measure);};
    const observer=new ResizeObserver(schedule);
    const watch=()=>{
      observer.disconnect();observer.observe(header);observer.observe(top);
      for(const el of [...top.children,...popup.children])observer.observe(el);
      schedule();
    };
    const mutations=new MutationObserver(watch);
    for(const host of [top,popup])mutations.observe(host,{childList:true});
    watch();
    return ()=>{win.cancelAnimationFrame(frame);observer.disconnect();mutations.disconnect();};
  },[header,top,popup]);
  useEffect(()=>{
    if(!open||!header||!popup)return;
    const doc=header.ownerDocument;
    const close=(event:PointerEvent)=>{
      const target=event.target as Element;
      if(trigger.current?.contains(target)||popup.contains(target))return;
      const owner=target.closest('[data-toolbar-menu]')?.getAttribute('data-toolbar-menu');
      if(owner&&Array.from(popup.children).some(n=>(n as HTMLElement).dataset.toolHome===owner))return;
      setOpen(false);
    };
    const key=(e:KeyboardEvent)=>{if(e.key==='Escape'){setOpen(false);trigger.current?.focus();}};
    doc.addEventListener('pointerdown',close);doc.addEventListener('keydown',key);
    return ()=>{doc.removeEventListener('pointerdown',close);doc.removeEventListener('keydown',key);};
  },[open,header,popup]);
  return <FlatToolbarContext.Provider value={{hosts:{top,bottom,right,overflow:popup},overflow:new Set(overflow),tools,all,dividers:layout.dividers,register,layout,apply:setLayout,legacy,defaults}}>
    <div ref={root} className={'toolbar-workspace flat-toolbar-workspace'+(hasRight?' has-right-dock':'')} data-toolbar-scope={scope} data-toolbar-rows={twoRows?2:1}>
      {children}
      {header&&createPortal(<>
        <div ref={setTop} className="flat-toolbar-strip flat-toolbar-top" aria-label="Üst alət paneli"/>
        <div ref={setBottom} className="flat-toolbar-strip flat-toolbar-bottom" hidden={!twoRows} aria-label="İkinci alət sırası"/>
        {overflow.length>0&&<button type="button" ref={trigger} className="toolbar-overflow-trigger" aria-label="Əlavə alətlər" aria-expanded={open} onClick={()=>setOpen(!open)}><MoreHorizontal/></button>}
        <div ref={setPopup} className={'toolbar-overflow-popup flat-toolbar-strip'+(open&&overflow.length?' is-open':'')} inert={!open||!overflow.length} aria-hidden={!open||!overflow.length}/>
      </>,header)}
      <ToolSource home="toolbar-settings" groupOrder={100} label="Alət panelini fərdiləşdir"><ToolbarCustomizeButton/></ToolSource>
      <aside className="right-tool-dock" aria-label="Sağ alət paneli" hidden={!hasRight}><div ref={setRight} className="flat-toolbar-strip flat-toolbar-right"/></aside>
    </div>
  </FlatToolbarContext.Provider>;
}
// These declarations supply stable command IDs and source order without creating a visual group.
export function ToolbarGroup({groupId,order=0,children,className='',...props}:HTMLAttributes<HTMLDivElement>&{groupId:string;order?:number;children?:ReactNode}){
  return <ToolSource home={groupId} groupOrder={order} className={className.split(/\s+/).filter(x=>!['toolbar-group','mode-controls','help-command','output-command-group','display-direct-controls'].includes(x)).join(' ')} label={props['aria-label']||groupId}>{children}</ToolSource>;
}
export function ToolbarOverflow(){return null;}
