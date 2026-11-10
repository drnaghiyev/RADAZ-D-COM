'use client';
import {useEffect,useState} from 'react';
import {Monitor} from 'lucide-react';
import {DropdownMenuItem} from '@/components/ui/dropdown-menu';
/** Only offered by the private local preview gateway; absent in the public build. */
export function NativeVolumeButton({seriesUID,preset='bone',menuItem=false}:{seriesUID?:string;preset?:string;menuItem?:boolean}){
 const [available,setAvailable]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
 useEffect(()=>{const controller=new AbortController();fetch('/native-volume-api/status',{signal:controller.signal}).then(async response=>{if(response.ok){const result=await response.json() as {available?:boolean};setAvailable(result.available===true);}}).catch(()=>{});return()=>controller.abort();},[]);
 if(!available||!seriesUID)return null;
 // Viewer ids are studyUID/seriesUID, optionally followed by reformat identity.
 const sourceUID=seriesUID.includes('/')?seriesUID.split('/')[1]:seriesUID;
 const open=async()=>{setBusy(true);setError('');try{const response=await fetch('/native-volume-api/open',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({seriesUID:sourceUID,preset})});const result=await response.json() as {error?:string};if(!response.ok)throw Error(result.error||'Native 3D açıla bilmədi.');}catch(error){setError(error instanceof Error?error.message:String(error));}finally{setBusy(false);}};
 if(menuItem)return <><DropdownMenuItem toolbarId="native-3d-local" disabled={busy} onSelect={event=>{event.preventDefault();void open();}}><Monitor size={16}/>{busy?'Native 3D hazırlanır…':'Native 3D · lokal desktop sınağı'}</DropdownMenuItem>{error&&<div role="alert" style={{maxWidth:280,padding:10,whiteSpace:'normal'}}>{error}</div>}</>;
 return <span style={{display:'inline-flex',alignItems:'center',position:'relative'}}><button type="button" disabled={busy} onClick={()=>void open()} title={busy?'Native 3D hazırlanır…':'Native 3D · lokal desktop sınağı'} aria-label="Native 3D · lokal desktop sınağı"><Monitor size={21}/>{busy?'…':null}</button>{error&&<span role="alert" style={{position:'absolute',top:'100%',right:0,width:280,padding:10,background:'#18303f',zIndex:200,border:'1px solid #648396'}}>{error}<button type="button" onClick={()=>setError('')} aria-label="Xətanı bağla">×</button></span>}</span>;
}
