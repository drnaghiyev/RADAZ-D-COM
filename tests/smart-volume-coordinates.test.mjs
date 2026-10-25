import {test} from 'node:test';
import assert from 'node:assert/strict';
import {loadTypeScript} from './load-typescript.mjs';
const {SmartSliceEngine}=loadTypeScript('lib/smart-volume/slice-renderer.ts');
const {indexToWorld}=loadTypeScript('lib/smart-volume/navigation.ts');
const {worldToIndex}=loadTypeScript('lib/smart-volume/geometry.ts');
const noop=()=>{};
globalThis.devicePixelRatio=2;
globalThis.document={createElement:()=>({style:{},remove:noop})};
const owner={requestAnimationFrame:()=>1,cancelAnimationFrame:noop};
const host=()=>({clientWidth:640,clientHeight:480,appendChild:noop,ownerDocument:{defaultView:owner}});
test('all source planes preserve voxel coordinates after pan, zoom and resize',()=>{
 const c=Math.cos(.3),s=Math.sin(.3);
 const geometry={dimensions:[40,32,24],spacing:[.7,.9,2.5],origin:[-20,13,44],direction:[c,s,0,-s,c,0,0,0,1]};
 const hosts=[host(),host(),host()];const engine=new SmartSliceEngine(geometry,new Float32Array(30720),new Uint8Array(30720),hosts,['x','y','z']);
 for(const [axis,v] of engine.getViewports().entries()){
  const index=[13,17,11],world=indexToWorld(geometry,index),camera=v.getCamera();
  v.setCamera({focalPoint:world,position:world.map((n,i)=>n+camera.viewPlaneNormal[i]*1000)});
  for(const scale of [5,35,150]){
   v.setCamera({parallelScale:scale});
   const a=v.canvasToWorld([0,0]),b=v.canvasToWorld([35,-22]);
   const cam=v.getCamera();v.setCamera({focalPoint:cam.focalPoint.map((n,i)=>n+a[i]-b[i])});
   const screen=v.worldToCanvas(world),actual=worldToIndex(geometry,v.canvasToWorld(screen));
   actual.forEach((n,i)=>assert.ok(Math.abs(n-index[i])<1e-9,`${axis}: ${actual}`));
   hosts[axis].clientWidth=930;hosts[axis].clientHeight=610;v.resize(true);
   const resized=worldToIndex(geometry,v.canvasToWorld(v.worldToCanvas(world)));
   resized.forEach((n,i)=>assert.ok(Math.abs(n-index[i])<1e-9));
  }
 }
 engine.destroy();
});
