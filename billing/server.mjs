import http from 'node:http';
import {mkdirSync,readFileSync,existsSync,writeFileSync,renameSync} from 'node:fs';
import {createPublicKey} from 'node:crypto';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createLicenseService} from './license-service.mjs';
import {isIP} from 'node:net';
import {ownerDirectory} from './owner-settings.mjs';
import {runtimeConfig} from './runtime-config.mjs';
import {createEpointProvider} from './epoint.mjs';
import {OwnerVault} from './owner-vault.mjs';
import {defaultCommerce,fetchExchange,verifyPolicy} from './commerce.mjs';
const owner=ownerDirectory(),vault=new OwnerVault(owner);
const ownerData=vault.exists?await vault.unlock(process.env.RADAZ_OWNER_PASSWORD):null;
const {settings,privateKey}=runtimeConfig(owner,process.env,ownerData);
let commerce=ownerData?.commerce||defaultCommerce();
const data=path.resolve(process.env.RADAZ_BILLING_DATA||path.join(owner,'billing-data'));mkdirSync(data,{recursive:true,mode:0o700});
const policyFile=path.join(data,'commerce.json'),publicKey=createPublicKey({key:JSON.parse(readFileSync(new URL('../public/license-public.json',import.meta.url))),format:'jwk'});
try{if(existsSync(policyFile))commerce=verifyPolicy(JSON.parse(readFileSync(policyFile)),publicKey);}catch{throw Error('Saxlanmış qiymət ayarlarının imzası etibarsızdır.');}
let lastPolicyCheck=0,refreshing;
async function refreshCommerce(){
 if(refreshing)return refreshing;
 if(Date.now()-lastPolicyCheck<15*60000)return;
 lastPolicyCheck=Date.now();
 refreshing=(async()=>{try{
  const response=await fetch('https://raw.githubusercontent.com/drnaghiyev/RADAZ-D-COM/main/commerce.json',{signal:AbortSignal.timeout(8000)});
  if(response.ok){const text=await response.text();if(text.length>32768)throw Error('Policy too large');const envelope=JSON.parse(text),next=verifyPolicy(envelope,publicKey,commerce.revision||0);writeFileSync(policyFile+'.tmp',JSON.stringify(envelope),{mode:0o600});renameSync(policyFile+'.tmp',policyFile);commerce=next;}
 }catch{/* Keep the last verified policy during network outages. */}
 try{if(provider&&(!commerce.exchange||Date.now()-commerce.exchange.checkedAt>86400000))commerce.exchange=await fetchExchange();}catch{/* Converted checkout rejects stale/missing rates. */}
 })().finally(()=>refreshing=null);return refreshing;
}
const provider=!privateKey?undefined:process.env.RADAZ_PAYMENT_ADAPTER?(await import(pathToFileURL(path.resolve(process.env.RADAZ_PAYMENT_ADAPTER)))).default:createEpointProvider(settings);
if(provider&&(!provider.createCheckout||!provider.verifyWebhook))throw new Error('Payment adapter must implement createCheckout and verifyWebhook.');
const service=createLicenseService({database:path.join(data,'billing.sqlite'),privateKey,provider,commerce:()=>commerce});
const windows=new Map();
const server=http.createServer(async(req,res)=>{
 const reply=(code,body)=>{res.writeHead(code,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(body));};
 try{
  const url=new URL(req.url,'http://localhost');
  if(req.method==='GET'&&url.pathname==='/healthz'){reply(200,{ok:true,paymentsEnabled:!!provider});return;}
  const forwarded=req.headers['x-real-ip'];
  const address=process.env.RADAZ_TRUST_PROXY==='1'&&typeof forwarded==='string'&&isIP(forwarded)?forwarded:req.socket.remoteAddress,now=Date.now();let rate=windows.get(address);if(!rate||rate.until<now){rate={count:0,until:now+60000};windows.set(address,rate);}if(++rate.count>120){reply(429,{error:'Bir az gözləyib yenidən sınayın.'});return;}if(windows.size>10000)for(const [id,item]of windows)if(item.until<now)windows.delete(id);
  if(req.method==='GET'&&url.pathname==='/payment/return'){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'"});res.end('<!doctype html><html lang="az"><meta charset="utf-8"><title>RADAZ ödənişi</title><body style="font:20px system-ui;padding:40px;background:#102331;color:white"><h1>RADAZ-a qayıdın</h1><p>Ödəniş pəncərəsini bağlayıb RADAZ-da Lisenziya ödənişi bölməsinə qayıdın.</p><p>Bank təsdiqi serverə çatdıqda açar həmin bölmədə görünəcək. Bu səhifənin açılması ödəniş təsdiqi sayılmır.</p></body></html>');return;}
  if(req.method==='GET'&&url.pathname==='/v1/catalog'){await refreshCommerce();reply(200,service.catalog());return;}
  if(req.method==='GET'&&/^\/v1\/orders\/[a-f0-9-]{36}$/.test(url.pathname)){reply(200,service.status(url.pathname.split('/').pop(),req.headers.authorization?.replace(/^Bearer /,'')));return;}
  if(req.method!=='POST'){reply(404,{error:'Ünvan tapılmadı'});return;}
  const parts=[];let bytes=0;for await(const chunk of req){bytes+=chunk.length;if(bytes>65536){reply(413,{error:'Sorğu həddindən böyükdür'});return;}parts.push(chunk);}const rawBody=Buffer.concat(parts);
  if(url.pathname==='/v1/webhooks/provider'){
   if(!provider){reply(503,{error:'Ödəniş provayderi qoşulmayıb'});return;}
   const event=await provider.verifyWebhook({headers:req.headers,rawBody});reply(200,service.confirmPayment(event));return;
  }
  if(!(req.headers['content-type']||'').startsWith('application/json'))throw new Error('JSON tələb olunur');
  const body=JSON.parse(rawBody.toString('utf8'));
  if(url.pathname==='/v1/orders'){
   await refreshCommerce();
   if((body.currency||'AZN')!==commerce.baseCurrency&&(!commerce.exchange||Date.now()-commerce.exchange.checkedAt>86400000))commerce.exchange=await fetchExchange();
   reply(200,await service.checkout(body.months,{currency:body.currency||'AZN',moduleId:body.moduleId??null}));return;
  }
  if(url.pathname==='/v1/activate'){if(!privateKey){reply(503,{error:'Lisenziya serverinin imza açarı hələ qoşulmayıb.'});return;}reply(200,service.activate(body.code,body.deviceId));return;}
  reply(404,{error:'Ünvan tapılmadı'});
 }catch(error){reply(400,{error:error.message||'Sorğu alınmadı'});}
});
server.listen(Number(process.env.PORT||8790),process.env.RADAZ_BIND||'127.0.0.1',()=>console.log(`RADAZ billing service ready on port ${server.address().port}. Payments ${provider?'enabled':'disabled'}. Use HTTPS in production.`));
process.on('SIGTERM',()=>server.close(()=>{service.close();process.exit();}));
