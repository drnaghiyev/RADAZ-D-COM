import { anatomyBones, anatomyRegions, anatomySearchKey, type AnatomyBone } from './anatomy-atlas';
import { anatomyPlates } from './anatomy-plates';

export type AnatomyKind = 'organ' | 'muscle' | 'vessel' | 'nerve' | 'bone' | 'other';
export type AnatomyStructure = AnatomyBone & { system: string; kind: AnatomyKind; paired: boolean; plate: string };
export const anatomySystems = [
  {id:'cardiovascular',name:'Ürək və damarlar'}, {id:'respiratory',name:'Tənəffüs'},
  {id:'digestive',name:'Həzm'}, {id:'urinary',name:'Sidik'},
  {id:'reproductive',name:'Reproduktiv'}, {id:'endocrine',name:'Endokrin'},
  {id:'nervous',name:'Sinir'}, {id:'lymphatic',name:'Limfa və immun'},
  {id:'sensory',name:'Hiss orqanları'}, {id:'integument',name:'Dəri və əlavələri'},
  {id:'muscular',name:'Əzələlər'}, {id:'skeletal',name:'Skelet və oynaqlar'},
];
export const anatomyKinds: {id:AnatomyKind;name:string}[] = [
  {id:'organ',name:'Orqanlar'}, {id:'muscle',name:'Əzələlər'}, {id:'vessel',name:'Damarlar'},
  {id:'nerve',name:'Sinirlər'}, {id:'bone',name:'Sümüklər'}, {id:'other',name:'Digər strukturlar'},
];
export const catalogueRegions = [
  ...anatomyRegions.map(r=>r.id==='skull'?{...r,name:'Baş və üz'}:r),
  {id:'neck',name:'Boyun'}, {id:'abdomen',name:'Qarın'}, {id:'whole',name:'Bədən üzrə'},
];
const unpairedBones = new Set(['frontal','occipital','sphenoid','ethmoid','mandible','vomer','hyoid','sternum']);
const entries: AnatomyStructure[] = anatomyBones.map(b=>({...b,system:'skeletal',kind:'bone',
  paired:b.region!=='spine'&&!unpairedBones.has(b.id),plate:b.region==='hand'?'hand':b.region==='foot'?'foot':'skeleton'}));

