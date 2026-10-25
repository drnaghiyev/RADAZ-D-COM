import type {TransferFunction,VolumeCrop} from './transfer-function';
export type VolumePreset = 'bone'|'organ'|'abdomen-color'|'brain'|'vessel'|'angio'|'soft'|'lung'|'airway'|'skin'|'transparent'|'mip'|'minip'|'mr';
export type VolumeQuality = 'performance'|'balanced'|'high'|'ultra'|'auto';
export type VolumeRenderSettings = {ambient:number;diffuse:number;specular:number;specularPower:number;quality:VolumeQuality;sourceQuality?:'full'|'light';
  lighting?:'even'|'studio'|'flat'; shading?:'surface'|'occlusion'|'scattering'; opacityDistance?:number; transferWidth?:number; sampling?:number;
  gradient?:boolean; gradientMin?:number; gradientMax?:number; normalFromOpacity?:boolean;
  occlusionRadius?:number; occlusionSamples?:number; scattering?:number; shadowReach?:number;
  lightIntensity?:number; interpolation?:'linear'|'nearest'; mouseMode?:'rotate'|'tissue';customTransfer?:TransferFunction;crop?:VolumeCrop};
type Definition = {key:VolumePreset;title:string;subtitle:string;tone:string;threshold:number;opacity:number;
  scalar:[number,number][];color:[number,number,number,number][];gradient:[number,number][];
  shade:boolean;interpolation:0|1;blend:'composite'|'maximum'|'minimum';lighting:VolumeRenderSettings;
  surface?:{opacityUnitDistance:number;gradientOpacity:boolean;normalFromOpacity:boolean;occlusion:boolean}};
