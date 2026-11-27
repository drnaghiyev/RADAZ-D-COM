'use client';
import {useLayoutEffect,useRef} from 'react';
import ArchivePage from '@/app/archive/page';

// Use the existing archive view and IndexedDB in the main Android renderer.
// The study, annotations and 2D canvases underneath retain their identities.
export function TabletArchiveWindow({onClose}:{onClose:()=>void}){
  const root=useRef<HTMLElement>(null);
  useLayoutEffect(()=>{
    const previous=document.activeElement as HTMLElement|null;
    const viewer=document.querySelector<HTMLElement>('.workstation')?.closest<HTMLElement>('.flat-toolbar-workspace');
    const wasInert=viewer?.inert;
    if(viewer){viewer.inert=true;viewer.setAttribute('data-tablet-under-archive','');}
    const token=crypto.randomUUID();
    const back=(event:Event)=>{
      if((event as CustomEvent).detail!==token)return;
      event.preventDefault();
      const modal=document.querySelector<HTMLDialogElement>('dialog:modal');
      if(modal){
        if(modal.dispatchEvent(new Event('cancel',{cancelable:true})))modal.close();
        return;
      }
      onClose();
    };
    const opened=(event:Event)=>{if(event.defaultPrevented)onClose();};
    window.addEventListener('radaz:volume-back',back);
    window.addEventListener('radaz-tablet-open-studies',opened);
    window.prompt('radaz-tablet/workspace-opened',token);
    root.current?.focus({preventScroll:true});
    return ()=>{
      window.removeEventListener('radaz:volume-back',back);
      window.removeEventListener('radaz-tablet-open-studies',opened);
      window.prompt('radaz-tablet/workspace-closed',token);
      if(viewer){viewer.inert=!!wasInert;viewer.removeAttribute('data-tablet-under-archive');}
      if(previous?.isConnected)previous.focus({preventScroll:true});
    };
  },[onClose]);
  return <section ref={root} className="tablet-archive-window" role="dialog" aria-label="Local arxiv" aria-modal="true" tabIndex={-1}
    onKeyDown={event=>{if(event.key==='Escape' && !event.defaultPrevented && !document.querySelector('dialog:modal,[role=menu]')){event.preventDefault();event.stopPropagation();onClose();}}}>
    <ArchivePage embedded tabletClose={onClose}/>
  </section>;
}