// Each row is an independently curated anatomical name, not a detection class.
// A region is a navigation aid; structures that span regions use their principal region.
function add(system:string,kind:AnatomyKind,region:string,plate:string,paired:boolean,rows:string) {
  for(const row of rows.trim().split('\n')) {
    const [id,az,latin,aliases] = row.trim().split('|');
    entries.push({id,az,latin,aliases,system,kind,region,plate,paired});
  }
}
add('cardiovascular','organ','thorax','heart',false,`
heart|Ürək|Cor|heart
atrium-right|Sağ qulaqcıq|Atrium dextrum|right atrium
atrium-left|Sol qulaqcıq|Atrium sinistrum|left atrium
ventricle-right|Sağ mədəcik|Ventriculus dexter|right ventricle
ventricle-left|Sol mədəcik|Ventriculus sinister|left ventricle
valve-tricuspid|Üçtaylı qapaq|Valva tricuspidalis|tricuspid
valve-mitral|Mitral qapaq|Valva mitralis|bicuspid
valve-aortic|Aorta qapağı|Valva aortae|aortic valve
valve-pulmonary|Ağciyər kötüyünün qapağı|Valva trunci pulmonalis|pulmonary valve
septum-ventricular|Mədəciklərarası çəpər|Septum interventriculare
septum-atrial|Qulaqcıqlararası çəpər|Septum interatriale
myocardium|Ürək əzələsi|Myocardium
endocardium|Endokard|Endocardium
pericardium|Ürək kisəsi|Pericardium
`);
add('cardiovascular','vessel','thorax','vessels',false,`
aorta|Aorta|Aorta
aorta-ascending|Qalxan aorta|Aorta ascendens
aorta-arch|Aorta qövsü|Arcus aortae
aorta-thoracic|Döş aortası|Aorta thoracica
vena-cava-superior|Yuxarı boş vena|Vena cava superior|SVC
vena-cava-inferior|Aşağı boş vena|Vena cava inferior|IVC
pulmonary-trunk|Ağciyər kötüyü|Truncus pulmonalis
brachiocephalic-trunk|Bazu-baş kötüyü|Truncus brachiocephalicus
coronary-right|Sağ tac arteriyası|Arteria coronaria dextra
coronary-left|Sol tac arteriyası|Arteria coronaria sinistra
coronary-lad|Ön mədəciklərarası şaxə|Ramus interventricularis anterior|LAD
coronary-circumflex|Dolanan şaxə|Ramus circumflexus|LCx
coronary-sinus|Tac cib|Sinus coronarius
azygos|Tək vena|Vena azygos
hemiazygos|Yarımtək vena|Vena hemiazygos
`);
add('cardiovascular','vessel','thorax','vessels',true,`
pulmonary-artery|Ağciyər arteriyası|Arteria pulmonalis
pulmonary-veins|Ağciyər venaları|Venae pulmonales
brachiocephalic-vein|Bazu-baş venası|Vena brachiocephalica
internal-thoracic-artery|Daxili döş arteriyası|Arteria thoracica interna
`);
add('cardiovascular','vessel','neck','vessels',true,`
carotid-common|Ümumi yuxu arteriyası|Arteria carotis communis|common carotid
carotid-internal|Daxili yuxu arteriyası|Arteria carotis interna
carotid-external|Xarici yuxu arteriyası|Arteria carotis externa
vertebral-artery|Fəqərə arteriyası|Arteria vertebralis
jugular-internal|Daxili vidaci vena|Vena jugularis interna|jugular
jugular-external|Xarici vidaci vena|Vena jugularis externa
`);
add('cardiovascular','vessel','skull','vessels',true,`
cerebral-anterior|Ön beyin arteriyası|Arteria cerebri anterior|ACA
cerebral-middle|Orta beyin arteriyası|Arteria cerebri media|MCA
cerebral-posterior|Arxa beyin arteriyası|Arteria cerebri posterior|PCA
`);
add('cardiovascular','vessel','skull','vessels',false,`
basilar-artery|Bazilyar arteriya|Arteria basilaris
cerebral-circle|Beynin arterial dairəsi|Circulus arteriosus cerebri|Willis
sagittal-sinus|Yuxarı sagittal sinus|Sinus sagittalis superior
`);
add('cardiovascular','vessel','arm','vessels',true,`
subclavian-artery|Körpücükaltı arteriya|Arteria subclavia
axillary-artery|Qoltuqaltı arteriya|Arteria axillaris
brachial-artery|Bazu arteriyası|Arteria brachialis
radial-artery|Mil arteriyası|Arteria radialis
ulnar-artery|Dirsək arteriyası|Arteria ulnaris
subclavian-vein|Körpücükaltı vena|Vena subclavia
axillary-vein|Qoltuqaltı vena|Vena axillaris
cephalic-vein|Baş vena|Vena cephalica
basilic-vein|Əsas vena|Vena basilica
median-cubital-vein|Dirsəyin orta venası|Vena mediana cubiti
`);
add('cardiovascular','vessel','abdomen','vessels',false,`
aorta-abdominal|Qarın aortası|Aorta abdominalis
celiac-trunk|Qarın kötüyü|Truncus coeliacus|celiac
mesenteric-superior|Yuxarı müsariqə arteriyası|Arteria mesenterica superior|SMA
mesenteric-inferior|Aşağı müsariqə arteriyası|Arteria mesenterica inferior|IMA
hepatic-artery|Ümumi qaraciyər arteriyası|Arteria hepatica communis
splenic-artery|Dalaq arteriyası|Arteria splenica
gastric-left|Sol mədə arteriyası|Arteria gastrica sinistra
portal-vein|Qapı venası|Vena portae hepatis|portal
hepatic-veins|Qaraciyər venaları|Venae hepaticae
splenic-vein|Dalaq venası|Vena splenica
mesenteric-superior-vein|Yuxarı müsariqə venası|Vena mesenterica superior
`);
add('cardiovascular','vessel','abdomen','vessels',true,`
renal-artery|Böyrək arteriyası|Arteria renalis
renal-vein|Böyrək venası|Vena renalis
`);
add('cardiovascular','vessel','pelvis','vessels',true,`
iliac-common-artery|Ümumi qalça arteriyası|Arteria iliaca communis
iliac-internal-artery|Daxili qalça arteriyası|Arteria iliaca interna
iliac-external-artery|Xarici qalça arteriyası|Arteria iliaca externa
iliac-common-vein|Ümumi qalça venası|Vena iliaca communis
`);
add('cardiovascular','vessel','leg','vessels',true,`
femoral-artery|Bud arteriyası|Arteria femoralis
deep-femoral-artery|Budun dərin arteriyası|Arteria profunda femoris
popliteal-artery|Dizaltı arteriya|Arteria poplitea
tibial-anterior-artery|Ön qamış arteriyası|Arteria tibialis anterior
tibial-posterior-artery|Arxa qamış arteriyası|Arteria tibialis posterior
fibular-artery|İncik arteriyası|Arteria fibularis|peroneal
femoral-vein|Bud venası|Vena femoralis
popliteal-vein|Dizaltı vena|Vena poplitea
saphenous-great|Böyük dərialtı vena|Vena saphena magna
saphenous-small|Kiçik dərialtı vena|Vena saphena parva
`);
add('cardiovascular','vessel','foot','vessels',true,`dorsalis-pedis|Ayağın arxa arteriyası|Arteria dorsalis pedis`);

