# Private DICOM Network — administrator üçün qısa bələdçi

## Noutbukda ilk açılış

1. Windows-da RADAZ-ı açın. Əsas pəncərədə **Ayarlar → DICOM Network ayarları** seçin. Bu pəncərədə bağlantını, cihazları, klinikaları, əməkdaşları, növbələri və avtomatik göndərməni idarə edə bilərsiniz. Gələn və gedən müayinələr üçün **Local Arxiv** düyməsinin yanındakı oxdan **DICOM Network** seçin.
2. **Bağlantı və qəbul ayarları** bölməsində **Bu noutbukda şəxsi şəbəkə yarat** formasına administratorun hesab ID-sini və adını yazın. **Yerli xidməti qur** düyməsini basın. Bu seçim yalnız həmin kompüterin özündə işləyən koordinator yaradır.
3. **Klinikalar və radioloqlar** bölməsində klinikanı yaradın və ayrıca klinika administratorunun hesab ID-sini göstərin. Super administrator klinika və cihazları idarə edir. Klinik görüntülərə baxış üçün ayrıca radioloq və ya baxış hesabı, təsdiqlənmiş cihaz və konkret göndəriş tələb olunur.
4. Administrator üçün birdəfəlik dəvət yaradın və onu birbaşa həmin şəxsə çatdırın. Dəvət 15 dəqiqə etibarlıdır. İstifadəçi öz Windows profilində koordinator ünvanını, dəvəti və cihaz adını daxil edir. Klinikalararası internet bağlantısı üçün aşağıdakı xarici xidmət tələb olunur.
5. Klinika administratoru siyahıya işçiləri əlavə edir və hər birinə bu klinikadakı işi üçün lazım olan icazələri verir. Arxivə endirəcək radioloqa **qəbul** və **endirmə**, operatora **göndərmə** icazəsi verin. Bir cihazı əlavə klinikaya bağlamaq üçün həmin hesab ID-sinə ikinci klinikanın dəvətindən istifadə edin.

Yenilənmədən sonra Desktop bağlantısını təsdiqləmək barədə bildiriş görsəniz, əvvəlcə açıq işinizi saxlayın. Windows-da saatın yanındakı RADAZ işarəsindən **Çıxış** seçin, sonra Başlat menyusundan **RADAZ** proqramını yenidən açın.

## Əməkdaş siyahısının idarə edilməsi

DICOM Network ayarlarını ilk dəfə açanda bu Windows istifadəçisi üçün şifrə təyin edin. Sonrakı açılışlarda şifrəni daxil edin. Ayarların kilidini açandan sonra onları yenidən kilidləyə və şifrəni dəyişə bilərsiniz. Klinikadakı rolunuz hansı əməliyyatlara icazəniz olduğunu müəyyən edir.

**Klinikalar və radioloqlar** bölməsində klinikanı seçin. Klinika administratoru **Yeni əməkdaş** düyməsi ilə şəxsə ayrıca hesab ID-si verir. Mövcud şəxsin sətrində **Düzəliş et** onun bu klinikadakı adını, rolunu və icazələrini dəyişməyə imkan verir. **Siyahıdan sil** düyməsi ilə adı yoxlayıb təsdiqlədikdə həmin şəxs klinikadan çıxarılır. Əvvəlki müayinələr və göndəriş tarixçəsi saxlanılır. Şəbəkə administratoru eyni bölmədə klinika administratorlarını idarə edir.

Ayrıca HTTPS koordinatorundan istifadə edirsinizsə, cihazlarla birlikdə həmin xidməti də 0.2.92-yə yeniləyin. Serverdə mövcud verilənlər bazası, sertifikat və xidmət ayarları ilə yenilənmiş koordinatoru başladın.

## Göndəriş, qəbul və növbə

Local Arxiv və ya PACS siyahısında müayinəni işarələyib **RADAZ-a göndər** seçin. Klinikanı və göndəriş rejimini yoxlayın. Fərdi çatdırılmalar **Göndərilənlər** bölməsində görünür. Qəbul edən **Mənə göndərilənlər** bölməsində göndərişi təsdiqləyir. Endirmə hüququ olduqda yoxlanmış orijinal DICOM faylları onun lokal arxivinə əlavə edilir. Yalnız baxış rejimində tələb olunan kadrın önbaxışı açılır.

**Növbə cədvəli** bölməsində klinikanın saat qurşağını, növbələri, tarix üzrə dəyişiklikləri və əvəzetmələri göstərin. Avtomatik yönləndirmə üçün klinikanın qaydasını aktiv edin və göndərən kompüterin qəbul ayarlarında **Bu cihazdan avtomatik göndəriş üçün klinika** sahəsini seçin. Qaydanı dayandırmaq və ya həmin cihazın avtomatik göndərişini söndürmək mümkündür. Modul aktiv edildikdən sonra daxil olan obyektləri izləyir. Müayinə üzrə yeni obyektlərin gəlməsi səngidikdən sonra gözləmə müddəti 60 saniyədir. Bu, cihazın verdiyi müayinənin yekunlaşması siqnalını əvəz etmir.

Qəbul edən offline olduqda növbə göndərən kompüterdə qalır. Hər iki tərəf sonradan qoşulduqda təsdiqlənmiş fayllar ötürülür. Koordinator göndərişin vəziyyətini və audit məlumatlarını bazada saxlayır. Şifrəli relay paketləri operativ yaddaşda ən çox beş dəqiqə qalır. Bir orijinal DICOM obyekti üçün hədd 160 MiB, relay yaddaşının ümumi həddi 384 MiB-dır.

## Ayrı klinikalardan internet bağlantısı

Ayrı şəbəkələrdən qoşulmaq üçün administrator həm göndərən, həm qəbul edən cihazın çata bildiyi, Windows-un etibar etdiyi TLS sertifikatlı HTTPS ünvanı təmin etməlidir. Sertifikat adı cihazlara verilən ünvanla uyğunlaşmalıdır. Koordinator verilənlər bazasını və serverin gizli açarını yalnız xidmət hesabının oxuya bildiyi qovluqda saxlayın. Qeydiyyat və transfer statusunun bərpası üçün metadata bazasının ehtiyat nüsxəsini saxlayın.

Koordinatorun ayrıca hostunda ilk dəfə aşağıdakı əmrləri tətbiq qovluğundan icra edin. Nümunə yollarını, hesab ID-sini və portu quraşdırmanıza uyğunlaşdırın. Birinci əmr super administrator üçün birdəfəlik dəvət verir. İkinci əmr HTTPS xidmətini başladır.

~~~powershell
python bridge/private_network_authority.py --db D:/RADAZ-Network/metadata.sqlite3 init --user network-admin --name "Şəbəkə administratoru"
python bridge/private_network_authority.py --db D:/RADAZ-Network/metadata.sqlite3 serve --bind 0.0.0.0 --port 8443 --cert D:/RADAZ-Network/fullchain.pem --key D:/RADAZ-Network/privkey.pem
~~~

Cihazlar bu xidmətin HTTPS ünvanına qeydiyyatdan keçir. Birbaşa bağlantı mümkün olmayanda şifrəli ötürmə koordinator vasitəsilə davam edir. Noutbukdakı lokal sınağın əhatəsi eyni maşında ayrıca arxiv və cihaz identifikatorlarıdır. Xarici klinika ilə işə başlamazdan əvvəl iki ayrı şəbəkədə sintetik müayinə üzrə göndəriş və qəbulu yoxlayın.
