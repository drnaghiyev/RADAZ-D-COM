import test from 'node:test';
import assert from 'node:assert/strict';
import {volumeStyles,smartVolumeMaterial,volumeLights,qualityProfiles,resolvedVolumeSettings} from '../lib/volume-presets.ts';
test('main and Smart Volume share composite material and physical rendering defaults',()=>{
 for(const preset of volumeStyles.filter(p=>p.blend==='composite')){
  const resolved=resolvedVolumeSettings(preset.key,preset.lighting);
  for(const key of Object.keys(smartVolumeMaterial))assert.equal(resolved[key],smartVolumeMaterial[key],`${preset.key}: ${key}`);
  assert.equal(resolved.opacityDistance,1);assert.equal(resolved.gradient,false);assert.equal(resolved.interpolation,'linear');
  assert.equal(qualityProfiles[resolved.quality].sample*resolved.sampling,.5);
 }
 assert.equal(volumeLights('even').length,1);assert.equal(volumeLights('even')[0].intensity,1);
});
