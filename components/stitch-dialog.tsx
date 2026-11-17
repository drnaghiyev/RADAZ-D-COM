'use client';
import {useEffect,useRef,useState} from 'react';
import {Dialog,DialogContent,DialogHeader,DialogTitle} from './ui/dialog';
import {getOriginalDicom} from '@/lib/cornerstone';
import {parseDicomFile} from '@/lib/dicom-file';
import {readDicomPixels} from '@/lib/dicom-pixels';
import {createStitchedDicom,type MeasurementDicomSource} from '@/lib/measurement-dicom';

type Item={id:string;name:string;modality:string;studyId:string;imageIds:string[]};
type Raster={file:File;width:number;height:number;pixels:Uint8Array;source:MeasurementDicomSource;spacing?:[number,number]};
const n=(value:string|undefined)=>{const x=Number(value);return Number.isFinite(x)&&x>0?x:0;};
async function load(id:string):Promise<Raster>{
 const bytes=await getOriginalDicom(id);if(!bytes)throw Error('Orijinal DICOM görüntüsü tapılmadı');
 const file=new File([Uint8Array.from(bytes).buffer],'source.dcm',{type:'application/dicom'}),ds=parseDicomFile(bytes);
 const image=await readDicomPixels(file)??await import('@/lib/cornerstone').then(({dicomMediaPreview})=>dicomMediaPreview(bytes));
 if(!image)throw Error('Rentgen görüntüsü oxunmadı');
 const spacing=(ds.string('x00280030')||ds.string('x00181164')||'').split('\\').map(n);
 return {file,width:image.columns,height:image.rows,pixels:image.pixels,
  source:{studyUID:ds.string('x0020000d')||'',sopUID:ds.string('x00080018')||'',sopClassUID:ds.string('x00080016')||'',patientName:ds.string('x00100010')||'',patientId:ds.string('x00100020')||'',studyDate:ds.string('x00080020')||'',studyTime:ds.string('x00080030')||'',accessionNumber:ds.string('x00080050')||'',studyDescription:ds.string('x00081030')||'',birthDate:ds.string('x00100030')||'',patientSex:ds.string('x00100040')||'',instanceNumber:ds.string('x00200013')||'1'},
  spacing:image.spacing||(spacing.length===2&&spacing.every(Boolean)?spacing as [number,number]:undefined)};
}
function compose(top:Raster,bottom:Raster,overlap:number,shift:number){
 const left=Math.min(0,shift),right=Math.max(top.width,shift+bottom.width),width=right-left,height=top.height+bottom.height-overlap;
 if(width<1||height<1||width>8192||height>8192||width*height>60_000_000)throw Error('Birləşmiş görüntü çox böyükdür');
 const data=new Uint8ClampedArray(width*height*4);for(let i=3;i<data.length;i+=4)data[i]=255;
 const put=(src:Raster,dx:number,dy:number)=>{for(let y=0;y<src.height;y++)for(let x=0;x<src.width;x++){
  const sy=y+dy,sx=x+dx;if(sy<0||sy>=height||sx<0||sx>=width)continue;
  const v=src.pixels[y*src.width+x],k=(sy*width+sx)*4;data[k]=data[k+1]=data[k+2]=v;
 }};
 put(top,-left,0);put(bottom,shift-left,top.height-overlap);
 return {width,height,data};
}
export function StitchDialog({open,onOpenChange,series,initialImage,onCreated}:{open:boolean;onOpenChange:(open:boolean)=>void;series:Item[];initialImage?:string;onCreated:(file:File)=>Promise<void>}){
 const options=series.flatMap(s=>s.imageIds.map((id,index)=>({id,label:`${s.name} · ${index+1}/${s.imageIds.length}`})));
 const optionsKey=options.map(item=>item.id).join('|');
 const [first,setFirst]=useState(''),[second,setSecond]=useState(''),[overlap,setOverlap]=useState(0),[shift,setShift]=useState(0),[raster,setRaster]=useState<[Raster,Raster]|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const preview=useRef<HTMLCanvasElement>(null);
 useEffect(()=>{if(open){const i=Math.max(0,options.findIndex(x=>x.id===initialImage));setFirst(options[i]?.id||'');setSecond(options[i+1]?.id||options[i-1]?.id||'');setOverlap(0);setShift(0);setError('');}},[open,initialImage,optionsKey]);
 useEffect(()=>{if(!open||!first||!second||first===second){setRaster(null);return;}let cancelled=false;void Promise.all([load(first),load(second)]).then(value=>{if(!cancelled){setRaster(value as [Raster,Raster]);setOverlap(Math.round(Math.min(value[0].height,value[1].height)*.1));}}).catch(e=>{if(!cancelled){setRaster(null);setError(String(e));}});return()=>{cancelled=true;};},[open,first,second]);
 useEffect(()=>{if(!raster||!preview.current)return;try{const image=compose(raster[0],raster[1],overlap,shift),canvas=preview.current;canvas.width=image.width;canvas.height=image.height;canvas.getContext('2d')?.putImageData(new ImageData(image.data,image.width,image.height),0,0);}catch(e){setError(String(e));}},[raster,overlap,shift]);
 const matching=!!raster?.[0].spacing&&!!raster?.[1].spacing&&raster[0].spacing.every((x,i)=>Math.abs(x-raster[1].spacing![i])<.0001);
 const save=async()=>{if(!raster||busy)return;setBusy(true);setError('');try{
  if(raster[0].source.studyUID!==raster[1].source.studyUID)throw Error('Görüntülər eyni müayinədən olmalıdır');
  const merged=compose(raster[0],raster[1],overlap,shift);
  const blob=await createStitchedDicom([raster[0].source,raster[1].source],merged.width,merged.height,merged.data,matching?raster[0].spacing:undefined);
  await onCreated(new File([blob],`RADAZ-Stitch-${Date.now()}.dcm`,{type:'application/dicom'}));onOpenChange(false);
 }catch(e){setError(e instanceof Error?e.message:String(e));}finally{setBusy(false);}};
 return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="stitch-dialog"><DialogHeader><DialogTitle>İki rentgen görüntüsünü birləşdir</DialogTitle></DialogHeader>
  <p>Yuxarı və aşağı kadrı seçin. Orijinal DICOM faylları qorunur.</p>
  <label>Yuxarı görüntü<select value={first} onChange={e=>setFirst(e.target.value)}>{options.map(x=><option key={x.id} value={x.id}>{x.label}</option>)}</select></label>
  <label>Aşağı görüntü<select value={second} onChange={e=>setSecond(e.target.value)}>{options.map(x=><option key={x.id} value={x.id}>{x.label}</option>)}</select></label>
  {raster&&<><label>Örtüşmə: {overlap} px<input type="range" min="0" max={Math.min(raster[0].height,raster[1].height)-1} value={overlap} onChange={e=>setOverlap(Number(e.target.value))}/></label>
  <label>Üfüqi sürüşmə: {shift} px<input type="range" min={-raster[1].width} max={raster[0].width} value={shift} onChange={e=>setShift(Number(e.target.value))}/></label>
  <div className="stitch-preview"><canvas ref={preview} aria-label="Birləşmiş rentgen ön baxışı"/></div>
  <small>{matching?'Kalibrləmə uyğundur: millimetr ölçüsü saxlanacaq.':'Kalibrləmə uyğun deyil və ya yoxdur: yanlış millimetr ölçüsü yazılmayacaq.'}</small></>}
  {error&&<p role="alert">{error}</p>}<button disabled={!raster||busy||first===second} onClick={()=>void save()}>{busy?'Saxlanır…':'Ayrıca DICOM kimi saxla'}</button>
 </DialogContent></Dialog>;
}
