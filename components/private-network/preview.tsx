'use client';
import {useEffect,useRef,useState} from 'react';
import {networkCall,type Delivery} from './api';
export function NetworkPreview({delivery,clinic,close}:{delivery:Delivery;clinic:string;close:()=>void}){
 const ref=useRef<HTMLDialogElement>(null),[index,setIndex]=useState(0),[frame,setFrame]=useState(0),[frames,setFrames]=useState(1),[src,setSrc]=useState(''),[message,setMessage]=useState(''),[retry,setRetry]=useState(0);
 const files=delivery.files||[],sha=files[index]?.sha256;
 useEffect(()=>{ref.current?.showModal();},[]);
 useEffect(()=>{let active=true;setSrc('');setMessage('Ön baxış yüklənir…');
 (async()=>{if(!sha)throw Error('Bu göndərişdə görüntü tapılmadı.');
 if(delivery.state==='queued')await networkCall('accept',{clinic,delivery:delivery.id,viewOnly:true});
 let result:{image?:string;pending?:boolean;frames?:number}={pending:true};for(let i=0;i<15&&active&&result.pending;i++){if(i)await new Promise(done=>setTimeout(done,2000));if(!active)return;result=await networkCall('preview',{clinic,delivery:delivery.id,sha256:sha,frame});}if(result.pending||!result.image)throw Error('Göndərən cihazdan ön baxış gözlənilir.');
 if(!/^data:image\/jpeg;base64,/.test(result.image))throw Error('Ön baxış oxunmadı.');if(active){setFrames(result.frames||1);setSrc(result.image);setMessage('');}})().catch(e=>{if(active)setMessage(e instanceof Error?e.message:String(e));});return()=>{active=false;};
 },[clinic,delivery.id,delivery.state,sha,frame,retry]);
 return <dialog ref={ref} className="dn dn-dialog dn-preview" onCancel={close}><header><h2>Ön baxış</h2><button onClick={close}>Bağla</button></header><div className="dn-row">
 <label>Görüntü<select value={index} onChange={e=>{setIndex(Number(e.target.value));setFrame(0);setFrames(1);}}>{files.map((f,i)=><option key={f.sha256} value={i}>{i+1} / {files.length}</option>)}</select></label>
 {frames>1&&<label>Kadr<input type="number" min={1} max={frames} value={frame+1} onChange={e=>setFrame(Math.min(frames-1,Math.max(0,Number(e.target.value)-1)))}/></label>}</div>
 {src&&<img draggable={false} alt="DICOM göndərişinin ön baxışı" src={src}/>}<p role="status">{message}</p><button onClick={()=>setRetry(r=>r+1)}>Yenilə</button></dialog>;
}
