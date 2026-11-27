'use client';
import {Children,Fragment,createContext,isValidElement,useContext,useEffect,useRef,useState,type ReactElement,type ReactNode} from 'react';
import {createPortal} from 'react-dom';
import {ArrowDown,ArrowUp,Columns2,RotateCcw,Settings2,X} from 'lucide-react';
import {ToolbarGrip} from './toolbar-grip';
import {defaultLayout,emptyLayout,placements,reorder,type Layout,type Legacy,type Dock,type Position,type Tool} from '@/lib/toolbar-layout';

export type ToolHosts={top:HTMLElement|null;bottom:HTMLElement|null;right:HTMLElement|null;overflow:HTMLElement|null};
export const FlatToolbarContext=createContext<{
  scope:string;hosts:ToolHosts; overflow:Set<string>; tools:Record<string,Tool>; all:Record<string,Position>; dividers:string[];
  register:(id:string,tool:Tool)=>()=>void;layout:Layout;apply:(value:Layout)=>void;legacy:Legacy;defaults:Legacy;
}|null>(null);
const Home=createContext({home:'',groupOrder:0,className:''});
export const useToolbarHome=()=>useContext(Home).home;
export function toolbarLabel(node:ReactNode):string{
  if(typeof node==='string'||typeof node==='number')return String(node);
  if(Array.isArray(node))return node.map(toolbarLabel).filter(Boolean).join(' ');
  if(!isValidElement(node)||node.type==='kbd')return '';
  const props=node.props as Record<string,any>;
  return props['aria-label']||props.title||toolbarLabel(props.children);
}
function primaryLabel(node:ReactNode):string{
  if(!isValidElement(node))return toolbarLabel(node);
  const props=node.props as Record<string,any>;
  return props['aria-label']||props.title||Children.toArray(props.children).map(primaryLabel).find(Boolean)||'';
}
function flattened(children:ReactNode):ReactElement[]{
  return Children.toArray(children).flatMap(node=>isValidElement(node)?node.type===Fragment?flattened((node.props as {children:ReactNode}).children):[node]:[]);
}
// The old source IDs also identify pinned menu commands in saved layouts.
export function ToolSource({home,groupOrder=0,className='',label,children}:{home:string;groupOrder?:number;className?:string;label:string;children?:ReactNode}){
  return <Home.Provider value={{home,groupOrder,className}}>{flattened(children).map((child,index)=>
    <PortableItem key={child.key||index} id={home+'/'+(child.key||index)} order={index} label={primaryLabel(child)||label}>{child}</PortableItem>)}</Home.Provider>;
}
function PortableItem({id,order,menu=false,label,children,command}:{id:string;order:number;menu?:boolean;label:string;children:ReactNode;command?:ReactNode}){
  const source=useContext(Home),context=useContext(FlatToolbarContext),register=context?.register;
  useEffect(()=>register?.(id,{home:source.home,groupOrder:source.groupOrder,order,label,menu}),[id,register,source.home,source.groupOrder,order,label,menu]);
  if(!context)return children;
  const placement=context.all[id]||{dock:menu?'menu':'top',order};
  if(placement.dock==='menu')return children;
  const pooled=placement.dock==='pool';
  const dock=placement.dock==='pool'?'top':placement.dock;
  const host=context.hosts[dock==='top'&&context.overflow.has(id)?'overflow':dock];
  if(!host)return null;
  return createPortal(<div className={'flat-toolbar-tool toolbar-portable '+source.className} data-toolbar-item={id}
      data-tool-home={source.home} data-toolbar-divider={context.dividers.includes(id)||undefined} data-tool-dock={dock}
      hidden={pooled} style={{order:placement.order}}>
    {context.dividers.includes(id)&&<span role="separator" className="flat-toolbar-divider" aria-orientation={dock==='right'?'horizontal':'vertical'}/>}
    {menu?command:children}
  </div>,host,id);
}
export function PortableMenuItem({id,label,children,command}:{id?:string;label:string;children:ReactNode;command:ReactNode}){
  const home=useToolbarHome();
  return home?<PortableItem id={home+'/menu:'+(id||label)} order={100} label={label} menu command={command}>{children}</PortableItem>:children;
}
const docks:Record<Dock,string>={top:'Üst panel',bottom:'İkinci sıra',right:'Sağ panel',menu:'Menyuda',pool:'Gizli'};

