"use client";
import {useLayoutEffect,useRef,useState,type ReactNode} from 'react';
import {createPortal} from 'react-dom';
/** Same-origin private window. No DICOM bytes are serialized into URLs or storage. */
export function SmartDetachedWindow({title,onClose,children}:{title:string;onClose:()=>void;children:ReactNode}){
 const [target,setTarget]=useState<HTMLDivElement|null>(null),[blocked,setBlocked]=useState(false);const close=useRef(onClose);close.current=onClose;
 useLayoutEffect(()=>{let disposed=false;const child=window.open('about:blank','radaz-smart-'+crypto.randomUUID(),'popup=yes,width=1450,height=950');if(!child){setBlocked(true);return;}
 child.document.title=title;child.document.documentElement.lang=document.documentElement.lang;child.document.body.style.cssText='margin:0;background:#091824';
 const base=child.document.createElement('base');base.href=location.origin+'/';child.document.head.appendChild(base);
 for(const sheet of Array.from(document.styleSheets)){try{const style=child.document.createElement('style');style.textContent=Array.from(sheet.cssRules).map(rule=>rule.cssText).join('\n');child.document.head.appendChild(style);}catch{if(sheet.href){const link=child.document.createElement('link');link.rel='stylesheet';link.href=sheet.href;child.document.head.appendChild(link);}}}
 const mount=child.document.createElement('div');child.document.body.appendChild(mount);setTarget(mount);
 const ended=()=>{if(!disposed)close.current();};child.addEventListener('pagehide',ended);const parentClosed=()=>child.close();window.addEventListener('pagehide',parentClosed);
 return()=>{disposed=true;child.removeEventListener('pagehide',ended);window.removeEventListener('pagehide',parentClosed);if(!child.closed)child.close();};
 },[]);
 return target?createPortal(children,target):blocked?<div role="alert">Ayrı pəncərə bloklandı. Bu lokal sayt üçün popup icazəsini aktiv edin. <button onClick={onClose}>Bağla</button></div>:null;
}
