'use client';
import {useEffect,useRef,useState} from 'react';
import {Mic,Square} from 'lucide-react';
import {aiRequest} from '@/lib/ai-client';
export function ReportDictation({text,language,onApply}:{text:string;language:string;onApply:(text:string)=>void}){
 const [recording,setRecording]=useState(false),[busy,setBusy]=useState(false),[status,setStatus]=useState(''),[draft,setDraft]=useState('');
 const recorder=useRef<MediaRecorder|null>(null),stream=useRef<MediaStream|null>(null),controller=useRef<AbortController|null>(null),alive=useRef(true),snapshot=useRef('');
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;controller.current?.abort();if(recorder.current){recorder.current.onstop=null;if(recorder.current.state!=='inactive')recorder.current.stop();}stream.current?.getTracks().forEach(t=>t.stop());};},[]);
 const start=async()=>{try{
  snapshot.current=text;setDraft('');setStatus('Mikrofon açılır…');
  const media=await navigator.mediaDevices.getUserMedia({audio:true,video:false});if(!alive.current){media.getTracks().forEach(t=>t.stop());return;}stream.current=media;
  const r=new MediaRecorder(media,{audioBitsPerSecond:64000});recorder.current=r;const chunks:Blob[]=[];let bytes=0;
  r.ondataavailable=e=>{chunks.push(e.data);bytes+=e.data.size;if(bytes>18_000_000&&r.state==='recording')r.stop();};
  r.onstop=()=>{media.getTracks().forEach(t=>t.stop());if(!alive.current)return;setRecording(false);setBusy(true);setStatus('Diktə mətnə çevrilir…');const c=new AbortController();controller.current=c;
   void(async()=>{const blob=new Blob(chunks,{type:r.mimeType});const audio=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=reject;reader.readAsDataURL(blob);});
    const transcription=await aiRequest<{text:string}>('transcribe',{audio,mime:r.mimeType},c.signal);
    if(!alive.current)return;setStatus('Düzəliş layihəsi hazırlanır…');
    const result=await aiRequest<{text:string}>('report',{phase:'revision',language,instruction:transcription.text,observations:snapshot.current},c.signal);
    if(alive.current){setDraft(result.text);setStatus('Dəyişiklikləri yoxlayıb tətbiq edin.');}
   })().catch(e=>{if(alive.current)setStatus(e instanceof Error?e.message:'Diktə alınmadı.');}).finally(()=>{if(alive.current)setBusy(false);});
  };
  r.start(1000);setRecording(true);setStatus('Danışın. Dayandırdıqda səs OpenAI-a göndəriləcək.');
 }catch(e){stream.current?.getTracks().forEach(t=>t.stop());setStatus(e instanceof Error?e.message:'Mikrofon açıla bilmədi.');}};
 return <div className="report-dictation"><button type="button" disabled={busy} title="Hesabatı səslə düzəlt" onClick={()=>recording?recorder.current?.stop():void start()}>{recording?<Square size={16}/>:<Mic size={16}/>} {recording?'Dayandır':'Səslə düzəlt'}</button><small role="status">{status}</small>{draft&&<div className="dictation-review"><textarea aria-label="Səsli düzəliş layihəsi" value={draft} onChange={e=>setDraft(e.target.value)}/><button disabled={text!==snapshot.current} onClick={()=>{onApply(draft);setDraft('');setStatus('Düzəliş tətbiq edildi.');}}>Düzəlişi tətbiq et</button><button onClick={()=>setDraft('')}>Ləğv et</button>{text!==snapshot.current&&<p>Hesabat bu vaxt dəyişib. Cari mətni qorumaq üçün diktəni yenidən başladın.</p>}</div>}</div>;
}
