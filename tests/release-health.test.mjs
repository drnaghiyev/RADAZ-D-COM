import assert from 'node:assert/strict';
import test from 'node:test';
import http from 'node:http';
import {createHash} from 'node:crypto';
import {verifyClientHttp} from '../scripts/release-health.mjs';
test('health rejects missing, corrupt and wrong-MIME assets even when HTML returns 200',async()=>{
 const files={'/app.js':'export const ok=true;', '/style.css':'body {color:white}'};
 const build={buildId:'synthetic',product:{version:'0.2.24'},assets:Object.fromEntries(Object.entries(files).map(([url,body])=>[url,{size:Buffer.byteLength(body),sha256:createHash('sha256').update(body).digest('hex')}]))};
 let mode='ok';
 const server=http.createServer((req,res)=>{
  if(req.url in files){
   if(mode==='missing'&&req.url.endsWith('.css')){res.writeHead(404);res.end();return;}
   res.setHeader('Content-Type',mode==='mime'?'text/html':req.url.endsWith('.js')?'application/javascript':'text/css');
   res.end(mode==='corrupt'?'changed':files[req.url]);
  }else{res.setHeader('Content-Type','text/html');res.end(`<html><script src="${mode==='unlisted'?'/old.js':'/app.js'}"></script><link href="/style.css" rel="stylesheet"></html>`);}
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 try{
  const base=`http://127.0.0.1:${server.address().port}`;
  assert.equal((await verifyClientHttp(base,build)).ready,true);
  for(const [value,pattern] of [['missing',/HTTP 404/],['corrupt',/SHA-256/],['mime',/MIME/],['unlisted',/Unlisted/]]){
   mode=value;await assert.rejects(verifyClientHttp(base,build),pattern);
  }
 }finally{await new Promise(r=>server.close(r));}
});