const lighting=(ambient:number,diffuse:number,specular:number,specularPower:number):VolumeRenderSettings=>({ambient,diffuse,specular,specularPower,quality:'high'});
// Camera-relative key, fill and rim lights: stable depth cues as the volume rotates.
export const volumeStudioLights=[
 {position:[-.5,.7,1] as [number,number,number],intensity:.85,color:[1,.99,.97] as [number,number,number]},
 {position:[.8,.15,.6] as [number,number,number],intensity:.28,color:[.96,.98,1] as [number,number,number]},
 {position:[.15,-.5,-1] as [number,number,number],intensity:.16,color:[1,1,1] as [number,number,number]},
];
// Match Smart Volume's neutral camera headlight; studio remains an explicit option.
export const volumeEvenLights=[
 {position:[0,0,1] as [number,number,number],intensity:1,color:[1,1,1] as [number,number,number]},
];
export const smartVolumeMaterial={ambient:.34,diffuse:.78,specular:.3,specularPower:32};
export const volumeLights=(mode:VolumeRenderSettings['lighting'])=>mode==='studio'?volumeStudioLights:volumeEvenLights;
export const volumeStyles:Definition[]=[
 {key:'bone',title:'Bone',subtitle:'Kortikal və süngəri sümük · HU',tone:'#eee0c5',threshold:260,opacity:1,
  scalar:[[-1024,0],[120,0],[200,.002],[260,.035],[340,.32],[420,.7],[650,.97],[1500,1],[3071,1]],
  color:[[-1024,.15,.035,.01],[120,.3,.09,.025],[200,.55,.2,.055],[260,.78,.43,.15],[340,.97,.85,.65],[420,1,.96,.85],[650,1,.99,.94],[1500,1,.99,.96],[3071,1,1,.98]],
  gradient:[[0,1],[1000,1]],shade:true,interpolation:1,blend:'composite',lighting:{...lighting(.22,.7,.12,28),sampling:.65,lightIntensity:.9},
  surface:{opacityUnitDistance:1,gradientOpacity:false,normalFromOpacity:false,occlusion:true}},
 {key:'abdomen-color',title:'Abdomen Color',subtitle:'Kontrastlı KT · qırmızı kontrast vurğusu, açıq sümük · orqan seqmentasiyası deyil',tone:'#e62d38',threshold:100,opacity:1,
  scalar:[[-1024,0],[-200,0],[20,0],[65,.001],[100,.008],[150,.025],[220,.07],[320,.16],[450,.22],[600,.3],[900,.55],[1500,.8],[3071,.95]],
  color:[[-1024,.08,.01,.015],[20,.15,.015,.025],[80,.5,.025,.04],[130,.85,.035,.055],[220,1,.08,.1],[350,1,.25,.27],[480,.94,.5,.46],[650,.82,.86,.82],[1000,.91,.95,.91],[1800,1,.99,.92],[3071,1,1,.98]],
  gradient:[[0,1],[1000,1]],shade:true,interpolation:1,blend:'composite',lighting:lighting(.35,.65,.3,24),
  surface:{opacityUnitDistance:1,gradientOpacity:false,normalFromOpacity:false,occlusion:false}},
 {key:'brain',title:'Brain',subtitle:'Beyin yumşaq toxuması · KT HU · kəllə kəsimi tələb oluna bilər',tone:'#d6a99a',threshold:20,opacity:1,scalar:[[-1024,0],[10,0],[25,.025],[40,.12],[65,.24],[100,.03],[160,0],[3071,0]],color:[[0,.2,.1,.08],[25,.65,.4,.35],[40,.86,.65,.58],[65,1,.87,.8],[100,1,.94,.9]],gradient:[[0,1],[1000,1]],shade:true,interpolation:1,blend:'composite',lighting:{...lighting(.35,.65,.22,30),sampling:.5},surface:{opacityUnitDistance:1,gradientOpacity:false,normalFromOpacity:false,occlusion:false}},
 {key:'vessel',title:'Vessels',subtitle:'Kontrastlı damar vurğusu · sümük də görünə bilər',tone:'#ea6c67',threshold:150,opacity:1,scalar:[[-1024,0],[100,0],[160,.04],[250,.32],[450,.7],[900,.85],[3071,1]],color:[[0,.2,.015,.025],[150,.7,.08,.12],[250,.95,.3,.35],[450,1,.7,.68],[900,1,.96,.88]],gradient:[[0,1],[1000,1]],shade:true,interpolation:1,blend:'composite',lighting:{...lighting(.35,.65,.3,32),sampling:.5},surface:{opacityUnitDistance:1,gradientOpacity:false,normalFromOpacity:false,occlusion:false}},
 {key:'angio',title:'Angio',subtitle:'Kontrastlı damarlar · HU',tone:'#e96543',threshold:120,opacity:1,scalar:[[-1024,0],[80,0],[140,.03],[250,.25],[450,.6],[900,.85],[3071,1]],color:[[0,.2,.01,.02],[120,.55,.025,.035],[200,.85,.05,.045],[300,1,.25,.09],[450,1,.7,.25],[650,1,.9,.62],[1000,1,.98,.91]],gradient:[[0,.05],[20,.25],[100,1]],shade:true,interpolation:1,blend:'composite',lighting:lighting(.2,.8,.4,40)},
 {key:'soft',title:'Soft Tissue',subtitle:'Yumşaq toxuma · HU',tone:'#c47068',threshold:0,opacity:1,scalar:[[-1024,0],[-150,0],[-50,.02],[40,.12],[150,.25],[400,.08],[3071,.1]],color:[[-150,.45,.25,.18],[0,.75,.4,.35],[100,1,.75,.6],[400,1,.92,.8]],gradient:[[0,.15],[20,.5],[80,1]],shade:true,interpolation:1,blend:'composite',lighting:lighting(.3,.7,.2,20)},
 {key:'lung',title:'Lung',subtitle:'Ağciyər parenximası · HU',tone:'#b6bec6',threshold:-760,opacity:1,scalar:[[-1024,0],[-950,0],[-850,.03],[-700,.12],[-400,.3],[-200,.02],[3071,0]],color:[[-1000,.12,.14,.16],[-800,.4,.43,.46],[-500,.75,.78,.8],[-200,.95,.96,.97]],gradient:[[0,.1],[10,.4],[80,1]],shade:true,interpolation:1,blend:'composite',lighting:lighting(.3,.75,.15,20)},
 {key:'airway',title:'Airway',subtitle:'Hava yolları · HU',tone:'#c2e7ef',threshold:-950,opacity:1,scalar:[[-1200,0],[-1024,0],[-1000,.1],[-940,.4],[-800,.03],[-600,0],[3071,0]],color:[[-1024,.2,.4,.65],[-950,.7,.9,1],[-800,1,1,1]],gradient:[[0,.02],[10,.3],[60,1]],shade:true,interpolation:1,blend:'composite',lighting:lighting(.3,.8,.2,25)},
 {key:'skin',title:'Skin',subtitle:'Dəri səthi · HU',tone:'#d99b7c',threshold:-280,opacity:1,scalar:[[-1024,0],[-500,0],[-280,.08],[-100,.5],[200,.75],[3071,.9]],color:[[-500,.35,.18,.12],[-280,.65,.35,.24],[0,.95,.7,.5],[400,1,.87,.7]],gradient:[[0,.05],[20,.6],[100,1]],shade:true,interpolation:1,blend:'composite',lighting:lighting(.3,.75,.2,22)},
 {key:'transparent',title:'Transparent',subtitle:'Şəffaf anatomik baxış · HU',tone:'#b4c9d6',threshold:0,opacity:.5,scalar:[[-1024,0],[-500,0],[-100,.008],[50,.02],[300,.04],[1000,.18],[3071,.3]],color:[[-500,.25,.3,.4],[0,.7,.45,.4],[300,.9,.6,.4],[1000,1,.95,.85]],gradient:[[0,.3],[100,1]],shade:true,interpolation:1,blend:'composite',lighting:lighting(.35,.65,.2,24)},
 {key:'mip',title:'MIP',subtitle:'Maksimum intensivlik proyeksiyası',tone:'#ddd',threshold:0,opacity:1,scalar:[[-1024,0],[0,0],[400,1],[3071,1]],color:[[-1024,0,0,0],[0,0,0,0],[400,1,1,1],[3071,1,1,1]],gradient:[[0,1],[1000,1]],shade:false,interpolation:1,blend:'maximum',lighting:lighting(1,0,0,1)},
 {key:'minip',title:'MinIP',subtitle:'Minimum intensivlik proyeksiyası',tone:'#899eae',threshold:0,opacity:1,scalar:[[-1024,1],[3071,1]],color:[[-1024,0,0,0],[-300,1,1,1],[3071,1,1,1]],gradient:[[0,1],[1000,1]],shade:false,interpolation:1,blend:'minimum',lighting:lighting(1,0,0,1)},
 {key:'mr',title:'MR',subtitle:'MRT siqnal intensivliyi',tone:'#bcc7d5',threshold:0,opacity:1,
  scalar:[[-1024,0],[-800,0],[-400,.015],[0,.06],[800,.18],[1500,.35],[3071,.8]],
  color:[[-1024,0,0,0],[-400,.28,.31,.36],[0,.5,.54,.6],[1500,.88,.91,.96],[3071,1,1,1]],
  gradient:[[0,1],[1000,1]],shade:true,interpolation:1,blend:'composite',lighting:lighting(.3,.7,.15,20),
  surface:{opacityUnitDistance:1,gradientOpacity:false,normalFromOpacity:false,occlusion:false}},
];
volumeStyles.push({...volumeStyles.find(p=>p.key==='abdomen-color')!,key:'organ',title:'Organ',subtitle:'HU toxuma rəngləməsi · ayrı orqan rəngləri üçün seqmentasiya lazımdır'});
// Both 3D entry points share the same material and unmodified HU transfer curves.
for(const definition of volumeStyles){
 if(definition.blend==='composite')definition.lighting={...smartVolumeMaterial,quality:'high',sourceQuality:'full',lighting:'even',shading:'surface',gradient:false,opacityDistance:1,sampling:1,lightIntensity:1,interpolation:'linear'};
}
export const volumePresetConfig=Object.fromEntries(volumeStyles.map(v=>[v.key,v])) as Record<VolumePreset,Definition>;
/** Physical opacity distance is in mm; gradients are calibrated scalar differences. */
export function resolvedVolumeSettings(preset:VolumePreset, settings:VolumeRenderSettings):Required<Omit<VolumeRenderSettings,'customTransfer'|'crop'>>&Pick<VolumeRenderSettings,'customTransfer'|'crop'> {
 const definition=volumePresetConfig[preset];
 return {sourceQuality:'full',lighting:'even',shading:'surface',opacityDistance:definition.surface?.opacityUnitDistance??1,
  transferWidth:1,sampling:1,gradient:definition.surface?.gradientOpacity??definition.shade,
  gradientMin:definition.gradient[0][0],gradientMax:definition.gradient.at(-1)![0],normalFromOpacity:definition.surface?.normalFromOpacity??false,
  occlusionRadius:2,occlusionSamples:16,scattering:.25,shadowReach:.12,lightIntensity:1,interpolation:'linear',mouseMode:'rotate',...settings};
}
export const qualityProfiles={
 performance:{sample:1.8,interaction:5,imageSample:1.4},
 balanced:{sample:1,interaction:3.5,imageSample:1},
 high:{sample:.5,interaction:3,imageSample:1},
 ultra:{sample:.35,interaction:2.5,imageSample:1},
} as const;
