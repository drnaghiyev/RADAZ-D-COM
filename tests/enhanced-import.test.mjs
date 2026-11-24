import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import {frameMetadata,indexableNativeFrames} from '../lib/dicom-frame-metadata.ts';
import {storedZipMembers} from '../lib/stored-zip.ts';
import {describeVolume} from '../lib/volume-geometry.ts';

const dataset = (tags={},elements={}) => ({
  elements, uint16:tag=>tags[tag], string:(tag,index)=>index===undefined?tags[tag]:tags[tag]?.split('\\')[index],
});
const sequence=(...items)=>({items:items.map(dataSet=>({dataSet}))});

test('enhanced MR uses each frame VOI, scaling and patient geometry with shared fallback',()=>{
  const shared=dataset({}, {x00289110:sequence(dataset({x00280030:'0.7\\0.8'})),x00289145:sequence(dataset({x00281053:'2.2'}))});
  const frame=(z,wc)=>dataset({}, {x00209113:sequence(dataset({x00200032:'12\\13\\'+z})),x00289132:sequence(dataset({x00281050:wc,x00281051:'500'}))});
  const source=dataset({x00200052:'1.2.3',x00281050:'40'}, {x52009229:sequence(shared),x52009230:sequence(frame(4,'150'),frame(9,'250'))});
  const a=frameMetadata(source,0),b=frameMetadata(source,1);
  assert.deepEqual([a.string('x00281050'),b.string('x00281050'),b.string('x00200032',2)],['150','250','9']);
  assert.deepEqual([a.string('x00280030'),b.string('x00281053'),b.string('x00200052')],['0.7\\0.8','2.2','1.2.3']);
  assert.equal(a.elements,source.elements);assert.equal(source.string('x00281050'),'40');
  const classic=dataset({x00281050:'21'});assert.equal(frameMetadata(classic,0),classic);
});

test('deferred native decoding requires all frames to fit the original pixel element',()=>{
  const ds=dataset({x00280100:16,x00280010:16,x00280011:16,x00280002:1,x00280004:'MONOCHROME2'}, {x7fe00010:{dataOffset:100,length:1024}});
  assert.equal(indexableNativeFrames(ds,1124,2),true);
  assert.equal(indexableNativeFrames(ds,1123,2),false);
  assert.equal(indexableNativeFrames(ds,1124,3),false);
  ds.elements.x7fe00010.encapsulatedPixelData=true;assert.equal(indexableNativeFrames(ds,1124,2),false);
});

test('different frames of one SOP remain separate physical slices',()=>{
  const base={sopUID:'1.2.3',studyId:'1.2.4',frameId:'1.2.5',columnDirection:[1,0,0],rowDirection:[0,1,0],rows:16,columns:16,rowSpacing:1,columnSpacing:1};
  const frames=[0,1,2].map(frameIndex=>({...base,frameIndex,id:'slice'+frameIndex,origin:[0,0,frameIndex]}));
  assert.deepEqual(describeVolume([...frames,{...frames[1],id:'reopened'}]).imageIds,['slice0','slice1','slice2']);
});

test('stored ZIP members retain order, exact bytes and names; compressed members use normal extraction',async()=>{
  const z=new JSZip();z.file('folder/A.dcm',new Uint8Array([0,128,255]));z.file('B.dcm','second');
  const make=async compression=>new File([await z.generateAsync({type:'arraybuffer',compression,streamFiles:true,comment:'MR'})],'images.zip');
  const files=await storedZipMembers(await make('STORE'));assert.deepEqual(files.map(f=>f.name),['folder/A.dcm','B.dcm']);
  assert.deepEqual([...new Uint8Array(await files[0].arrayBuffer())],[0,128,255]);assert.equal(await files[1].text(),'second');
  assert.equal(await storedZipMembers(await make('DEFLATE')),null);
  assert.equal(await storedZipMembers(new File(['bad'],'bad.zip')),null);
});
