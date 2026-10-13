import test from 'node:test';
import assert from 'node:assert/strict';
import {loadTypeScript} from './load-typescript.mjs';
const {displayMeasurement}=loadTypeScript('lib/measurement-units.ts');
test('physical distances convert both ways, preserving calibration labels',()=>{
  assert.deepEqual(displayMeasurement(125,'mm','cm'),{value:12.5,unit:'sm'});
  assert.deepEqual(displayMeasurement(12.5,'cm','mm'),{value:125,unit:'mm'});
  assert.deepEqual(displayMeasurement(80,'mm US Region','cm'),{value:8,unit:'sm US Region'});
});
test('physical areas use squared conversion; pixel and unknown values are untouched',()=>{
  assert.deepEqual(displayMeasurement(250,'mm²','cm'),{value:2.5000000000000004,unit:'sm²'});
  assert.deepEqual(displayMeasurement(2.5,'cm²','mm'),{value:250,unit:'mm²'});
  for(const source of ['px','px²','unknown','']) assert.deepEqual(displayMeasurement(123,source,'cm'),{value:123,unit:source});
});
