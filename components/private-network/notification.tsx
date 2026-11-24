'use client';
import {useEffect,useState} from 'react';
import {networkCall,type NetworkState} from './api';
export function PrivateNetworkNotice(){
 const [pending,setPending]=useState<{id:string;clinic:string;profile:string;invite:boolean}[]>([]),[dismissed,setDismissed]=useState<string[]>([]);
 useEffect(()=>{
   let closed=false,loading=false;
   async function update(){
     if(closed||loading)return;loading=true;
     try{const rows=await Promise.all(['private','internet'].map(async profile=>{
       const data=await networkCall<NetworkState>('state',{_profile:profile}).catch(()=>null);
       if(!data)return [];
       const deliveries=(data.deliveries||[]).filter(item=>item.state==='queued'&&(data.clinicModes?.[item.clinic]||data.acceptMode)!=='auto').map(item=>({id:item.id,clinic:item.clinic,profile,invite:false}));
       if(data.inviteNotice)deliveries.unshift({id:data.inviteNotice,clinic:'',profile,invite:true});
       return deliveries;
     }));
       if(!closed)setPending(rows.flat());
     }catch{if(!closed)setPending([]);}finally{loading=false;}
   }
   const timer=setInterval(()=>void update(),30000);void update();return()=>{closed=true;clearInterval(timer);};
 },[]);
 const unseen=pending.filter(item=>!dismissed.includes(item.id));if(!unseen.length)return null;
 const first=unseen[0],route=first.invite?'/private-network/settings':'/private-network';
 return <aside className="dn dn-notice" role="status"><button onClick={()=>window.open(route+'?network='+first.profile+'&clinic='+encodeURIComponent(first.clinic),'radaz-private-network','popup')?.focus()}>{first.invite?'Klinika dəvəti gəlib · Dəvətə bax':'DICOM Network · göndəriş təsdiq gözləyir'}</button><button aria-label="Bildirişi bağla" onClick={()=>setDismissed(pending.map(item=>item.id))}>×</button></aside>;
}
