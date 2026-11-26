import {mixCamera,turn,type Snapshot} from './scene';
export type MovieOptions={mode:'spin'|'snapshots';axis:'vertical'|'horizontal'|'combined'|'roll';arc:'360'|'180'|'loop180';duration:number;fps:number;size:number;bitrate:number;loop:boolean;reverse:boolean};
export async function recordVrMovie(doc:Document,start:Snapshot,shots:Snapshot[],opt:MovieOptions,
 draw:(frame:Snapshot,width:number)=>Promise<HTMLCanvasElement>,progress:(value:number)=>void,signal:AbortSignal){
 if(!globalThis.MediaRecorder)throw Error('Bu cihazda video yazma dəstəklənmir.');
 if(opt.mode==='snapshots'&&shots.length<2)throw Error('Video üçün ən azı iki görünüş saxlayın.');
 const keys=opt.loop?[...shots,shots[0]]:shots,segments=keys.slice(0,-1),duration=opt.mode==='spin'?opt.duration:segments.reduce((n,s)=>n+s.duration,0);
 const total=Math.max(2,Math.round(opt.fps*duration));
 const canvas=doc.createElement('canvas'),first=await draw(opt.mode==='spin'?start:keys[0],opt.size);
 canvas.width=first.width;canvas.height=first.height;const ctx=canvas.getContext('2d')!;ctx.drawImage(first,0,0);
 const stream=canvas.captureStream(opt.fps),type=['video/webm;codecs=vp9','video/webm;codecs=vp8','video/mp4','video/webm'].find(x=>MediaRecorder.isTypeSupported(x));
 const rec=new MediaRecorder(stream,{...(type?{mimeType:type}:{}),videoBitsPerSecond:opt.bitrate*1000000}),parts:BlobPart[]=[];
 const ended=new Promise<Blob>((res,rej)=>{rec.ondataavailable=e=>{if(e.data.size)parts.push(e.data);};rec.onerror=()=>rej(Error('Video yazılmadı.'));rec.onstop=()=>res(new Blob(parts,{type:rec.mimeType}));});void ended.catch(()=>{});
 try{
   rec.start();for(let i=0;i<total;i++){
     signal.throwIfAborted();const before=performance.now(),t=i/(total-1);let frame=start;
     if(opt.mode==='spin'){const phase=opt.axis==='combined'?(t<.5?2*t:2*t-1):t,plane=opt.axis==='combined'?(t<.5?'vertical':'horizontal'):opt.axis;
       const angle=(u:number)=>opt.arc==='360'?u*2*Math.PI:opt.arc==='180'?(u-.5)*Math.PI:(u<=.25?2*u:u<.75?1-2*u:2*u-2)*Math.PI;
       const a=(opt.reverse?-1:1)*angle(phase);const base=opt.axis==='combined'&&t>=.5?turn(start.camera,(opt.reverse?-1:1)*angle(1),0):start.camera;
       frame={...start,camera:turn(base,plane==='vertical'?a:0,plane==='horizontal'?a:0,plane==='roll'?a:0)};}
     else{let time=t*duration,index=0;while(index<segments.length-1&&time>segments[index].duration){time-=segments[index].duration;index++;}
       const a=keys[index],b=keys[index+1],k=Math.min(1,time/a.duration),mix=(x:number,y:number)=>x+(y-x)*k;
       frame={...(k<.5?a:b),camera:mixCamera(a.camera,b.camera,k),style:{...b.style,mixFrom:a.style.preset,mixAmount:k,ww:mix(a.style.ww,b.style.ww),wl:mix(a.style.wl,b.style.wl),opacity:mix(a.style.opacity,b.style.opacity),brightness:mix(a.style.brightness,b.style.brightness)}};
     }
     const rendered=await draw(frame,opt.size);ctx.drawImage(rendered,0,0,canvas.width,canvas.height);progress(Math.round((i+1)*100/total));
     await new Promise(r=>setTimeout(r,Math.max(1,1000/opt.fps-(performance.now()-before))));
   }
   rec.stop();return await ended;
 }finally{if(rec.state!=='inactive')rec.stop();for(const track of stream.getTracks())track.stop();}
}
