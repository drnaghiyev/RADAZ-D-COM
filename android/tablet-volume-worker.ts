import {areaWeights,displayPlaneSampler} from '../lib/volume-resampling';
import type {TabletFrame,ReadRequest,ReadReply} from './tablet-volume-reader';

async function calibrated(frame:TabletFrame){
  const {pixels,encoding:e,rows,columns}=frame;
  if(!e)return pixels;
  const bytes=pixels as Uint8Array;
  const n=rows*columns;
  let decoded:ArrayLike<number>;
  if(e.compressed){
    // Import the pinned loader's worker entry, without its browser viewport and DOM modules.
    const {decodeImageFrame}=await import('../node_modules/@cornerstonejs/dicom-image-loader/dist/esm/decodeImageFrameWorker.js');
    const result=await decodeImageFrame({rows,columns,bitsAllocated:e.bits,bitsStored:e.stored,
      pixelRepresentation:Number(e.signed),samplesPerPixel:1,photometricInterpretation:e.photo,
      planarConfiguration:0,imageId:'tablet-volume'},e.syntax,bytes,{wasmBasePath:'/dicom-codecs'},{preScale:{enabled:false}},undefined);
    decoded=result.pixelData;
  }else if(e.bits===8){decoded=bytes;}
  else if(e.syntax!=='1.2.840.10008.1.2.2'){decoded=new Uint16Array(bytes.buffer,bytes.byteOffset,n);}
  else{
    const big=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),out=new Uint16Array(n);
    for(let i=0;i<n;i++)out[i]=big.getUint16(i*2,false);
    decoded=out;
  }
  if(decoded?.length!==n)throw Error('DICOM kəsiyində piksellərin sayı uyğun deyil.');
  const out=e.compact?new Int16Array(n):new Float32Array(n);
  const shift=e.high+1-e.stored,mask=2**e.stored-1,sign=2**(e.stored-1);
  for(let i=0;i<n;i++){
    let value=decoded[i];
    if(!e.compressed){value=(value>>>shift)&mask;if(e.signed && value>=sign)value-=mask+1;}
    out[i]=value*e.slope+e.intercept;
  }
  return out;
}
let key='',sampler:ReturnType<typeof displayPlaneSampler>|undefined;
self.onmessage=({data}:{data:{port:MessagePort}})=>{
  const port=data.port;
  port.onmessage=async({data}:{data:ReadRequest})=>{
    try{
      const {frame,width,height}=data;
      const raw=await calibrated(frame);
      if(raw.length!==frame.rows*frame.columns)throw Error('Kəsik ölçüsü düzgün deyil.');
      let pixels:Int16Array|Float32Array;
      if(width!==frame.columns||height!==frame.rows){
        const next=[frame.columns,frame.rows,width,height].join(':');
        if(next!==key){
          sampler=displayPlaneSampler(frame.columns,frame.rows,areaWeights(frame.columns,width),areaWeights(frame.rows,height),true);
          key=next;
        }
        pixels=sampler!(raw).slice();
      }else pixels=raw instanceof Uint8Array?Int16Array.from(raw):raw;
      let min=Infinity,max=-Infinity;
      for(let i=0;i<pixels.length;i++){const v=pixels[i];if(v<min)min=v;if(v>max)max=v;}
      port.postMessage({pixels,min,max} satisfies ReadReply,[pixels.buffer as ArrayBuffer]);
    }catch(e){port.postMessage({error:e instanceof Error?e.message:String(e)});}
  };
};