add('respiratory','organ','skull','respiratory',false,`
nose|Burun|Nasus
nasal-cavity|Burun boşluğu|Cavitas nasi
nasal-septum|Burun çəpəri|Septum nasi
`);
add('respiratory','organ','skull','respiratory',true,`
sinus-maxillary|Əng cibi|Sinus maxillaris
sinus-frontal|Alın cibi|Sinus frontalis
sinus-sphenoid|Pazabənzər cib|Sinus sphenoidalis
ethmoidal-cells|Xəlbir hüceyrələri|Cellulae ethmoidales
`);
add('respiratory','organ','neck','respiratory',false,`
larynx|Qırtlaq|Larynx
epiglottis|Qırtlaq qapağı|Epiglottis
trachea|Nəfəs borusu|Trachea
vocal-folds|Səs büküşləri|Plicae vocales
`);
add('respiratory','organ','thorax','respiratory',false,`
lung-right|Sağ ağciyər|Pulmo dexter
lung-left|Sol ağciyər|Pulmo sinister
lung-right-upper|Sağ ağciyərin yuxarı payı|Lobus superior pulmonis dextri
lung-right-middle|Sağ ağciyərin orta payı|Lobus medius pulmonis dextri
lung-right-lower|Sağ ağciyərin aşağı payı|Lobus inferior pulmonis dextri
lung-left-upper|Sol ağciyərin yuxarı payı|Lobus superior pulmonis sinistri
lung-left-lower|Sol ağciyərin aşağı payı|Lobus inferior pulmonis sinistri
lingula|Sol ağciyərin dilciyi|Lingula pulmonis sinistri
bronchus-right|Sağ baş bronx|Bronchus principalis dexter
bronchus-left|Sol baş bronx|Bronchus principalis sinister
`);
add('respiratory','organ','thorax','respiratory',true,`
bronchioles|Bronxiollar|Bronchioli
alveoli|Ağciyər alveolları|Alveoli pulmonis
pleura|Plevra|Pleura
lung-hilum|Ağciyər qapısı|Hilum pulmonis
`);
add('digestive','organ','skull','digestive',false,`
mouth|Ağız boşluğu|Cavitas oris
tongue|Dil|Lingua
palate-hard|Sərt damaq|Palatum durum
palate-soft|Yumşaq damaq|Palatum molle
teeth|Dişlər|Dentes
`);
add('digestive','organ','skull','digestive',true,`
parotid|Qulaqaltı vəzi|Glandula parotidea
submandibular|Çənəaltı vəzi|Glandula submandibularis
sublingual|Dilaltı vəzi|Glandula sublingualis
`);
add('digestive','organ','neck','digestive',false,`pharynx|Udlaq|Pharynx`);
add('digestive','organ','thorax','digestive',false,`esophagus|Qida borusu|Oesophagus|esophagus`);
add('digestive','organ','abdomen','digestive',false,`
liver|Qaraciyər|Hepar|liver
liver-right-lobe|Qaraciyərin sağ payı|Lobus hepatis dexter
liver-left-lobe|Qaraciyərin sol payı|Lobus hepatis sinister
gallbladder|Öd kisəsi|Vesica biliaris|cholecyst gall bladder
cystic-duct|Öd kisəsi axacağı|Ductus cysticus
common-hepatic-duct|Ümumi qaraciyər axacağı|Ductus hepaticus communis
common-bile-duct|Ümumi öd axacağı|Ductus choledochus|CBD
stomach|Mədə|Gaster|ventriculus stomach
stomach-fundus|Mədənin dibi|Fundus gastricus
stomach-body|Mədənin cismi|Corpus gastricum
pylorus|Mədə qapısı|Pylorus
pancreas|Mədəaltı vəzi|Pancreas
pancreas-head|Mədəaltı vəzinin başı|Caput pancreatis
pancreas-body|Mədəaltı vəzinin cismi|Corpus pancreatis
pancreas-tail|Mədəaltı vəzinin quyruğu|Cauda pancreatis
pancreatic-duct|Mədəaltı vəzi axacağı|Ductus pancreaticus|Wirsung
small-intestine|Nazik bağırsaq|Intestinum tenue
duodenum|Onikibarmaq bağırsaq|Duodenum
jejunum|Acı bağırsaq|Jejunum
ileum|Qalça bağırsağı|Ileum
large-intestine|Yoğun bağırsaq|Intestinum crassum
cecum|Kor bağırsaq|Caecum|cecum
appendix|Soxulcanabənzər çıxıntı|Appendix vermiformis|appendiks
colon-ascending|Qalxan çənbər bağırsaq|Colon ascendens
colon-transverse|Köndələn çənbər bağırsaq|Colon transversum
colon-descending|Enən çənbər bağırsaq|Colon descendens
colon-sigmoid|S-əbənzər çənbər bağırsaq|Colon sigmoideum
peritoneum|Periton|Peritoneum
mesentery|Müsariqə|Mesenterium
omentum-greater|Böyük piylik|Omentum majus
`);
add('digestive','organ','pelvis','digestive',false,`
rectum|Düz bağırsaq|Rectum
anal-canal|Anal kanal|Canalis analis
anus|Anus|Anus
`);
add('urinary','organ','abdomen','urinary',true,`
kidney|Böyrək|Ren|kidney nephros
renal-cortex|Böyrəyin qabıq maddəsi|Cortex renalis
renal-medulla|Böyrəyin beyin maddəsi|Medulla renalis
renal-pelvis|Böyrək ləyəni|Pelvis renalis
renal-calyces|Böyrək kasacıqları|Calices renales
renal-pyramids|Böyrək piramidaları|Pyramides renales
ureter|Sidik axarı|Ureter
`);
add('urinary','organ','pelvis','urinary',false,`
bladder|Sidik kisəsi|Vesica urinaria|bladder
bladder-trigone|Sidik kisəsi üçbucağı|Trigonum vesicae
urethra|Sidik kanalı|Urethra
`);
add('reproductive','organ','pelvis','female-reproductive',false,`
uterus|Uşaqlıq|Uterus
uterus-fundus|Uşaqlığın dibi|Fundus uteri
uterus-body|Uşaqlığın cismi|Corpus uteri
cervix|Uşaqlıq boynu|Cervix uteri
endometrium|Endometrium|Endometrium
myometrium|Miometrium|Myometrium
vagina|Uşaqlıq yolu|Vagina
vulva|Vulva|Pudendum femininum
clitoris|Klitor|Clitoris
placenta|Cift|Placenta
`);
add('reproductive','organ','pelvis','female-reproductive',true,`
ovary|Yumurtalıq|Ovarium|ovary
uterine-tube|Uşaqlıq borusu|Tuba uterina|fallopian tube
bartholin-gland|Böyük dəhliz vəzisi|Glandula vestibularis major|Bartholin
`);
add('reproductive','organ','thorax','organs',true,`mammary-gland|Süd vəzisi|Glandula mammaria|breast`);
add('reproductive','organ','pelvis','male-reproductive',false,`
prostate|Prostat vəzi|Prostata
penis|Penis|Penis
glans-penis|Penisin başı|Glans penis
scrotum|Xaya kisəsi|Scrotum
`);
add('reproductive','organ','pelvis','male-reproductive',true,`
testis|Xaya|Testis
epididymis|Xaya artımı|Epididymis
vas-deferens|Toxumdaşıyıcı axacaq|Ductus deferens|vas deferens
seminal-vesicle|Toxum qovuqcuğu|Glandula vesiculosa|seminal vesicle
ejaculatory-duct|Toxumçıxarıcı axacaq|Ductus ejaculatorius
bulbourethral-gland|Soğanaq-sidik kanalı vəzisi|Glandula bulbourethralis|Cowper
`);
add('endocrine','organ','skull','endocrine',false,`
pituitary|Hipofiz|Hypophysis|pituitary
pineal|Epifiz|Glandula pinealis|pineal
hypothalamus|Hipotalamus|Hypothalamus
`);
add('endocrine','organ','neck','endocrine',false,`thyroid|Qalxanabənzər vəzi|Glandula thyroidea|thyroid`);
add('endocrine','organ','neck','endocrine',true,`parathyroid|Qalxanabənzərətraf vəzi|Glandula parathyroidea|parathyroid`);
add('endocrine','organ','abdomen','endocrine',true,`
adrenal|Böyrəküstü vəzi|Glandula suprarenalis|adrenal
adrenal-cortex|Böyrəküstü vəzinin qabıq maddəsi|Cortex glandulae suprarenalis
adrenal-medulla|Böyrəküstü vəzinin beyin maddəsi|Medulla glandulae suprarenalis
`);
add('endocrine','organ','abdomen','endocrine',false,`pancreatic-islets|Mədəaltı vəzi adacıqları|Insulae pancreaticae|Langerhans`);

