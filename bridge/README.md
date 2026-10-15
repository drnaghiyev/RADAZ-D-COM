# RADAZ yerli PACS körpüsü

IP, port və AE Title ilə PACS axtarışı DICOM C-FIND, görüntü endirmə isə C-GET və ya C-MOVE tələb edir. Saytın açıq olduğu **eyni Windows kompüterində** bu köməkçi proqramı başladın:

1. Yeni ZIP arxivini tam çıxarın. Kompüterdə Python **3.10 və ya daha yeni** versiya olmalıdır.
2. `start-radaz-pacs.cmd` faylını başladın. Lazım olan kitabxanalar ZIP-in içindədir; `pip`, quraşdırma və internet tələb olunmur. Köhnə `.venv` qovluğu artıq istifadə edilmir.
3. Konsolda `http://127.0.0.1:8765` yazısını gördükdən sonra RADAZ-da PACS serverini seçib **Axtar** düyməsini sıxın. Eyni portda köhnə körpü açıqdırsa, onu bağlayın.
4. Chrome bu sayta lokal şəbəkəyə giriş icazəsi istəsə, icazə verin. Proqramı istifadə etdiyiniz müddətdə konsolu açıq saxlayın.

PACS-də `RADAZ` çağıran AE Title-ına (və ya konfiqurasiyada seçdiyiniz ada), kompüterinizin IP-sinə, C-FIND və C-GET və ya C-MOVE sorğularına icazə verilməlidir. PACS-in IP, port və öz AE Title-ını RADAZ konfiqurasiyasına yazın. Seriyanı seçib **Arxivə endir və aç** düyməsinə basın.

Görüntü üçün körpü əvvəl C-GET sınayır. PACS yalnız C-MOVE dəstəkləyirsə, PACS konfiqurasiyasında **çağıran AE Title**, **bu kompüterin lokal şəbəkə IP-si** və RADAZ-dakı **listener port** (standart `11112`) qeyd olunmalıdır. Bu portun Windows firewall tərəfindən qəbul edildiyinə də əmin olun. Bəzi PACS sistemlərində bu ayar yalnız administrator tərəfindən edilir. Transferi az sayda seriya ilə sınayın; bir köçürmə 800 görüntü və 512 MB ilə məhdudlaşır.

Körpü idarəetmə sorğuları üçün yalnız `127.0.0.1` ünvanında dinləyir və yalnız RADAZ saytının sorğularını qəbul edir. C-MOVE zamanı kompüterinizdə müvəqqəti DICOM qəbul portu açır. Fayllar müvəqqəti saxlanılır, brauzerdəki lokal arxivə verilir və müvəqqəti nüsxələr silinir. DICOMweb ünvanı varsa, sayt onu ayrıca istifadə edə bilər.

Əl ilə başlatmaq üçün: `python -I -S radaz_pacs_bridge.py`. `--origin` seçimi yalnız lokal sınaq üçün nəzərdə tutulub.

## RADAZBRIDGE-ə müayinə göndərmək

RADAZ Desktop-da Local Arxiv və ya PACS-dən müayinəni seçib **RADAZBRIDGE-ə göndər** düyməsinə basın. Bir neçə müayinəni checkbox ilə seçmək olar; checkbox seçilməyibsə aktiv sətir göndərilir. Bu əməliyyat bütün müayinəyə aiddir.

Qəbul edən kompüterin lokal IP-sini, portunu (standart `11112`), Called AE (`RADAZBRIDGE`) və bu Viewer-in Calling AE adını (standart `RADAZ`) yazın. Bridge-in cihaz icazələrinə Viewer kompüterinin IP-si və həmin Calling AE əlavə olunmalıdır. **Bağlantını yoxla**, sonra **Göndər** düyməsini basın. Ünvan bu kompüterdə saxlanılır və hər iki pəncərədə istifadə olunur.

Fayllar DICOM C-STORE ilə ötürülür; say yalnız qəbul təsdiqindən sonra artır. Dayandırma əvvəl qəbul edilmiş faylları geri silmir. Şəbəkə təsdiqi itərsə avtomatik təkrar göndəriş edilmir. C-GET işləmirsə C-MOVE üçün Viewer-in qəbul AE/IP/port qeydiyyatı PACS-də olmalıdır; RADAZBRIDGE eyni kompüterdədirsə Viewer-in C-MOVE listener portu Bridge portundan fərqli olmalıdır.

Bu, buluda birbaşa göndəriş deyil. RADAZBRIDGE qəbul etdiyi faylları öz klinika/lisenziya ayarlarına uyğun sinxronizasiya edir. Mənbə DICOM faylları dəyişdirilmir.
