import profile from '../bridge/radiology-profile.json' with {type:'json'};
export function chatgptPrompt({imageCount,seriesCount,modality,windowMode,clinical}:{imageCount:number;seriesCount:number;modality:string;windowMode:string;clinical:string}){
 const keys=[...new Set(modality.split(/[,/\s]+/).map(m=>['CR','DX','XA','RF','MG'].includes(m)?'XR':m))];
 const rules=keys.map(m=>profile.modalities[m as keyof typeof profile.modalities]||'').filter(Boolean).join('\n');
 return `${profile.core}\n${rules}\n\nDərindən, tək-tək analiz et və rapor yaz. Azərbaycan dilində radioloqun yoxlaması üçün radioloji hesabat LAYİHƏSİ hazırla.
Yalnız əlavə edilmiş RADAZ-ChatGPT.zip arxivindən istifadə et. ZIP-də ${imageCount} JPEG görüntüsü və manifest.json var. Arxivi aç, manifest.json sırasına uyğun olaraq HƏR BİR görüntüyə ayrıca bax, seriyalar daxilində və seriyalar arasında müqayisə et. Tək bir görüntü və ya önbaxış əsasında bütün müayinə haqqında nəticə çıxarma.
Modalitet: ${modality}; pəncərə: ${windowMode}; ${seriesCount} seriya. Bunlar yalnız Viewer-dən hesabata ötürülmüş və seçilmiş görüntülərdir.
Əvvəlcə faktiki açıb baxdığın faylların adlarını və sayını, sonra hər görüntü üzrə müşahidələrini bildir. Heç bir görüntü faktiki əlçatan deyilsə, yalnız qısa texniki xəta bildir; görüntüsüz radioloji hesabat bölmələri yaratma. Açılmayan və baxılmayan faylları ayrıca qeyd et, onları analiz edilmiş kimi göstərmə.
Klinik məlumat / sual: ${clinical.trim()||'Təqdim edilməyib.'}
Bütün əlçatan görüntüləri nəzərdən keçirdikdən sonra raporu bu strukturla yaz: müayinənin adı, təqdim edilmiş texnika, anatomik nahiyələr üzrə abzaslar, Nəticə, əsaslandırılmış tövsiyələr və məhdudiyyətlər. Təsvir başlığı və standart abzaslardan əvvəl markerlər yazma. JPEG-lərdən HU və mm ölçüləri hesablama. Görünməyən patologiyanı, normal nəticəni və etibarlı miqyas olmadan ölçüləri uydurma. Nəticə radioloq tərəfindən yoxlanmalıdır.`;
}
