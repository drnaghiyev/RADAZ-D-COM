import test from 'node:test';
import assert from 'node:assert/strict';
import {loadTypeScript} from './load-typescript.mjs';
const {brushIndices,correct,structureCenter}=loadTypeScript('lib/anatomy-editing.ts');
const {exportSegmentation,importSegmentation}=loadTypeScript('lib/anatomy-file.ts');
const geometry={dimensions:[7,7,7],spacing:[1,1,2],direction:[0,1,0,-1,0,0,0,0,1],origin:[20,30,40],modality:'CT'};
const result=()=>({...geometry,mask:new Uint8Array(343),classes:{1:'liver'},sourceKey:'source',sourceFingerprint:'f'.repeat(64),task:'total',device:'cpu',seconds:1,modelSpacingMm:3,experimental:true});
test('oblique brush edits a physical disc, preserves immutable mask and supports erasing overrides',()=>{
 const r=result(),indices=brushIndices(r,[17,33,46],[0,0,1],1.1);
 assert.equal(indices.length,5);assert.ok(indices.every(i=>Math.floor(i/49)===3));
 const edits=correct(r,indices,1);assert.equal(edits.size,5);assert.ok(r.mask.every(n=>n===0));
 assert.deepEqual(structureCenter({...r,corrections:edits},1),[17,33,46]);
 assert.equal(correct({...r,corrections:edits},indices,0).size,0);
 assert.throws(()=>correct(r,[400],1));assert.throws(()=>correct(r,[5],99));
});
test('segmentation export/import keeps original and corrections separate; rejects other source or corrupt bytes',async()=>{
 const r=result();r.corrections=new Map([[100,1]]);
 const blob=await exportSegmentation(r),file=new File([blob],'test.radazseg');
 const loaded=await importSegmentation(file,geometry,r.sourceFingerprint,'new-session');
 assert.equal(loaded.mask[100],0);assert.equal(loaded.corrections.get(100),1);assert.equal(loaded.sourceKey,'new-session');
 await assert.rejects(()=>importSegmentation(file,geometry,'other','x'));
 await assert.rejects(()=>importSegmentation(file,{...geometry,spacing:[1,1,3]},r.sourceFingerprint,'x'));
 const bytes=new Uint8Array(await blob.arrayBuffer());bytes[bytes.length-1]^=1;
 await assert.rejects(()=>importSegmentation(new File([bytes],'bad.radazseg'),geometry,r.sourceFingerprint,'x'));
});
