import type {Contour} from './contours';
import type {Geometry} from './geometry';

export type InferenceJob={id:string};
const base='/smart-volume-api';
async function checked(response:Response){if(!response.ok)throw Error(await response.text());return response;}
export async function startInference(geometry:Geometry,values:Float32Array,mask:Uint8Array,axis:number,slices:number[],label:number,lower:number,upper:number,point?:[number,number],contours?:Contour[]):Promise<InferenceJob>{
 const header=new TextEncoder().encode(JSON.stringify({dimensions:geometry.dimensions,axis,slices,label,lower,upper,point,contours}));
 const length=new Uint32Array([header.length]);
 const body=new Blob([length,header,values as Float32Array<ArrayBuffer>,mask as Uint8Array<ArrayBuffer>]);
 return (await checked(await fetch(base+'/jobs',{method:'POST',headers:{'Content-Type':'application/octet-stream'},body}))).json();
}
export async function inferenceStatus(id:string){return (await checked(await fetch(`${base}/jobs/${id}`))).json() as Promise<{status:string;progress:number;error?:string;seconds?:number}>;}
export async function inferenceMask(id:string){return new Uint8Array(await (await checked(await fetch(`${base}/jobs/${id}/mask`))).arrayBuffer());}
export async function cancelInference(id:string){await fetch(`${base}/jobs/${id}`,{method:'DELETE'});}
