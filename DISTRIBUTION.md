# RADAZ — satıcı, ödəniş və buraxılış təlimatı

Bu sənəd proqramın sahibi üçündür. Alıcıya göndəriləcək quraşdırma qaydası [README.md](README.md)-dədir. Cari versiya 0.2.10-dur. Aylıq qiymət 10 AZN, seçim 1–120 aydır; ayrıca illik paket və avtomatik kartdan təkrar pul çəkmə yoxdur.

## Kapital Bank hesabları

Satıcı panelində **Kapital Bank / Birbank Biznes** seçin. AZN və USD üçün ayrı IBAN sahələri, bankın filial kodu, VÖEN-i, SWIFT və müxbir hesab saxlanılır. Bu sahələr yalnız satıcı kompüterindəki ayarlardır və müştəri paketinə daxil edilmir. USD hesabı verilməyibsə onu AZN hesabı ilə doldurmayın.

Kapital Bank üçün avtomatik ödəniş adapteri hələ qoşulmayıb. Bankın [API müraciət qaydası](https://api.birbank.business/how-to-use) ilə biznes/e-commerce müraciətini başlayın; istifadə olunacaq internet-ekvayrinq məhsulunun rəsmi sənədi, test merchant hesabı və webhook qaydaları alınmalıdır. Hesab çıxarışı/transfer API-si ayrıca məhsuldur və kart ödənişi checkout-u ilə eyni deyil. Açarlar alındıqdan sonra server inteqrasiyası və bankın test ssenariləri tamamlanmalıdır.

Mövcud avtomatik lisenziya checkout-u AZN qiymətləri ilə işləyir. USD IBAN-ın saxlanması USD checkout və ya valyuta çevirməsini aktiv etmir. Bank köçürməsinin əl ilə təsdiqi üçün əvvəlki `scripts/license-admin.mjs` aləti mövcuddur; bankdan vəsaitin daxil olduğu yoxlanmadan aktivləşdirmə açarı verilməməlidir.

Aşağıdakı Epoint bölmələri əvvəlki adapterin texniki sənədidir; Kapital Bank seçimində Epoint işə düşmür.

## Hazır olan və tamamlanmalı hissələr

Ay seçimi, məbləğin serverdə hesablanması, Epoint sorğusunun imzalanması, callback imzasının yoxlanması, ödənişdən sonra açar verilməsi və ilk aktivləşdirmədən müddətin hesablanması kodda hazırdır. Saxta callback, yanlış məbləğ, eyni əməliyyatın təkrarı və başqa kompüterdə aktivləşdirmə testlərlə yoxlanır.

Hazır satıcı hesabınız və API məlumatlarınız olmadığı üçün kart ödənişi hazırda açıq deyil. HTTPS domenli lisenziya serveri hələ yerləşdirilməyib. Həqiqi Epoint test ödənişi keçirilməyib. Sadəcə proqramı GitHub-a yükləmək bank ödənişini aktiv etmir.

## Yalnız sizin üçün ödəniş ayarları

Mənbə qovluğundakı **billing/OPEN-SELLER-SETTINGS.cmd** faylını açın. Node.js olan Windows kompüterində şəxsi satıcı paneli brauzerdə açılır. Bu panel alıcının proqram menyusunda yoxdur və müştəri ZIP-inə daxil edilmir.

Paneldə bu sahələr var:

| Sahə | Nə daxil edilir | Harada istifadə olunur |
|---|---|---|
| Satıcı / şirkət adı | Sizin təsdiqlənmiş biznes adınız | Şəxsi satıcı qeydi |
| VÖEN | 10 rəqəmli vergi identifikatoru | Şəxsi satıcı qeydi |
| Vəsaiti alanın adı | Bank hesabının sahibi | Şəxsi satıcı qeydi |
| Bankın adı, IBAN | Biznes bank rekvizitləri | Şəxsi satıcı qeydi |
| Dəstək e-poçtu | Müştərinin sizinlə əlaqə ünvanı | Şəxsi satıcı qeydi; müştəri əlaqəsi ayrıca product.json-dadır |
| HTTPS domeni | Sizin lisenziya serverinizin domeni | Callback, ödənişdən qayıdış |
| Epoint API ünvanı | Epoint-in sizə verdiyi ödəniş yaratma endpoint-i | Bank ödənişi yaratmaq |
| Public key | Epoint satıcı identifikatoru | Epoint sorğusu |
| Private key | Epoint-in verdiyi gizli API açarı | Sorğu və callback imzaları |

**IBAN yazmaq pulun köçürüləcəyi hesabı avtomatik dəyişmir.** Vəsaitin yönələcəyi bank hesabı Epoint satıcı kabinetində və provayderlə razılaşmada təsdiqlənir. Paneldəki bank sahələri sizin şəxsi qeydinizdir. Kart nömrəsi, CVV, bank parolu və SMS kodu bu panelə daxil edilmir.

Ayarlar standart olaraq `%USERPROFILE%\Documents\RADAZ-License-Admin\merchant.json` faylında saxlanır. Sizin kompüterinizdə bu, `C:\Users\drnag\Documents\RADAZ-License-Admin\merchant.json` yoludur. Qovluğu dəyişmək üçün `RADAZ_OWNER_DIR` istifadə edilir. Bu qovluq GitHub deposundan kənardadır; `merchant.json` və private key adları ayrıca gitignore ilə də qorunur.

Panel yalnız `127.0.0.1` üzərində açılır. Hər işə salınmada yeni təsadüfi giriş tokeni verilir; panel linkini paylaşmayın. Xarici origin sorğuları rədd olunur. Saxlanmış private key API cavabında qaytarılmır; sahəni boş saxlayanda əvvəlki açar qorunur. Silmək üçün ayrıca checkbox var. Windows hesabınıza/administrator hüquqlarına çıxışı olan şəxs faylları oxuya bilər; ayrıca Windows hesabı və təhlükəsiz ehtiyat nüsxə saxlayın. Bu paneli reverse proxy ilə internetə açmayın.

## Epoint hesabını necə qoşursunuz?

1. [Epoint](https://epoint.az/az) üzərindən satıcı müraciətini özünüz tamamlayın. Provayder tələb olunan biznes sənədlərini, bank hesabını və müqaviləni yoxlayır. Komissiya və köçürmə vaxtını onların müqaviləsindən dəqiqləşdirin; RADAZ bu şərtləri müəyyən etmir.
2. Merchant public/private açarlarını götürün. API ünvanı `https://epoint.az/api/1/request` olaraq əvvəlcədən doldurulur: Epoint sənədlərində keçid verilən PHP SDK-nın [EpointClient](https://github.com/rafoabbas/epoint-php/blob/main/src/EpointClient.php) və [PaymentRequest](https://github.com/rafoabbas/epoint-php/blob/main/src/Requests/PaymentRequest.php) mənbələrində yoxlanılıb. Merchant hesabınız üçün Epoint başqa endpoint verərsə onu istifadə edin.
3. HTTPS domenli server ayırın. Epoint lokal kompüterinizdəki `localhost` ünvanına callback göndərə bilməz. GitHub Pages bu Node/SQLite xidmətini işlətdiyi server deyil.
4. Satıcı panelinə məlumatları yazın. Panelin göstərdiyi `https://SIZIN-DOMEN/v1/webhooks/provider` ünvanını Epoint-də **result URL**, `/payment/return` ünvanını success/error URL kimi qeyd edin.
5. Sınaq məlumatları ilə ödəniş, yanlış məbləğ, uğursuz ödəniş, təkrar callback və açarın verilməsi yoxlanmalıdır. Sonra istehsal merchant məlumatlarına keçin.

[Epoint-in rəsmi başlanğıc qaydası](https://developer.epoint.az/az) merchant qeydiyyatı, açarlar və yönləndirmə/callback axınını təsvir edir. [Callback sənədi](https://developer.epoint.az/en/callbacks) imza yoxlamasını izah edir. `billing/epoint.mjs` bu protokola əsaslanır; bank kartı məlumatı RADAZ serverindən keçmir.

## Lisenziya serveri

Hazır domen və server olmadıqda [Render quraşdırma təlimatını](billing/RENDER-SETUP.md) istifadə edin. Depoya hazır `render.yaml` əlavə edilib. Bu konfiqurasiya avtomatik HTTPS ünvanı və 1 GB daimi disk verir. Ödəniş ilkin olaraq bağlıdır; Epoint və mövcud lisenziya imza açarı qoşulandan sonra açılır.

Bu xidmət alıcıların kompüterində deyil, sizin nəzarətinizdəki daimi serverdə işləyir. Serverdə Node.js 22.13+ olmalıdır. Mənbədəki `billing` qovluğu lazımdır; əlavə Node paketi tələb olunmur. SQLite Node-un daxili moduludur.

Mövcud `issuer-private.pem` və ona uyğun `public/license-public.json` cütünü qoruyun. Hər buraxılış üçün yeni imza açarı yaratmayın. Yalnız ilk quraşdırmada açar ümumiyyətlə yoxdursa `node scripts/license-admin.mjs init` işlədilir. Mövcud açarı başqa təsadüfi açarla əvəz etmək əvvəlki müştərilərin aktivləşdirməsini poza bilər.

Serverdə təhlükəsiz qovluğa `merchant.json` və mövcud `issuer-private.pem` köçürülür. Bunları GitHub-a yükləməyin. Dəyərləri server mühitinə uyğun təyin edin:

```text
RADAZ_OWNER_DIR=/private/radaz-owner
RADAZ_BILLING_DATA=/private/radaz-owner/billing-data
RADAZ_ISSUER_PRIVATE_KEY=/private/radaz-owner/issuer-private.pem
PORT=8790
```

`node billing/server.mjs` başladılır. Xidmət yalnız `127.0.0.1:8790` dinləyir. Qarşısında etibarlı HTTPS reverse proxy qurun, prosesin server açıldıqda başlamasını təmin edin. Reverse proxy `X-Real-IP` sahəsini mütləq özü yazırsa `RADAZ_TRUST_PROXY=1` verə bilərsiniz; əks halda bu dəyişəni açmayın. İnternetə yalnız billing serverinin portuna gedən HTTPS xidmətini çıxarın, satıcı panelini və RADAZ arxivini çıxarmayın.

`merchant.json` dəyişdikdən sonra yalnız billing xidmətini yenidən başlatmaq lazımdır. Bazanın ehtiyat nüsxəsini SQLite backup üsulu ilə və ya xidməti dayandıraraq alın; işləyən bazanın tək `.sqlite` faylını WAL-dan ayırıb köçürməyin. Baza ilk aktivləşdirmə tarixini saxlayır, itməsi satış tarixçəsini də itirə bilər.

Müştəri paketində `public/product.json` faylının `billingUrl` dəyərinə həmin HTTPS domenini yazın, sonra build və ZIP-i yenidən hazırlayın. Burada yalnız açıq xidmət ünvanı olur; bank hesabı və gizli açarlar olmur. Lokal server əvəzinə internetdəki server işlək olmasa, alıcı ödəniş və ilk aktivləşdirmə edə bilməz.

## Ödənişdən sonra açar alıcıya necə çatır?

1. Alıcı RADAZ-da Yardım → Aylıq ödəniş bölməsində ayı seçir. Məsələn, 3 ay = 30 AZN.
2. RADAZ sizin billing serverinizdə sifariş yaradır; qiymət serverdə hesablanır.
3. Brauzerdə Epoint/bank ödəniş səhifəsi açılır. Alıcı kart məlumatlarını orada daxil edir.
4. Epoint imzalı nəticəni sizin serverə göndərir. Server imzanı, sifariş ID-sini, əvvəl yaradılmış transaction ID-ni və məbləği yoxlayır. Sadəcə “ödəniş uğurludur” səhifəsinin açılması açar vermir.
5. Ödənilmiş sifariş üçün `RADAZ-ACT-…` açarı yaradılır. RADAZ hər 5 saniyədə nəticəni soruşur və **Lisenziya ödənişi** bölməsində açarı göstərir.
6. Alıcı açarı kopyalaya və **Açarı TXT faylı kimi saxla** ilə ehtiyat nüsxə ala bilər. “Bu açarı aktivləşdirməyə hazırla”, sonra “Aktivləşdir” düyməsini basır.
7. İlk uğurlu aktivləşdirmədə müddət başlayır. Məsələn, 3 aylıq açar 5 oktyabrda alınıb 12 oktyabrda aktivləşdirilsə, müddət 12 oktyabrdan hesablanır. Təkrar açar daxil etmək müddəti sıfırlamır; bir açar bir kompüterə bağlanır.

Açar avtomatik e-poçt/SMS ilə göndərilmir; bu funksiya qoşulmayıb. Açardan əvvəl RADAZ-ı bağlasa belə, həmin kompüterin sifariş məlumatı saxlanır. Yenidən eyni bölməni açdıqda serverdən açar alınır. Yerli sifariş faylı və TXT açar birlikdə itərsə, sifariş nömrəsi və ödəniş sübutu ilə sizə müraciət etməlidir; bazada sifarişi yoxlamaq lazımdır. Ödəniş qəbzi təkbaşına avtomatik aktivləşdirmə deyil.

Ödənişə baxmayaraq açar görünmürsə, ikinci dəfə pul ödəməzdən əvvəl sifariş ID-sini, Epoint əməliyyat statusunu və callback bağlantısını yoxlayın. Geri qaytarma, chargeback və artıq aktiv offline açarın dərhal ləğvi bu versiyada avtomatlaşdırılmayıb. Yenilənmə ayrıca alışdır; yeni açarı vaxtından əvvəl aktivləşdirmək əvvəlki müddətin qalan günlərini avtomatik birləşdirmir.

## Alıcıya hansı GitHub linki verilir?

Mənbə kodu və quraşdırıcılar üçün əsas depo: [RADAZ-D-COM](https://github.com/drnaghiyev/RADAZ-D-COM). `public/product.json` daxilində `updateRepository` yenilənmə ünvanıdır; `repository` köhnə quraşdırmalarla uyğun məhsul kimliyini saxlayır. Desktop updater yalnız sabit `UPDATE_REPOSITORY` ünvanından SHA-256 yoxlanmış paket qəbul edir.

0.2.27-dən başlayaraq yeni yenilənmələr əsas repodan alınır. 0.2.10–0.2.26 versiyalarında köhnə repo ünvanı proqramın daxilində sabitdir; həmin quraşdırmaların Setup olmadan keçidi üçün köhnə ünvanda keçid buraxılışı saxlanmalıdır. Əks halda yeni Setup-ı bir dəfə açmaq tələb olunur; lokal arxiv versiya qovluqlarından ayrıdır.

Buraxılış əvvəl draft kimi yaradılır, Setup, tam Windows-x64 paketi və SHA-256 faylları yüklənib yoxlanır, sonra Latest kimi yayımlanır. Draft və pre-release avtomatik yenilənmədə görünmür. Artıq yayımlanmış versiyanın faylları dəyişdirilmir.

Alıcıya relizin **Assets** bölməsindəki `RADAZ-0.2.27-Setup.exe` verilir. **Code → Download ZIP** və **Source code (zip)** quraşdırma paketləri deyil. Keçid: [son buraxılış](https://github.com/drnaghiyev/RADAZ-D-COM/releases/latest).

Setup ilə quraşdırılmış RADAZ-da **Yardım (?) → Yeniləmələri yoxla → Yenilə** endirmə və quraşdırmanı başladır. Real progressbar və tamamlanma mesajı görünür. Müayinə davam edir; yeni versiya növbəti açılışda sağlamlıq yoxlamasından sonra aktivləşir. Arxiv mövcud `Documents\RADAZ-Archive` qovluğunda qalır. Portable ZIP istifadəçiləri Setup keçidini açır.

## Paket hazırlamaq və yoxlamaq

### GitHub ilə avtomatik buraxılış

`.github/workflows/windows-release.yml` hər `main` göndərişində `public/product.json` versiyasını yoxlayır. Bu versiya artıq yayımlanıbsa paket yenidən yazılmır. Yeni buraxılış üçün versiyanı artırın, `releases/X.Y.Z.md` qeydlərini hazırlayın və dəyişiklikləri `main` qoluna göndərin. İstəyə görə Actions → Publish RADAZ Windows release → Run workflow ilə təkrar yoxlama başlatmaq olar.

Windows işçisi asılılıqları kilid faylı ilə quraşdırır, TypeScript/Node/Python yoxlamalarını keçir və paketi yığır. Ayrı yayım işi uzaqdakı fayl cəmlərini təsdiqləyib sonra Latest Release kimi yayımlayır. Yayım işi eyni repoya yazmaq üçün `contents: write` icazəli `github.token` istifadə edir; başqa hesabın tokeni lazım deyil. Lokal yayımda credential helper-dən alınmış token yalnız proses yaddaşında saxlanır. Token müştəri paketinə daxil edilmir.

Digər kompüterlər proqram açıldıqdan təxminən 15 saniyə sonra, daha sonra hər 6 saatda GitHub Release yoxlayır. Dərhal yoxlama üçün **Yardım (?) → Yeniləmələri yoxla** istifadə edin. Bildiriş üçün yeni versiyanın uğurla yayımlanması və kompüterin internetə çıxışı lazımdır.

```powershell
node node_modules/typescript/bin/tsc --noEmit --incremental false
node --test tests/*.test.mjs
python -m unittest discover -s tests -p '*_test.py'
python scripts/package-chatgpt.py
corepack pnpm build
python scripts/package-release.py
```

Paket `outputs/releases` içində yaranır. İmza public açarı və `billingUrl` düzgün olmalıdır. `licenseRequired=true` saxlanır. Paketdə satıcı paneli, billing bazası, gizli açar, merchant rekvizitləri və pasiyent arxivi olmamalıdır. Ayrı təmiz Windows kompüterində setup/start, ödənişin sınaq axını, aktivləşdirmə və müddət bitməsini yoxlamadan satışa hazır hesab etməyin.

Setup.exe bütün runtime-ları daxil edir və offline quraşdırılır; Authenticode imzası yoxdur. Portable preview ZIP ayrıca asılılıq quraşdırılması üçündür. İstifadəçinin tam idarə etdiyi lokal proqramda lisenziya nəzarəti dəyişdirilməyə qarşı mütləq DRM təmin etmir.


## 30 günlük demo və sahib kompüteri

0.2.18 paketində `licenseRequired=true`, `trialDays=30` saxlanır. Demo ilk istifadədən 30 × 24 saatdır; bütün lisenziyalı funksiyalar bu vaxt açıqdır. Demo bitdikdə əvvəlki PACS/arxiv və yalnız listələmə qaydası tətbiq edilir. Yeniləmə, brauzer keşini silmək və adi yenidən quraşdırma demo müddətini sıfırlamır.

Windows-da demo qeydi `%LOCALAPPDATA%/RADAZ/Licensing` və `HKCU/Software/RADAZ/Licensing` içində saxlanır, DPAPI ilə həmin Windows istifadəçisinə bağlanır. Qeyd MachineGuid əsasında alınan kompüter kodunu daşıyır. Bir nüsxə itərsə qalan qeyddən ilkin tarix bərpa olunur; korlanmış qeyd və saatın geriyə çəkilməsi yeni demo yaratmır. Offline demo yerli administratorun müdaxiləsinə, yeni Windows profilinə və əməliyyat sisteminin tam yenidən qurulmasına qarşı mütləq müdafiə deyil; bu səviyyədə nəzarət üçün internetdə cihaz qeydiyyatı xidməti lazımdır.

Satıcının öz kompüteri üçün `scripts/license-admin.mjs owner --customer "Ad Soyad" --device KOMPÜTER_KODU --out ŞƏXSİ_QOVLUQ/owner-activation.txt` ayrıca imzalı, bir cihaza bağlı sahib açarı verir. Mövcud private açar müştərinin public açarı ilə uyğun olmalıdır. Bu açar yalnız sahib kompüterində aktivləşdirilir; alıcı ZIP-inə daxil edilmir. Köhnə işləyən xidmətlə uyğunluq üçün imzalı açarda aylıq format və 9999-cu il bitmə tarixi saxlanır, yeni interfeys bunu müddətsiz sahib lisenziyası kimi göstərir. Bu, ümumi hazırlama rejimini açmır.

Sahibin aktivləşdirmə faylı, `Documents/RADAZ-Archive/product/license.json`, demo qeydləri və `Documents/RADAZ-License-Admin` qovluğu GitHub-a və müştəri paketinə daxil edilməməlidir.


0.2.18 sahib paneli və yeni ödəniş təhlükəsizliyi qaydaları üçün [billing/README.md](billing/README.md) əsas götürülür. Parol yaradıldıqda əvvəlki açıq mətn merchant və issuer faylları şifrələnmiş owner-vault.json yaddaşına köçürülür. Sahib paneli müştəri buraxılışına daxil edilmir.


## AI asistentin API açarı

**Yardım → AI ayarları** bölməsində istifadəçi öz OpenAI API açarını saxlayır. `Documents/RADAZ-Archive/product/openai-key.dpapi` Windows DPAPI ilə həmin hesaba bağlı şifrələnir; başqa hesaba/kompüterə köçürəndə açar yenidən daxil edilməlidir. Açar brauzer yaddaşına və API cavabına daxil edilmir; mühitdəki OPENAI_API_KEY avtomatik götürülmür. Paketdə bu fayl yoxdur. Server və development proxy yalnız eyni kompüterdən, eyni origin-dən AI sorğularını qəbul edir.

Açarın saxlanması şəbəkəyə sorğu göndərmir. **Bağlantını yoxla** modelə giriş yoxlamasıdır. Hesabat düyməsi seçilmiş görüntüləri 8-lik qruplarla Responses API-yə göndərir (`store: false`); DICOM teqləri göndərilmir, lakin pikselə yazılmış şəxsi məlumatlar qala bilər. Proqram görüntüləri diaqnostik cəhətdən təsdiqləmir; nəticə radioloqun yoxlaması üçün layihədir. Tamamlanmayan cavab hesabatı dəyişmir. Dayandırma gələcək qrupları dayandırır; artıq OpenAI-a çatan sorğunun hesablanmasını geri almır.
