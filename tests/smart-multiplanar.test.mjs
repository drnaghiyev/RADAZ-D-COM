import test from 'node:test';import assert from 'node:assert/strict';
import {loadTypeScript} from './load-typescript.mjs';
const {mapContour}=loadTypeScript('lib/smart-volume/multiplanar.ts');
const axial={dimensions:[32,32,12],spacing:[1,1,2],origin:[0,0,0],direction:[1,0,0,0,1,0,0,0,1]};
const sagittal={...axial,direction:[0,1,0,0,0,1,1,0,0]};
test('native MRI contour maps through LPS into another series plane',()=>{
 const c={axis:2,slice:5,points:[[10,10],[20,10],[20,20],[10,20]]};
 const mapped=mapContour(c,axial,sagittal);assert.equal(mapped.axis,1);assert.equal(mapped.slice,10);
 assert.deepEqual(mapped.points,[[10,5],[10,10],[20,10],[20,5]]);
 assert.deepEqual(mapContour(mapped,sagittal,axial),c);
});
test('outside and oblique contours are rejected instead of misplaced',()=>{
 const c={axis:2,slice:5,points:[[10,10],[20,10],[20,20]]};
 assert.throws(()=>mapContour(c,axial,{...sagittal,origin:[100,0,0]}));
 assert.throws(()=>mapContour(c,axial,{...axial,direction:[1,0,0,0,.8,.6,0,-.6,.8]}));
});
