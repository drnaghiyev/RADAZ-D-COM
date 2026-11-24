# RADAZ Viewer · Android planşet

Bu paket RADAZ-ın görüntüləyicisini, DICOM dekoderlərini və həcm rekonstruksiyası üçün işçi modullarını APK daxilində saxlayır. Android 8 və daha yeni sistemlərdə işləmək üçün hazırlanıb. Planşetdə aktual Android System WebView lazımdır.

## Planşetdə istifadə

1. Fayllar tətbiqində **Download → RADAZ-Tablet-0.2.97-1.apk → Yenilə → Aç** seçin. İlk quraşdırmada **Quraşdır** görünür.
   0.2.97-dən başlayaraq yenilənmə proqram açılanda və açıq qaldığı müddətdə yoxlanır. **Yenilə** paketi yükləyib Android quraşdırıcısını açır. Əl ilə yoxlamaq üçün **Yardım → Proqram yeniləmələri** seçin.
2. Əsas paneldə qovluq işarəsi Android-in qovluq seçicisini açır. Yanındakı oxdan DICOM fayllarını və ya ZIP/RAR arxivini seçə bilərsiniz.
3. Əsas görüntüdə seriyanı seçin. **MPR** və **3D** ayrıca görünüş açır. Android-in **Geri** əmri ilə əvvəlki görünüşə qayıdın.
4. Müayinəni sonradan açmaq üçün onu **Local arxiv** bölməsində idxal edin. Bu arxiv tətbiqin planşetdəki yaddaşında saxlanılır. Android tətbiqini silmək və ya onun məlumatlarını təmizləmək bu arxivi də silir.

5. Sağ panel standart olaraq iki sütun göstərir. **Yardım → Ayarlar → Alət paneli** bölməsində bir və ya iki sütun seçin. Qrupları əvvəlki kimi sağdakı tutacaqdan daşıya bilərsiniz.
6. **Yardım → Ayarlar → DICOM Network ayarları** bölməsini açın. İlk girişdə bu planşet üçün ayar şifrəsi yaradın. **RADAZ İnternet** bağlantısında cihaz ID-sini alın və göndərən klinikaya verin. Klinika dəvət edəndə həmin pəncərədə təsdiqləyin. İstifadə etdiyiniz klinikanı soldakı siyahıdan seçin. Öz HTTPS xidməti olan klinika üçün **Mövcud şəxsi şəbəkə** seçib ünvanı və birdəfəlik dəvət kodunu yazın.

7. Noutbukda **RADAZ-a göndər** pəncərəsində həkimi seçib **Göndər** düyməsinə basın. Planşet internetə qoşulub RADAZ açıq olanda həmin həkimə ünvanlanan müayinələr avtomatik olaraq **Local arxiv** bölməsinə yazılır. Göndəriş pəncərəsi qəbul edilmiş görüntülərin sayını göstərir. Bağlantı kəsilərsə, tətbiq növbəti bağlantıda qalan faylları qəbul edir.
8. Əvvəlki tarixli müayinəni tapmaq üçün arxivdə **Bu gün** filtrini söndürüb pasiyentin adını axtarın.

## İmzalı APK-nın yığılması

Windows-da JDK 21, Android SDK Platform 36, Build Tools 36.0.0, Git, Node.js və RADAZ build asılılıqları tələb olunur. Planşet interfeysi seçilmiş buraxılışın Git mənbəyindən yığılır.

```powershell
.\build.ps1 -ViewerSource '<RADAZ Git qovluğu>' -Jdk '<JDK qovluğu>'
```

Nəticə `out/RADAZ-Tablet-0.2.97-1.apk` faylıdır. İmzalama açarı `.local` qovluğunda saxlanılır. Mövcud quraşdırmanın üzərinə yenilənmə vermək üçün eyni açar lazımdır.

Buraxılış üçün mövcud imza qovluğunu `-SigningDirectory` ilə göstərin. Windows buraxılışı hazırlanarkən aşağıdakı əmrlə imzalı APK-nı və yeniləmə məlumatını həmin buraxılışın qaralamasına əlavə edin.

```powershell
python android/stage-release.py <tam-Git-commit>
```

Buraxılış yayımlandıqdan sonra `python android/stage-release.py <tam-Git-commit> --promote` planşetin istifadə etdiyi açıq ünvandan məlumatı və APK-nı yükləyib yoxlayır. Yaranan `android/release.json` faylını əsas budağa daxil edin. Planşet əsas ünvana çata bilməyəndə bu ehtiyat ünvandan son Android paketini tapır.
