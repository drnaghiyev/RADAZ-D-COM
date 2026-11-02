import test from 'node:test';
import assert from 'node:assert/strict';
import {bindPresentationSync} from '../lib/presentation-sync.ts';
function setup(modality='CT'){
 const handlers={};const root={addEventListener:(name,fn)=>handlers[name]=event=>fn({...event,type:name}),removeEventListener:name=>delete handlers[name]};
 const make=(id,range)=>({id,element:{clientWidth:500,clientHeight:500},range,zoom:1,pan:[0,0],getCurrentImageId:()=>id,getProperties(){return {voiRange:this.range};},setProperties(p){this.range=p.voiRange;},getZoom(){return this.zoom;},setZoom(z){this.zoom=z;},getPan(){return this.pan;},setPan(p){this.pan=p;},render(){}});
 const a=make('panel-A',{lower:-1000,upper:400}),b=make('panel-B',{lower:-150,upper:250});
 const stop=bindPresentationSync(root,()=>[a,b],()=> 'A',()=>modality);
 return {a,b,handlers,stop};
}
test('CT lung/mediastinal windows stay distinct while zoom and pan synchronize',()=>{
 const {a,b,handlers,stop}=setup();handlers.CORNERSTONE_VOI_MODIFIED({target:a.element});assert.deepEqual(b.range,{lower:-150,upper:250});
 a.zoom=2;a.pan=[25,30];handlers.CORNERSTONE_CAMERA_MODIFIED({target:a.element,detail:{}});assert.equal(b.zoom,2);assert.deepEqual(b.pan,[25,30]);
 assert.equal(handlers.CORNERSTONE_ANNOTATION_MODIFIED,undefined);stop();assert.deepEqual(handlers,{});
});
test('MR windows synchronize and CT windows with the same tissue setting synchronize',()=>{
 for(const modality of ['CT','MR']){const {a,b,handlers,stop}=setup(modality);if(modality==='CT')a.range={lower:-100,upper:200};
 handlers.CORNERSTONE_VOI_MODIFIED({target:a.element});assert.deepEqual(a.range,b.range);stop();}
});
test('Rotations are not synchronized',()=>{const {a,b,handlers,stop}=setup();a.zoom=3;handlers.CORNERSTONE_CAMERA_MODIFIED({target:a.element,detail:{previousCamera:{viewUp:[0,1,0]},camera:{viewUp:[1,0,0]}}});assert.equal(b.zoom,1);stop();});

