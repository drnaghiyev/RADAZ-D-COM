import {translate,type MessageKey} from './i18n';
import {messages} from './locales/messages';
import type {Point3} from './localizer';

export type AnatomyVolumeGeometry = {dimensions:Point3;spacing:Point3;origin:Point3;direction:number[];modality:'CT'|'MR'};
export type AnatomyVolumeResult = AnatomyVolumeGeometry & {mask:Uint8Array;corrections?:Map<number,number>;classes:Record<string,string>;sourceKey:string;sourceFingerprint?:string;task:string;device:string;seconds:number;modelSpacingMm:number|null;experimental:true};
export const volumeSourceKey=(imageIds:string[])=>imageIds.join('|');
export function volumeIndex(geometry:AnatomyVolumeGeometry,world:Point3):Point3{
 const delta=world.map((n,i)=>n-geometry.origin[i]);
 return [0,1,2].map(i=>delta.reduce((sum,n,j)=>sum+n*geometry.direction[i*3+j],0)/geometry.spacing[i]) as Point3;
}
export function volumeLabelAt(result:AnatomyVolumeResult,world:Point3){
 const index=volumeIndex(result,world).map(Math.round);
 if(index.some((n,i)=>!Number.isFinite(n)||n<0||n>=result.dimensions[i]))return 0;
 const offset=(index[2]*result.dimensions[1]+index[1])*result.dimensions[0]+index[0];return result.corrections?.get(offset)??result.mask[offset]??0;
}
/** Nearest-neighbour labels in any displayed plane, including oblique MPR. */
export function sampleAnatomyPlane(result:AnatomyVolumeResult,a:Point3,b:Point3,d:Point3,width:number,height:number){
 const start=volumeIndex(result,a),bx=volumeIndex(result,b),dy=volumeIndex(result,d);
 const u=bx.map((n,i)=>n-start[i]),v=dy.map((n,i)=>n-start[i]);
 const [nx,ny,nz]=result.dimensions,labels=new Uint8Array(width*height);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const i=Math.round(start[0]+u[0]*x+v[0]*y),j=Math.round(start[1]+u[1]*x+v[1]*y),k=Math.round(start[2]+u[2]*x+v[2]*y);
  if(i>=0&&i<nx&&j>=0&&j<ny&&k>=0&&k<nz){const offset=(k*ny+j)*nx+i;labels[y*width+x]=result.corrections?.get(offset)??result.mask[offset];}
 }return labels;
}
export const anatomyVolumeError=(code:string)=>translate((Object.hasOwn(messages,`anatomy.${code}`)?`anatomy.${code}`:'anatomy.inference_failed') as MessageKey);

const terms:Record<string,[string,string]>={
 spleen:['Dalaq','Splen'],kidney:['Böyrək','Ren'],gallbladder:['Öd kisəsi','Vesica biliaris'],liver:['Qaraciyər','Hepar'],stomach:['Mədə','Gaster'],pancreas:['Mədəaltı vəzi','Pancreas'],adrenal_gland:['Böyrəküstü vəzi','Glandula suprarenalis'],
 lung:['Ağciyər','Pulmo'],lung_upper_lobe:['Ağciyərin yuxarı payı','Lobus superior pulmonis'],lung_lower_lobe:['Ağciyərin aşağı payı','Lobus inferior pulmonis'],lung_middle_lobe:['Ağciyərin orta payı','Lobus medius pulmonis'],
 esophagus:['Qida borusu','Oesophagus'],trachea:['Nəfəs borusu','Trachea'],thyroid_gland:['Qalxanabənzər vəzi','Glandula thyroidea'],small_bowel:['Nazik bağırsaq','Intestinum tenue'],duodenum:['Onikibarmaq bağırsaq','Duodenum'],colon:['Çənbər bağırsaq','Colon'],urinary_bladder:['Sidik kisəsi','Vesica urinaria'],prostate:['Prostat vəzi','Prostata'],
 sacrum:['Oma sümüyü','Os sacrum'],vertebrae:['Fəqərələr','Vertebrae'],intervertebral_discs:['Fəqərəarası disklər','Disci intervertebrales'],heart:['Ürək','Cor'],aorta:['Aorta','Aorta'],pulmonary_vein:['Ağciyər venaları','Venae pulmonales'],brachiocephalic_trunk:['Bazu-baş kötüyü','Truncus brachiocephalicus'],subclavian_artery:['Körpücükaltı arteriya','Arteria subclavia'],common_carotid_artery:['Ümumi yuxu arteriyası','Arteria carotis communis'],brachiocephalic_vein:['Bazu-baş venası','Vena brachiocephalica'],atrial_appendage:['Qulaqcıq seyvanı','Auricula atrii'],superior_vena_cava:['Yuxarı boş vena','Vena cava superior'],inferior_vena_cava:['Aşağı boş vena','Vena cava inferior'],portal_vein_and_splenic_vein:['Qapı venası və dalaq venası','Vena portae hepatis et vena splenica'],iliac_artery:['Qalça arteriyası','Arteria iliaca'],iliac_vena:['Qalça venası','Vena iliaca'],
 humerus:['Bazu sümüyü','Humerus'],scapula:['Kürək sümüyü','Scapula'],clavicula:['Körpücük sümüyü','Clavicula'],femur:['Bud sümüyü','Femur'],hip:['Çanaq sümüyü','Os coxae'],spinal_cord:['Onurğa beyni','Medulla spinalis'],gluteus_maximus:['Böyük sağrı əzələsi','Musculus gluteus maximus'],gluteus_medius:['Orta sağrı əzələsi','Musculus gluteus medius'],gluteus_minimus:['Kiçik sağrı əzələsi','Musculus gluteus minimus'],autochthon:['Kürəyin dərin əzələləri','Musculi dorsi profundi'],iliopsoas:['Qalça-bel əzələsi','Musculus iliopsoas'],brain:['Baş beyin','Encephalon'],skull:['Kəllə','Cranium'],sternum:['Döş sümüyü','Sternum'],costal_cartilages:['Qabırğa qığırdaqları','Cartilagines costales'],
};
export function volumeAnatomyName(key:string):[string,string]{
 const rib=key.match(/^rib_(left|right)_(\d+)$/);
 if(rib)return [`${rib[1]==='left'?'Sol':'Sağ'} · ${rib[2]}-ci qabırğa`,`Costa ${rib[2]}`];
 const vertebra=key.match(/^vertebrae_([CTLS])(\d+)$/);
 if(vertebra)return [`${({C:'Boyun',T:'Döş',L:'Bel',S:'Oma'} as Record<string,string>)[vertebra[1]]} fəqərəsi · ${vertebra[1]}${vertebra[2]}`,`Vertebra ${vertebra[1]}${vertebra[2]}`];
 const side=key.match(/_(left|right)$/),base=side?key.slice(0,-side[0].length):key;
 const term=terms[base];if(!term)return ['Adı dəstəklənməyən struktur',''];
 return [side?`${side[1]==='left'?'Sol':'Sağ'} · ${term[0]}`:term[0],side?`${term[1]} · ${side[1]==='left'?'latus sinistrum':'latus dextrum'}`:term[1]];
}
export async function volumeRequest<T>(url:string,options:RequestInit={}):Promise<T>{
 const response=await fetch('/anatomy-volume'+url,{...options,cache:'no-store'});
 const value=await response.json() as T&{error?:string};
 if(!response.ok||value.error)throw Error(anatomyVolumeError(value.error||''));return value;
}
