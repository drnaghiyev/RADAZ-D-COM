import test from 'node:test';
import assert from 'node:assert/strict';
import {createScalpelBuffer} from '../lib/scalpel-buffer.ts';
test('large clinical volume cuts without old 64M cap and preserves source, undo and reset',()=>{
 const source=new Uint8Array(64*1024*1024+8);source[0]=42;source[source.length-1]=88;
 const buffer=createScalpelBuffer(source,-4096),first=buffer.begin();
 assert.ok(first.byteLength<=source.length/8+1);
 assert.ok(buffer.remove(0,first));assert.ok(buffer.remove(source.length-1,first));
 assert.equal(source[0],42);assert.equal(source.at(-1),88);
 const second=buffer.begin();assert.equal(buffer.remove(0,second),false);buffer.remove(1,second);
 buffer.restore(second);assert.equal(buffer.values[0],-4096);assert.equal(buffer.values[1],0);
 buffer.restore(first);assert.equal(buffer.values[0],42);assert.equal(buffer.values.at(-1),88);
 buffer.remove(2,buffer.begin());buffer.reset();assert.equal(buffer.values[2],source[2]);
});
