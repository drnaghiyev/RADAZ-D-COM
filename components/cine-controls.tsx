'use client';
import {useEffect,useRef,useState} from 'react';
import {Play,Pause,Square,Minus,Plus} from 'lucide-react';
import {getViewer} from '@/lib/cornerstone';
import {ToolbarGroup} from './toolbar-workspace';
export function CineControls({panel,seriesId,count}:{panel:string;seriesId?:string;count:number}){
 const [playing,setPlaying]=useState(false),[speed,setSpeed]=useState(5),[error,setError]=useState('');const epoch=useRef(0);
 useEffect(()=>{epoch.current++;setPlaying(false);setError('');},[panel,seriesId]);
 useEffect(()=>{const token=++epoch.current;let timer:ReturnType<typeof setTimeout>;let node:HTMLElement|undefined;const pause=()=>{epoch.current++;setPlaying(false);};
  if(!playing||count<2)return;
  const step=async()=>{const start=performance.now();try{const {engine}=await getViewer();if(epoch.current!==token)return;const vp=engine.getViewport(`panel-${panel}`) as any;
   if(!vp?.getImageIds)return pause();node=vp.element;node?.addEventListener('pointerdown',pause,{once:true});const ids=vp.getImageIds();if(ids.length<2)return pause();
   await vp.setImageIdIndex((vp.getCurrentImageIdIndex()+1)%ids.length);if(epoch.current!==token)return;vp.render();timer=setTimeout(step,Math.max(0,1000/speed-(performance.now()-start)));
  }catch(e){if(epoch.current===token){setError(String(e));setPlaying(false);}}};timer=setTimeout(step,1000/speed);
  return()=>{epoch.current++;clearTimeout(timer);node?.removeEventListener('pointerdown',pause);};
 },[playing,speed,panel,seriesId,count]);
 const stop=async()=>{epoch.current++;setPlaying(false);const {engine}=await getViewer();const vp=engine.getViewport(`panel-${panel}`) as any;if(vp?.getImageIds?.().length){await vp.setImageIdIndex(0);vp.render();}};
 return <ToolbarGroup groupId="cine" order={44} className="toolbar-group cine-controls"><button title="Play · avtomatik listələ" aria-label="Play" disabled={count<2||playing} onClick={()=>setPlaying(true)}><Play size={18}/></button><button title="Pauza" aria-label="Pauza" disabled={!playing} onClick={()=>setPlaying(false)}><Pause size={18}/></button><button title="Stop · ilk kadr" aria-label="Stop" disabled={count<2} onClick={()=>void stop()}><Square size={16}/></button><button aria-label="Sürəti azalt" disabled={speed<=1} onClick={()=>setSpeed(s=>Math.max(1,s-1))}><Minus size={14}/></button><label title="Saniyədə kadr sayı"> <input aria-label="Play sürəti" type="range" min="1" max="10" value={speed} onChange={e=>setSpeed(Number(e.target.value))}/><output>{speed} kadr/s</output></label><button aria-label="Sürəti artır" disabled={speed>=10} onClick={()=>setSpeed(s=>Math.min(10,s+1))}><Plus size={14}/></button>{error&&<span role="alert">{error}</span>}</ToolbarGroup>;
}