add('nervous','organ','skull','nerves',false,`
brain|Baş beyin|Encephalon|brain
cerebrum|Böyük beyin|Cerebrum
cerebellum|Beyincik|Cerebellum
brainstem|Beyin kötüyü|Truncus encephali
midbrain|Orta beyin|Mesencephalon
pons|Körpü|Pons
medulla-oblongata|Uzunsov beyin|Medulla oblongata
corpus-callosum|Döyənək cisim|Corpus callosum
ventricle-third|Üçüncü mədəcik|Ventriculus tertius
ventricle-fourth|Dördüncü mədəcik|Ventriculus quartus
dura|Sərt beyin qişası|Dura mater
arachnoid|Hörümçəyəbənzər beyin qişası|Arachnoidea mater
pia|Yumşaq beyin qişası|Pia mater
`);
add('nervous','organ','skull','nerves',true,`
brain-frontal-lobe|Beynin alın payı|Lobus frontalis
brain-parietal-lobe|Beynin təpə payı|Lobus parietalis
brain-temporal-lobe|Beynin gicgah payı|Lobus temporalis
brain-occipital-lobe|Beynin ənsə payı|Lobus occipitalis
insula|Ada payı|Insula
thalamus|Talamus|Thalamus
hippocampus|Hippokamp|Hippocampus
amygdala|Badamabənzər cisim|Corpus amygdaloideum
caudate-nucleus|Quyruqlu nüvə|Nucleus caudatus
putamen|Qabıq|Putamen
globus-pallidus|Solğun kürə|Globus pallidus
ventricle-lateral|Yan mədəcik|Ventriculus lateralis
`);
add('nervous','organ','spine','nerves',false,`
spinal-cord|Onurğa beyni|Medulla spinalis
conus-medullaris|Beyin konusu|Conus medullaris
cauda-equina|At quyruğu|Cauda equina
`);
add('nervous','nerve','skull','nerves',true,`
cn-1|I — Qoxu siniri|Nervus olfactorius|olfactory
cn-2|II — Görmə siniri|Nervus opticus|optic
cn-3|III — Gözün hərəki siniri|Nervus oculomotorius
cn-4|IV — Blok siniri|Nervus trochlearis
cn-5|V — Üçlü sinir|Nervus trigeminus|trigeminal
cn-6|VI — Uzaqlaşdırıcı sinir|Nervus abducens
cn-7|VII — Üz siniri|Nervus facialis|facial
cn-8|VIII — Dəhliz-ilbiz siniri|Nervus vestibulocochlearis
cn-9|IX — Dil-udlaq siniri|Nervus glossopharyngeus
cn-10|X — Azan sinir|Nervus vagus|vagus
cn-11|XI — Əlavə sinir|Nervus accessorius
cn-12|XII — Dilaltı sinir|Nervus hypoglossus
`);
add('nervous','nerve','neck','nerves',true,`
cervical-plexus|Boyun kələfi|Plexus cervicalis
phrenic-nerve|Diafraqma siniri|Nervus phrenicus
`);
add('nervous','nerve','arm','nerves',true,`
brachial-plexus|Bazu kələfi|Plexus brachialis
axillary-nerve|Qoltuq siniri|Nervus axillaris
musculocutaneous-nerve|Əzələ-dəri siniri|Nervus musculocutaneus
radial-nerve|Mil siniri|Nervus radialis
median-nerve|Orta sinir|Nervus medianus
ulnar-nerve|Dirsək siniri|Nervus ulnaris
`);
add('nervous','nerve','thorax','nerves',true,`intercostal-nerves|Qabırğaarası sinirlər|Nervi intercostales`);
add('nervous','nerve','abdomen','nerves',true,`lumbar-plexus|Bel kələfi|Plexus lumbalis`);
add('nervous','nerve','pelvis','nerves',true,`
sacral-plexus|Oma kələfi|Plexus sacralis
pudendal-nerve|Cinsiyyət siniri|Nervus pudendus
obturator-nerve|Qapayıcı sinir|Nervus obturatorius
`);
add('nervous','nerve','leg','nerves',true,`
sciatic-nerve|Oturaq siniri|Nervus ischiadicus|sciatic siyatik
femoral-nerve|Bud siniri|Nervus femoralis
tibial-nerve|Qamış siniri|Nervus tibialis
fibular-common-nerve|Ümumi incik siniri|Nervus fibularis communis|peroneal
fibular-deep-nerve|Dərin incik siniri|Nervus fibularis profundus
fibular-superficial-nerve|Səthi incik siniri|Nervus fibularis superficialis
saphenous-nerve|Dərialtı sinir|Nervus saphenus
sural-nerve|Baldır siniri|Nervus suralis
`);
add('lymphatic','organ','abdomen','lymphatic',false,`spleen|Dalaq|Splen|lien spleen`);
add('lymphatic','organ','thorax','lymphatic',false,`thymus|Çəngələbənzər vəzi|Thymus`);
add('lymphatic','organ','skull','lymphatic',true,`tonsil-palatine|Damaq badamcığı|Tonsilla palatina`);
add('lymphatic','organ','skull','lymphatic',false,`tonsil-pharyngeal|Udlaq badamcığı|Tonsilla pharyngealis|adenoid`);
add('lymphatic','organ','whole','lymphatic',false,`bone-marrow|Sümük iliyi|Medulla ossium`);
add('lymphatic','other','neck','lymphatic',true,`nodes-cervical|Boyun limfa düyünləri|Nodi lymphoidei cervicales`);
add('lymphatic','other','arm','lymphatic',true,`nodes-axillary|Qoltuqaltı limfa düyünləri|Nodi lymphoidei axillares`);
add('lymphatic','other','pelvis','lymphatic',true,`nodes-inguinal|Qasıq limfa düyünləri|Nodi lymphoidei inguinales`);
add('lymphatic','other','abdomen','lymphatic',false,`nodes-mesenteric|Müsariqə limfa düyünləri|Nodi lymphoidei mesenterici`);
add('lymphatic','vessel','thorax','lymphatic',false,`
thoracic-duct|Döş axacağı|Ductus thoracicus
right-lymphatic-duct|Sağ limfa axacağı|Ductus lymphaticus dexter
`);
add('sensory','organ','skull','eye',true,`
eye|Göz alması|Bulbus oculi|eye
cornea|Buynuz qişa|Cornea
sclera|Ağlı qişa|Sclera
iris|Qüzehli qişa|Iris
pupil|Bəbək|Pupilla
lens|Büllur|Lens
retina|Torlu qişa|Retina
choroid|Damarlı qişa|Choroidea
ciliary-body|Kirpikli cisim|Corpus ciliare
vitreous|Şüşəyəbənzər cisim|Corpus vitreum
lacrimal-gland|Gözyaşı vəzisi|Glandula lacrimalis
conjunctiva|Konyunktiva|Tunica conjunctiva
eyelids|Göz qapaqları|Palpebrae
`);
add('sensory','organ','skull','ear',true,`
ear|Qulaq|Auris
auricle|Qulaq seyvanı|Auricula
ear-canal|Xarici qulaq keçəcəyi|Meatus acusticus externus
tympanic-membrane|Təbil pərdəsi|Membrana tympanica
middle-ear|Təbil boşluğu|Cavitas tympani
auditory-tube|Eşitmə borusu|Tuba auditiva|Eustachian
cochlea|İlbiz|Cochlea
vestibule|Daxili qulağın dəhlizi|Vestibulum labyrinthi
semicircular-canals|Yarımdairəvi kanallar|Canales semicirculares
`);
add('integument','organ','whole','skin',false,`
skin|Dəri|Cutis
epidermis|Epidermis|Epidermis
dermis|Derma|Dermis
subcutis|Dərialtı toxuma|Tela subcutanea
hair-follicle|Tük follikulu|Folliculus pili
sebaceous-gland|Piy vəzisi|Glandula sebacea
sweat-gland|Tər vəzisi|Glandula sudorifera
nail|Dırnaq|Unguis
`);

