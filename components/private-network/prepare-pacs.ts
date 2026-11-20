import {streamRemoteStudy,type RemoteStudy} from '@/lib/dicomweb';
import {queryDimseSeries,type DimseLocation} from '@/lib/pacs-bridge';
import {parseDicomFile} from '@/lib/dicom-file';
import {saveDiskFiles} from '@/lib/disk-archive';
import {networkCall} from './api';

export async function stageNetworkPacs(
  location:DimseLocation&{dicomwebUrl:string},token:string,callingAe:string,port:string,
  study:RemoteStudy,clinic:string,status:(message:string)=>void
) {
  let done = 0, stageId = '';
  const seen = new Set<string>();
  async function verify(file:File, series:string, sop?:string) {
    const ds = parseDicomFile(new Uint8Array(await file.arrayBuffer()));
    const actualSop = ds.string('x00080018');
    if (ds.string('x0020000d') !== study.uid || ds.string('x0020000e') !== series)
      throw Error('PACS-dan gələn görüntü seçilmiş müayinə və seriyaya uyğun deyil.');
    if (!actualSop || (sop && sop !== actualSop) || seen.has(actualSop))
      throw Error('PACS görüntüsünün identifikatoru sorğuya uyğun deyil və ya təkrarlanır.');
    seen.add(actualSop);
  }
  async function stage(file:File) {
    await saveDiskFiles([file], undefined, location.aeTitle, true);
    status('PACS · ' + (++done) + (study.instanceCount ? '/' + study.instanceCount : ''));
  }
  if (location.dicomwebUrl) {
    const files = streamRemoteStudy(location.dicomwebUrl, token, study.uid, study.instanceCount,
      (file, item) => verify(file, item.series, item.sop));
    for await (const file of files) await stage(file);
  } else {
    const result = await queryDimseSeries(location, callingAe, study.uid);
    if (result.truncated || !result.items.length || result.items.length < study.seriesCount)
      throw Error('PACS-dən müayinənin bütün seriyalarının siyahısı alınmadı.');
    status('PACS · DICOM qəbul edilir…');
    const resultOfStage = await networkCall<{count:number;stageId:string}>('stage_dimse', {
      clinic, study:study.uid, expected:study.instanceCount,
      series:result.items.map(item=>({uid:item.uid,instanceCount:item.instanceCount})),
      pacs:{host:location.host,port:location.port,aeTitle:location.aeTitle,callingAe,listenerPort:port},
    });
    done = resultOfStage.count;
    stageId = resultOfStage.stageId;
    if (!stageId) throw Error('PACS müayinəsinin qəbul təsdiqi alınmadı.');
  }
  if (!done || done < study.instanceCount) throw Error('PACS müayinəsi tam qəbul edilmədi.');
  return stageId ? {stageId} : {onlyUids:[...seen]};
}