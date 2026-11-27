export type TabletMatrix = 64 | 128 | 192 | 256 | 512;
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
  return matrix===512?256:matrix===256?192:matrix===192?128:64;
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
  for(const matrix of [512,256,192,128,64] as const){
    if(choice==='auto'){
      if(matrix===64 && Math.max(columns,rows)>64)continue;
      if(matrix===192 && !cpu)continue;
      const smaller=matrix===256&&!cpu ? 128 : smallerTabletMatrix(matrix);
      if(matrix>64 && Math.max(columns,rows)<=smaller)continue;
      if(matrix>ceiling || (matrix>128&&!cpu&&(memory.low||depth>maxTexture)) ||
        (matrix===512&&(software||memory.totalMiB<5600)))continue;
    }else if(matrix!==choice)continue;
    const scale=Math.min(1,matrix/Math.max(columns,rows));
    const w=Math.max(1,Math.round(columns*scale)),h=Math.max(1,Math.round(rows*scale));
    if(matrix>128 && (w>maxTexture||h>maxTexture))continue;
    const peakMiB=(w*h*depth*(cpu?9:10)+columns*rows*12)/MiB+8;
    if(peakMiB<=budgetMiB)return matrix;
  }
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
      if([64,128,192,256,512].includes(entry.matrix))return smallerTabletMatrix(entry.matrix);
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
