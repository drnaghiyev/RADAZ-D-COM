# RADAZ Viewer · Android planşet

Bu şəxsi sınaq paketi RADAZ 0.2.94-ün görüntüləyicisini, DICOM dekoderlərini və həcm rekonstruksiyası üçün işçi modullarını APK daxilində saxlayır. Android 8 və daha yeni sistemlərdə işləmək üçün hazırlanıb. Planşetdə aktual Android System WebView lazımdır.

## Planşetdə istifadə

1. Fayllar tətbiqində **Download → RADAZ-Tablet-0.2.94-4.apk → Yenilə → Aç** seçin. İlk quraşdırmada **Quraşdır** görünür.
2. Əsas paneldə qovluq işarəsi Android-in qovluq seçicisini açır. Yanındakı oxdan DICOM fayllarını və ya ZIP/RAR arxivini seçə bilərsiniz.
3. Əsas görüntüdə seriyanı seçin. **MPR** və **3D** ayrıca görünüş açır. Android-in **Geri** əmri ilə əvvəlki görünüşə qayıdın.
4. Müayinəni sonradan açmaq üçün onu **Local arxiv** bölməsində idxal edin. Bu arxiv tətbiqin planşetdəki yaddaşında saxlanılır. Android tətbiqini silmək və ya onun məlumatlarını təmizləmək bu arxivi də silir.

5. Sağ panel standart olaraq iki sütun göstərir. **Yardım → Ayarlar → Alət paneli** bölməsində bir və ya iki sütun seçin. Qrupları əvvəlki kimi sağdakı tutacaqdan daşıya bilərsiniz.
6. **Yardım → Ayarlar → DICOM Network ayarları** bölməsini açın. İlk girişdə bu planşet üçün ayar şifrəsi yaradın. **RADAZ İnternet** bağlantısında cihaz ID-sini alın və göndərən klinikaya verin. Klinika dəvət edəndə həmin pəncərədə təsdiqləyin. İstifadə etdiyiniz klinikanı soldakı siyahıdan seçin. Öz HTTPS xidməti olan klinika üçün **Mövcud şəxsi şəbəkə** seçib ünvanı və birdəfəlik dəvət kodunu yazın.

7. Noutbukda **RADAZ-a göndər** pəncərəsində həkimi seçib **Göndər** düyməsinə basın. Planşet internetə qoşulub RADAZ açıq olanda həmin həkimə ünvanlanan müayinələr avtomatik olaraq **Local arxiv** bölməsinə yazılır. Göndəriş pəncərəsi qəbul edilmiş görüntülərin sayını göstərir. Bağlantı kəsilərsə, tətbiq növbəti bağlantıda qalan faylları qəbul edir.
8. Əvvəlki tarixli müayinəni tapmaq üçün arxivdə **Bu gün** filtrini söndürüb pasiyentin adını axtarın.

## Şəxsi APK-nın yenidən yığılması

Windows-da JDK 21, Android SDK Platform 36, Build Tools 36.0.0, Git, Node.js və RADAZ build asılılıqları tələb olunur. Planşet interfeysi 0.2.94 mənbəyinin ayrıca nüsxəsində yığılır.

```powershell
.\build.ps1 -ViewerRoot '<RADAZ 0.2.94 qovluğu>' -ViewerSource '<RADAZ Git qovluğu>' -Jdk '<JDK qovluğu>'
```

Nəticə `out/RADAZ-Tablet-0.2.94-4.apk` faylıdır. İmzalama açarı `.local` qovluğunda saxlanılır. Mövcud quraşdırmanın üzərinə yenilənmə vermək üçün eyni açar lazımdır.
