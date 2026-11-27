import workerUrl from './tablet-volume-worker.ts?worker&url';

export type Scalars=Uint8Array|Int16Array|Float32Array;
export type TabletFrame={columns:number;rows:number;pixels:Scalars;encoding?:{
  syntax:string;bits:number;stored:number;high:number;signed:boolean;photo:string;
  slope:number;intercept:number;compact:boolean;compressed:boolean;
}};
export type ReadRequest={frame:TabletFrame;width:number;height:number};
export type ReadReply={pixels:Int16Array|Float32Array;min:number;max:number};
export function tabletPlaneReader(readFrame:(id:string,signal:AbortSignal)=>Promise<TabletFrame>){
  let worker:Worker|undefined,port:MessagePort|undefined;
  function dispose(){
    port?.close();worker?.terminate();port=undefined;worker=undefined;
  }
  async function attempt(id:string,width:number,height:number,signal:AbortSignal,ms:number):Promise<ReadReply>{
    signal.throwIfAborted();
    const stop=new AbortController();
    const relay=()=>stop.abort(signal.reason);
    signal.addEventListener('abort',relay,{once:true});
    const timeout=setTimeout(()=>stop.abort(new DOMException('Kəsik cavab vermədi','TimeoutError')),ms);
    try{
      return await new Promise<ReadReply>((resolve,reject)=>{
        const abort=()=>{dispose();reject(stop.signal.reason);};
        stop.signal.addEventListener('abort',abort,{once:true});
        void readFrame(id,stop.signal).then(frame=>{
          stop.signal.throwIfAborted();
          if(!worker){
            worker=new Worker(new URL(workerUrl,location.origin),{type:'module',name:'RADAZ tablet volume'});
            const channel=new MessageChannel();port=channel.port1;
            worker.postMessage({port:channel.port2},[channel.port2]);
          }
          worker.onerror=e=>reject(new Error(e.message||'3D hesablama xidməti dayanıb.'));
          port!.onmessageerror=()=>reject(Error('3D kəsiyi oxunmadı.'));
          port!.onmessage=e=>e.data.error?reject(new Error(e.data.error)):resolve(e.data);
          port!.postMessage({frame,width,height} satisfies ReadRequest,[frame.pixels.buffer as ArrayBuffer]);
        }).catch(reject);
      });
    }finally{
      clearTimeout(timeout);signal.removeEventListener('abort',relay);
      if(port){port.onmessage=null;port.onmessageerror=null;}
      if(worker)worker.onerror=null;
    }
  }
  return {dispose,async read(id:string,width:number,height:number,signal:AbortSignal,
      onRetry:()=>Promise<{width:number;height:number}>){
    try{return await attempt(id,width,height,signal,12000);}
    catch(e){
      signal.throwIfAborted();
      if(!(e instanceof DOMException && e.name==='TimeoutError'))throw e;
      // Only the outstanding plane is retried. Previously assembled slices remain usable.
      const next=await onRetry();
      return attempt(id,next.width,next.height,signal,24000);
    }
  }};
}
