import {volumePresetConfig,type VolumePreset,type VolumeRenderSettings} from './volume-presets';
/** Main workstation defaults. Source geometry and measured voxel values stay unchanged. */
export function workstationSettings(preset:VolumePreset):VolumeRenderSettings{
 const base=volumePresetConfig[preset].lighting;
 if(preset==='mr'||preset==='mip'||preset==='minip')return {...base};
 return {...base,quality:'high',lighting:'studio',shading:'surface',ambient:.26,diffuse:.76,specular:.28,specularPower:36,
  gradient:preset==='bone'||preset==='angio',gradientMin:0,gradientMax:preset==='bone'?90:60,
  normalFromOpacity:false,sampling:1,transferWidth:1};
}
