import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign} from 'node:crypto';
import {createLicenseService} from '../billing/license-service.mjs';
import {anatomyAccess} from '../scripts/anatomy-access.mjs';
const {privateKey}=generateKeyPairSync('rsa',{modulusLength:2048}),device='A'.repeat(64);
const credential=(issuedAt,extra={})=>{const claims={v:1,product:'RADAZ',deviceId:device,licenseId:'base-license',issuedAt,expiresAt:issuedAt+365*86400,...extra},payload='RADAZ1.'+Buffer.from(JSON.stringify(claims)).toString('base64url');return payload+'.'+sign('RSA-SHA256',Buffer.from(payload),privateKey).toString('base64url');};
test('explicit trial activation lasts exactly thirty days, never resets, and does not alter base orders',()=>{
 let now=1800000000;const service=createLicenseService({database:':memory:',privateKey,now:()=>now});const token=credential(now);
 try{
  assert.equal(service.anatomy.status(token).status,'inactive');assert.throws(()=>service.anatomy.authorize(token));
  const first=service.anatomy.startTrial(token);assert.equal(first.expiresAt,now+30*86400);assert.equal(first.remainingTrialDays,30);assert.ok(service.anatomy.authorize(token).allowed);
  now+=100;assert.equal(service.anatomy.startTrial(token).expiresAt,first.expiresAt);
  now=first.expiresAt;assert.equal(service.anatomy.status(token).status,'expired');assert.throws(()=>service.anatomy.authorize(token));assert.equal(service.anatomy.startTrial(token).expiresAt,first.expiresAt);
  assert.throws(()=>service.anatomy.startTrial(token.slice(0,-5)+'abcde'));assert.throws(()=>service.anatomy.startTrial(credential(now,{moduleId:'anatomy_ai'})));
 }finally{service.close();}
});
test('public inference fails closed without backend licensing configuration; research mode has no trial',async()=>{
 const publicAccess=anatomyAccess({channel:'preview'},{env:{},request:async()=>({ok:false})});await assert.rejects(()=>publicAccess.authorize(),/license_not_configured/);
 const local=anatomyAccess({channel:'local-anatomy'},{env:{}});assert.equal((await local.status()).status,'local-research');await local.authorize();await assert.rejects(()=>local.trial());
});

test('paid Anatomy AI activation and renewal are independent; owner suspension survives without a trial',async()=>{
 let now=1800000000;const service=createLicenseService({database:':memory:',privateKey,now:()=>now,commerce:()=>({schema:1,revision:1,baseCurrency:'AZN',monthlyMinor:1000,trialDays:7,maxMonths:120,modules:[{id:'anatomy_ai',name:'Anatomy AI',monthlyMinor:2500,enabled:true}]}),provider:{currencies:['AZN'],async createCheckout(order){return{id:'tx-'+order.orderId,url:'https://payments.example.test/pay'};}}});
 const token=credential(now);
 try{
  service.anatomy.suspend(device,true);assert.equal(service.anatomy.status(token).status,'suspended');service.anatomy.suspend(device,false);assert.equal(service.anatomy.status(token).status,'inactive');
  const order=await service.checkout(12,{moduleId:'anatomy_ai'});assert.equal(order.amountMinor,30000);
  service.confirmPayment({orderId:order.id,providerOrder:'tx-'+order.id,id:'paid-anatomy',status:'paid',amountMinor:order.amountMinor,currency:'AZN'});
  const paid=service.status(order.id,order.token);assert.equal(service.anatomy.status(token).status,'inactive');
  const receipt=service.activate(paid.activationCode,device);assert.equal(service.anatomy.status(token).status,'active');assert.equal(service.anatomy.status(token).trialStartedAt,null);
  service.anatomy.suspend(device,true);assert.throws(()=>service.anatomy.authorize(token));service.anatomy.suspend(device,false);assert.ok(service.anatomy.authorize(token).allowed);
  const renewal=await service.checkout(1,{moduleId:'anatomy_ai'});service.confirmPayment({orderId:renewal.id,providerOrder:'tx-'+renewal.id,id:'paid-renewal',status:'paid',amountMinor:renewal.amountMinor,currency:'AZN'});const renewalCode=service.status(renewal.id,renewal.token).activationCode;const renewed=service.activate(renewalCode,device);assert.ok(renewed.expiresAt>receipt.expiresAt);assert.equal(service.activate(renewalCode,device).expiresAt,renewed.expiresAt);
  now=renewed.expiresAt;const renewedBase=credential(now);assert.equal(service.anatomy.status(renewedBase).status,'expired');assert.throws(()=>service.anatomy.authorize(renewedBase));
 }finally{service.close();}
});

test('desktop licence proxy uses a server request without an invalid archive-port Origin',async()=>{
 const calls=[];const access=anatomyAccess({channel:'preview'},{env:{RADAZ_ARCHIVE_PORT:'9876'},request:async(url,options)=>{
 calls.push([url,options]);assert.equal(options.headers.Origin,undefined);
 return {ok:true,json:async()=>({moduleId:'anatomy_ai',status:'active',allowed:true})};
 }});
 assert.equal((await access.status()).allowed,true);await access.trial();await access.authorize();
 assert.equal(calls[1][0],'http://127.0.0.1:9876/anatomy-license/trial');assert.equal(calls[1][1].method,'POST');
});
