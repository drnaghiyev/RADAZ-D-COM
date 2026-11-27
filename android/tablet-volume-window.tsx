'use client';

import {useCallback,useEffect,useRef,useState} from 'react';
import {flushSync} from 'react-dom';
import {SharedVolumeView} from './shared-volume-view';
import {borrowLocalDicoms,releaseLocalDicoms} from '@/lib/cornerstone';
import {readDetachedSource} from '@/lib/detached-viewer';
import type {AnatomyVolumeResult} from '@/lib/anatomy-volume';
import './tablet-layout.css';

type Source={id:string;modality:string;imageIds:string[];loading?:boolean;discovered?:number;mediaSession?:string;archived?:boolean};

export default function TabletVolumeWindow(){
  const [series,setSeries]=useState<Source>(),[anatomy,setAnatomy]=useState<AnatomyVolumeResult|null>(null);
  const [closed,setClosed]=useState(false),closing=useRef(false);
  const disconnect=useRef<()=>void>(()=>{});
  const dispose=useCallback(()=>{
    if(closing.current)return;
    closing.current=true;
    // Abort slab reads and release the VR canvas before Android destroys its WebView.
    flushSync(()=>setClosed(true));
    disconnect.current();
  },[]);
  const close=useCallback(()=>{dispose();window.close();},[dispose]);
  useEffect(()=>{
    const token=new URLSearchParams(location.search).get('handoff');
    if(!token)return;
    const channel=new BroadcastChannel('radaz-'+token);
    let source:Source|undefined,revision='',timer:number|undefined,disposed=false;
    function sync(){
      if(disposed || !token)return;
      window.clearTimeout(timer);
      const snapshot=readDetachedSource(token);
      if(snapshot){
        setAnatomy(snapshot.anatomy||null);
        if(snapshot.revision!==revision){
          revision=snapshot.revision;
          const item=snapshot.series.find(s=>s.id===snapshot.preferredSeriesId)||snapshot.series[0];
          const next=item?{id:item.id,modality:item.modality,loading:item.loading,discovered:item.discovered,
            mediaSession:item.mediaSession,archived:item.archived,imageIds:borrowLocalDicoms(item.images)}:undefined;
          const retained=new Set(next?.imageIds);
          const obsolete=source?.imageIds.filter(id=>!retained.has(id))||[];
          source=next;setSeries(next);if(obsolete.length)releaseLocalDicoms(obsolete);
        }
      }else if(source?.mediaSession && !source.archived){
        releaseLocalDicoms(source.imageIds);source=undefined;setSeries(undefined);
      }
      if(!source || source.loading || (source.mediaSession && !source.archived))timer=window.setTimeout(sync,750);
    }
    const release=()=>{
      if(disposed)return;
      disposed=true;window.clearTimeout(timer);channel.close();
      if(source)releaseLocalDicoms(source.imageIds);
    };
    disconnect.current=release;
    const nativeClose=(event:Event)=>{event.preventDefault();close();};
    channel.onmessage=sync;sync();channel.postMessage({kind:'READY'});
    window.addEventListener('radaz:request-child-close',nativeClose);
    window.addEventListener('pagehide',dispose);
    return ()=>{window.removeEventListener('pagehide',dispose);window.removeEventListener('radaz:request-child-close',nativeClose);release();};
  },[close,dispose]);
  return closed?null:<SharedVolumeView series={series} anatomy={anatomy} onClose={close}/>;
}
