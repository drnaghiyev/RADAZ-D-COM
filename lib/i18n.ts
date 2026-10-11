import {useSyncExternalStore} from 'react';
import {messages} from './locales/messages';

export type Language='az'|'ru'|'en';
export type MessageKey=keyof typeof messages;
const storageKey='radaz.interface-language';
let language:Language='az';
let initialized=false;
const listeners=new Set<()=>void>();
export const isLanguage=(value:unknown):value is Language=>value==='az'||value==='ru'||value==='en';
function notify(){for(const listener of listeners)listener();}
export function initializeLanguage(){
 if(initialized||typeof window==='undefined')return;
 initialized=true;
 try{const saved=localStorage.getItem(storageKey);if(isLanguage(saved))language=saved;}catch{/* Private browsing may disallow persistence. */}
 document.documentElement.lang=language;
 window.addEventListener('storage',event=>{if(event.key===storageKey&&isLanguage(event.newValue)){language=event.newValue;document.documentElement.lang=language;notify();}});
 notify();
}
export function setLanguage(next:Language){
 if(!isLanguage(next))return;
 language=next;
 if(typeof window!=='undefined'){document.documentElement.lang=next;try{localStorage.setItem(storageKey,next);}catch{/* Current session still switches. */}}
 notify();
}
export function translate(key:MessageKey,locale:Language=language,values:Record<string,string|number>={}){
 return messages[key][locale].replace(/\{(\w+)\}/g,(match,name)=>Object.hasOwn(values,name)?String(values[name]):match);
}
export function useTranslation(){
 const locale=useSyncExternalStore(callback=>{listeners.add(callback);return()=>{listeners.delete(callback);};},()=>language,()=> 'az' as Language);
 return {language:locale,setLanguage,t:(key:MessageKey,values?:Record<string,string|number>)=>translate(key,locale,values)};
}
