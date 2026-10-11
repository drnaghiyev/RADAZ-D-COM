'use client';
import {useTranslation as useUiTranslation,translate as tr} from '@/lib/i18n';

import { OutputPageHeader } from '@/components/output-page-header';
import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Disc3, Download, RefreshCw } from 'lucide-react';
import { buildDicomCdPackage } from '@/lib/dicom-media';
import { getArchiveFiles, listArchiveStudies, type ArchiveStudy } from '@/lib/local-archive';
import { outputRequest, readOutputJob } from '@/lib/output-jobs';
import { parseDicomFile } from '@/lib/dicom-file';

type Drive = {id:string;name:string;volumes:string[];canWrite:boolean;blank:boolean;mediaSupported:boolean;freeBytes:number};
type MediaJob = {id:string;state:string;count:number;size:number;message:string;iso?:boolean};
export default function MediaPage() {
  useUiTranslation();
  useEffect(() => { document.title = 'RADAZ · CD / DVD'; }, []);
  const [study,setStudy] = useState<ArchiveStudy|null>(null), [files,setFiles] = useState<File[]>([]);
  const [drives,setDrives] = useState<Drive[]>([]),[recorder,setRecorder] = useState('');
  const [job,setJob] = useState<MediaJob|null>(null),[status,setStatus] = useState('Müayinə oxunur…'),[busy,setBusy] = useState(false);
  const persistenceKey = useRef('');
  const [downloadFile,setDownloadFile] = useState<{url:string;name:string}|null>(null);
  useEffect(()=>()=>{if(downloadFile)URL.revokeObjectURL(downloadFile.url);},[downloadFile]);
  const refresh = async () => { try { const value=await outputRequest<{drives:Drive[]}>('/output-devices');setDrives(value.drives);setRecorder(current=>value.drives.some(item=>item.id===current)?current:value.drives.find(item=>item.canWrite)?.id||value.drives[0]?.id||''); }catch(error){setStatus(String(error));} };
  useEffect(()=>{
    void refresh();
    void (async()=>{
      const query=new URLSearchParams(location.search),jobId=query.get('job'),uid=query.get('study');
      persistenceKey.current=`radaz-media-${jobId||uid||''}`;
      const previous=sessionStorage.getItem(persistenceKey.current);if(previous)void outputRequest<MediaJob>(`/media/status?job=${previous}`).then(setJob).catch(()=>{});
      if(jobId){
        const item=await readOutputJob(jobId);if(!item?.files?.length)throw new Error('CD/DVD üçün görüntülər tapılmadı');
        const ds=parseDicomFile(new Uint8Array(await item.files[0].arrayBuffer()));
        setFiles(item.files);setStudy({uid:ds.string('x0020000d')||'',patient:(ds.string('x00100010')||'').replaceAll('^',' '),patientId:ds.string('x00100020')||'',description:item.title,date:ds.string('x00080020')||'',modality:ds.string('x00080060')||'',time:ds.string('x00080030')||'',birth:ds.string('x00100030')||'',accession:ds.string('x00080050')||'',referring:ds.string('x00080090')||'',openedAt:null,imageCount:item.files.length,series:[],size:item.files.reduce((sum,file)=>sum+file.size,0),addedAt:Date.now()} as ArchiveStudy);
        setStatus(`${item.files.length} görüntü seçilib`);
      }else if(uid){
        const item=(await listArchiveStudies()).find(item=>item.uid===uid);if(!item)throw new Error('Müayinə tapılmadı');setStudy(item);const loaded=await getArchiveFiles(uid);setFiles(loaded);setStatus(`${loaded.length} görüntü seçilib`);
      }else throw new Error('Viewer və ya arxivdə CD/DVD üçün müayinə seçin');
    })().catch(error=>setStatus(error instanceof Error?error.message:String(error)));
  },[]);
  const running=job?.state==='preparing'||job?.state==='writing';
  useEffect(()=>{
    if(!running||!job)return;
    const timer=setInterval(()=>{void outputRequest<MediaJob>(`/media/status?job=${job.id}`).then(value=>{setJob(value);setStatus(value.message);}).catch(error=>setStatus(String(error)));},2000);
    return()=>clearInterval(timer);
  },[running,job?.id]);
  const prepare=async()=>{
    if(job)return job;
    if(!study||!files.length)throw new Error('Görüntü seçilməyib');
    const {blob}=await buildDicomCdPackage(study,files,setStatus);
    setStatus('DICOMDIR və disk fayl sistemi hazırlanır…');
    const value=await outputRequest<MediaJob>('/media/prepare',{method:'POST',headers:{'Content-Type':'application/zip'},body:blob});
    setJob(value);sessionStorage.setItem(persistenceKey.current,value.id);return value;
  };
  const start=async(mode:'iso'|'burn'|'package')=>{
    setBusy(true);
    try{const current=await prepare();if(mode==='package'){setStatus(current.message);return;}const value=await outputRequest<MediaJob>('/media/start',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({job:current.id,mode,recorder})});setJob(value);setStatus(value.message);}
    catch(error){setStatus(error instanceof Error?error.message:String(error));}finally{setBusy(false);}
  };
  const download=async(kind:'iso'|'zip')=>{
    if(!job||busy)return;setBusy(true);
    try{
      const response=await fetch(`/local-archive-api/media/${kind}?job=${job.id}`);
      if(!response.ok)throw new Error('Media faylı yüklənmədi');
      const url=URL.createObjectURL(await response.blob()),name=kind==='iso'?'RADAZ.iso':'RADAZ-CD.zip';
      setDownloadFile({url,name});setStatus(`${name} hazırdır`);
      const link=document.createElement('a');link.href=url;link.download=name;link.click();
    }catch(error){setStatus(String(error));}finally{setBusy(false);}
  };
  const drive=drives.find(item=>item.id===recorder);
  return <main className="media-shell media-output-shell"><OutputPageHeader kind="media"/><section><Disc3 size={48}/><h1>{tr('ui.prepare_and_burn_dicom_disc_78d3c')}</h1><p>{study?<><strong>{study.patient}</strong><br/>{study.description} · {files.length} {tr('ui.images_992d4')}</>:'Müayinə seçilməyib'}</p><p>{tr('ui.dicomdir_dicom_images_and_the_offline_start_h_64400')}</p>
    <div className="disc-device"><label>{tr('ui.drive_on_the_radaz_computer_ae629')}<select aria-label={tr('ui.cd_dvd_drive_0f769')} value={recorder} onChange={e=>setRecorder(e.target.value)}>{!drives.length&&<option value="">{tr('ui.no_drive_found_fbf81')}</option>}{drives.map(item=><option key={item.id} value={item.id}>{item.volumes.join(', ')} {item.name} {item.canWrite?'':'· yalnız oxuyur'}</option>)}</select></label><button aria-label={tr('ui.refresh_drives_9de73')} disabled={busy||running} onClick={()=>void refresh()}><RefreshCw size={17}/></button></div>
    <p className="disc-state">{!drive?'CD/DVD writer qoşun.':!drive.canWrite?'Bu qurğu yalnız oxuyur. Birbaşa yazmaq üçün CD/DVD writer qoşun.':!drive.mediaSupported||!drive.blank?'Uyğun boş CD/DVD daxil edin. Mövcud diskdəki məlumatlar silinmir.':`Boş disk hazırdır · ${(drive.freeBytes/1024/1024).toFixed(0)} MB boş yer`}</p>
    <button disabled={!files.length||busy||running||!drive?.canWrite||!drive.blank||!drive.mediaSupported} onClick={()=>void start('burn')}><Disc3 size={19}/> {tr('ui.burn_to_blank_cd_dvd_ccce0')}</button>
    <div className="media-secondary"><button disabled={!files.length||busy||running} onClick={()=>void start('iso')}>{tr('ui.create_iso_e0c1e')}</button><button disabled={!files.length||busy||running} onClick={()=>void start('package')}>{tr('ui.create_zip_package_40d58')}</button></div>
    {job&&<div className="output-actions"><button className="output-primary" disabled={busy||running} onClick={()=>void download('zip')}><Download size={16}/> {tr('ui.dicomdir_viewer_zip_ac6c0')}</button>{job.iso&&<button className="output-primary" disabled={busy||running} onClick={()=>void download('iso')}>{tr('ui.download_iso_89805')}</button>}</div>}
    {downloadFile&&<a className="output-primary" href={downloadFile.url} download={downloadFile.name}>{downloadFile.name} {tr('ui._download_file_eb257')}</a>}
    <p role="status" className="output-status">{status}</p>{running&&<progress aria-label={tr('ui.disc_operation_in_progress_60006')}/>}
    <small>{tr('ui.the_operation_runs_locally_do_not_disconnect_e0576')}</small>
  </section><footer>{busy?'Paket hazırlanır…':running?'Disk işi davam edir…':'RADAZ lokal media xidməti'}</footer></main>;
}