export function ToolbarCustomizeButton(){
  const context=useContext(FlatToolbarContext),[open,setOpen]=useState(false);
  const trigger=useRef<HTMLButtonElement>(null);
  const confirm=useRef<HTMLButtonElement>(null);
  useEffect(()=>{if(open)confirm.current?.focus();},[open]);
  const [draft,setDraft]=useState<Layout>(emptyLayout);
  if(!context)return null;
  const {tools}=context,all=placements(tools,draft,draft.ignoreLegacy?context.defaults:context.legacy);
  const dividers=draft.dividers;
  const move=(id:string,dock:Dock,before?:string)=>setDraft(reorder(draft,all,id,dock,before));
  const toggleDivider=(id:string)=>setDraft({...draft,dividers:dividers.includes(id)?dividers.filter(k=>k!==id):[...dividers,id]});
  const reset=()=>setDraft(defaultLayout(context.scope));
  const close=()=>{setOpen(false);trigger.current?.focus();};
  return <><button type="button" ref={trigger} className="toolbar-customize-trigger" aria-label="Alət panelini fərdiləşdir" title="Alət panelini fərdiləşdir" onClick={()=>{setDraft(context.layout);setOpen(true);}}><Settings2/></button>
    {open&&createPortal(<div className="toolbar-editor-backdrop" onClick={e=>{if(e.target===e.currentTarget)close();}}><section role="dialog" aria-modal="true" aria-label="Alət panelinin düzülüşü" className="toolbar-editor" onKeyDown={e=>{if(e.key==='Escape')close();}}>
      <header><h2>Alət panelinin düzülüşü</h2><button type="button" ref={confirm} onClick={()=>{context.apply(draft);close();}}>Təsdiq</button><button type="button" aria-label="Bağla" onClick={close}><X/></button></header>
      <button type="button" className="toolbar-reset-flat" onClick={reset}><RotateCcw size={16}/> Standart düzülüşü bərpa et</button>
      {(Object.keys(docks) as Dock[]).map(dock=>{
        const peers=Object.keys(all).filter(id=>all[id].dock===dock).sort((a,b)=>all[a].order-all[b].order);
        return <section key={dock} data-layout-zone={dock} className="flat-toolbar-editor-zone"><h3>{docks[dock]}</h3>{peers.map((id,index)=>{
          const item=tools[id],change=(next:Dock)=>move(id,next);
          return <div key={id} className="toolbar-editor-item flat-toolbar-editor-item" data-layout-id={id}>
            <ToolbarGrip label={item.label} drop={(zone,target,after)=>{
              const dest=zone as Dock;
              if(target===id||!(dest in docks)||(dest==='menu'&&!item.menu)||(dest==='pool'&&item.home==='toolbar-settings'))return;
              const list=Object.keys(all).filter(k=>k!==id&&all[k].dock===dest).sort((a,b)=>all[a].order-all[b].order);
              move(id,dest,after&&target?list[list.indexOf(target)+1]:target);
            }}/>
            <span>{item.label}</span><select aria-label={item.label+' yerləşməsi'} value={dock} onChange={e=>change(e.target.value as Dock)}>{(Object.keys(docks) as Dock[]).filter(key=>(key!=='menu'||item.menu)&&(key!=='pool'||item.home!=='toolbar-settings')).map(key=><option key={key} value={key}>{docks[key]}</option>)}</select>
            <button type="button" title="Əvvələ" aria-label={item.label+' əvvələ'} disabled={index===0||dock==='menu'} onClick={()=>move(id,dock,peers[index-1])}><ArrowUp/></button>
            <button type="button" title="Sonraya" aria-label={item.label+' sonraya'} disabled={index===peers.length-1||dock==='menu'} onClick={()=>move(id,dock,peers[index+2])}><ArrowDown/></button>
            <button type="button" title="Düymədən əvvəl ayırıcı" aria-label={item.label+' düyməsindən əvvəl ayırıcı'} disabled={dock==='menu'||dock==='pool'} aria-pressed={dividers.includes(id)} onClick={()=>toggleDivider(id)}><Columns2/></button>
          </div>;
        })}</section>;
      })}
    </section></div>,trigger.current?.ownerDocument.body||document.body)}
  </>;
}
