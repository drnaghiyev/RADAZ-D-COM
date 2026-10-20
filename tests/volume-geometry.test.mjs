import test from 'node:test';
import assert from 'node:assert/strict';
import {describeVolume} from '../lib/volume-geometry.ts';
const frames=()=>Array.from({length:8},(_,i)=>({id:String(i),studyId:'study',frameId:'frame',origin:[12,-80-i*1.4*.6,20+i*1.4*.8],
 columnDirection:[1,0,0],rowDirection:[0,.8,.6],rowSpacing:.7,columnSpacing:.8,rows:16,columns:24,sliceThickness:2,spacingBetweenSlices:1.4}));
test('oblique geometry follows physical positions, independent of input/instance order',()=>{
 const result=describeVolume(frames().reverse());assert.deepEqual(result.imageIds,['0','1','2','3','4','5','6','7']);
 assert.deepEqual(result.origin,[12,-80,20]);assert.deepEqual(result.dimensions,[24,16,8]);
 assert.ok(Math.abs(result.spacing[2]-1.4)<1e-6);assert.deepEqual(result.direction,[1,0,0,0,.8,.6,0,-.6,.8]);
 assert.equal(result.spacing[0],.8);assert.equal(result.spacing[1],.7);assert.equal(result.sliceThickness,2);
});
test('reject incompatible frames, missing slices, tilt and invalid geometry instead of distorting anatomy',()=>{
 for(const change of [f=>f[3].frameId='other',f=>f[3].rowSpacing=.9,f=>f[3].origin[0]+=3,
  f=>f.splice(3,1),f=>f[3].origin=f[2].origin,f=>f[3].origin[2]=NaN,f=>f[0].rowDirection=[1,0,0]]){
  const values=frames();change(values);assert.throws(()=>describeVolume(values));
 }
});

test('reimported SOP instances do not duplicate slices, while conflicting phases stay rejected',()=>{
 const values=frames().map((f,i)=>({...f,sopUID:`1.2.${i}`}));
 const duplicate=values.map(f=>({...f,id:`copy-${f.id}`}));
 const volume=describeVolume([...values,...duplicate]);
 assert.equal(volume.dimensions[2],8);assert.deepEqual(volume.imageIds,values.map(f=>f.id));
 assert.throws(()=>describeVolume([...values,{...values[0],id:'phase',sopUID:'9.1'}]));
 assert.throws(()=>describeVolume([...values,{...values[0],id:'corrupt',origin:[0,0,0]}]));
});
