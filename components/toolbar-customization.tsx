'use client';
import {Children,Fragment,createContext,isValidElement,useContext,useEffect,useRef,useState,type ReactNode,type ReactElement,type DragEvent} from 'react';
import {createPortal} from 'react-dom';
import {Settings2,Plus,X,RotateCcw,ArrowUp,ArrowDown} from 'lucide-react';

type Placement={group:string;order:number};
type Saved={groups:{id:string;name:string}[];items:Record<string,Placement>};
type Item={home:string;label:string;menu:boolean;order:number};
const mime='application/x-radaz-toolbar-item';
const empty=():Saved=>({groups:[],items:{}});
const Context=createContext<{
  saved:Saved; editing:boolean;setEditing:(v:boolean)=>void; items:Record<string,Item>;
  groups:Record<string,{label:string;host:HTMLElement}>;
  register:(id:string,item:Item)=>()=>void;registerGroup:(id:string,label:string,host:HTMLElement)=>()=>void;
  move:(id:string,group:string,before?:string)=>void;save:(value:Saved|((value:Saved)=>Saved))=>void;
}|null>(null);
const GroupContext=createContext('');
export const useToolbarHome=()=>useContext(GroupContext);

export function ToolbarCustomization({scope,children}:{scope:string;children:ReactNode}){
  const [saved,save]=useState<Saved>(empty),[loaded,setLoaded]=useState(''),[editing,setEditing]=useState(false);
  const [items,setItems]=useState<Record<string,Item>>({}),[groups,setGroups]=useState<Record<string,{label:string;host:HTMLElement}>>({});
  useEffect(()=>{
    let value=empty();
    try{const data=JSON.parse(localStorage.getItem(`radaz-toolbar-items-v1:${scope}`)||'null');
      if(Array.isArray(data?.groups)&&data.groups.length<=40&&data.items&&typeof data.items==='object'){
        value.groups=data.groups.filter((g:{id:string;name:string})=>/^custom-[a-z0-9-]+$/.test(g?.id)&&typeof g.name==='string'&&g.name.length<=80);
        for(const [id,p] of Object.entries(data.items) as [string,Placement][])if(id.length<300&&p&&typeof p.group==='string'&&Number.isFinite(p.order))value.items[id]=p;
      }
    }catch{}save(value);setLoaded(scope);
  },[scope]);
  useEffect(()=>{if(loaded===scope)try{localStorage.setItem(`radaz-toolbar-items-v1:${scope}`,JSON.stringify(saved));}catch{}},[saved,scope,loaded]);
  const register=useRef((id:string,item:Item)=>{setItems(current=>({...current,[id]:item}));return()=>setItems(current=>{const next={...current};delete next[id];return next;});}).current;
  const registerGroup=useRef((id:string,label:string,host:HTMLElement)=>{setGroups(current=>({...current,[id]:{label,host}}));return()=>setGroups(current=>{const next={...current};delete next[id];return next;});}).current;
  const move=(id:string,group:string,before?:string)=>{
    if(!items[id]||(group!=='menu'&&!groups[group]))return;
    save(current=>{
      const peers=Object.keys(items).filter(key=>key!==id&&(current.items[key]?.group||(items[key].menu?'menu':items[key].home))===group)
        .sort((a,b)=>(current.items[a]?.order??items[a].order)-(current.items[b]?.order??items[b].order));
      const index=before?peers.indexOf(before):-1;peers.splice(index<0?peers.length:index,0,id);
      const next={...current,items:{...current.items}};peers.forEach((key,order)=>next.items[key]={group,order});return next;
    });
  };
  return <Context.Provider value={{saved,editing,setEditing,items,groups,register,registerGroup,move,save}}>{children}</Context.Provider>;
}

