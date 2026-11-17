import {measurementCopies} from './measurement-copies';
import JSZip from 'jszip';
import type { ArchiveStudy } from './local-archive';
import { readDicomPixels,bytesToBase64,type DicomPixelImage } from './dicom-pixels';
import {viewerHtml} from './dicom-lite-html';
import {parseDicomFile} from './dicom-file';
import {createMeasurementDicom,type MeasurementDicomSource} from './measurement-dicom';
import {saveMeasurementCopy} from './measurement-copies';

const safe = (value: string) => value.replace(/[^a-z0-9._-]+/gi, '_').replace(/^_+|_+$/g, '') || 'study';

export async function buildDicomCdPackage(study: ArchiveStudy, files: File[], progress?: (message: string) => void) {
  const zip = new JSZip();
  const dicom = zip.folder('DICOM')!;
  const previews = zip.folder('PREVIEWS')!;
  const viewerImages: Array<{ name: string; path: string; spacing?:[number,number]; hu?:string; rows:number; columns:number }> = [];
  for (let index = 0; index < files.length; index++) {
    const file = files[index];
    dicom.file(`IMG${String(index + 1).padStart(6, '0')}.dcm`, file);
    try {
      const image = await readDicomPixels(file) ?? await import('./cornerstone').then(({dicomMediaPreview})=>file.arrayBuffer().then(bytes=>dicomMediaPreview(new Uint8Array(bytes))));
      if (!image) throw Error('DICOM önbaxışı oxunmadı');
      const canvas=document.createElement('canvas');canvas.width=image.columns;canvas.height=image.rows;
      const context=canvas.getContext('2d');if(!context)throw Error('CD önbaxışı hazırlana bilmədi');
      const raster=context.createImageData(image.columns,image.rows);
      for(let pixel=0;pixel<image.pixels.length;pixel++){
        const offset=pixel*4,value=image.pixels[pixel];
        raster.data[offset]=raster.data[offset+1]=raster.data[offset+2]=value;raster.data[offset+3]=255;
      }
      context.putImageData(raster,0,0);
      const preview=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(Error('CD önbaxışı hazırlana bilmədi')),'image/jpeg',.87));
      const path=`PREVIEWS/IMG${String(index+1).padStart(6,'0')}.jpg`;
      previews.file(path.slice('PREVIEWS/'.length),preview);
      const calibrated=image as Partial<DicomPixelImage>,raw=calibrated.values;
      const hu=raw&&calibrated.modality==='CT'?`HU/IMG${String(index+1).padStart(6,'0')}.js`:undefined;
      if(hu&&raw){const values=new Int16Array(raw.length);for(let k=0;k<values.length;k++)values[k]=Math.max(-32768,Math.min(32767,Math.round(raw[k])));
        zip.file(hu,'window.__RADAZ_HU={index:'+viewerImages.length+',data:"'+bytesToBase64(new Uint8Array(values.buffer))+'"};',{compression:'DEFLATE'});}
      viewerImages.push({name:file.name,path,spacing:'spacing' in image?image.spacing as [number,number]|undefined:undefined,hu,rows:image.rows,columns:image.columns});
    } catch { /* DICOM file remains on the media even when Lite preview cannot decode it. */ }
    if (index % 10 === 0) progress?.(`CD paketi hazırlanır: ${index + 1} / ${files.length}`);
  }
  const savedCopies=await measurementCopies(study.uid);
  const included=new Map<string,MeasurementDicomSource>();
  if(savedCopies.length)for(const file of files){try{const ds=parseDicomFile(new Uint8Array(await file.arrayBuffer())),sop=ds.string('x00080018');if(sop)included.set(sop,{
    studyUID:ds.string('x0020000d')||'',sopUID:sop,sopClassUID:ds.string('x00080016')||'',patientName:ds.string('x00100010')||'',patientId:ds.string('x00100020')||'',
    studyDate:ds.string('x00080020')||'',studyTime:ds.string('x00080030')||'',accessionNumber:ds.string('x00080050')||'',studyDescription:ds.string('x00081030')||'',
    birthDate:ds.string('x00100030')||'',patientSex:ds.string('x00100040')||'',instanceNumber:ds.string('x00200013')||'1',
  });}catch{}}
  const copies=savedCopies.filter(copy=>included.has(copy.sop));
  for(const [i,copy] of copies.entries()){
    let dicom=copy.blob;
    if(dicom.type!=='application/dicom'){
      // Upgrade the PNG snapshots made by 0.2.72 before the first new disc is prepared.
      const bitmap=await createImageBitmap(dicom),canvas=document.createElement('canvas');
      canvas.width=bitmap.width;canvas.height=bitmap.height;const context=canvas.getContext('2d');
      if(!context)throw Error('Ölçülü görüntü oxunmadı');context.drawImage(bitmap,0,0);bitmap.close();
      dicom=await createMeasurementDicom(included.get(copy.sop)!,canvas.width,canvas.height,context.getImageData(0,0,canvas.width,canvas.height).data);
      await saveMeasurementCopy({...copy,blob:dicom,updated:Date.now()},copy.id);
    }
    zip.file(`MEASUREMENTS/IMG${String(i+1).padStart(6,'0')}.dcm`,dicom);
  }
  zip.file('README.txt', `RADAZ DICOM media\r\nPatient: ${study.patient}\r\nPatient ID: ${study.patientId}\r\nStudy UID: ${study.uid}\r\nImages: ${files.length}\r\n\r\nSTART.html faylını Chrome və ya Edge ilə açın. Orijinal DICOM faylları DICOM qovluğundadır.${copies.length?' Ölçülər ayrıca DICOM Secondary Capture seriyasındadır.':''}\r\n`);
  zip.file('START.html', viewerHtml(study, viewerImages));
  zip.file('AUTORUN.INF', '[AutoRun]\r\nshellexecute=START.html\r\naction=RADAZ DICOM Lite ilə aç\r\nlabel=RADAZ DICOM Media\r\n');
  zip.file('MANIFEST.json', JSON.stringify({ profile: 'RADAZ-DICOM-MEDIA', study, files: [...files.map((file, index) => ({ path: `DICOM/IMG${String(index + 1).padStart(6, '0')}.dcm`, originalName: file.name })),...copies.map((copy,index)=>({path:`MEASUREMENTS/IMG${String(index+1).padStart(6,'0')}.dcm`,originalName:`Measured ${copy.sop}`}))] }, null, 2));
  const blob = await zip.generateAsync({ type: 'blob', compression: 'STORE' }, value => progress?.(`CD faylı yaradılır: ${Math.round(value.percent)}%`));
  return { blob, previews: viewerImages.length };
}

export async function createDicomCdPackage(study: ArchiveStudy, files: File[], progress?: (message: string) => void) {
  const { blob, previews } = await buildDicomCdPackage(study, files, progress);
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob); link.download = `${safe(study.patient)}-${study.date || 'study'}-RADAZ-CD.zip`;
  link.click(); setTimeout(() => URL.revokeObjectURL(link.href), 30_000);
  return previews;
}
