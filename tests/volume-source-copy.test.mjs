import test from 'node:test';import assert from 'node:assert/strict';
import {copyVolumeScalars} from '../lib/volume-source-copy.ts';
test('volume copying yields to UI and preserves all scalar samples',async()=>{const input=Float32Array.from({length:600000},(_,i)=>i/10-1000);let ticks=0;const timer=setInterval(()=>ticks++,0);const output=await copyVolumeScalars(input,()=>false);clearInterval(timer);assert.deepEqual(output,input);assert.ok(ticks>=2);});
test('closing during preparation cancels the copy',async()=>{let closed=false;setTimeout(()=>closed=true,0);await assert.rejects(copyVolumeScalars({length:600000,getAtIndex:i=>i},()=>closed));});

test('signed 16-bit CT copy retains every voxel using half the float storage',async()=>{const values=Int16Array.from({length:600000},(_,i)=>(i%4000)-1024);const output=await copyVolumeScalars(values,()=>false,'int16');assert.ok(output instanceof Int16Array);assert.equal(output.byteLength,values.length*2);assert.deepEqual(output,values);});
