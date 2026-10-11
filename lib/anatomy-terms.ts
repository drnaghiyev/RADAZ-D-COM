import type {Language} from './i18n';
const terms:Record<string,[string,string,string]>={
 spleen:['Dalaq','Селезёнка','Spleen'],kidney:['Böyrək','Почка','Kidney'],gallbladder:['Öd kisəsi','Жёлчный пузырь','Gallbladder'],liver:['Qaraciyər','Печень','Liver'],stomach:['Mədə','Желудок','Stomach'],pancreas:['Mədəaltı vəzi','Поджелудочная железа','Pancreas'],adrenal_gland:['Böyrəküstü vəzi','Надпочечник','Adrenal gland'],
 lung:['Ağciyər','Лёгкое','Lung'],lung_upper_lobe:['Ağciyərin yuxarı payı','Верхняя доля лёгкого','Upper lung lobe'],lung_lower_lobe:['Ağciyərin aşağı payı','Нижняя доля лёгкого','Lower lung lobe'],lung_middle_lobe:['Ağciyərin orta payı','Средняя доля лёгкого','Middle lung lobe'],
 esophagus:['Qida borusu','Пищевод','Esophagus'],trachea:['Nəfəs borusu','Трахея','Trachea'],thyroid_gland:['Qalxanabənzər vəzi','Щитовидная железа','Thyroid gland'],small_bowel:['Nazik bağırsaq','Тонкая кишка','Small bowel'],duodenum:['Onikibarmaq bağırsaq','Двенадцатиперстная кишка','Duodenum'],colon:['Çənbər bağırsaq','Ободочная кишка','Colon'],urinary_bladder:['Sidik kisəsi','Мочевой пузырь','Urinary bladder'],prostate:['Prostat vəzi','Предстательная железа','Prostate'],
 sacrum:['Oma sümüyü','Крестец','Sacrum'],vertebrae:['Fəqərələr','Позвонки','Vertebrae'],intervertebral_discs:['Fəqərəarası disklər','Межпозвонковые диски','Intervertebral discs'],heart:['Ürək','Сердце','Heart'],aorta:['Aorta','Аорта','Aorta'],pulmonary_vein:['Ağciyər venası','Лёгочная вена','Pulmonary vein'],brachiocephalic_trunk:['Bazu-baş kötüyü','Плечеголовной ствол','Brachiocephalic trunk'],subclavian_artery:['Körpücükaltı arteriya','Подключичная артерия','Subclavian artery'],common_carotid_artery:['Ümumi yuxu arteriyası','Общая сонная артерия','Common carotid artery'],brachiocephalic_vein:['Bazu-baş venası','Плечеголовная вена','Brachiocephalic vein'],atrial_appendage:['Qulaqcıq seyvanı','Ушко предсердия','Atrial appendage'],superior_vena_cava:['Yuxarı boş vena','Верхняя полая вена','Superior vena cava'],inferior_vena_cava:['Aşağı boş vena','Нижняя полая вена','Inferior vena cava'],portal_vein_and_splenic_vein:['Qapı və dalaq venaları','Воротная и селезёночная вены','Portal and splenic veins'],iliac_artery:['Qalça arteriyası','Подвздошная артерия','Iliac artery'],iliac_vena:['Qalça venası','Подвздошная вена','Iliac vein'],
 humerus:['Bazu sümüyü','Плечевая кость','Humerus'],scapula:['Kürək sümüyü','Лопатка','Scapula'],clavicula:['Körpücük sümüyü','Ключица','Clavicle'],femur:['Bud sümüyü','Бедренная кость','Femur'],hip:['Çanaq sümüyü','Тазовая кость','Hip bone'],spinal_cord:['Onurğa beyni','Спинной мозг','Spinal cord'],gluteus_maximus:['Böyük sağrı əzələsi','Большая ягодичная мышца','Gluteus maximus'],gluteus_medius:['Orta sağrı əzələsi','Средняя ягодичная мышца','Gluteus medius'],gluteus_minimus:['Kiçik sağrı əzələsi','Малая ягодичная мышца','Gluteus minimus'],autochthon:['Kürəyin dərin əzələləri','Глубокие мышцы спины','Deep back muscles'],iliopsoas:['Qalça-bel əzələsi','Подвздошно-поясничная мышца','Iliopsoas'],brain:['Baş beyin','Головной мозг','Brain'],skull:['Kəllə','Череп','Skull'],sternum:['Döş sümüyü','Грудина','Sternum'],costal_cartilages:['Qabırğa qığırdaqları','Рёберные хрящи','Costal cartilages'],
 body:['Bədən','Тело','Body'],body_trunc:['Gövdə','Туловище','Trunk'],body_extremities:['Ətraflar','Конечности','Extremities'],skin:['Dəri','Кожа','Skin'],lung_arteries:['Ağciyər arteriyaları','Лёгочные артерии','Pulmonary arteries'],lung_veins:['Ağciyər venaları','Лёгочные вены','Pulmonary veins'],lung_vessels:['Ağciyər damarları','Лёгочные сосуды','Pulmonary vessels'],lung_airways:['Ağciyər hava yolları','Дыхательные пути лёгких','Pulmonary airways'],lung_airways_wall:['Hava yollarının divarı','Стенки дыхательных путей','Airway walls'],lung_trachea_bronchia:['Traxeya və bronxlar','Трахея и бронхи','Trachea and bronchi'],
};
export function anatomyTerm(key:string,language:Language='az'){
 const col={az:0,ru:1,en:2}[language];
 const rib=key.match(/^rib_(left|right)_(\d+)$/),vertebra=key.match(/^vertebrae_([CTLS])(\d+)$/);
 const sideName=(side:string)=>({az:side==='left'?'Sol':'Sağ',ru:side==='left'?'Слева':'Справа',en:side==='left'?'Left':'Right'}[language]);
 if(rib)return `${sideName(rib[1])} · ${{az:'Qabırğa',ru:'Ребро',en:'Rib'}[language]} ${rib[2]}`;
 if(vertebra)return `${{az:'Fəqərə',ru:'Позвонок',en:'Vertebra'}[language]} ${vertebra[1]}${vertebra[2]}`;
 const side=key.match(/_(left|right)$/),base=side?key.slice(0,-side[0].length):key;
 // Unknown model labels remain explicit English identifiers; never invent anatomy.
 const name=terms[base]?.[col]??`[EN] ${key.replaceAll('_',' ')}`;
 return side?`${sideName(side[1])} · ${name}`:name;
}
export function anatomyCategory(key:string){
 if(/rib_|vertebrae|sacrum|humerus|scapula|clavicula|femur|hip|skull|sternum|cartilage/.test(key))return 'bone';
 if(/gluteus|autochthon|iliopsoas/.test(key))return 'muscle';
 if(/brain|spinal_cord/.test(key))return 'nervous';
 if(/arter|aorta|vein|vena|vessel|brachiocephalic_trunk/.test(key))return 'vessel';
 return 'organ';
}
