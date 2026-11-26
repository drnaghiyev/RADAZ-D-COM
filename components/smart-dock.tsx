"use client";
import {Children,Fragment,isValidElement,createContext,useContext,useEffect,useRef,useState,type ReactNode} from 'react';
import {createPortal} from 'react-dom';

type Placement={side:'top'|'right';order:number};
type Dock={top:HTMLElement|null;right:HTMLElement|null;layout:Record<string,Placement>;overflow:string[];move:(id:string,side:'top'|'right',before?:string)=>void};
const Context=createContext<Dock|null>(null);
export function SmartDock({scope,children}:{scope:string;children:ReactNode}){
 const root=useRef<HTMLDivElement>(null),[top,setTop]=useState<HTMLElement|null>(null),[right,setRight]=useState<HTMLElement|null>(null),[layout,setLayout]=useState<Record<string,Placement>>({});
 useEffect(()=>{const node=root.current;if(!node)return;setTop(node.querySelector<HTMLElement>('.smart-dock-top'));setRight(node.querySelector<HTMLElement>('.smart-dock-right'));try{setLayout(JSON.parse(localStorage.getItem('radaz-smart-dock:'+scope)||'{}'));}catch{}},[scope]);
 const [overflow,setOverflow]=useState<string[]>([]);const widths=useRef(new Map<string,number>());
 useEffect(()=>{const rootNode=root.current;if(!top||!right||!rootNode)return;const view=top.ownerDocument.defaultView!;let frame=0,disposed=false;
 const measure=()=>{if(disposed||!rootNode.isConnected)return;const nodes=[...rootNode.querySelectorAll<HTMLElement>('[data-smart-tool]')].filter(n=>n.dataset.preferred==='top').sort((a,b)=>Number(a.style.order)-Number(b.style.order));let used=0;const hidden:string[]=[];for(const n of nodes){const id=n.dataset.smartTool!;if(n.dataset.side==='top')widths.current.set(id,n.getBoundingClientRect().width);const width=widths.current.get(id)||n.scrollWidth;used+=width+3;if(used>top.clientWidth)hidden.push(id);}setOverflow(old=>old.join('|')===hidden.join('|')?old:hidden);};
 const schedule=()=>{if(disposed)return;view.cancelAnimationFrame(frame);frame=view.requestAnimationFrame(measure);};const observer=new ResizeObserver(schedule);observer.observe(top);const mutations=new MutationObserver(schedule);mutations.observe(rootNode,{childList:true,subtree:true});schedule();return()=>{disposed=true;view.cancelAnimationFrame(frame);observer.disconnect();mutations.disconnect();};
 },[top,right,layout]);
 const move=(id:string,side:'top'|'right',before?:string)=>setLayout(old=>{const rootNode=root.current;if(!rootNode)return old;const nodes=[...rootNode.querySelectorAll<HTMLElement>('[data-smart-tool]')].filter(n=>n.dataset.smartTool!==id&&n.dataset.side===side).sort((a,b)=>Number(a.style.order)-Number(b.style.order));const ids=nodes.map(n=>n.dataset.smartTool!);let index=before?ids.indexOf(before):-1;ids.splice(index<0?ids.length:index,0,id);const next={...old};ids.forEach((key,order)=>next[key]={side,order});try{localStorage.setItem('radaz-smart-dock:'+scope,JSON.stringify(next));}catch{}return next;});
 return <Context.Provider value={{top,right,layout,overflow,move}}><div ref={root} className="smart-dock-root">{children}</div></Context.Provider>;
}
type ItemProps = {children?: ReactNode; title?: string; 'aria-label'?: string};
function items(children: ReactNode): React.ReactElement<ItemProps>[] {
  return Children.toArray(children).flatMap(child => {
    if (!isValidElement<ItemProps>(child)) return [];
    return child.type === Fragment ? items(child.props.children) : [child];
  });
}

export function SmartDockItems({id,side,order,disabled=false,children}: {
  id:string; side:Placement['side']; order:number; disabled?:boolean; children:ReactNode;
}) {
  const dock = useContext(Context)!;
  const saved = dock.layout[id] || {side,order};
  return items(children).map((child,index) => {
    const words=Children.toArray(child.props.children).filter(value => typeof value==='string').join('').trim();
    const name = child.props['aria-label'] || child.props.title || words || String(child.key ?? index);
    const key = id + ':' + name;
    const place = dock.layout[key] || {side:saved.side,order:saved.order*100+index};
    const actual = place.side==='top' && dock.overflow.includes(key) ? 'right' : place.side;
    const target = actual==='top' ? dock.top : dock.right;
    const element = <fieldset key={key} className={'smart-flat-command '+id} disabled={disabled}
      data-smart-tool={key} data-side={actual} data-preferred={place.side} style={{order:place.order}}
      draggable={child.type==='button'}
      onDragStart={e=>{e.dataTransfer.setData('application/x-radaz-smart-tool',key);e.dataTransfer.effectAllowed='move';}}
      onDragOver={e=>{if(e.dataTransfer.types.includes('application/x-radaz-smart-tool'))e.preventDefault();}}
      onDrop={e=>{const moving=e.dataTransfer.getData('application/x-radaz-smart-tool');if(moving){e.preventDefault();e.stopPropagation();if(moving!==key)dock.move(moving,actual,key);}}}
      onKeyDown={e=>{if(e.altKey&&(e.key==='ArrowRight'||e.key==='ArrowUp')){e.preventDefault();dock.move(key,e.key==='ArrowRight'?'right':'top');}}}>
      {child}
    </fieldset>;
    return target ? createPortal(element,target,key) : element;
  });
}
