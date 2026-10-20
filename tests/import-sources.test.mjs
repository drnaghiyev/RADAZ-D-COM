import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import JSZip from 'jszip';
import { expandSources, filesFromDrop, iterateSources } from '../lib/import-sources.ts';
import { storedRar } from './rar-fixture.mjs';

test('ZIP and RAR preserve nested, extensionless DICOM bytes alongside ordinary files', async () => {
  const bytes = Buffer.from('Synthetic fixture bytes'), direct = new File([bytes], 'DIRECT');
  const zip = new JSZip(); zip.file('nested/IMAGE001', bytes);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(readFileSync(createRequire(import.meta.url).resolve('node-unrar-js/esm/js/unrar.wasm')));
  try {
    const result = await expandSources([direct, new File([await zip.generateAsync({type:'uint8array'})], 'cd.ZIP'),
      new File([storedRar([['nested/IMAGE002',bytes]])], 'scan.RAR')], () => {});
    assert.deepEqual(result.map(file => file.name), ['DIRECT','nested/IMAGE001','nested/IMAGE002']);
    for (const file of result) assert.deepEqual(Buffer.from(await file.arrayBuffer()),bytes);
    await assert.rejects(expandSources([new File(['broken archive'], 'broken.rar')], () => {}), /RAR açıla bilmədi/);
  } finally { globalThis.fetch = originalFetch; }
});

test('a mixed directory and file drop reads every browser directory chunk', async () => {
  const fileEntry = name => ({isFile:true,file:resolve=>resolve(new File([name],name))});
  const folder = {isFile:false,createReader() { let chunk=0; return {readEntries(resolve) {
    resolve(chunk++ === 0 ? Array.from({length:100},(_,i)=>fileEntry(`I${i}`)) : chunk === 2 ? [fileEntry('I100')] : []);
  }}; }};
  const standalone = new File(['standalone'],'SINGLE');
  const result = await filesFromDrop([
    {kind:'file',webkitGetAsEntry:()=>folder,getAsFile:()=>null},
    {kind:'file',webkitGetAsEntry:()=>null,getAsFile:()=>standalone},
  ], []);
  assert.equal(result.length,102);assert.equal(result[100].name,'I100');assert.equal(result[101],standalone);
});

test('large source lists have no global count/byte ceiling and stream on demand', async () => {
  const file=new File(['fixture'],'LARGE.dcm');
  Object.defineProperty(file,'size',{value:2*1024**3});
  const iterator=iterateSources(Array(20001).fill(file),()=>{});
  let count=0;
  for await(const item of iterator){assert.equal(item.file,file);assert.equal(item.sourceCount,20001);count++;}
  assert.equal(count,20001);
});

test('ZIP member processing applies consumer backpressure', async () => {
  const zip=new JSZip();zip.file('a/one','one');zip.file('b/two','two');
  const iterator=iterateSources([new File([await zip.generateAsync({type:'uint8array'})],'study.zip')],()=>{});
  const first=await iterator.next();assert.equal(first.value.file.name,'a/one');
  assert.equal(first.value.entryCount,2);assert.equal(first.value.entryIndex,0);
  assert.equal((await iterator.next()).value.file.name,'b/two');
  assert.equal((await iterator.next()).done,true);
});
