import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {loadTypeScript} from './load-typescript.mjs';
const {anatomyTerm}=loadTypeScript('lib/anatomy-terms.ts');
// Class identifiers from the installed Apache-2.0 TotalSegmentator 2.18.0 map.
const registry=JSON.parse(readFileSync(new URL('./anatomy-model-labels.json',import.meta.url)));
test('all six registered model anatomies have AZ, RU and EN labels, excluding deliberately removed pathology',()=>{
 for(const labels of Object.values(registry))for(const key of Object.values(labels)){
  if(key.startsWith('kidney_cyst_'))continue;
  for(const language of ['az','ru','en'])assert.ok(!anatomyTerm(key,language).includes('[EN]'),`${language}: ${key}`);
 }
 assert.notEqual(anatomyTerm('kidney_left','en'),anatomyTerm('kidney_right','en'));
 assert.match(anatomyTerm('unknown_future_model_label','az'),/^\[EN\]/);
});
