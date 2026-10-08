# RADAZ sahib paneli və ödəniş xidməti

Sahib paneli `OPEN-SELLER-SETTINGS.cmd` ilə açılır. Müştəri Setup-ında bu səhifə və onun serveri yoxdur. Panel yalnız `127.0.0.1` üzərində işləyir; giriş üçün launcher-in təsadüfi açarı və sahib parolu lazımdır. İlk açılışda ən azı 12 simvolluq parol seçin. Parol 15 dəqiqə fəaliyyətsizlikdən sonra yenidən tələb olunur. Kilidlə düyməsi hesab məlumatlarını səhifədən təmizləyir.

Hesablar və mövcud issuer açarı `Documents/RADAZ-License-Admin/owner-vault.json` daxilində scrypt (N=131072, r=8, p=1) və AES-256-GCM ilə qorunur. İlk parol yaradıldıqda köhnə `merchant.json` və `issuer-private.pem` şifrələnmiş yaddaşa köçürülür, açıq mətn nüsxələri silinir. Windows qovluq icazələri cari istifadəçi və SYSTEM ilə məhdudlaşdırılır. Şifrələnmiş faylın ehtiyat nüsxəsini və parolu ayrı təhlükəsiz yerlərdə saxlayın. Parol itərsə məlumat bərpa edilmir. Açıq sessiyaya və ya Windows administratoruna malik şəxsə qarşı mütləq müdafiə iddia edilmir; iş bitdikdə paneli kilidləyin.

## Qiymət, məzənnə və demo

AZN və USD qiymət sahələri bir-birini hesablayır. Axırıncı dəyişdirilmiş sahə əsas valyutadır. Məzənnə Azərbaycan Mərkəzi Bankının tarixli XML mənbəyindən alınır; mənbə tarixi göstərilir. Şəbəkə xətası əvvəlki məzənnəni silmir. Çevrilən ödəniş üçün 7 gündən köhnə məzənnə qəbul edilmir. Bankın faktiki məzənnəsi və komissiyası fərqli ola bilər.

Demo 0–365 gün arasında dəyişdirilir; 0 demo rejimini söndürür. Günlər ilk istifadədən hesablanır, yenidən quraşdırma ilə başlanğıc yenilənmir. Standart 30 gündür.

Yadda saxla yalnız şifrələnmiş yerli ayarları dəyişir. **Qiymət və demo ayarlarını yayımla** düyməsi sahibin RSA açarı ilə imzalanmış ümumi konfiqurasiyanı `drnaghiyev/RADAZ-D-COM` reposunun `commerce.json` faylına yazır. GitHub hesabı bu kompüterdə Git Credential Manager ilə qoşulmalıdır. Faylda yalnız qiymət, məzənnə, demo, modullar və ictimai ödəniş serverinin ünvanı var. Bank rekvizitləri və sirrlər göndərilmir. RADAZ 0.2.18+ və billing serveri imzanı və artan revision-u yoxlayır, ən gec 15 dəqiqəlik yoxlamada qəbul edir. İnternet yoxdursa son təsdiqlənmiş ayarlar saxlanır. İmzalı ayar faylını ayrıca endirmək də mümkündür.

## Əlavə ödənişli modul

Sabit modul kodu, görünən adı və aylıq qiyməti daxil edin. Hazır olmayan modulu Satışda seçməyin. Modulun qiyməti əsas valyutadadır. Mövcud lisenziyalı funksiyalar özbaşına ayrıca ödənişə keçirilməyib.

Checkout modul kodunu və istənən valyutanı qəbul edir, məbləği serverdə hesablayır və sifarişə yazır. Sonrakı qiymət dəyişikliyi əvvəlki sifarişin məbləğini dəyişmir. İmzalı callback sifariş ID-si, əməliyyat ID-si, məbləğ və valyutanı uyğunlaşdırmadan kod verilmir. Ayrı modul üçün verilmiş açar yalnız həmin modulun `moduleId` icazəsini daşıyır və əsas lisenziyanı əvəz etmir. İlk aktivləşdirmə cihaz və başlanğıc tarixini bağlayır; təkrar callback/aktivləşdirmə müddəti uzatmır.

Yeni modulun backend əməliyyatında `ProductService.module_allowed(id)` yoxlaması, React görünüşündə `useModuleLicense(id)` istifadə edilməlidir. Təkcə düyməni gizlətmək təhlükəsizlik yoxlaması deyil.

## Canlı ödənişin qoşulması

Bank / provayder hələ seçilməyib. Hesab və HTTPS ödəniş linkini saxlamaq mümkündür, amma sadə link avtomatik aktivləşdirmə yaratmır. Bunun üçün sifarişə bağlanan məbləğ/valyuta və provayderin imzalı webhook-u lazımdır. Kart PIN/CVV və internet-bank parolu saxlanmır.

Mövcud Epoint adapteri AZN checkout və imzalı callback yoxlamasını dəstəkləyir. USD bazalı qiymət AZN-ə çevrilə bilər; faktiki USD ödənişi üçün USD dəstəkləyən provayder adapteri lazımdır. Yeni adapter `currencies`, `createCheckout` və `verifyWebhook` interfeyslərini təmin etməlidir. İmzasız və ya brauzerin uğur URL-inə əsaslanan təsdiq qəbul edilmir.

Server: Node.js 22.13+, `node billing/server.mjs`, HTTPS reverse proxy, `RADAZ_BIND`, `PORT`, `RADAZ_BILLING_DATA`. Hostingdə açarlar platformanın secret store-unda `RADAZ_ISSUER_PRIVATE_KEY_PEM`, `EPOINT_PUBLIC_KEY`, `EPOINT_PRIVATE_KEY`, `RADAZ_PUBLIC_BASE_URL`, `RADAZ_PAYMENTS_ENABLED` vasitəsilə verilir. Yerli şifrələnmiş yaddaş istifadə edilirsə `RADAZ_OWNER_PASSWORD` təhlükəsiz mühitdə verilməlidir. Parolu əmr sətrinə yazmayın. Köhnə license-admin CLI da şifrələnmiş yaddaşı bu dəyişənlə aça bilir və yeni imza açarı yaratmır.

Provayder açarları dəyişəndə server yenidən başladılır; yayımlanmış qiymətlər avtomatik yenilənir. Müştəri ödəniş təsdiqini izləyir və alınmış kodu avtomatik həmin kompüterdə aktivləşdirir. Şəbəkə xətasında kod əl ilə yenidən aktivləşdirilə bilər. Canlı merchant hesabı və HTTPS serveri qoşulmadan real ödəniş sınağı keçmiş sayılmır.

Mənbələr: [Mərkəzi Bank məzənnələri](https://www.cbar.az/currency/rates?language=az), [OWASP parol yaddaşı](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html), [Epoint callback](https://developer.epoint.az/en/callbacks).
