import test from 'node:test';
import assert from 'node:assert/strict';
import {synchronizedSlice,bindProjectionPresentation} from '../lib/viewer-navigation.ts';
const plane=z=>({studyId:'study',frameId:'frame',origin:[0,0,z],columnDirection:[1,0,0],rowDirection:[0,1,0],columnSpacing:1,rowSpacing:1,columns:64,rows:64});
test('Sync Scroll matches physical locations across different counts, spacing and reversed acquisition',()=>{
  const target=[30,25,20,15,10,5,0].map(plane);
  assert.equal(synchronizedSlice(plane(16),target),3);
  assert.equal(synchronizedSlice(plane(25),target),1);
  assert.equal(synchronizedSlice(plane(-10),target),null);
});
test('Sync Scroll refuses unrelated, missing and nonparallel geometry',()=>{
  for(const patch of [{studyId:'other'},{frameId:'other'},{frameId:''},{columnDirection:[0,0,1]}])assert.equal(synchronizedSlice(plane(5),[plane(0),{...plane(5),...patch}]),null);
  assert.equal(synchronizedSlice({...plane(0),frameId:''},[plane(0),plane(5)]),null);
  assert.equal(synchronizedSlice(plane(0),[plane(0),null]),null);
});
const events={PRE_STACK_NEW_IMAGE:'before',STACK_NEW_IMAGE:'shown',CAMERA_MODIFIED:'camera'};
test('XR presentations follow SOP identity, isolate other images, survive remount and ignore late renders',async()=>{
  let image='',zoom=1,pan=[0,0],projection=true;const values=new Map(),element=new EventTarget();
  const vp={element,getCurrentImageId:()=>image,getZoom:()=>zoom,getPan:()=>pan,setZoom:v=>{zoom=v;element.dispatchEvent(new Event('camera'));},setPan:v=>{pan=[...v];element.dispatchEvent(new Event('camera'));},render(){}};
  const identity=id=>id.split(':').at(-1);
  const connect=()=>bindProjectionPresentation(vp,values,events,identity,()=>projection);
  let stop=connect();
  const show=async id=>{element.dispatchEvent(new Event('before'));image=id;element.dispatchEvent(new Event('shown'));await Promise.resolve();};
  await show('original:one');vp.setZoom(2);vp.setPan([12,8]);
  await show('original:two');assert.equal(zoom,1);assert.deepEqual(pan,[0,0]);vp.setZoom(3);vp.setPan([-10,5]);
  await show('archive:one');assert.equal(zoom,2);assert.deepEqual(pan,[12,8]);
  stop();stop=connect();await show('archive:two');assert.equal(zoom,3);assert.deepEqual(pan,[-10,5]);
  projection=false;await show('ct:one');assert.equal(zoom,3);assert.deepEqual(pan,[-10,5]);stop();
});
