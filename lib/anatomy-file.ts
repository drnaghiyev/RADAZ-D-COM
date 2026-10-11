import type {AnatomyVolumeGeometry,AnatomyVolumeResult} from './anatomy-volume';
const magic=new TextEncoder().encode('RADAZSEG1\n');
export const hex=(value:ArrayBuffer)=>Array.from(new Uint8Array(value),b=>b.toString(16).padStart(2,'0')).join('');
export const sha256=async(value:Uint8Array)=>hex(await crypto.subtle.digest('SHA-256',value as Uint8Array<ArrayBuffer>));
export async function sourceFingerprint(geometry:AnatomyVolumeGeometry,sliceHashes:string[]){
 const g={dimensions:geometry.dimensions,spacing:geometry.spacing,origin:geometry.origin,direction:geometry.direction,modality:geometry.modality};
 return sha256(new TextEncoder().encode(JSON.stringify(g)+'\n'+sliceHashes.join('\n')));
}
export async function exportSegmentation(result:AnatomyVolumeResult){
 if(!result.sourceFingerprint)throw Error('missing_fingerprint');
 const corrections=new Uint8Array((result.corrections?.size??0)*5),view=new DataView(corrections.buffer);let i=0;
 for(const [index,value] of result.corrections??[]){view.setUint32(i,index,true);view.setUint8(i+4,value);i+=5;}
 const {dimensions,spacing,origin,direction,modality,classes,task,device,seconds,modelSpacingMm,sourceFingerprint}=result;
 const header=new TextEncoder().encode(JSON.stringify({schema:1,dimensions,spacing,origin,direction,modality,classes,task,device,seconds,modelSpacingMm,sourceFingerprint,experimental:true,maskHash:await sha256(result.mask),correctionsHash:await sha256(corrections),correctionCount:corrections.length/5}));
 const prefix=new Uint8Array(magic.length+4);prefix.set(magic);new DataView(prefix.buffer).setUint32(magic.length,header.length,true);
 return new Blob([prefix,header,result.mask as Uint8Array<ArrayBuffer>,corrections],{type:'application/octet-stream'});
}
export async function importSegmentation(file:File,geometry:AnatomyVolumeGeometry,fingerprint:string,sourceKey:string):Promise<AnatomyVolumeResult>{
 if(file.size<magic.length+4||file.size>38000000)throw Error('invalid_segmentation');
 const prefix=new Uint8Array(await file.slice(0,magic.length+4).arrayBuffer());
 if(!magic.every((n,i)=>prefix[i]===n))throw Error('invalid_segmentation');
 const length=new DataView(prefix.buffer).getUint32(magic.length,true),start=prefix.length;
 if(length>65536||start+length>file.size)throw Error('invalid_segmentation');
 const meta=JSON.parse(await file.slice(start,start+length).text());
 if(meta.schema!==1||meta.sourceFingerprint!==fingerprint||meta.modality!==geometry.modality||meta.experimental!==true||!meta.classes||typeof meta.classes!=='object'||Array.isArray(meta.classes)||typeof meta.task!=='string'||meta.task.length>80||typeof meta.device!=='string'||!Number.isFinite(meta.seconds))throw Error('invalid_segmentation');
 for(const key of ['dimensions','spacing','origin','direction'] as const)if(!Array.isArray(meta[key])||meta[key].length!==geometry[key].length||meta[key].some((n:number,i:number)=>!Number.isFinite(n)||Math.abs(n-geometry[key][i])>1e-5))throw Error('invalid_segmentation');
 for(const [id,name] of Object.entries(meta.classes))if(!/^\d+$/.test(id)||+id<1||+id>255||typeof name!=='string'||!/^[a-zA-Z0-9_ -]{1,100}$/.test(name))throw Error('invalid_segmentation');
 const count=geometry.dimensions.reduce((a,b)=>a*b,1),maskStart=start+length;
 if(!Number.isInteger(meta.correctionCount)||meta.correctionCount<0||meta.correctionCount>1000000||count>32000000||maskStart+count+meta.correctionCount*5!==file.size)throw Error('invalid_segmentation');
 const mask=new Uint8Array(await file.slice(maskStart,maskStart+count).arrayBuffer()),bytes=new Uint8Array(await file.slice(maskStart+count).arrayBuffer());
 if(await sha256(mask)!==meta.maskHash||await sha256(bytes)!==meta.correctionsHash)throw Error('invalid_segmentation');
 if(mask.some(value=>value!==0&&!meta.classes[String(value)]))throw Error('invalid_segmentation');
 const view=new DataView(bytes.buffer),corrections=new Map<number,number>();
 for(let i=0;i<bytes.length;i+=5){const index=view.getUint32(i,true),value=view.getUint8(i+4);if(index>=count||corrections.has(index)||value!==0&&!meta.classes[String(value)])throw Error('invalid_segmentation');corrections.set(index,value);}
 return {...geometry,mask,corrections,sourceKey,sourceFingerprint:fingerprint,classes:meta.classes,task:meta.task,device:meta.device,seconds:meta.seconds,modelSpacingMm:meta.modelSpacingMm,experimental:true};
}
