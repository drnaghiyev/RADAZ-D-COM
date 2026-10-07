# RADAZ

Azərbaycan dilində DICOM görüntüləmə və radiologiya iş sahəsi — Windows 10/11, 64 bit.

[**Son Setup-ı endir**](https://github.com/cesur9872-droid/RADAZ-Releases/releases/latest) · [Buraxılışlar](https://github.com/cesur9872-droid/RADAZ-Releases/releases)

## Quraşdırma

1. Son buraxılışın **Assets** bölməsindən **RADAZ-0.2.22-Setup.exe** endirin.
2. Setup-ı açıb quraşdırın. Node.js, Python və lazım olan komponentlər paketə daxildir.
3. İş masasındakı **RADAZ** qısayolunu açın. Proqram lokal brauzer pəncərəsində işləyir.

Setup Windows-a daxil olanda serveri, Local arxivi və RADAZ pəncərəsini avtomatik başladır. Windows-un Startup bölməsindən bunu söndürmək olar. CD/DVD görüntüləri əvvəlcə Local arxivə saxlanılır və Viewer həmin nüsxədən oxuyur. DICOM, qovluq, ZIP və RAR fayllarını Viewer və ya Local arxiv üzərinə sürükləyib import etmək olar.

Əlavə proqramlaşdırma mühiti tələb olunmur. **Source code (zip)** quraşdırıcı deyil. Alternativ **Windows-x64.zip** tam oflayn paketdir; **Windows-preview.zip** isə texniki istifadə üçündür və ayrıca runtime tələb edir.

## 30 günlük demo

Standart olaraq ilk istifadədən **30 gün** bütün funksiyalar açıqdır; sahib imzalı ayarla demo müddətini dəyişə bilər. Demo üçün kart və açar lazım deyil. Əvvəlki 7 günlük demo yeni versiyada **ilk açılış tarixindən 30 günə** uzanır; yenidən quraşdırmaq tarixi sıfırlamır. Qalan vaxt **Yardım → Lisenziya** bölməsində görünür.

Aylıq lisenziya: **10 AZN**. Demo bitdikdə arxiv və PACS əlçatan qalır, Viewer-in qabaqcıl alətləri üçün lisenziya tələb olunur. Saxlanmış müayinələr silinmir. Onlayn ödəniş xidməti qoşulmayıbsa, aktivləşdirmə üçün məhsul sahibi ilə əlaqə saxlayın.

## Proqramı yeniləmək

**Yardım → Yeniləmələri yoxla → Yenilə → Proqramı yenidən aç**.

Yeni versiya mövcud olduqda bildiriş göstərilir. Yoxlama və yenilənmə pəncərəsinin açılması endirməni başlatmır. “Yenilə” bir kliklə paketi endirir, yoxlayır və hazırlayır; gediş progressbar-da görünür. Hazır olduqda pəncərə açıq qalır və “Proqramı yenidən aç” düyməsi görünür. Bu düymə yenilənməni tətbiq edib RADAZ-ı yenidən başladır; ayrıca Setup endirmək lazım deyil.

**Digər kompüterdə 0.2.9 qalırsa:** həmin versiyanın köhnə yenilənmə ünvanı artıq əlçatan deyil. Son Setup-ı o kompüterdə **bir dəfə** açın. Sonrakı yenilənmələr yeni açıq kanaldan görünəcək.

Arxiv proqramın versiya qovluqlarından ayrıdır. Standart yer `Documents\RADAZ-Archive`-dır; dəyişdirilmiş arxiv yolu yenilənərkən saxlanılır.

## İş axını

- **Local arxiv və PACS:** müayinələri checkbox ilə seçin və iki kliklə açın. Mövcud Viewer önə gətirilir və maksimum ölçüdə açılır; arxiv/PACS pəncərələri minimallaşmır.
- **CD/DVD:** DICOM faylları ardıcıl köçürülüb daimi Local arxivə yazılır; hər hazır görüntü eyni vaxtda Viewer-də görünür. Başqa müayinə açıldıqda import arxa planda davam edir və aktiv görüntünü dəyişmir. Piksellər lokal diskdən oxunur. CD çıxarılanda yalnız müvəqqəti köçürmə nüsxəsi silinir; arxiv və açıq görüntülər saxlanılır. Təkrar import eyni SOP faylını çoxaltmır.
- **Ölçmələr:** xəttin üzərindən tutub daşıyın. Oxun uclarından tutub istiqamətini və uzunluğunu dəyişin. Ox üzərində iki klik və ya sağ klik menyusu şərhi dəyişir. Sağ klik → **Sil**, **Ctrl+D** → cari kəsitdə hamısını sil.
- **2D mouse:** sol düymə WW/WL, orta düymə daşıma, sağ düyməni sürükləmə zoom, təkər kəsitləri dəyişir. WW/WL yalnız aktiv görüntüdə dəyişir; hər kəsit və panel öz ayarını saxlayır. Seçilmiş alət sol düymənin davranışını dəyişir.
- **Hesabat:** Viewer siyahısında seçilmiş seriya açılır. Hesabat redaktoru, Word/PDF çıxışı və seçilmiş görüntülərin ZIP hazırlanması mövcuddur.
- **Çap önbaxışı:** **Tək / Hamısı** seçimi ilə zoom, parlaqlıq və kontrastı dəyişin.

## MPR və 3D

MPR və 3D ayrıca iş sahəsində açılır. DICOM-un fiziki koordinatları, istiqaməti və piksel aralığı istifadə olunur. CT üçün RescaleSlope və RescaleIntercept tətbiq edilərək HU ilə render edilir. Eyni seriyanın dekodlanmış pikselləri iş sahələri arasında paylaşılır.

3D presetləri: **Bone, Angio, Soft Tissue, Lung, Airway, Skin, Transparent, MIP, MinIP**; MRT üçün ayrıca siqnal preseti.

**Ayarlar** ikonunda HU keçid eni, optik məsafə, gradient, səth normalı, interpolyasiya, ətraf/diffuz işıq, parlaqlıq, işıq gücü, yumşaq kölgə, həcm daxilində işıq səpilməsi və render addımı var. **Performance / Balanced / High / Ultra / Auto** profillərindən Balanced standartdır. Ağır kölgələr zəif GPU-da məhdudlaşdırılır.

| 3D mouse əməliyyatı | Nəticə |
| --- | --- |
| Sol düymə | Fırlatma; ayarlarda HU/şəffaflıq rejimi də seçilə bilər |
| Shift + sol | Üfüqi: HU həddi; şaquli: şəffaflıq |
| Ctrl + sol | HU keçid enini dəyiş |
| Orta düymə | Daşıma |
| Sağ düymə / təkər | Zoom |

Sürükləmə zamanı render yüngülləşir, buraxıldıqda final keyfiyyət bərpa olunur. GPU-ya sığmayan həcm bütün mənbə kəsitlərindən istifadə edilməklə kiçildilir və bu barədə məlumat göstərilir. Qalın və ya aralıqlı CT kəsitlərindən incə rekonstruksiya detalını yaratmaq mümkün deyil; belə seriyalarda pillələnmə qala bilər.

Render ayarları [Kitware cinematic volume rendering](https://www.kitware.com/cinematic-volume-rendering/) və [vtk.js VolumeProperty sənədləri](https://kitware.github.io/vtk-js/api/Rendering_Core_VolumeProperty.html) əsasında təşkil olunub. Bunlar tənzimlənən görüntüləmə presetləridir; klinik protokol və cihaz kalibrasiyasını əvəz etmir.

## Dəstək

Məhsul sahibi: **Radioloq Rövşən Nağıyev** · [E-poçt](mailto:drnaghiyev@gmail.com)

Xəta bildirərkən RADAZ versiyasını, Windows versiyasını və xəta mətnini qeyd edin. Açıq GitHub yazışmasına pasiyentin DICOM fayllarını və şəxsi məlumatlarını əlavə etməyin.

İlkin sınaq buraxılışıdır. Bütün hüquqlar məhsul sahibinə məxsusdur. Üçüncü tərəf komponentləri öz lisenziyalarına tabedir. Açıq RADAZ-Releases deposu quraşdırıcılar və yenilənmə faylları üçündür.

## Sahib idarəetməsi və ödənişlər

Şəxsi sahib paneli müştəri Setup-ına daxil deyil. Bank hesabları parolla şifrələnir; AZN/USD qiymət, Mərkəzi Bank məzənnəsi, demo və modul qiymətləri idarə olunur. 0.2.18+ imzalı ümumi ayarları avtomatik qəbul edir. Provayder hələ seçilmədiyi üçün canlı ödəniş bağlıdır. Provayder qoşulduqdan sonra təsdiqlənmiş ödəniş alınmış lisenziyanı və ya modulu avtomatik aktivləşdirir.

Yenilənmə endirildikdən sonra **Proqramı yenidən aç** düyməsi görünür. Köhnə hazırlanmış paket daha yeni versiyanı gizlətmir.
