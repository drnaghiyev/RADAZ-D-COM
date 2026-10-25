import {validateGeometry,type Geometry} from './geometry';
export type Snapshot={schema:1;segmentationId:string;seriesInstanceUID:string;frameOfReferenceUID:string;geometry:Geometry;segments:{id:number;name:string;color:string}[];mask:Uint8Array};
const digest=async(mask:Uint8Array)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',mask as Uint8Array<ArrayBuffer>)),v=>v.toString(16).padStart(2,'0')).join('');
export async function encodeSnapshot(value:Snapshot){
 if(!value.seriesInstanceUID||!value.frameOfReferenceUID||validateGeometry(value.geometry)!==value.mask.length)throw Error('Missing source identity or invalid mask');
 const {mask,...metadata}=value;
 const header=new TextEncoder().encode(JSON.stringify({...metadata,sha256:await digest(mask)}));
 const prefix=new Uint8Array(8);prefix.set([83,86,48,49]);new DataView(prefix.buffer).setUint32(4,header.length,true);
 return new Blob([prefix,header,mask as Uint8Array<ArrayBuffer>],{type:'application/octet-stream'});
}
export async function decodeSnapshot(blob:Blob,expected:Pick<Snapshot,'seriesInstanceUID'|'frameOfReferenceUID'|'geometry'>):Promise<Snapshot>{
 const prefix=new Uint8Array(await blob.slice(0,8).arrayBuffer());
 if(prefix.length!==8||prefix.slice(0,4).join()!=='83,86,48,49')throw Error('Invalid Smart Volume file');
 const length=new DataView(prefix.buffer).getUint32(4,true);if(length>1024*1024||length+8>blob.size)throw Error('Invalid header');
 const metadata=JSON.parse(await blob.slice(8,8+length).text());
 if(metadata.schema!==1||typeof metadata.segmentationId!=='string'||metadata.seriesInstanceUID!==expected.seriesInstanceUID||metadata.frameOfReferenceUID!==expected.frameOfReferenceUID)throw Error('Mask belongs to another series/frame');
 for(const key of ['dimensions','spacing','origin','direction'] as const)if(!Array.isArray(metadata.geometry?.[key])||metadata.geometry[key].length!==expected.geometry[key].length||metadata.geometry[key].some((n:number,i:number)=>!Number.isFinite(n)||Math.abs(n-expected.geometry[key][i])>1e-5))throw Error('Mask geometry mismatch');
 if(blob.size-8-length!==validateGeometry(expected.geometry))throw Error('Invalid mask length');
 if(!Array.isArray(metadata.segments)||!metadata.segments.length||metadata.segments.length>255)throw Error('Invalid segments');
 const ids=new Set<number>();for(const s of metadata.segments){if(!Number.isInteger(s.id)||s.id<1||s.id>255||ids.has(s.id)||typeof s.name!=='string'||s.name.length>200||!/^#[0-9a-f]{6}$/i.test(s.color))throw Error('Invalid segment metadata');ids.add(s.id);}
 const mask=new Uint8Array(await blob.slice(8+length).arrayBuffer());if(await digest(mask)!==metadata.sha256||mask.some(n=>n!==0&&!ids.has(n)))throw Error('Mask integrity failed');
 return {...metadata,mask};
}
async function database(){return new Promise<IDBDatabase>((resolve,reject)=>{const request=indexedDB.open('RADAZ-SmartVolume-local',1);request.onupgradeneeded=()=>request.result.createObjectStore('masks');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});}
export async function saveSnapshot(value:Snapshot){const blob=await encodeSnapshot(value),db=await database();try{await new Promise<void>((resolve,reject)=>{const tx=db.transaction('masks','readwrite');tx.objectStore('masks').put(blob,`${value.seriesInstanceUID}|${value.frameOfReferenceUID}`);tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);});}finally{db.close();}return blob;}
export async function loadSnapshot(expected:Pick<Snapshot,'seriesInstanceUID'|'frameOfReferenceUID'|'geometry'>){const db=await database();let blob:Blob|undefined;try{blob=await new Promise<Blob|undefined>((resolve,reject)=>{const request=db.transaction('masks').objectStore('masks').get(`${expected.seriesInstanceUID}|${expected.frameOfReferenceUID}`);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});}finally{db.close();}return blob?decodeSnapshot(blob,expected):null;}
