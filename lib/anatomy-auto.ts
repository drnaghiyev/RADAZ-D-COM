/** The model's actual 60 groups; never substitute an individual atlas bone. */
export const autoAnatomyNames: Record<string,string> = {
 skull:'Kəllə', scapulae:'Kürək sümükləri', clavicles:'Körpücük sümükləri', humeri:'Bazu sümükləri',
 phalanges:'Əl barmaqlarının falanqaları', metacarpals:'Əl darağı sümükləri', carpals:'Bilək sümükləri (qrup)',
 radii:'Mil sümükləri', ulnae:'Dirsək sümükləri', tibiae:'Qamış sümükləri', femurs:'Bud sümükləri',
 patellae:'Diz qapaqları', fibulae:'İncik sümükləri', metatarsals:'Ayaq darağı sümükləri',
 tarsals:'Ayaq biləyi sümükləri (qrup)', toes:'Ayaq barmaqlarının falanqaları', sternum:'Döş sümüyü',
 hips:'Çanaq sümükləri', sacrum:'Oma sümüyü', kidneys:'Böyrəklər', liver:'Qaraciyər', spleen:'Dalaq', lungs:'Ağciyərlər', heart:'Ürək',
 ...Object.fromEntries(Array.from({length:12},(_,i)=>[`rib_${i+1}`,`${i+1}-ci qabırğalar`])),
 ...Object.fromEntries([['c',7,'Boyun'],['t',12,'Döş'],['l',5,'Bel']].flatMap(([level,count,name])=>Array.from({length:Number(count)},(_,i)=>[`vertebra_${level}${i+1}`,`${name} fəqərəsi · ${String(level).toUpperCase()}${i+1}`]))),
};
export const anatomyAutoError = (code: string) => ({
 local_only:'Tanıma yalnız proqramın quraşdırıldığı kompüterdə işləyir.',
 model_missing:'Lokal tanıma modeli quraşdırılmayıb.', busy:'Model başqa görüntünü işləyir. Bir qədər sonra yenidən klikləyin.',
 no_contrast:'Bu görüntüdə tanıma üçün yetərli kontrast yoxdur.', unsupported_image:'Bu sınaq yalnız adi DX/CR rentgen üçündür. KT, MRT, mammoqrafiya və dental görüntülər dəstəklənmir.',
 outside_image:'Görüntünün daxilində bir nöqtə seçin.', invalid_size:'Bu görüntünün ölçüsü dəstəklənmir (ən çox 16 milyon piksel).',
 model_checksum:'Model faylı yoxlamadan keçmədi. Lokal modulu yenidən quraşdırın.',
 timeout:'Tanıma vaxtı bitdi. Yenidən cəhd edin.',
}[code] || 'Anatomiya tanınmadı. Lokal model işləyə bilmədi.');

export type AnatomyPixels = {width:number;height:number;pixels:string;modality:string;photometric:string;bodyPart:string};

export async function requestAutoAnatomy(image:AnatomyPixels,x:number,y:number,signal:AbortSignal):Promise<string[]> {
 const response=await fetch('/anatomy-auto/recognize',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...image,x,y}),signal});
 const result=await response.json() as {error?:string;labels?:unknown};
 if(!response.ok||result.error)throw Error(anatomyAutoError(result.error||'inference_failed'));
 if(!Array.isArray(result.labels)||result.labels.some((id:unknown)=>typeof id!=='string'||!autoAnatomyNames[id]))throw Error(anatomyAutoError('invalid_output'));
 return result.labels;
}
