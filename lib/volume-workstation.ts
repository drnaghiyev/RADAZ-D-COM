import {volumePresetConfig,type VolumePreset,type VolumeRenderSettings} from './volume-presets';
/** Main workstation defaults. Source geometry and measured voxel values stay unchanged. */
export function workstationSettings(preset:VolumePreset):VolumeRenderSettings{
 const base=volumePresetConfig[preset].lighting;
 // Do not override the shared Smart Volume material with a second studio preset.
 return {...base,sourceQuality:'auto',normalFromOpacity:false,transferWidth:1};
}
