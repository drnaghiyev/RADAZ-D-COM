'use client';
import {useEffect, useState} from 'react';
import {FileSearch} from 'lucide-react';
import {Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription} from './ui/dialog';
import {getOriginalDicom} from '@/lib/cornerstone';
import {parseDicomFile} from '@/lib/dicom-file';

const dictionary: Record<string, [string, string]> = {
  x00020010:['Transfer Syntax UID','UI'], x00080005:['Specific Character Set','CS'],
  x00080008:['Image Type','CS'], x00080016:['SOP Class UID','UI'], x00080018:['SOP Instance UID','UI'],
  x00080020:['Study Date','DA'], x00080030:['Study Time','TM'], x00080050:['Accession Number','SH'],
  x00080060:['Modality','CS'], x00080070:['Manufacturer','LO'], x00080080:['Institution Name / Klinika','LO'],
  x00080090:['Referring Physician','PN'], x00081030:['Study Description','LO'], x0008103e:['Series Description','LO'],
  x00081090:['Manufacturer Model','LO'], x00100010:['Patient Name','PN'], x00100020:['Patient ID','LO'],
  x00100030:['Birth Date','DA'], x00100040:['Sex','CS'], x00101010:['Age','AS'],
  x00180015:['Body Part Examined','CS'], x00180024:['Sequence Name','SH'], x00180050:['Slice Thickness (mm)','DS'],
  x00180060:['KVP','DS'], x00180080:['TR (ms)','DS'], x00180081:['TE (ms)','DS'],
  x00180087:['Magnetic Field Strength (T)','DS'], x00180088:['Spacing Between Slices (mm)','DS'],
  x00181030:['Protocol Name','LO'], x00181164:['Imager Pixel Spacing (mm)','DS'], x00185101:['View Position','CS'],
  x0020000d:['Study Instance UID','UI'], x0020000e:['Series Instance UID','UI'], x00200011:['Series Number','IS'],
  x00200013:['Instance Number','IS'], x00200032:['Image Position Patient (mm)','DS'],
  x00200037:['Image Orientation Patient','DS'], x00200052:['Frame of Reference UID','UI'],
  x00280002:['Samples per Pixel','US'], x00280004:['Photometric Interpretation','CS'], x00280008:['Frames','IS'],
  x00280010:['Rows','US'], x00280011:['Columns','US'], x00280030:['Pixel Spacing (mm)','DS'],
  x00280100:['Bits Allocated','US'], x00280101:['Bits Stored','US'], x00280102:['High Bit','US'],
  x00280103:['Pixel Representation','US'], x00281050:['Window Center / WL','DS'], x00281051:['Window Width / WW','DS'],
  x00281052:['Rescale Intercept','DS'], x00281053:['Rescale Slope','DS'], x7fe00010:['Pixel Data','OW'],
};
type Row = {tag: string; name: string; vr: string; value: string};
export function DicomInfoButton({imageId}: {imageId?: string}) {
  const [open,setOpen]=useState(false), [query,setQuery]=useState(''), [rows,setRows]=useState<Row[]>([]), [status,setStatus]=useState('');
  useEffect(()=>{
    if(!open||!imageId)return;
    let cancelled=false;setRows([]);setStatus('DICOM məlumatları oxunur…');
    void (async()=>{
      const bytes=await getOriginalDicom(imageId);
      if(!bytes)throw Error('Bu, törəmə MPR görüntüsüdür. Orijinal DICOM seriyasını seçin.');
      const ds=parseDicomFile(bytes);
      const next=Object.entries(ds.elements).sort(([a],[b])=>a.localeCompare(b)).map(([tag,element])=>{
        const [name,fallback]=dictionary[tag]||['—',''];const vr=element.vr||fallback||'UN';let value='';
        try {
          if(element.items)value=`${element.items.length} element (sequence)`;
          else if(tag==='x7fe00010'||['OB','OW','OF','OD','OL','OV','UN'].includes(vr))value=`${element.length.toLocaleString()} bayt`;
          else if(['US','SS','UL','SL','FL','FD'].includes(vr)) {
            const width=['US','SS'].includes(vr)?2:vr==='FD'?8:4;
            const read={US:ds.uint16.bind(ds),SS:ds.int16.bind(ds),UL:ds.uint32.bind(ds),SL:ds.int32.bind(ds),FL:ds.float.bind(ds),FD:ds.double.bind(ds)}[vr]!;
            value=Array.from({length:Math.min(16,Math.floor(element.length/width))},(_,i)=>String(read(tag,i))).join(' \\ ');
          } else value=(ds.string(tag)||'').replace(/\^/g,' ').slice(0,2048);
        } catch {value='Oxunmadı';}
        return {tag:`(${tag.slice(1,5)},${tag.slice(5)})`.toUpperCase(),name,vr,value};
      });
      if(!cancelled){setRows(next);setStatus(`${next.length} DICOM teqi`);}
    })().catch(error=>{if(!cancelled)setStatus(String(error.message||error));});
    return()=>{cancelled=true;};
  },[open,imageId]);
  const filter=query.trim().toLocaleLowerCase();
  return <><button className="header-control" title="DICOM məlumatları" aria-label="DICOM məlumatları" disabled={!imageId} onClick={()=>{setQuery('');setOpen(true);}}><FileSearch/></button>
    <Dialog open={open} onOpenChange={setOpen}><DialogContent className="dicom-info-dialog"><DialogHeader><DialogTitle>DICOM məlumatları</DialogTitle><DialogDescription>Aktiv görüntünün faylında qeyd olunan metadata</DialogDescription></DialogHeader>
      <input aria-label="DICOM teqlərində axtar" placeholder="Teq, ad və ya dəyər üzrə axtar" value={query} onChange={e=>setQuery(e.target.value)}/>
      <p role="status">{status}</p><div className="dicom-info-table"><table><thead><tr><th>Teq</th><th>Ad</th><th>VR</th><th>Dəyər</th></tr></thead><tbody>{rows.filter(row=>Object.values(row).join(' ').toLocaleLowerCase().includes(filter)).map(row=><tr key={row.tag}><td>{row.tag}</td><td>{row.name}</td><td>{row.vr}</td><td>{row.value}</td></tr>)}</tbody></table></div>
    </DialogContent></Dialog></>;
}
