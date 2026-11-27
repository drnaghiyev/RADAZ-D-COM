export type TabletMatrix = 128 | 256 | 512;
export type TabletVolumeOpening = {ready:()=>void; reduce:()=>boolean};
type Memory = {availableMiB:number; totalMiB:number; reserveMiB:number; heapMiB:number; low:boolean};

const MiB=1024**2;
export function tabletVolumeMemory():Memory {
  try {
    const m=JSON.parse(window.prompt('radaz-tablet/volume-memory','')||'null');
    if(m && [m.availableMiB,m.totalMiB,m.heapMiB].every(n=>Number.isFinite(n)&&n>0) &&
        Number.isFinite(m.reserveMiB)&&m.reserveMiB>=0 && typeof m.low==='boolean')return m;
  }catch{/* Only the Android app provides live system memory. */}
  const totalMiB=((navigator as Navigator & {deviceMemory?:number}).deviceMemory||2)*1024;
  return {totalMiB,availableMiB:Math.min(900,totalMiB/4),reserveMiB:160,heapMiB:128,low:totalMiB<=2048};
}

export function chooseTabletMatrix(dimensions:readonly number[],memory:Memory,maxTexture:number,software:boolean,ceiling:TabletMatrix):TabletMatrix{
  const [columns,rows,depth]=dimensions;
  const usable=Math.max(0,memory.availableMiB-memory.reserveMiB);
  // Allow for the scalar array, upload/driver copies, and one decoded source plane at a time.
  const budgetMiB=Math.min(usable*.36,memory.totalMiB*.12,memory.heapMiB*3,1536);
  for(const matrix of [512,256,128] as const){
    if((matrix===512 && Math.max(columns,rows)<=256) || (matrix===256 && Math.max(columns,rows)<=128))continue;
    if(matrix>ceiling || (matrix>128&&(memory.low||depth>maxTexture)) ||
      (matrix===512&&(software||memory.totalMiB<5600)))continue;
    const scale=Math.min(1,matrix/Math.max(columns,rows));
    const w=Math.max(1,Math.round(columns*scale)),h=Math.max(1,Math.round(rows*scale));
    if(matrix>128 && (w>maxTexture||h>maxTexture))continue;
    const peakMiB=(w*h*depth*10+columns*rows*12)/MiB+8;
    if(peakMiB<=budgetMiB)return matrix;
  }
  throw Error('128 px 3D üçün də boş yaddaş çatmır. Digər tətbiqləri bağlayıb yenidən cəhd edin.');
}

// A driver can terminate the WebView before a JS timeout fires. Keep only the
// attempted matrix and time so the next launch will try one smaller size.
const openingKey='radaz.tablet.vr.opening';
export function previousMatrixLimit(now=Date.now()):TabletMatrix {
  try {
    const entry=JSON.parse(localStorage.getItem(openingKey)||'null');
    if(entry && now>=entry.time && now-entry.time<60*60*1000){
      if(entry.matrix===512)return 256;
      if(entry.matrix===256||entry.matrix===128)return 128;
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
