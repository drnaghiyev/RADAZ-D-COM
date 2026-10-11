import {sign,verify,createPrivateKey,createPublicKey} from 'node:crypto';
import {readFileSync} from 'node:fs';
export const moduleId=value=>typeof value==='string'&&/^[a-z][a-z0-9_-]{1,47}$/.test(value);
export const defaultCommerce=()=>({baseCurrency:'AZN',monthlyMinor:1000,trialDays:30,modules:[{id:'anatomy_ai',name:'Anatomik seqmentasiya',monthlyMinor:500,enabled:true}],exchange:null});
export function validateCommerce(value={}){
 const next={...defaultCommerce(),...value};
 if(!['AZN','USD'].includes(next.baseCurrency)||!Number.isSafeInteger(next.monthlyMinor)||next.monthlyMinor<1||next.monthlyMinor>100000000)throw Error('Qiymət və valyuta düzgün deyil.');
 if(!Number.isInteger(next.trialDays)||next.trialDays<0||next.trialDays>365)throw Error('Demo müddəti 0–365 gün olmalıdır.');
 if(!Array.isArray(next.modules)||next.modules.length>50)throw Error('Ən çox 50 modul əlavə etmək olar.');
 const ids=new Set();next.modules=next.modules.map(m=>{
  if(!moduleId(m.id)||m.id==='base'||ids.has(m.id)||typeof m.name!=='string'||!m.name.trim()||m.name.length>100||!Number.isSafeInteger(m.monthlyMinor)||m.monthlyMinor<1||m.monthlyMinor>100000000)throw Error('Modulun kodu, adı və qiyməti düzgün deyil.');
  ids.add(m.id);return {id:m.id,name:m.name.trim(),monthlyMinor:m.monthlyMinor,enabled:m.enabled===true};
 });
 if(next.exchange){const e=next.exchange;if(e.source!=='CBAR'||!Number.isFinite(e.usdAzn)||e.usdAzn<=0||e.usdAzn>100||!/^\d{4}-\d{2}-\d{2}$/.test(e.date)||!Number.isFinite(e.checkedAt))throw Error('Məzənnə düzgün deyil.');next.exchange={usdAzn:e.usdAzn,date:e.date,checkedAt:e.checkedAt,source:'CBAR'};}
 const billingUrl=next.billingUrl||'';if(billingUrl){const u=new URL(billingUrl);if(u.protocol!=='https:'||u.username||u.password||u.search||u.hash||u.pathname!=='/')throw Error('Ödəniş serverinin HTTPS ünvanı düzgün deyil.');}
 return {baseCurrency:next.baseCurrency,monthlyMinor:next.monthlyMinor,trialDays:next.trialDays,modules:next.modules,exchange:next.exchange,billingUrl};
}
export function convertMinor(minor,from,to,exchange,{now=Date.now(),fresh=false}={}){
 if(!['AZN','USD'].includes(from)||!['AZN','USD'].includes(to))throw Error('Valyuta AZN və ya USD olmalıdır.');
 if(from===to)return minor;
 if(!exchange||fresh&&(now-exchange.checkedAt>7*86400000||exchange.checkedAt>now+300000))throw Error('Məzənnəni Mərkəzi Bankdan yeniləyin.');
 return Math.round(from==='USD'?minor*exchange.usdAzn:minor/exchange.usdAzn);
}
export async function fetchExchange(request=fetch,now=new Date()){
 const local=new Date(now.getTime()+4*3600000);
 for(let back=0;back<8;back++){
  const date=new Date(local.getTime()-back*86400000).toISOString().slice(0,10),[y,m,d]=date.split('-');
  const response=await request(`https://www.cbar.az/currencies/${d}.${m}.${y}.xml`,{signal:AbortSignal.timeout(10000),redirect:'error'});
  if(!response.ok)continue;
  const xml=await response.text();if(xml.length>200000)throw Error('Məzənnə cavabı böyükdür.');
  const block=xml.match(/<Valute\s+Code=["']USD["'][^>]*>([\s\S]*?)<\/Valute>/i)?.[1];if(!block)continue;
  const nominal=Number(block.match(/<Nominal>([\d.]+)<\/Nominal>/i)?.[1]),value=Number(block.match(/<Value>([\d.,]+)<\/Value>/i)?.[1]?.replace(',','.'));
  const usdAzn=value/nominal;if(!Number.isFinite(usdAzn)||usdAzn<=0||usdAzn>100)throw Error('USD məzənnəsi təsdiqlənmədi.');
  const sourceDate=xml.match(/<ValCurs[^>]*Date=["'](\d{2})\.(\d{2})\.(\d{4})["']/i);
  return {usdAzn,date:sourceDate?`${sourceDate[3]}-${sourceDate[2]}-${sourceDate[1]}`:date,checkedAt:now.getTime(),source:'CBAR'};
 }
 throw Error('Mərkəzi Bank məzənnəsi alınmadı. Son saxlanmış məzənnə qorundu.');
}
export function issuerKey(pem){
 const key=createPrivateKey(pem),actual=createPublicKey(key).export({format:'jwk'}),expected=JSON.parse(readFileSync(new URL('../public/license-public.json',import.meta.url)));
 if(actual.n!==expected.n||actual.e!==expected.e)throw Error('İmza açarı RADAZ-a uyğun deyil.');return key;
}
export function signPolicy(commerce,key,previous=0){
 const claims={v:1,product:'RADAZ',revision:Math.max(Date.now(),previous+1),...validateCommerce(commerce)};
 const payload='RADAZPOLICY1.'+Buffer.from(JSON.stringify(claims)).toString('base64url');
 return {policy:payload+'.'+sign('RSA-SHA256',Buffer.from(payload),key).toString('base64url')};
}
export function verifyPolicy(envelope,publicKey,previous=0){
 if(typeof envelope?.policy!=='string'||envelope.policy.length>32768)throw Error('Invalid policy');
 const parts=envelope.policy.split('.');if(parts.length!==3||parts[0]!=='RADAZPOLICY1'||!verify('RSA-SHA256',Buffer.from(parts[0]+'.'+parts[1]),publicKey,Buffer.from(parts[2],'base64url')))throw Error('Invalid policy signature');
 const c=JSON.parse(Buffer.from(parts[1],'base64url'));if(c.v!==1||c.product!=='RADAZ'||!Number.isSafeInteger(c.revision)||c.revision<previous||c.revision>Date.now()+300000)throw Error('Invalid policy revision');
 return {...validateCommerce(c),revision:c.revision};
}
