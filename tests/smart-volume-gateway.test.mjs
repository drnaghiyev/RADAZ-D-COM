import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {smartVolumeService} from '../scripts/smart-volume-service.mjs';
test('Smart Volume gateway rejects foreign origins and reports missing local model honestly',async()=>{
 const service=smartVolumeService(process.cwd(),null,{env:{LOCALAPPDATA:process.cwd()+'/outputs/nonexistent-gateway-fixture'}});
 const server=http.createServer((req,res)=>void service.handle(req,res));
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const base='http://127.0.0.1:'+server.address().port;
 try{
  let r=await fetch(base+'/smart-volume-api/setup');assert.equal(r.status,200);assert.equal((await r.json()).installed,false);
  r=await fetch(base+'/smart-volume-api/health');assert.equal(r.status,503);assert.match((await r.json()).error,/qurulmayıb/);
  r=await fetch(base+'/smart-volume-api/setup',{method:'POST',headers:{Origin:'https://external.example','Content-Type':'application/json'},body:'{"researchAccepted":true}'});assert.equal(r.status,403);
  r=await fetch(base+'/smart-volume-api/setup',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:'{"researchAccepted":false}'});assert.equal(r.status,400);
  r=await fetch(base+'/smart-volume-api/jobs/00000000-0000-0000-0000-000000000000',{method:'DELETE',headers:{Origin:'https://external.example'}});assert.equal(r.status,403);
 }finally{service.stop();server.closeAllConnections();await new Promise(r=>server.close(r));}
});
