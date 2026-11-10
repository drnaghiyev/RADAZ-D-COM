import assert from 'node:assert/strict';
import {test} from 'node:test';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {nativeVolumeService} from '../scripts/native-volume-service.mjs';

test('native launch is local, validated, explicit and waits for actual readiness',async()=>{
 const root=mkdtempSync(path.join(tmpdir(),'radaz-native-route-'));
 mkdirSync(path.join(root,'bridge'));writeFileSync(path.join(root,'bridge/native_volume_app.py'),'');
 writeFileSync(path.join(root,'python.exe'),'');writeFileSync(path.join(root,'archive.sqlite3'),'');
 let launches=0,child;
 const service=nativeVolumeService(root,{env:{RADAZ_NATIVE_PYTHON:path.join(root,'python.exe'),RADAZ_NATIVE_ARCHIVE:root},launch:(exe,args)=>{
  launches++;assert.ok(args.includes('1.2.3'));child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>child.emit('exit',0);
  setTimeout(()=>child.stdout.write('RADAZ_NATIVE_READY\n'),20);return child;
 }});
 const server=http.createServer((req,res)=>service.handle(req,res));await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const base=`http://127.0.0.1:${server.address().port}`;
 const post=(body,origin=base)=>fetch(base+'/native-volume-api/open',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(body)});
 try{
  assert.equal((await (await fetch(base+'/native-volume-api/status')).json()).available,true);
  assert.equal((await post({seriesUID:'1.2.3'},'https://untrusted.example')).status,403);
  assert.equal((await post({seriesUID:'../../archive'})).status,400);
  assert.equal((await post(null)).status,400);
  assert.equal((await post([])).status,400);
  assert.equal((await post({seriesUID:'1.2.3',preset:'invalid'})).status,400);
  assert.equal(launches,0);
  const result=await post({seriesUID:'1.2.3',preset:'bone'});assert.equal(result.status,200);assert.equal((await result.json()).opened,true);
  assert.equal((await post({seriesUID:'1.2.3'})).status,409);assert.equal(launches,1);
  child.emit('exit',0);
  const simultaneous=await Promise.all([post({seriesUID:'1.2.3'}),post({seriesUID:'1.2.3'})]);
  assert.deepEqual(simultaneous.map(r=>r.status).sort(),[200,409]);assert.equal(launches,2);
 }finally{service.stop();await new Promise(r=>server.close(r));rmSync(root,{recursive:true,force:true});}
});
