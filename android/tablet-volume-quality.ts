export type TabletMatrix = number;
export type ResolutionPreference = 'auto' | 64 | 128 | 256 | 512;
const preferenceKey='radaz.tablet.vr.resolution';
export function readResolutionPreference():ResolutionPreference {
  try {
    const value=Number(localStorage.getItem(preferenceKey));
    if(value===64 || value===128 || value===256 || value===512)return value;
  } catch { /* The current session can still change resolution. */ }
  return 'auto';
}
export function saveResolutionPreference(value:ResolutionPreference){
  try { localStorage.setItem(preferenceKey,String(value)); } catch {}
}
export type TabletVolumeOpening = {ready:()=>void; reduce:()=>boolean; preferCpu:boolean};
type Memory = {availableMiB:number; totalMiB:number; reserveMiB:number; heapMiB:number; low:boolean};

const MiB=1024**2;
export function weakTablet(memory:Memory){
  return memory.low || memory.totalMiB<=4608 || memory.heapMiB<=192;
}
export function smallerTabletMatrix(matrix:TabletMatrix):TabletMatrix {
  return Math.max(64,matrix-32);
}
export function tabletVolumeMemory():Memory {
  try {
    const m=JSON.parse(window.prompt('radaz-tablet/volume-memory','')||'null');
    if(m && [m.availableMiB,m.totalMiB,m.heapMiB].every(n=>Number.isFinite(n)&&n>0) &&
        Number.isFinite(m.reserveMiB)&&m.reserveMiB>=0 && typeof m.low==='boolean')return m;
  }catch{/* Only the Android app provides live system memory. */}
  const totalMiB=((navigator as Navigator & {deviceMemory?:number}).deviceMemory||2)*1024;
  return {totalMiB,availableMiB:Math.min(900,totalMiB/4),reserveMiB:160,heapMiB:128,low:totalMiB<=2048};
}

export function chooseTabletMatrix(dimensions:readonly number[],memory:Memory,maxTexture:number,software:boolean,ceiling:TabletMatrix,cpu=false,choice:ResolutionPreference='auto'):TabletMatrix{
  const [columns,rows,depth]=dimensions;
  const usable=Math.max(0,memory.availableMiB-memory.reserveMiB);
  // Allow for the scalar array, upload/driver copies, and one decoded source plane at a time.
  // CPU drawing holds the assembled volume and its worker copy, without a GPU texture.
  const budgetMiB=Math.min(usable*(cpu ? .49 : .36),memory.totalMiB*(cpu ? .21 : .12),memory.heapMiB*3,1536);
  let selected:TabletMatrix|undefined;
  const sourceLimit=Math.max(64,Math.ceil(Math.max(columns,rows)/32)*32);
  const limit=choice==='auto'?Math.min(512,ceiling,sourceLimit):choice;
  // Evaluate 64, 96, 128... without allocating trial volumes or rereading DICOM.
  for(let matrix=choice==='auto'?64:choice;matrix<=limit;matrix+=32){
    const scale=Math.min(1,matrix/Math.max(columns,rows));
    const w=Math.max(1,Math.round(columns*scale)),h=Math.max(1,Math.round(rows*scale));
    if(!cpu && (w>maxTexture||h>maxTexture))break;
    const peakMiB=(w*h*depth*(cpu?9:10)+columns*rows*12)/MiB+8;
    if(peakMiB>budgetMiB)break;
    selected=matrix;
  }
  if(selected!==undefined)return selected;
  const label=choice==='auto'?'3D':choice+' px';
  throw new RangeError(label+' üçün boş yaddaş çatmır. Daha aşağı ölçü seçin və ya digər tətbiqləri bağlayın.');
}

// A driver can terminate the WebView before a JS timeout fires. Keep only the
// attempted matrix and time so the next launch will try one smaller size.
const openingKey='radaz.tablet.vr.opening';
export function previousMatrixLimit(now=Date.now()):TabletMatrix {
  try {
    const entry=JSON.parse(localStorage.getItem(openingKey)||'null');
    if(entry && now>=entry.time && now-entry.time<60*60*1000){
      if(Number.isInteger(entry.matrix) && entry.matrix>=64 && entry.matrix<=512 && entry.matrix%32===0)return smallerTabletMatrix(entry.matrix);
    }
  }catch{/* Storage can be unavailable in a restricted WebView. */}
  return 512;
}
export function trackMatrixOpening(matrix:TabletMatrix){
  const entry=JSON.stringify({matrix,time:Date.now(),token:crypto.randomUUID()});
  try{localStorage.setItem(openingKey,entry);}catch{}
  return ()=>{
    try{if(localStorage.getItem(openingKey)===entry)localStorage.removeItem(openingKey);}catch{}
  };
}
