export function copyVolumeScalars(values:ArrayLike<number>|{length:number;getAtIndex:(i:number)=>number},cancelled:()=>boolean):Promise<Float32Array>;
export function copyVolumeScalars(values:ArrayLike<number>|{length:number;getAtIndex:(i:number)=>number},cancelled:()=>boolean,storage:'float32'|'int16'):Promise<Float32Array|Int16Array>;
export async function copyVolumeScalars(values:ArrayLike<number>|{length:number;getAtIndex:(i:number)=>number},cancelled:()=>boolean,storage:'float32'|'int16'='float32'):Promise<Float32Array|Int16Array>{
 const result=storage==='int16'?new Int16Array(values.length):new Float32Array(values.length);
 for(let offset=0;offset<values.length;offset+=262144){if(cancelled())throw Error('3D bağlandı.');const end=Math.min(values.length,offset+262144);if(values instanceof Float32Array||values instanceof Int16Array)result.set(values.subarray(offset,end),offset);else for(let i=offset;i<end;i++)result[i]='getAtIndex' in values?values.getAtIndex(i):values[i];await new Promise<void>(resolve=>{const channel=new MessageChannel();channel.port1.onmessage=()=>{channel.port1.close();channel.port2.close();resolve();};channel.port2.postMessage(null);});}
 return result;
}

