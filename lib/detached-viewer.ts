import type {AnatomyVolumeResult} from './anatomy-volume';
import type {SharedDicom} from './cornerstone';

export type DetachedSeries={id:string;studyId:string;name:string;modality:string;patient:string;patientId:string;
  birth:string;date:string;number:string;thumb?:string;mediaSession?:string;archived?:boolean;discovered?:number;loading?:boolean;images:SharedDicom[]};
export type DetachedSnapshot={revision:string;series:DetachedSeries[];preferredSeriesId?:string;anatomy?:AnatomyVolumeResult|null};
type SourceWindow=Window&{radazDetachedSources?:Map<string,()=>DetachedSnapshot>};

export function publishDetachedSource(token:string,read:()=>DetachedSnapshot){
  const target=window as SourceWindow;
  (target.radazDetachedSources??=new Map()).set(token,read);
  return()=>target.radazDetachedSources?.delete(token);
}
export function readDetachedSource(token:string):DetachedSnapshot|null{
  try{
    const parent=window.opener as SourceWindow|null;
    if(!parent||parent.closed||parent.location.origin!==location.origin)return null;
    return parent.radazDetachedSources?.get(token)?.()||null;
  }catch{return null;}
}
