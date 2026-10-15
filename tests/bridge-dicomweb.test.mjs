import test from 'node:test';
import assert from 'node:assert/strict';
import {loadTypeScript} from './load-typescript.mjs';
const {streamRemoteStudy}=loadTypeScript('lib/dicomweb.ts');
const field=v=>({vr:'UI',Value:[v]});
const row=i=>({'00080018':field(`2.25.${i}`),'0020000E':field('2.25.1000')});

test('full-study DICOMweb uses paginated metadata and preserves one-file-at-a-time payloads',async()=>{
 const previous=globalThis.fetch,position=globalThis.location;globalThis.location={protocol:'http:'};let downloads=0;
 globalThis.fetch=async(url,options)=>{
  assert.equal(options.headers.Authorization,'Bearer synthetic-token');
  const parsed=new URL(url);
  if(parsed.pathname.endsWith('/instances')){const offset=Number(parsed.searchParams.get('offset'));return Response.json(Array.from({length:Math.min(200,401-offset)},(_,i)=>row(offset+i+1)));}
  downloads++;return new Response(new Uint8Array([1,2,3]),{headers:{'content-type':'application/dicom'}});
 };
 try{let count=0;for await(const file of streamRemoteStudy('http://fixture','synthetic-token','2.25.1',401)){count++;assert.equal(downloads,count);assert.deepEqual([...new Uint8Array(await file.arrayBuffer())],[1,2,3]);}assert.equal(count,401);}
 finally{globalThis.fetch=previous;globalThis.location=position;}
});

test('truncated or repeating PACS metadata never reports a complete study',async()=>{
 const previous=globalThis.fetch,position=globalThis.location;globalThis.location={protocol:'http:'};
 try{
  for(const mode of ['short','repeat','warning']){
   let downloads=0;globalThis.fetch=async url=>{if(!new URL(url).pathname.endsWith('/instances')){downloads++;return new Response('pixels');}return Response.json(Array.from({length:mode==='repeat'?200:1},(_,i)=>row(i+1)),{headers:mode==='warning'?{warning:'299 truncated'}:{}});};
   await assert.rejects(async()=>{for await(const file of streamRemoteStudy('http://fixture','','2.25.1',mode==='short'?3:0))void file;});assert.equal(downloads,0);
  }
 }finally{globalThis.fetch=previous;globalThis.location=position;}
});
