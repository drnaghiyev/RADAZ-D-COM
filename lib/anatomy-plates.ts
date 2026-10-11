export type AnatomyPlate = {src:string;width:number;height:number;caption:string;author:string;source:string;license:string;licenseUrl?:string};
const commons=(file:string)=>`https://commons.wikimedia.org/wiki/File:${file}`;
const pd='İctimai mülkiyyət';
const gray='H. V. Carter · Gray’s Anatomy, 1918';
const lady='Mariana Ruiz Villarreal (LadyofHats)';
function plate(file:string,width:number,height:number,caption:string,author:string,source:string,license=pd,licenseUrl?:string):AnatomyPlate {
  return {src:`/anatomy/${file}`,width,height,caption,author,source:commons(source),license,licenseUrl};
}
export const anatomyPlates:Record<string,AnatomyPlate>={
  hand:plate('hand.png',733,900,'Əl · arxa səth',gray,'Gray220.png'),
  foot:plate('foot.png',638,1195,'Ayaq · üst səth',gray,'Gray268.png'),
  skeleton:plate('skeleton.svg',436,842,'Skelet · öndən',`${lady} / Mikael Häggström`,'Human_skeleton_front_-_no_labels.svg'),
  organs:plate('organs.svg',1454,2320,'Daxili orqanlar · ümumi istinad','Mikael Häggström','Female_template_with_organs.svg','CC0','https://creativecommons.org/publicdomain/zero/1.0/'),
  vessels:plate('vessels.svg',371,821,'Qan damarları · öndən',`${lady} / Jmarchn`,'Circulatory_System_no_tags.svg'),
  heart:plate('heart.svg',663,651,'Ürək · koronal kəsik','Wapcaplet / Yaddah','Diagram_of_the_human_heart_(cropped).svg','CC BY-SA 3.0','https://creativecommons.org/licenses/by-sa/3.0/'),
  respiratory:plate('respiratory.svg',907,966,'Tənəffüs yolları və ağciyərlər',lady,'Respiratory_system_complete_en.svg'),
  digestive:plate('digestive.svg',465,657,'Həzm sistemi',`${lady} / Jmarchn`,'Digestive_system_diagram_en.svg'),
  urinary:plate('urinary.svg',248,288,'Sidik sistemi · öndən','US Government / SEER · Thstehle','Illu_urinary_system.svg'),
  'female-reproductive':plate('female-reproductive.svg',214,173,'Qadın reproduktiv sistemi · öndən',lady,'Female_reproductive_system_-_anterior_view.svg'),
  'male-reproductive':plate('male-reproductive.jpg',1456,1187,'Kişi reproduktiv sistemi · sagittal kəsik','Mikael Häggström','Lateral_cross-section_of_male_reproductive_system.jpg','CC0','https://creativecommons.org/publicdomain/zero/1.0/'),
  endocrine:plate('endocrine.svg',3264,1824,'Endokrin vəzilər · ümumi baxış',`${lady} / RWhitwam`,'Endocrine_glands_%26_their_hormones.svg','CC BY-SA 4.0','https://creativecommons.org/licenses/by-sa/4.0/'),
  nerves:plate('nerves.png',1772,3404,'Sinir sistemi · ümumi sxem','Pearson Scott Foresman','Nervous_System_(PSF).png'),
  lymphatic:plate('lymphatic.svg',612,717,'Limfa damarları və düyünləri','NIH / JGM73','Lymphatic_system_(vector).svg'),
  eye:plate('eye.png',600,481,'Göz alması · kəsik',gray,'Gray869.png'),
  ear:plate('ear.png',600,530,'Xarici və orta qulaq · kəsik',gray,'Gray907.png'),
  skin:plate('skin.png',1000,1029,'Dəri · kəsik','US Government / SEER · Prof. Squirrel','Skin.png'),
  'muscles-front':plate('muscles-front.png',1664,1632,'Əzələlər · öndən',`${gray} · Mikael Häggström`,'Muscles_anterior_labeled.png'),
  'muscles-back':plate('muscles-back.png',1063,1297,'Əzələlər · arxadan',`${gray} · Mikael Häggström`,'Muscle_posterior_labeled.png'),
};