function labelOf(node:ReactNode):string{
  if(typeof node==='string'||typeof node==='number')return String(node);
  if(Array.isArray(node))return node.map(labelOf).filter(Boolean).join(' ');
  if(!isValidElement(node))return '';
  const props=node.props as Record<string,any>;
  if(node.type==='kbd')return '';
  return props['aria-label']||props.title||labelOf(props.children);
}
function primaryLabel(node:ReactNode):string{
  if(!isValidElement(node))return labelOf(node);
  const props=node.props as Record<string,any>;
  return props['aria-label']||props.title||Children.toArray(props.children).map(primaryLabel).find(Boolean)||'';
}
function flattened(children:ReactNode):ReactElement[]{
  return Children.toArray(children).flatMap(node=>isValidElement(node)?node.type===Fragment?flattened((node.props as {children:ReactNode}).children):[node]:[]);
}
function start(event:DragEvent,id:string){event.stopPropagation();event.dataTransfer.setData(mime,id);event.dataTransfer.effectAllowed='move';}
function accept(event:DragEvent){if(event.dataTransfer.types.includes(mime)){event.preventDefault();event.stopPropagation();event.dataTransfer.dropEffect='move';}}

export function CustomizableGroup({id,label,children}:{id:string;label:string;children:ReactNode}){
  const context=useContext(Context),[host,setHost]=useState<HTMLDivElement|null>(null);
  const register=context?.registerGroup;
  useEffect(()=>host?register?.(id,label,host):undefined,[id,label,host,register]);
  return <GroupContext.Provider value={id}><div ref={setHost} className="toolbar-item-host" data-item-group={id}
    onDragOver={accept} onDrop={event=>{if(!event.dataTransfer.types.includes(mime))return;event.preventDefault();event.stopPropagation();context?.move(event.dataTransfer.getData(mime),id);}}>
    {flattened(children).map((child,index)=><PortableItem key={child.key||index} id={`${id}/${child.key||index}`} home={id} label={primaryLabel(child)||`${label} ${index+1}`} order={index}>{child}</PortableItem>)}
    {context?.editing&&!Children.count(children)&&<span className="toolbar-empty-group">{label}</span>}
  </div></GroupContext.Provider>;
}

function PortableItem({id,home,label,order,menu=false,children,command}:{id:string;home:string;label:string;order:number;menu?:boolean;children:ReactNode;command?:ReactNode}){
  const context=useContext(Context),register=context?.register;
  useEffect(()=>register?.(id,{home,label,menu,order}),[register,id,home,label,menu,order]);
  if(!context)return children;
  const destination=context.saved.items[id]?.group||(menu?'menu':home),position=context.saved.items[id]?.order??order;
  const target=destination==='menu'?null:context.groups[destination]?.host;
  const isHome=destination===(menu?'menu':home)||!target;
  const dragProps={draggable:context.editing,onDragStart:(event:DragEvent)=>start(event,id),onDragOver:accept,onDrop:(event:DragEvent)=>{
    if(!event.dataTransfer.types.includes(mime))return;event.preventDefault();event.stopPropagation();context.move(event.dataTransfer.getData(mime),destination,id);
  }};
  const element=<div className={`toolbar-portable ${menu&&isHome?'toolbar-menu-item':''} ${context.editing?'toolbar-item-editing':''}`} data-toolbar-item={id} style={{order:position}} {...dragProps}>{menu&&!isHome?command:children}</div>;
  return isHome?element:createPortal(element,target!,id);
}

/** Menu content remains mounted so pinned commands always use current React state. */
export function PortableMenuItem({id,label,children,command}:{id?:string;label:string;children:ReactNode;command:ReactNode}){
  const home=useToolbarHome();
  if(!home)return children;
  return <PortableItem id={`${home}/menu:${id||label}`} home={home} label={label} order={100} menu command={command}>{children}</PortableItem>;
}
export const toolbarLabel=labelOf;
export function useCustomToolbarGroups(){return useContext(Context)?.saved.groups||[];}

