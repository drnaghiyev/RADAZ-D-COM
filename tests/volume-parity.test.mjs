import assert from 'node:assert/strict';
import {test} from 'node:test';
import {loadTypeScript} from './load-typescript.mjs';
const {contextVolume}=loadTypeScript('lib/smart-volume/context-volume.ts');
const {workstationSettings}=loadTypeScript('lib/volume-workstation.ts');
const {smartVolumeMaterial}=loadTypeScript('lib/volume-presets.ts');
const {resolveVolumeSourceQuality}=loadTypeScript('lib/volume-source-quality.ts');
test('main 3D uses Smart Volume material and automatic source policy',()=>{
 for(const p of ['bone','angio','soft','lung','organ']){
  const s=workstationSettings(p);for(const [k,v] of Object.entries(smartVolumeMaterial))assert.equal(s[k],v);
  assert.equal(s.lighting,'even');assert.equal(s.gradient,false);assert.equal(s.sourceQuality,'auto');
 }
 assert.equal(resolveVolumeSourceQuality([512,512,442]),'light');
 assert.equal(resolveVolumeSourceQuality([128,128,100]),'full');
 assert.equal(resolveVolumeSourceQuality([512,512,442],'full'),'full');
});
test('optimized preview preserves interpolation, physical extent and every Z plane',()=>{
 const g={dimensions:[13,11,442],spacing:[.7,.9,1.1],origin:[5,-3,10],direction:[0,1,0,-1,0,0,0,0,1]};
 const source=Float32Array.from({length:13*11*442},(_,i)=>Math.sin(i)*500+i%17);
 const out=contextVolume(g,source,7);assert.equal(out.dimensions[2],442);
 for(let z=0;z<442;z++)for(let y=0;y<7;y++)for(let x=0;x<7;x++){
  const px=(x+.5)*13/7-.5,py=(y+.5)*11/7-.5,x0=Math.floor(px),y0=Math.floor(py),fx=px-x0,fy=py-y0;
  let v=0;for(let iy=0;iy<2;iy++)for(let ix=0;ix<2;ix++)v+=source[(z*11+y0+iy)*13+x0+ix]*(ix?fx:1-fx)*(iy?fy:1-fy);
  assert.ok(Math.abs(out.values[(z*7+y)*7+x]-v)<.0001);
 }
 assert.equal(out.spacing[2],g.spacing[2]);
});