add('muscular','muscle','skull','muscles-front',true,`
muscle-frontalis|Alın əzələsi|Venter frontalis musculi occipitofrontalis
muscle-temporalis|Gicgah əzələsi|Musculus temporalis
muscle-masseter|Çeynəmə əzələsi|Musculus masseter
muscle-orbicularis-oculi|Gözün dairəvi əzələsi|Musculus orbicularis oculi
muscle-buccinator|Yanaq əzələsi|Musculus buccinator
muscle-zygomaticus|Böyük almacıq əzələsi|Musculus zygomaticus major
muscle-pterygoid-medial|Medial qanadabənzər əzələ|Musculus pterygoideus medialis
muscle-pterygoid-lateral|Lateral qanadabənzər əzələ|Musculus pterygoideus lateralis
`);
add('muscular','muscle','skull','muscles-front',false,`muscle-orbicularis-oris|Ağızın dairəvi əzələsi|Musculus orbicularis oris`);
add('muscular','muscle','neck','muscles-front',true,`
muscle-scm|Döş-körpücük-məməyəbənzər əzələ|Musculus sternocleidomastoideus|SCM
muscle-platysma|Boyunun dərialtı əzələsi|Platysma
muscle-scalene-anterior|Ön pilləli əzələ|Musculus scalenus anterior
muscle-scalene-middle|Orta pilləli əzələ|Musculus scalenus medius
muscle-scalene-posterior|Arxa pilləli əzələ|Musculus scalenus posterior
muscle-digastric|İkiqarıncıqlı əzələ|Musculus digastricus
muscle-mylohyoid|Çənə-dilaltı əzələ|Musculus mylohyoideus
muscle-sternohyoid|Döş-dilaltı əzələ|Musculus sternohyoideus
`);
add('muscular','muscle','thorax','respiratory',false,`diaphragm|Diafraqma|Diaphragma`);
add('muscular','muscle','thorax','muscles-front',true,`
muscle-pectoralis-major|Böyük döş əzələsi|Musculus pectoralis major
muscle-pectoralis-minor|Kiçik döş əzələsi|Musculus pectoralis minor
muscle-serratus-anterior|Ön dişli əzələ|Musculus serratus anterior
muscle-intercostal-external|Xarici qabırğaarası əzələlər|Musculi intercostales externi
muscle-intercostal-internal|Daxili qabırğaarası əzələlər|Musculi intercostales interni
`);
add('muscular','muscle','spine','muscles-back',true,`
muscle-trapezius|Trapesiyabənzər əzələ|Musculus trapezius
muscle-latissimus|Kürəyin ən enli əzələsi|Musculus latissimus dorsi
muscle-rhomboid-major|Böyük rombabənzər əzələ|Musculus rhomboideus major
muscle-rhomboid-minor|Kiçik rombabənzər əzələ|Musculus rhomboideus minor
muscle-levator-scapulae|Kürəyi qaldıran əzələ|Musculus levator scapulae
muscle-erector-spinae|Onurğanı düzləndirən əzələ|Musculus erector spinae
muscle-multifidus|Çoxbölünmüş əzələlər|Musculi multifidi
`);
add('muscular','muscle','abdomen','muscles-front',true,`
muscle-rectus-abdominis|Qarının düz əzələsi|Musculus rectus abdominis
muscle-oblique-external|Qarının xarici çəp əzələsi|Musculus obliquus externus abdominis
muscle-oblique-internal|Qarının daxili çəp əzələsi|Musculus obliquus internus abdominis
muscle-transversus|Qarının köndələn əzələsi|Musculus transversus abdominis
muscle-quadratus-lumborum|Belin kvadrat əzələsi|Musculus quadratus lumborum
`);
add('muscular','muscle','arm','muscles-front',true,`
muscle-deltoid|Deltayabənzər əzələ|Musculus deltoideus
muscle-biceps|Bazunun ikibaşlı əzələsi|Musculus biceps brachii
muscle-brachialis|Bazu əzələsi|Musculus brachialis
muscle-coracobrachialis|Dimdik-bazu əzələsi|Musculus coracobrachialis
muscle-brachioradialis|Bazu-mil əzələsi|Musculus brachioradialis
muscle-pronator-teres|Dairəvi pronator|Musculus pronator teres
muscle-pronator-quadratus|Kvadrat pronator|Musculus pronator quadratus
muscle-supinator|Supinator|Musculus supinator
muscle-fcr|Biləyin mil bükücüsü|Musculus flexor carpi radialis
muscle-fcu|Biləyin dirsək bükücüsü|Musculus flexor carpi ulnaris
muscle-palmaris|Uzun ovuc əzələsi|Musculus palmaris longus
muscle-fds|Barmaqların səthi bükücüsü|Musculus flexor digitorum superficialis
muscle-fdp|Barmaqların dərin bükücüsü|Musculus flexor digitorum profundus
muscle-fpl|Baş barmağın uzun bükücüsü|Musculus flexor pollicis longus
`);
add('muscular','muscle','arm','muscles-back',true,`
muscle-triceps|Bazunun üçbaşlı əzələsi|Musculus triceps brachii
muscle-supraspinatus|Tinüstü əzələ|Musculus supraspinatus
muscle-infraspinatus|Tinaltı əzələ|Musculus infraspinatus
muscle-teres-minor|Kiçik girdə əzələ|Musculus teres minor
muscle-teres-major|Böyük girdə əzələ|Musculus teres major
muscle-subscapularis|Kürəkaltı əzələ|Musculus subscapularis
muscle-ecrl|Biləyin uzun mil açıcı əzələsi|Musculus extensor carpi radialis longus
muscle-ecrb|Biləyin qısa mil açıcı əzələsi|Musculus extensor carpi radialis brevis
muscle-ecu|Biləyin dirsək açıcı əzələsi|Musculus extensor carpi ulnaris
muscle-extensor-digitorum|Barmaqların açıcı əzələsi|Musculus extensor digitorum
muscle-epl|Baş barmağın uzun açıcı əzələsi|Musculus extensor pollicis longus
muscle-apl|Baş barmağın uzun uzaqlaşdırıcı əzələsi|Musculus abductor pollicis longus
`);
add('muscular','muscle','hand','muscles-front',true,`
muscle-thenar|Baş barmaq hündürlüyünün əzələləri|Musculi eminentiae thenaris|thenar
muscle-hypothenar|Çeçələ barmaq hündürlüyünün əzələləri|Musculi eminentiae hypothenaris|hypothenar
muscle-lumbricals-hand|Əlin soxulcanabənzər əzələləri|Musculi lumbricales manus
muscle-interossei-hand|Əlin sümükarası əzələləri|Musculi interossei manus
`);
add('muscular','muscle','pelvis','muscles-back',true,`
muscle-gluteus-maximus|Böyük sağrı əzələsi|Musculus gluteus maximus
muscle-gluteus-medius|Orta sağrı əzələsi|Musculus gluteus medius
muscle-gluteus-minimus|Kiçik sağrı əzələsi|Musculus gluteus minimus
muscle-piriformis|Armudabənzər əzələ|Musculus piriformis
muscle-obturator-internus|Daxili qapayıcı əzələ|Musculus obturatorius internus
muscle-levator-ani|Anusu qaldıran əzələ|Musculus levator ani
`);
add('muscular','muscle','leg','muscles-front',true,`
muscle-iliopsoas|Qalça-bel əzələsi|Musculus iliopsoas
muscle-psoas|Böyük bel əzələsi|Musculus psoas major
muscle-iliacus|Qalça əzələsi|Musculus iliacus
muscle-tfl|Budun enli fassiyasını gərən əzələ|Musculus tensor fasciae latae
muscle-sartorius|Dərzi əzələsi|Musculus sartorius
muscle-quadriceps|Budun dördbaşlı əzələsi|Musculus quadriceps femoris
muscle-rectus-femoris|Budun düz əzələsi|Musculus rectus femoris
muscle-vastus-medialis|Medial enli əzələ|Musculus vastus medialis
muscle-vastus-lateralis|Lateral enli əzələ|Musculus vastus lateralis
muscle-vastus-intermedius|Ara enli əzələ|Musculus vastus intermedius
muscle-adductor-longus|Uzun yaxınlaşdırıcı əzələ|Musculus adductor longus
muscle-adductor-brevis|Qısa yaxınlaşdırıcı əzələ|Musculus adductor brevis
muscle-adductor-magnus|Böyük yaxınlaşdırıcı əzələ|Musculus adductor magnus
muscle-gracilis|İncə əzələ|Musculus gracilis
muscle-pectineus|Daraq əzələsi|Musculus pectineus
muscle-tibialis-anterior|Ön qamış əzələsi|Musculus tibialis anterior
muscle-edl|Ayaq barmaqlarının uzun açıcı əzələsi|Musculus extensor digitorum longus
muscle-ehl|Ayaq baş barmağının uzun açıcı əzələsi|Musculus extensor hallucis longus
`);
add('muscular','muscle','leg','muscles-back',true,`
muscle-biceps-femoris|Budun ikibaşlı əzələsi|Musculus biceps femoris
muscle-semitendinosus|Yarıvətərli əzələ|Musculus semitendinosus
muscle-semimembranosus|Yarızarlı əzələ|Musculus semimembranosus
muscle-gastrocnemius|Baldır əzələsi|Musculus gastrocnemius
muscle-soleus|Kambalayabənzər əzələ|Musculus soleus
muscle-popliteus|Dizaltı əzələ|Musculus popliteus
muscle-tibialis-posterior|Arxa qamış əzələsi|Musculus tibialis posterior
muscle-fibularis-longus|Uzun incik əzələsi|Musculus fibularis longus|peroneus longus
muscle-fibularis-brevis|Qısa incik əzələsi|Musculus fibularis brevis|peroneus brevis
muscle-fdl|Ayaq barmaqlarının uzun bükücüsü|Musculus flexor digitorum longus
muscle-fhl|Ayaq baş barmağının uzun bükücüsü|Musculus flexor hallucis longus
`);
add('muscular','muscle','foot','muscles-front',true,`
muscle-abductor-hallucis|Ayaq baş barmağını uzaqlaşdıran əzələ|Musculus abductor hallucis
muscle-fdb|Ayaq barmaqlarının qısa bükücüsü|Musculus flexor digitorum brevis
muscle-edb|Ayaq barmaqlarının qısa açıcı əzələsi|Musculus extensor digitorum brevis
muscle-lumbricals-foot|Ayağın soxulcanabənzər əzələləri|Musculi lumbricales pedis
muscle-interossei-foot|Ayağın sümükarası əzələləri|Musculi interossei pedis
`);
add('skeletal','other','arm','skeleton',true,`
joint-shoulder|Çiyin oynağı|Articulatio humeri
joint-elbow|Dirsək oynağı|Articulatio cubiti
joint-acromioclavicular|Akromion-körpücük oynağı|Articulatio acromioclavicularis
`);
add('skeletal','other','hand','hand',true,`joint-wrist|Mil-bilək oynağı|Articulatio radiocarpalis`);
add('skeletal','other','pelvis','skeleton',true,`
joint-hip|Bud-çanaq oynağı|Articulatio coxae
joint-sacroiliac|Oma-qalça oynağı|Articulatio sacroiliaca
`);
add('skeletal','other','leg','skeleton',true,`
joint-knee|Diz oynağı|Articulatio genus
meniscus-medial|Medial menisk|Meniscus medialis
meniscus-lateral|Lateral menisk|Meniscus lateralis
acl|Ön çarpaz bağ|Ligamentum cruciatum anterius|ACL
pcl|Arxa çarpaz bağ|Ligamentum cruciatum posterius|PCL
mcl|Medial kollateral bağ|Ligamentum collaterale tibiale|MCL
lcl|Lateral kollateral bağ|Ligamentum collaterale fibulare|LCL
patellar-ligament|Diz qapağı bağı|Ligamentum patellae
achilles|Axill vətəri|Tendo calcaneus|Achilles
`);
add('skeletal','other','foot','foot',true,`joint-ankle|Aşıq-baldır oynağı|Articulatio talocruralis`);
add('skeletal','other','spine','skeleton',false,`disc-intervertebral|Fəqərəarası disk|Discus intervertebralis`);