export function ToolbarCustomizeButton({onReset}:{onReset:()=>void}){
  const context=useContext(Context),[open,setOpen]=useState(false),[name,setName]=useState('');
  if(!context)return null;
  const {saved,save,items,groups,move,editing,setEditing}=context;
  const names=(id:string)=>saved.groups.find(g=>g.id===id)?.name||groups[id]?.label||id;
  const options=[...new Set([...Object.keys(groups),...saved.groups.map(g=>g.id)])];
  const ordered=Object.keys(items).sort((a,b)=>(saved.items[a]?.order??items[a].order)-(saved.items[b]?.order??items[b].order));
  return <><button className="toolbar-customize-trigger" title="Alət panelini fərdiləşdir" aria-label="Alət panelini fərdiləşdir" onClick={()=>setOpen(true)}><Settings2/></button>
    {editing&&<button className="toolbar-edit-done" onClick={()=>setEditing(false)}>Düzülüşü bitir ✓</button>}
    {open&&createPortal(<div className="toolbar-editor-backdrop" onClick={event=>{if(event.target===event.currentTarget)setOpen(false);}}><section role="dialog" aria-modal="true" aria-label="Alət panelinin düzülüşü" className="toolbar-editor" onKeyDown={event=>{if(event.key==='Escape')setOpen(false);}}>
      <header><h2>Alət panelinin düzülüşü</h2><button aria-label="Bağla" onClick={()=>setOpen(false)}><X/></button></header>
      <p>Düymələri və menyu alətlərini qruplar arasında sürüşdürün. Qrupun sağ tutacağı onun yerini dəyişir. Dəyişikliklər avtomatik saxlanılır.</p>
      <div className="toolbar-editor-actions"><button onClick={()=>{setEditing(true);setOpen(false);}}>Sürüşdürərək düzəlt</button><button onClick={()=>{save(empty());onReset();}}><RotateCcw/>Standart düzülüşü bərpa et</button></div>
      <form onSubmit={event=>{event.preventDefault();if(!name.trim()||saved.groups.length>=40)return;save({...saved,groups:[...saved.groups,{id:`custom-${crypto.randomUUID()}`,name:name.trim().slice(0,80)}]});setName('');}}><input aria-label="Yeni qrupun adı" value={name} maxLength={80} onChange={e=>setName(e.target.value)} placeholder="Yeni qrupun adı"/><button type="submit"><Plus/>Qrup yarat</button></form>
      {saved.groups.map(group=><div className="toolbar-editor-custom" key={group.id}><input aria-label="Qrupun adı" value={group.name} maxLength={80} onChange={event=>save({...saved,groups:saved.groups.map(g=>g.id===group.id?{...g,name:event.target.value}:g)})}/><button aria-label={`${group.name} qrupunu sil`} onClick={()=>save({...saved,groups:saved.groups.filter(g=>g.id!==group.id),items:Object.fromEntries(Object.entries(saved.items).filter(([,p])=>p.group!==group.id))})}><X/></button></div>)}
      <div className="toolbar-editor-list">{ordered.map(id=>{
        const item=items[id],destination=saved.items[id]?.group||(item.menu?'menu':item.home);
        const peers=ordered.filter(key=>(saved.items[key]?.group||(items[key].menu?'menu':items[key].home))===destination),index=peers.indexOf(id);
        return <div className="toolbar-editor-item" key={id} draggable onDragStart={event=>start(event,id)} onDragOver={accept} onDrop={event=>{if(!event.dataTransfer.types.includes(mime))return;event.preventDefault();move(event.dataTransfer.getData(mime),destination,id);}}><span>{item.label}</span><select aria-label={`${item.label} qrupu`} value={destination} onChange={event=>move(id,event.target.value)}>{item.menu&&<option value="menu">Əsas menyu</option>}{options.map(group=><option value={group} key={group}>{names(group)}</option>)}</select><button disabled={index<1} aria-label={`${item.label} əvvələ`} onClick={()=>move(id,destination,peers[index-1])}><ArrowUp/></button><button disabled={index===peers.length-1} aria-label={`${item.label} sonraya`} onClick={()=>move(id,destination,peers[index+2])}><ArrowDown/></button></div>;
      })}</div>
    </section></div>,document.body)}
  </>;
}
