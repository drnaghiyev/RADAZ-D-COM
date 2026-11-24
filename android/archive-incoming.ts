// Built into the Android edition of lib/local-archive.ts to share its schema and DICOM reader.
export async function storeIncomingDicom(file:File, manifest:{study:string;uid:string;sha:string;size:number}) {
  if(file.size!==manifest.size)throw Error('Faylın ölçüsü uyğun deyil.');
  const bytes=await file.arrayBuffer();
  const hex=async (buffer:ArrayBuffer)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',buffer)),n=>n.toString(16).padStart(2,'0')).join('');
  if(await hex(bytes)!==manifest.sha)throw Error('Faylın bütövlüyü təsdiqlənmədi.');
  const ds=parseDicomFile(new Uint8Array(bytes));
  const tag=(id:string)=>ds.string(id)?.trim()||'';
  const studyUID=tag('x0020000d'),seriesUID=tag('x0020000e'),sopUID=tag('x00080018');
  if(studyUID!==manifest.study||sopUID!==manifest.uid||!seriesUID)throw Error('DICOM göndərişə uyğun deyil.');
  const id=studyUID+'|'+sopUID,now=Date.now(),db=await database();
  try{
    // The two stores commit together. Concurrent receipts of one SOP increment counts only once.
    const tx=db.transaction(['studies','instances'],'readwrite',{durability:'strict'});
    const done=complete(tx),instances=tx.objectStore('instances'),studies=tx.objectStore('studies');
    let existing:StoredInstance|undefined;
    const lookup=instances.get(id);
    lookup.onsuccess=()=>{
      existing=lookup.result;
      if(existing)return;
      const lookupStudy=studies.get(studyUID);
      lookupStudy.onsuccess=()=>{
        const study:ArchiveStudy=lookupStudy.result||{
          uid:studyUID,date:tag('x00080020'),time:tag('x00080030'),patient:(tag('x00100010')||'Naməlum pasiyent').replaceAll('^',' '),
          patientId:tag('x00100020'),birth:tag('x00100030'),modality:tag('x00080060'),description:tag('x00081030'),
          accession:tag('x00080050'),referring:tag('x00080090').replaceAll('^',' '),series:[],imageCount:0,size:0,addedAt:now,openedAt:null
        };
        let series=study.series.find(item=>item.uid===seriesUID);
        if(!series){
          series={uid:seriesUID,number:tag('x00200011')||'—',modality:tag('x00080060')||'DICOM',
            description:dicomSeriesName(tag),protocol:tag('x00181030'),imageCount:0,addedAt:now};
          study.series.push(series);study.series.sort((a,b)=>Number(a.number)-Number(b.number));
        }
        series.imageCount++;study.imageCount++;study.size+=file.size;
        study.modality=[...new Set(study.series.map(s=>s.modality))].join('/');
        instances.add({id,studyUID,seriesUID,sopUID,number:Number(tag('x00200013'))||0,filename:file.name,file,size:file.size});
        studies.put(study);
      };
    };
    await done;
    if(existing&&(existing.size!==file.size||await hex(await existing.file.arrayBuffer())!==manifest.sha))
      throw Error('Bu görüntü identifikatoru ilə arxivdə fərqli DICOM var.');
  }finally{db.close();}
}
