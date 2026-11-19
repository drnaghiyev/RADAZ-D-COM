import assert from 'node:assert/strict';import {test} from 'node:test';
import {deflatePixels,inflatePixels} from '../lib/portable-dicom.ts';
test('offline transport preserves every calibrated scalar, including fractional and high CT values',async()=>{
 const values=new Float32Array([-1024.5,123.125,80000,0,255]);const source=new Uint8Array(values.buffer),encoded=await deflatePixels(source),restored=await inflatePixels(encoded);assert.deepEqual(restored,source);
});
