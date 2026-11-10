import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { prefetchOrdered } from '../lib/import-pipeline.ts';
import { diskFiles } from '../lib/disk-archive.ts';

test('prefetch preserves source order, bounds memory, and observes consumer backpressure', async () => {
  let started=0, active=0, peak=0;
  const items=Array.from({length:20},(_,i)=>i);
  const iterator=prefetchOrdered(items,async n=>{
    started++;active++;peak=Math.max(peak,active);await delay(n===0?20:2);active--;return n;
  },4,()=>8,24);
  assert.equal((await iterator.next()).value,0);
  await delay(20);assert.equal(started,3,'paused consumer must not queue the rest of the study');
  const result=[0];for await(const n of iterator)result.push(n);
  assert.deepEqual(result,items);assert.ok(peak<=3);
});

test('an oversized input runs alone and in-flight failures are drained on early exit', async()=>{
  let active=0,peak=0;
  const items=[80,8,8,8];
  const iterator=prefetchOrdered(items,async n=>{active++;peak=Math.max(peak,active);await delay(10);active--;if(n===8)throw Error('read failed');return n;},4,n=>n,24);
  assert.equal((await iterator.next()).value,80);assert.equal(peak,1);
  await assert.rejects(iterator.next(),/read failed/);assert.equal(active,0);
});

test('archive prefetch keeps images and completed-series notifications in catalog order', async()=>{
  const previousFetch=globalThis.fetch, previousWindow=globalThis.window;
  const catalog=Array.from({length:36},(_,i)=>({uid:String(i),series:i<18?'A':'B',size:1024}));
  let active=0,peak=0;
  globalThis.window={location:{hostname:'localhost'}};
  globalThis.fetch=async url=>{
    if(String(url).includes('/instances'))return Response.json(catalog);
    const n=Number(String(url).split('/').at(-1));active++;peak=Math.max(peak,active);
    await delay(n===0?15:2);active--;return new Response(String(n));
  };
  try {
    const published=[],progress=[];
    const files=await diskFiles('study',(n)=>progress.push(n),async(batch,pending)=>{
      published.push({names:batch.map(f=>f.name),pending:[...pending]});await delay(2);
    });
    assert.deepEqual(files.map(f=>f.name),catalog.map(f=>`${f.uid}.dcm`));
    assert.deepEqual(published[0].names,['0.dcm'],'first image is published immediately');
    const completedA=published.find(p=>p.names.includes('17.dcm'));
    assert.deepEqual(completedA.pending,['B']);
    assert.deepEqual(published.at(-1).pending,[]);
    assert.deepEqual(progress,Array.from({length:37},(_,i)=>i));
    assert.ok(peak>1&&peak<=4);assert.equal(active,0);
  } finally {globalThis.fetch=previousFetch;globalThis.window=previousWindow;}
});

test('legacy archive catalog without byte sizes stays conservative',async()=>{
  const previousFetch=globalThis.fetch,previousWindow=globalThis.window;let active=0,peak=0;
  globalThis.window={location:{hostname:'localhost'}};
  globalThis.fetch=async url=>{
    if(String(url).includes('/instances'))return Response.json([{uid:'1'},{uid:'2'},{uid:'3'}]);
    active++;peak=Math.max(peak,active);await delay(2);active--;return new Response('fixture');
  };
  try{assert.equal((await diskFiles('study')).length,3);assert.equal(peak,1);}
  finally{globalThis.fetch=previousFetch;globalThis.window=previousWindow;}
});
