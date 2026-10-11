// Offline, manually curated atlas. Coordinates refer to the bundled atlas plates,
// never to a patient's pixels. This catalogue performs no image recognition.
export type AnatomyBone = { id: string; region: string; az: string; latin: string; aliases?: string; point?: [number, number] };
export type AnatomyLabel = { id: string; text: string; imageId: string; panel: string };
export const anatomyRegions = [
  { id: 'skull', name: 'Kəllə və üz' }, { id: 'spine', name: 'Onurğa' },
  { id: 'thorax', name: 'Döş qəfəsi' }, { id: 'arm', name: 'Çiyin və qol' },
  { id: 'hand', name: 'Bilək və əl' }, { id: 'pelvis', name: 'Çanaq' },
  { id: 'leg', name: 'Bud, diz və baldır' }, { id: 'foot', name: 'Ayaq' },
];
const bones: AnatomyBone[] = [];
function add(region: string, id: string, az: string, latin: string, point?: [number, number], aliases?: string) {
  bones.push({ region, id, az, latin, point, aliases });
}
[
  ['frontal','Alın sümüyü','Os frontale'], ['parietal','Təpə sümüyü','Os parietale'],
  ['temporal','Gicgah sümüyü','Os temporale'], ['occipital','Ənsə sümüyü','Os occipitale'],
  ['sphenoid','Pazabənzər sümük','Os sphenoidale'], ['ethmoid','Xəlbir sümüyü','Os ethmoidale'],
  ['nasal','Burun sümüyü','Os nasale'], ['lacrimal','Gözyaşı sümüyü','Os lacrimale'],
  ['zygomatic','Almacıq sümüyü','Os zygomaticum'], ['maxilla','Əng sümüyü','Maxilla'],
  ['mandible','Çənə sümüyü','Mandibula'], ['palatine','Damaq sümüyü','Os palatinum'],
  ['vomer','Xış sümüyü','Vomer'], ['concha','Aşağı burun balıqqulağı','Concha nasalis inferior'],
  ['hyoid','Dilaltı sümük','Os hyoideum'], ['malleus','Çəkic sümükcüyü','Malleus'],
  ['incus','Zindan sümükcüyü','Incus'], ['stapes','Üzəngi sümükcüyü','Stapes'],
].forEach(([id,az,latin])=>add('skull',id,az,latin));
for (const [prefix, count, az, latin] of [['C',7,'Boyun','cervicalis'],['T',12,'Döş','thoracica'],['L',5,'Bel','lumbalis']] as const) {
  for(let n=1;n<=count;n++) add('spine',`${prefix}${n}`,`${prefix}${n} — ${az} fəqərəsi${prefix==='C'&&n===1?' (Atlas)':prefix==='C'&&n===2?' (Axis)':''}`,`Vertebra ${latin} ${n}`,undefined,prefix==='T'?`D${n}`:undefined);
}
add('spine','sacrum','Oma sümüyü','Os sacrum');
add('spine','coccyx','Büzdüm sümüyü','Os coccygis');
add('thorax','sternum','Döş sümüyü','Sternum');
for(let n=1;n<=12;n++) add('thorax',`rib-${n}`,`${n}-ci qabırğa`,`Costa ${n}`);
[
  ['clavicle','Körpücük sümüyü','Clavicula'],['scapula','Kürək sümüyü','Scapula'],
  ['humerus','Bazu sümüyü','Humerus'],['radius','Mil sümüyü','Radius'],['ulna','Dirsək sümüyü','Ulna'],
].forEach(([id,az,latin])=>add('arm',id,az,latin));
[
  ['scaphoid','Qayığabənzər sümük','Os scaphoideum',335,65,'scaphoid skafoid navicular'],
  ['lunate','Aypara sümük','Os lunatum',419,46,'lunate semilunar'],
  ['triquetrum','Üçüzlü sümük','Os triquetrum',445,94,'triquetral triangular'],
  ['pisiform','Noxudabənzər sümük','Os pisiforme',496,108,'pisiform'],
  ['trapezium','Trapesiya sümüyü','Os trapezium',245,125,'greater multangular'],
  ['trapezoid','Trapesiyabənzər sümük','Os trapezoideum',309,130,'lesser multangular'],
  ['capitate','Başlı sümük','Os capitatum',377,140,'capitate'],
  ['hamate','Qarmaqlı sümük','Os hamatum',449,154,'hamate unciform'],
].forEach(([id,az,latin,x,y,aliases])=>add('hand',String(id),String(az),String(latin),[Number(x),Number(y)],String(aliases)));
const roman=['I','II','III','IV','V'];
const handMeta: [number,number][]=[[174,222],[275,310],[355,315],[449,313],[530,277]];
const handProx: [number,number][]=[[120,362],[229,550],[346,554],[482,539],[581,471]];
const handMiddle: [number,number][]=[[0,0],[207,697],[339,735],[480,696],[610,594]];
const handDistal: [number,number][]=[[85,474],[205,796],[332,850],[481,801],[619,688]];
for(let n=0;n<5;n++) {
  add('hand',`metacarpal-${n+1}`,`${roman[n]} əl darağı sümüyü`,`Os metacarpale ${roman[n]}`,handMeta[n]);
  add('hand',`hand-proximal-${n+1}`,`Əl ${roman[n]} barmaq — proksimal falanqa`,`Phalanx proximalis digiti ${roman[n]} manus`,handProx[n]);
  if(n) add('hand',`hand-middle-${n+1}`,`Əl ${roman[n]} barmaq — orta falanqa`,`Phalanx media digiti ${roman[n]} manus`,handMiddle[n]);
  add('hand',`hand-distal-${n+1}`,`Əl ${roman[n]} barmaq — distal falanqa`,`Phalanx distalis digiti ${roman[n]} manus`,handDistal[n]);
}
[
  ['hip','Çanaq sümüyü','Os coxae'],['ilium','Qalça sümüyü','Os ilium'],
  ['ischium','Oturaq sümüyü','Os ischii'],['pubis','Qasıq sümüyü','Os pubis'],
].forEach(([id,az,latin])=>add('pelvis',id,az,latin));
[
  ['femur','Bud sümüyü','Femur'],['patella','Diz qapağı','Patella'],
  ['tibia','Qamış sümüyü','Tibia'],['fibula','İncik sümüyü','Fibula'],
].forEach(([id,az,latin])=>add('leg',id,az,latin));
[
  ['calcaneus','Daban sümüyü','Calcaneus',291,94],['talus','Aşıq sümüyü','Talus',307,241],
  ['navicular','Ayağın qayığabənzər sümüyü','Os naviculare',362,434],
  ['cuboid','Kubabənzər sümük','Os cuboideum',220,443],
  ['cuneiform-medial','Medial pazabənzər sümük','Os cuneiforme mediale',381,552],
  ['cuneiform-intermediate','Ara pazabənzər sümük','Os cuneiforme intermedium',312,520],
  ['cuneiform-lateral','Lateral pazabənzər sümük','Os cuneiforme laterale',249,505],
].forEach(([id,az,latin,x,y])=>add('foot',String(id),String(az),String(latin),[Number(x),Number(y)]));
const footMeta: [number,number][]=[[412,757],[290,756],[226,748],[174,713],[119,688]];
const footProx: [number,number][]=[[398,978],[274,1001],[202,962],[136,910],[78,865]];
const footMiddle: [number,number][]=[[0,0],[274,1100],[202,1062],[127,1024],[64,946]];
const footDistal: [number,number][]=[[395,1116],[277,1158],[202,1126],[127,1074],[64,991]];
for(let n=0;n<5;n++) {
  add('foot',`metatarsal-${n+1}`,`${roman[n]} ayaq darağı sümüyü`,`Os metatarsale ${roman[n]}`,footMeta[n]);
  add('foot',`foot-proximal-${n+1}`,`Ayaq ${roman[n]} barmaq — proksimal falanqa`,`Phalanx proximalis digiti ${roman[n]} pedis`,footProx[n]);
  if(n) add('foot',`foot-middle-${n+1}`,`Ayaq ${roman[n]} barmaq — orta falanqa`,`Phalanx media digiti ${roman[n]} pedis`,footMiddle[n]);
  add('foot',`foot-distal-${n+1}`,`Ayaq ${roman[n]} barmaq — distal falanqa`,`Phalanx distalis digiti ${roman[n]} pedis`,footDistal[n]);
}
export const anatomyBones: readonly AnatomyBone[] = bones;
export const anatomySearchKey=(value:string)=>value.toLocaleLowerCase('az').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/ə/g,'e').replace(/ı/g,'i');
export function searchAnatomy(query:string,region:string) {
  const terms=anatomySearchKey(query).trim().split(/\s+/).filter(Boolean);
  return anatomyBones.filter(bone=>(region==='all'||bone.region===region)&&terms.every(term=>anatomySearchKey(`${bone.az} ${bone.latin} ${bone.aliases||''}`).includes(term)));
}
export function anatomyLabelText(bone:AnatomyBone,side:string,language:string) {
  const prefix=side==='left'?'Sol · ':side==='right'?'Sağ · ':'';
  return prefix+(language==='latin'?bone.latin:language==='az'?bone.az:`${bone.az}\n${bone.latin}`);
}
