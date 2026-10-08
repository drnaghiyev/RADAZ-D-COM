import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import http from 'node:http';
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'playwright');
const boot=readFileSync('public/radaz-boot.js');
const server=http.createServer((req,res)=>{
 res.setHeader('Cache-Control','no-store');
 if(req.url==='/obsolete-sw.js'){
  res.setHeader('Content-Type','application/javascript');res.end(`self.addEventListener('install',()=>self.skipWaiting());self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));self.addEventListener('fetch',event=>{if(new URL(event.request.url).pathname==='/app.js')event.respondWith(new Response('window.syntheticBuild="old"',{headers:{'Content-Type':'application/javascript'}}));});`);
 }else if(req.url.startsWith('/radaz-boot.js')){res.setHeader('Content-Type','application/javascript');res.end(boot);}
 else if(req.url==='/app.js'){res.setHeader('Content-Type','application/javascript');res.end('window.syntheticBuild="new";');}
 else if(req.url==='/radaz-runtime.json'){res.setHeader('Content-Type','application/json');res.end('{"buildId":"new"}');}
 else{res.setHeader('Content-Type','text/html');res.end(req.url.startsWith('/seed')?'<html><body>Seed</body></html>':'<html><head><meta name="radaz-build" content="new"><script src="/radaz-boot.js"></script><script src="/app.js"></script></head><body>RADAZ</body></html>');}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,channel:'msedge'});
try{
 const page=await browser.newPage(),base=`http://127.0.0.1:${server.address().port}`;
 await page.goto(base+'/seed');
 await page.evaluate(async()=>{
  localStorage.setItem('pacs-synthetic','preserve');
  await navigator.serviceWorker.register('/obsolete-sw.js');await navigator.serviceWorker.ready;
  if(!navigator.serviceWorker.controller)await new Promise(r=>navigator.serviceWorker.addEventListener('controllerchange',r,{once:true}));
 });
 assert.equal(await page.evaluate(()=>fetch('/app.js').then(r=>r.text())),'window.syntheticBuild="old"');
 await page.goto(base+'/archive');
 await page.waitForFunction(()=>window.syntheticBuild==='new'&&!navigator.serviceWorker.controller);
 assert.equal(await page.evaluate(()=>localStorage.getItem('pacs-synthetic')),'preserve');
 assert.equal(await page.evaluate(async()=>(await navigator.serviceWorker.getRegistrations()).length),0);
 assert.match(page.url(),/radaz-build=new/);
 console.log('PASS: obsolete controlling Service Worker retired; new assets loaded; local settings retained');
}finally{await browser.close();await new Promise(r=>server.close(r));}
