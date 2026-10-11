import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,existsSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {anatomyVolumeService} from '../scripts/local-anatomy-volume.mjs';
test('local job API gates origin, modality, geometry, concurrent upload, complete slices and cancellation',async()=>{
 const folder=mkdtempSync(path.join(os.tmpdir(),'radaz-job-test-')),previous=process.env.RADAZ_ANATOMY_VOLUME_ROOT;
 process.env.RADAZ_ANATOMY_VOLUME_ROOT=folder;mkdirSync(path.join(folder,'python'));writeFileSync(path.join(folder,'python/python.exe'),'test-only; never executed');writeFileSync(path.join(folder,'weights-manifest.json'),JSON.stringify({tasks:{total:{files:{'test.bin':'abc'}}}}));
 const service=anatomyVolumeService(process.cwd(),null,{channel:'local-anatomy'});
 const server=http.createServer((req,res)=>void service.handle(req,res));await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const base=`http://127.0.0.1:${server.address().port}`;
 const request=(url,method='GET',body,headers={})=>fetch(base+'/anatomy-volume'+url,{method,headers:{Origin:base,...(body?{'Content-Type':'application/json'}:{}),...headers},body:body?JSON.stringify(body):undefined});
 const geometry={dimensions:[3,3,3],spacing:[1,1,2],origin:[-10,20,30],direction:[0,1,0,-1,0,0,0,0,1],modality:'CT',task:'total'};
 try{
  assert.equal((await request('/models','GET',null,{Origin:'https://evil.example'})).status,403);
  for(const change of [{modality:'DX'},{task:'total_mr'},{direction:[1,0,0,1,0,0,0,0,1]},{dimensions:[2048,2048,2048]}])assert.equal((await request('/jobs','POST',{...geometry,...change})).status,400);
  const first=await request('/jobs','POST',geometry);assert.equal(first.status,201);const {id}=await first.json();
  assert.equal((await request('/jobs','POST',geometry)).status,409);
  assert.equal((await request(`/jobs/${id}/run`,'POST',{})).status,400);
  const slice=Buffer.alloc(36);const upload=()=>fetch(base+`/anatomy-volume/jobs/${id}/slices/0`,{method:'PUT',headers:{Origin:base,'Content-Type':'application/octet-stream'},body:slice});
  assert.equal((await upload()).status,200);assert.equal((await upload()).status,400);
  assert.equal((await request(`/jobs/${id}`,'DELETE')).status,200);assert.equal(existsSync(path.join(folder,'jobs',id)),false);
  assert.equal((await request(`/jobs/${id}`)).status,404);
 }finally{
  service.stop();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
  if(previous===undefined)delete process.env.RADAZ_ANATOMY_VOLUME_ROOT;else process.env.RADAZ_ANATOMY_VOLUME_ROOT=previous;
  assert.ok(path.resolve(folder).startsWith(path.resolve(os.tmpdir())+path.sep+'radaz-job-test-'));rmSync(folder,{recursive:true,force:true});
 }
});
