'use client';
import {useEffect,useState} from 'react';
import {networkCall,type NetworkState} from './api';
export function PrivateNetworkNotice(){
 const [pending,setPending]=useState<{id:string;clinic:string}[]>([]),[dismissed,setDismissed]=useState<string[]>([]);
 useEffect(()=>{
   let closed=false,loading=false;
   async function update(){
     if(closed||loading)return;loading=true;
     try{const data=await networkCall<NetworkState>('state');
       if(!closed)setPending((data.deliveries||[]).filter(item=>item.state==='queued'&&(data.clinicModes?.[item.clinic]||data.acceptMode)!=='auto').map(item=>({id:item.id,clinic:item.clinic})));
     }catch{if(!closed)setPending([]);}finally{loading=false;}
   }
   const timer=setInterval(()=>void update(),30000);void update();return()=>{closed=true;clearInterval(timer);};
 },[]);
 const unseen=pending.filter(item=>!dismissed.includes(item.id));if(!unseen.length)return null;
 return <aside className="dn dn-notice" role="status"><button onClick={()=>window.open('/private-network?clinic='+encodeURIComponent(unseen[0].clinic),'radaz-private-network','popup')?.focus()}>DICOM Network · {unseen.length} göndəriş təsdiq gözləyir</button><button aria-label="Bildirişi bağla" onClick={()=>setDismissed(pending.map(item=>item.id))}>×</button></aside>;
}