// Points are percentages of an inspected reference plate, independent of laterality
// on patient images. Unmapped entries intentionally have no invented marker.
const points: Record<string,[number,number]> = {
  'atrium-right':[31,51], 'atrium-left':[59,39], 'ventricle-right':[47,73], 'ventricle-left':[69,65],
  'nasal-cavity':[39,16],larynx:[45,30],trachea:[48,46],'lung-right':[36,65],'lung-left':[63,65],
  'bronchus-right':[44,55],'bronchus-left':[52,56],alveoli:[79,15],diaphragm:[33,84],
  mouth:[40,15],tongue:[43,17],parotid:[50,17],pharynx:[51,21],esophagus:[51,34],
  liver:[38,55],gallbladder:[40,59],stomach:[63,55],pancreas:[49,64],duodenum:[42,66],
  'colon-ascending':[35,75],'colon-transverse':[51,71],'colon-descending':[70,76],
  'colon-sigmoid':[55,88],cecum:[41,84],appendix:[43,89],'small-intestine':[48,79],rectum:[51,92],anus:[51,96],
  kidney:[49,34],ureter:[45,57],bladder:[36,82],urethra:[36,92],
  uterus:[50,38],cervix:[50,70],vagina:[50,86],ovary:[15,27],'uterine-tube':[29,14],
  testis:[45,79],prostate:[62,47],'seminal-vesicle':[69,20],penis:[12,44],
  thyroid:[25.5,39],parathyroid:[26.7,88.4],adrenal:[71.4,25.6],
  brain:[50,8],cerebellum:[49,11.5],'spinal-cord':[54,23],
  'muscle-frontalis':[51.4,4.7],'muscle-scm':[47.9,14.7],'muscle-deltoid':[38.8,20.5],
  'muscle-pectoralis-major':[45.3,23.5],'muscle-biceps':[62,27.1],'muscle-brachioradialis':[32.5,37.6],
  'muscle-rectus-abdominis':[48,37.7],'muscle-oblique-external':[43,39],'muscle-fcr':[64.4,39.4],
  'muscle-tfl':[41.7,47.5],'muscle-sartorius':[54.5,54.6],'muscle-quadriceps':[44.8,58.5],
  'muscle-tibialis-anterior':[55.6,75.8],
  'muscle-trapezius':[46.1,13.6],'muscle-levator-scapulae':[54.2,11.5],
  'muscle-latissimus':[42.7,29.7],'muscle-triceps':[69.3,22.7],'muscle-gluteus-maximus':[53.6,42.6],
  'muscle-biceps-femoris':[42.7,55],'muscle-semitendinosus':[44.6,56.7],
  'muscle-gastrocnemius':[45.1,65.5],'muscle-soleus':[45.4,74.9],'muscle-tibialis-posterior':[56,71.9],
  'muscle-fibularis-longus':[58,73.1],'muscle-fibularis-brevis':[56.9,79.2],
  'carotid-common':[54,15],
  'subclavian-artery':[40,21.5],'axillary-artery':[32.5,27.7],'brachial-artery':[30,33.6],
  'radial-artery':[18.8,45],'ulnar-artery':[24.3,45], 'aorta-abdominal':[57.5,43],
  'renal-artery':[64.6,39.8],'femoral-artery':[65,56.7],
  'nodes-cervical':[59,6],'nodes-axillary':[74,22],'nodes-inguinal':[59,85],
  cornea:[46,5],lens:[45,20],vitreous:[36,53],iris:[35,14],retina:[78,64],
  auricle:[12,36],'ear-canal':[34,47],'tympanic-membrane':[46,44],'auditory-tube':[68,52],
  epidermis:[73,31],dermis:[64,45],subcutis:[64,79],'hair-follicle':[48,52],'sebaceous-gland':[43,47],'sweat-gland':[52,70],
};
for(const entry of entries) {
  const point=points[entry.id];
  if(point) { const plate=anatomyPlates[entry.plate]; entry.point=[point[0]*plate.width/100,point[1]*plate.height/100]; }
}
export const anatomyStructures:readonly AnatomyStructure[]=entries;
const sharedSystems:Record<string,string[]>={pancreas:['endocrine'],ovary:['endocrine'],testis:['endocrine'],thymus:['endocrine'],hypothalamus:['nervous'],pharynx:['respiratory'],diaphragm:['respiratory'],malleus:['sensory'],incus:['sensory'],stapes:['sensory']};
export const isInAnatomySystem=(item:AnatomyStructure,system:string)=>system==='all'||item.system===system||sharedSystems[item.id]?.includes(system)===true;
export function searchCatalogue(query='',system='all',kind='all',region='all') {
  const terms=anatomySearchKey(query).trim().split(/\s+/).filter(Boolean);
  return anatomyStructures.filter(item=>isInAnatomySystem(item,system)&&(kind==='all'||item.kind===kind)
    &&(region==='all'||item.region===region)&&terms.every(term=>anatomySearchKey(`${item.az} ${item.latin} ${item.aliases||''}`).includes(term)));
}
export function structureLabelText(item:AnatomyStructure,side:string,language:string) {
  const azPrefix=item.paired?(side==='left'?'Sol · ':side==='right'?'Sağ · ':''):'';
  const latinPrefix=item.paired?(side==='left'?'Latus sinistrum · ':side==='right'?'Latus dextrum · ':''):'';
  return language==='latin'?latinPrefix+item.latin:language==='az'?azPrefix+item.az:`${azPrefix}${item.az}\n${item.latin}`;
}
