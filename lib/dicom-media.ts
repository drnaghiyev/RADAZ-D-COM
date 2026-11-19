import {measurementCopies} from './measurement-copies';
import JSZip from 'jszip';
import type { ArchiveStudy } from './local-archive';
import {bytesToBase64} from './dicom-pixels';
import {portableViewerHtml} from './dicom-lite-html';
import {deflatePixels} from './portable-dicom';
import {prefetchOrdered} from './import-pipeline';
import {yieldToBrowser,type WorkProgress} from './work-progress';
import {parseDicomFile} from './dicom-file';
import {createMeasurementDicom,type MeasurementDicomSource} from './measurement-dicom';
import {saveMeasurementCopy} from './measurement-copies';

const safe = (value: string) => value.replace(/[^a-z0-9._-]+/gi, '_').replace(/^_+|_+$/g, '') || 'study';

export async function buildDicomCdPackage(study: ArchiveStudy, files: File[], progress?: (message: string) => void,onProgress?:(value:WorkProgress)=>void,store?:(path:string,data:Blob|string)=>Promise<void>) {
  const zip = new JSZip();
  const add=async(path:string,data:Blob|string)=>{if(store)await store(path,data);else zip.file(path,data);};
  const viewerImages:{name:string;path:string}[]=[],warnings:string[]=[];
  const assets=await Promise.all(['viewer.js','viewer.css'].map(async name=>{const response=await fetch('/dicom-lite/'+name);if(!response.ok)throw Error('DICOM Lite faylları tapılmadı. Proqramı yenidən başladın.');return {name,blob:await response.blob()};}));for(const asset of assets)await add('LITE/'+asset.name,asset.blob);
  const {preparePortableDicom}=await import('./cornerstone');let completed=0;
  const prepare=async(file:File,key:string)=>{const entries:{name:string;path:string}[]=[];let frame=0;
   await preparePortableDicom(new Uint8Array(await file.arrayBuffer()),async(packet,pixels,frameProgress)=>{const path=`DATA/IMG${key}_F${String(++frame).padStart(6,'0')}.js`,compressed=await deflatePixels(pixels);await add(path,'window.RADAZ_LITE_PACKET='+JSON.stringify({...packet,data:bytesToBase64(compressed)}).replace(/</g,'\\u003c')+';');entries.push({name:file.name+(frame>1?' · '+frame:''),path});if(frameProgress.total>1)onProgress?.({label:'DICOM Lite kadrları hazırlanır',done:frameProgress.done,total:frameProgress.total,unit:'kadr'});await yieldToBrowser();});return entries;};
  onProgress?.({label:'DICOM Lite görüntüləri hazırlanır',done:0,total:files.length});
  for await(const entries of prefetchOrdered(files,async(file,index)=>{await add(`DICOM/IMG${String(index+1).padStart(6,'0')}.dcm`,file);let entries:{name:string;path:string}[]=[];try{entries=await prepare(file,String(index+1).padStart(6,'0'));}catch(error){if(store)throw error;warnings.push(file.name);}completed++;progress?.(`CD paketi hazırlanır: ${completed} / ${files.length}`);onProgress?.({label:'DICOM Lite görüntüləri hazırlanır',done:completed,total:files.length});return entries;},2,file=>file.size,16*1024*1024))viewerImages.push(...entries);
  if(!viewerImages.length)throw Error('DICOM Lite üçün heç bir görüntü oxunmadı. Orijinal DICOM faylları dəyişdirilmədi.');
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
    await add(`MEASUREMENTS/IMG${String(i+1).padStart(6,'0')}.dcm`,dicom);
    viewerImages.push(...await prepare(new File([dicom],`Measured ${i+1}.dcm`,{type:'application/dicom'}),'M'+String(i+1).padStart(6,'0')));
  }
  await add('README.txt', `RADAZ DICOM media\r\nPatient: ${study.patient}\r\nPatient ID: ${study.patientId}\r\nStudy UID: ${study.uid}\r\nImages: ${files.length}\r\n\r\nSTART.html faylını Chrome və ya Edge ilə açın. Orijinal DICOM faylları DICOM qovluğundadır.${copies.length?' Ölçülər ayrıca DICOM Secondary Capture seriyasındadır.':''}\r\n`);
  await add('START.html', portableViewerHtml(study, viewerImages));
  await add('AUTORUN.INF', '[AutoRun]\r\nshellexecute=START.html\r\naction=RADAZ DICOM Lite ilə aç\r\nlabel=RADAZ DICOM Media\r\n');
  await add('MANIFEST.json', JSON.stringify({ profile: 'RADAZ-DICOM-MEDIA', study, files: [...files.map((file, index) => ({ path: `DICOM/IMG${String(index + 1).padStart(6, '0')}.dcm`, originalName: file.name })),...copies.map((copy,index)=>({path:`MEASUREMENTS/IMG${String(index+1).padStart(6,'0')}.dcm`,originalName:`Measured ${copy.sop}`}))] }, null, 2));
  const blob = store?new Blob():await zip.generateAsync({ type: 'blob', compression: 'STORE' }, value => {progress?.(`CD faylı yaradılır: ${Math.round(value.percent)}%`);onProgress?.({label:'CD faylı yaradılır',done:Math.round(value.percent),total:100});});
  return { blob, previews: viewerImages.length,warnings };
}

export async function createDicomCdPackage(study: ArchiveStudy, files: File[], progress?: (message: string) => void) {
  const { blob, previews } = await buildDicomCdPackage(study, files, progress);
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob); link.download = `${safe(study.patient)}-${study.date || 'study'}-RADAZ-CD.zip`;
  link.click(); setTimeout(() => URL.revokeObjectURL(link.href), 30_000);
  return previews;
}
