import {test} from 'node:test';
import assert from 'node:assert/strict';
import {loadTypeScript} from './load-typescript.mjs';
const {measureMask,validateGeometry,worldToIndex}=loadTypeScript('lib/smart-volume/geometry.ts');
const {rasterizeContour,interpolateContours}=loadTypeScript('lib/smart-volume/contours.ts');
const geometry={dimensions:[10,10,10],spacing:[.5,.5,2],origin:[10,20,30],direction:[0,1,0,-1,0,0,0,0,1]};
const {radiologicalOrientation,indexToWorld,orientationLetter}=loadTypeScript('lib/smart-volume/navigation.ts');
test('radiological left-right orientation survives reversed source axes',()=>{
 for(const direction of [[1,0,0,0,1,0,0,0,1],[-1,0,0,0,-1,0,0,0,1]])for(const axis of [1,2]){
  const {viewUp:u,viewPlaneNormal:n}=radiologicalOrientation({...geometry,direction},axis);
  const right=[u[1]*n[2]-u[2]*n[1],u[2]*n[0]-u[0]*n[2],u[0]*n[1]-u[1]*n[0]];
  assert.equal(orientationLetter(right),'L');assert.equal(orientationLetter(right.map(n=>-n)),'R');
 }
});
test('localizer index-to-world retains oblique coordinates',()=>{
 const index=[3,5,7];assert.deepEqual(worldToIndex(geometry,indexToWorld(geometry,index)),index);
});
test('anisotropic volume counts occupied voxels, not bounding box',()=>{
 const mask=new Uint8Array(1000);mask[0]=1;mask[999]=1;mask[500]=2;
 const m=measureMask(mask,geometry,1);assert.equal(m.mm3,1);assert.equal(m.ml,.001);assert.deepEqual(m.orientedExtentsMm,[5,5,20]);
 assert.equal(measureMask(mask,geometry,2).mm3,.5);
});
test('empty mask and invalid geometry',()=>{
 assert.deepEqual(measureMask(new Uint8Array(1000),geometry,1).orientedExtentsMm,[0,0,0]);
 assert.throws(()=>validateGeometry({...geometry,spacing:[0,1,1]}));
 assert.throws(()=>validateGeometry({...geometry,direction:[1,0,0,1,0,0,0,0,1]}));
 assert.throws(()=>measureMask(new Uint8Array(5),geometry,1));
});
test('oblique coordinate transform retains physical position',()=>assert.deepEqual(worldToIndex(geometry,[9,21,36]),[2,2,3]));
test('polygon filling on all three index planes',()=>{
 for(const axis of [0,1,2]){
 const result=rasterizeContour(geometry,{axis,slice:4,points:[[1.5,1.5],[4.5,1.5],[4.5,4.5],[1.5,4.5]]});
 assert.equal(result.length,9);
 for(const i of result)assert.equal([i%10,Math.floor(i/10)%10,Math.floor(i/100)][axis],4);
 }
});
test('interpolation preserves anchors and rejects mismatched topology',()=>{
 const a={axis:2,slice:0,points:[[0,0],[2,0],[2,2]]},b={axis:2,slice:2,points:[[2,2],[4,2],[4,4]]};
 assert.deepEqual(interpolateContours(a,b)[0].points,[[1,1],[3,1],[3,3]]);
 assert.throws(()=>interpolateContours(a,{...b,axis:1}));
});
test('binary persistence preserves geometry and rejects another series or damaged mask',async()=>{
 const {encodeSnapshot,decodeSnapshot}=loadTypeScript('lib/smart-volume/storage.ts');
 const original={schema:1,segmentationId:'test',seriesInstanceUID:'1.2.3',frameOfReferenceUID:'1.2.4',geometry,segments:[{id:1,name:'Test',color:'#abcdef'}],mask:new Uint8Array(1000)};
 original.mask[4]=1;
 const blob=await encodeSnapshot(original),read=await decodeSnapshot(blob,original);
 assert.deepEqual(read.mask,original.mask);
 await assert.rejects(decodeSnapshot(blob,{...original,seriesInstanceUID:'1.2.5'}));
 const bytes=new Uint8Array(await blob.arrayBuffer());bytes[bytes.length-1]=1;
 await assert.rejects(decodeSnapshot(new Blob([bytes]),original));
});

const {contextVolume}=loadTypeScript('lib/smart-volume/context-volume.ts');
test('context preview keeps physical bounds and does not change source measurements',()=>{
 const g={dimensions:[8,6,4],spacing:[.7,1.2,2],origin:[10,20,30],direction:[0,1,0,-1,0,0,0,0,1]};const source=Float32Array.from({length:192},(_,i)=>i),before=source.slice(),preview=contextVolume(g,source,3);
 assert.deepEqual(source,before);assert.deepEqual(preview.dimensions,[3,3,4]);
 for(const side of [0,1]){const original=indexToWorld(g,g.dimensions.map(n=>side?n-.5:-.5)),sampled=indexToWorld(preview,preview.dimensions.map(n=>side?n-.5:-.5));original.forEach((n,a)=>assert.ok(Math.abs(n-sampled[a])<1e-6));}
 assert.equal(preview.values.length,36);
});

test('native sagittal and coronal MRI stacks retain superior up',()=>{
 for(const direction of [[0,1,0,0,0,1,1,0,0],[1,0,0,0,0,1,0,-1,0]]){
 const o=radiologicalOrientation({...geometry,direction},2);assert.equal(orientationLetter(o.viewUp),'S');
 }
});

test('3D preview retains every source slice',()=>{const g={...geometry,dimensions:[4,4,442]};const data=Float32Array.from({length:4*4*442},(_,i)=>Math.floor(i/16));const p=contextVolume(g,data,2);assert.equal(p.dimensions[2],442);for(let z=0;z<442;z++)assert.equal(p.values[z*4],z);});
