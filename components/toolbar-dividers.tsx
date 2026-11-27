'use client';

import {useEffect, useRef, useState} from 'react';
import {createPortal} from 'react-dom';
import {Columns2,ArrowUp,ArrowDown} from 'lucide-react';
import {bindToolbarDrag} from '@/lib/toolbar-direct-drag';
import {ToolbarGrip} from './toolbar-grip';
import './toolbar-dividers.css';

type Tool = {key: string; label: string; node: HTMLElement};

export function ToolbarDividers({scope, container, selector = 'button, a[href], summary'}: {
  scope: string; container?: string; selector?: string;
}) {
  const trigger = useRef<HTMLButtonElement>(null);
  const [tools, setTools] = useState<Tool[]>([]);
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [position, setPosition] = useState<{top: number; left: number}|null>(null);
  const [order,setOrder]=useState<string[]>([]);
  const [draftOrder,setDraftOrder]=useState<string[]>([]);
  const [draft,setDraft]=useState<Set<string>>(new Set());
  const menu = useRef<HTMLDivElement>(null);
  const storageKey = 'radaz:toolbar-dividers:' + scope;

  useEffect(() => {
    const button = trigger.current;
    const root = container ? button?.closest(container) : button?.parentElement;
    if (!root || !button) return;
    const view = button.ownerDocument.defaultView!;
    try {
      const values = JSON.parse(view.localStorage.getItem(storageKey) || '[]');
      if (Array.isArray(values)) setSelection(new Set(values.filter(v => typeof v === 'string')));
      const saved=JSON.parse(view.localStorage.getItem(storageKey+':order')||'[]');
      if(Array.isArray(saved))setOrder(saved.filter(v=>typeof v==='string'));
    } catch { /* Offline media may have read-only storage. */ }
    const scan = () => {
      const next: Tool[] = [];
      const seen = new Map<string, number>();
      for (const node of root.querySelectorAll<HTMLElement>(selector)) {
        if (node === button || node.closest('[role="menu"], .vr-menu, .toolbar-dividers-menu, .menu-popover')) continue;
        const label = node.getAttribute('title') || node.getAttribute('aria-label') || node.textContent?.trim();
        if (!label) continue;
        const icon = node.querySelector('svg');
        const id = node.dataset.toolId || Array.from(icon?.classList || []).find(c => c.startsWith('lucide-')) || label;
        const occurrence = seen.get(id) || 0;
        seen.set(id, occurrence + 1);
        next.push({key: id + '#' + occurrence, label, node});
      }
      setTools(old => old.length === next.length && old.every((t,i) => t.node === next[i].node && t.key === next[i].key && t.label === next[i].label) ? old : next);
    };
    scan();
    const observer = new view.MutationObserver(scan);
    observer.observe(root, {subtree: true, childList: true, attributes: true, attributeFilter: ['title','aria-label']});
    return () => observer.disconnect();
  }, [container, selector, storageKey]);

  useEffect(() => {
    for (const t of tools) t.node.toggleAttribute('data-radaz-divider', selection.has(t.key));
    return () => { for (const t of tools) t.node.removeAttribute('data-radaz-divider'); };
  }, [tools, selection]);

  useEffect(()=>{
    if(!order.length)return;
    const previous=new Map<HTMLElement,string>();
    const known=order.filter(k=>tools.some(t=>t.key===k));
    const ids=[...new Set([...known,...tools.map(t=>t.key)])];
    for(const t of tools){
      const node=t.node.closest<HTMLElement>('.smart-flat-command')||t.node;
      previous.set(node,node.style.order);
      node.style.order=String(ids.indexOf(t.key)+1);
    }
    return ()=>{for(const [node,value] of previous)node.style.order=value;};
  },[tools,order]);
  useEffect(() => {
    if (!position) return;
    const doc = trigger.current!.ownerDocument;
    const dismiss = (e: Event) => {
      if (!menu.current?.contains(e.target as Node) && !trigger.current?.contains(e.target as Node)) setPosition(null);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {e.preventDefault(); setPosition(null); trigger.current?.focus();}
    };
    doc.addEventListener('pointerdown', dismiss, true);
    doc.addEventListener('keydown', key, true);
    return () => { doc.removeEventListener('pointerdown', dismiss, true); doc.removeEventListener('keydown', key, true); };
  }, [position]);

  useEffect(()=>{
    const button=trigger.current,root=(container?button?.closest<HTMLElement>(container):button?.parentElement);
    if(!root||!button)return;
    root.setAttribute('data-direct-strip','');
    for(const t of tools)t.node.dataset.directItem=t.key;
    const unbind=bindToolbarDrag(root,'[data-direct-item]','[data-direct-strip]',(item,_zone,target,after)=>{
      const id=item.dataset.directItem!,other=target?.dataset.directItem;
      const ids=[...new Set([...order.filter(k=>tools.some(t=>t.key===k)),...tools.map(t=>t.key)])].filter(k=>k!==id);
      const i=other?ids.indexOf(other):-1;ids.splice(i<0?ids.length:i+Number(after),0,id);
      setOrder(ids);try{button.ownerDocument.defaultView!.localStorage.setItem(storageKey+':order',JSON.stringify(ids));}catch{}
    });
    return ()=>{unbind();root.removeAttribute('data-direct-strip');for(const t of tools)delete t.node.dataset.directItem;};
  },[tools,order,storageKey,container]);
  const title = 'Alət panelini fərdiləşdir';
  const ids=[...new Set([...draftOrder.filter(k=>tools.some(t=>t.key===k)),...tools.map(t=>t.key)])];
  const place=(id:string,before?:string)=>{
    if(id===before)return;
    const list=ids.filter(k=>k!==id),index=before?list.indexOf(before):-1;
    list.splice(index<0?list.length:index,0,id);setDraftOrder(list);
  };
  return <><button ref={trigger} type="button" title={title} aria-label={title} aria-expanded={!!position}
    className="toolbar-dividers-trigger" onClick={() => {
      if (position) {setPosition(null); return;}
      setDraft(new Set(selection));setDraftOrder(order);
      const b = trigger.current!, view = b.ownerDocument.defaultView!, rect = b.getBoundingClientRect();
      setPosition({left: Math.max(4, Math.min(rect.right - Math.min(340,view.innerWidth*.93), view.innerWidth - Math.min(340,view.innerWidth*.93) - 4)), top: Math.max(4, Math.min(rect.bottom + 4, view.innerHeight - Math.min(330,view.innerHeight * .6)))});
    }}><Columns2 size={16}/></button>
    {position && trigger.current && createPortal(<div ref={menu} role="dialog" aria-label="Alət panelinin düzülüşü" data-layout-zone="strip" className="toolbar-dividers-menu" style={position}>
      <header><strong>Alət panelinin düzülüşü</strong><button type="button" title="Standart düzülüş" onClick={()=>{setDraftOrder([]);setDraft(new Set());}}>Sıfırla</button><button type="button" onClick={()=>{
        setSelection(draft);setOrder(draftOrder);
        try {const storage=trigger.current!.ownerDocument.defaultView!.localStorage;
          storage.setItem(storageKey,JSON.stringify([...draft]));storage.setItem(storageKey+':order',JSON.stringify(draftOrder));}catch{}
        setPosition(null);trigger.current?.focus();
      }}>Təsdiq</button></header>
      {ids.map((id,i)=>{const t=tools.find(v=>v.key===id)!;return <div key={id} data-layout-id={id} className="aux-tool-row">
        <ToolbarGrip label={t.label} drop={(_,target,after)=>{if(target===id)return; const peers=ids.filter(key=>key!==id); place(id,after&&target?peers[peers.indexOf(target)+1]:target);}}/>
        <span>{t.label}</span>
        <button type="button" disabled={!i} aria-label={t.label+' əvvələ'} onClick={()=>place(id,ids[i-1])}><ArrowUp size={15}/></button>
        <button type="button" disabled={i===ids.length-1} aria-label={t.label+' sonraya'} onClick={()=>place(id,ids[i+2])}><ArrowDown size={15}/></button>
        <button type="button" aria-label={t.label+' düyməsindən əvvəl ayırıcı'} title="Düymədən əvvəl ayırıcı" aria-pressed={draft.has(id)} onClick={()=>{const next=new Set(draft);if(next.has(id))next.delete(id);else next.add(id);setDraft(next);}}>|</button>
      </div>;})}
    </div>,trigger.current.closest(':fullscreen') || trigger.current.ownerDocument.body)}</>;
}
