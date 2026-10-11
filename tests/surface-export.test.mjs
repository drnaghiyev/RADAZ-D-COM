import test from 'node:test';
import assert from 'node:assert/strict';
import {loadTypeScript} from './load-typescript.mjs';
const {surfacesToPly}=loadTypeScript('lib/surface-export.ts');
test('PLY preserves patient coordinates, merges triangle indices and rejects malformed meshes',async()=>{
 const mesh={points:[-10,20,30,-9,20,30,-10,21,30],polys:[3,0,1,2],color:[1,.5,0]};
 const bytes=new Uint8Array(await surfacesToPly([mesh,mesh]).arrayBuffer());
 const text=new TextDecoder().decode(bytes),start=text.indexOf('end_header\n')+11;
 assert.match(text,/element vertex 6\n/);assert.match(text,/element face 2\n/);
 const view=new DataView(bytes.buffer,start);assert.equal(view.getFloat32(0,true),-10);assert.equal(view.getUint8(13),128);
 assert.equal(view.getUint32(6*15+13+1,true),3);assert.equal(view.getUint32(6*15+13+9,true),5);
 for(const bad of [{...mesh,color:[1]},{...mesh,points:[NaN,0,0]},{...mesh,polys:[3,0,1,8]}])assert.throws(()=>surfacesToPly([bad]));
});
