import workerUrl from './display-plane.worker.ts?worker&url';

type Pixels=Int16Array|Float32Array|Uint8Array;
type Batch={block:Float32Array;min:number;max:number};

/** Calibrated source images stay in the Viewer; only bounded plane copies cross to workers. */
export async function buildDisplayPlanes(
  shape:[number,number,number,number], target:Float32Array, depth:number,
  read:(z:number)=>Promise<Pixels>, signal:AbortSignal, progress:(percent:number)=>void,
):Promise<[number,number]|undefined>{
  if(typeof Worker==='undefined')return;
  const planeSize=shape[2]*shape[3];
  const batchSize=Math.max(1,Math.min(6,Math.floor(4*1024**2/(shape[0]*shape[1]*4))));
  const workers:Worker[]=[];
  const controller=new AbortController();
  const stop=()=>controller.abort(signal.reason);
  let next=0,done=0,min=Infinity,max=-Infinity,workerFailed=false,lastProgress=0;

  async function lane(worker:Worker){
    while(next<depth){
      controller.signal.throwIfAborted();
      const start=next,end=Math.min(depth,start+batchSize);next=end;
      const planes:Pixels[]=[];
      for(let z=start;z<end;z++){
        const pixels=await read(z);
        controller.signal.throwIfAborted();
        planes.push(pixels.slice());
      }
      const result=await new Promise<Batch>((resolve,reject)=>{
        const abort=()=>reject(controller.signal.reason);
        controller.signal.addEventListener('abort',abort,{once:true});
        worker.onmessage=({data})=>{
          controller.signal.removeEventListener('abort',abort);
          resolve(data);
        };
        worker.postMessage({planes},planes.map(p=>p.buffer as ArrayBuffer));
      });
      controller.signal.throwIfAborted();
      target.set(result.block,start*planeSize);min=Math.min(min,result.min);max=Math.max(max,result.max);
      done+=end-start;
      if(performance.now()-lastProgress>=75 || done===depth){progress(Math.round(100*done/depth));lastProgress=performance.now();}
    }
  }
  signal.throwIfAborted();signal.addEventListener('abort',stop,{once:true});
  try{
    const count=Math.min(3,Math.max(1,(navigator.hardwareConcurrency||4)-2));
    for(let i=0;i<count;i++){
      try{workers.push(new Worker(new URL(workerUrl,location.origin),{type:'module'}));}
      catch{return;}
    }
    for(const worker of workers){
      worker.onerror=event=>{
        event.preventDefault();workerFailed=true;
        controller.abort(Error(event.message||'Həcm hazırlana bilmədi.'));
      };
      worker.postMessage({shape});
    }
    await Promise.all(workers.map(lane));
    return [min,Math.max(min+1,max)];
  }catch(error){
    signal.throwIfAborted();
    if(!workerFailed)throw error;
    progress(0); // Resume with the in-process sampler if workers are unavailable.
  }finally{
    controller.abort();signal.removeEventListener('abort',stop);
    for(const worker of workers)worker.terminate();
  }
}
