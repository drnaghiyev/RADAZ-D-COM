'use client';
import {useTranslation as useUiTranslation,translate as tr} from '@/lib/i18n';

import {useEffect,useRef,useState} from 'react';
type Module={id:string;name:string;monthlyMinor:number;enabled:boolean};
type Catalog={enabled:boolean;monthly:number;currency:'AZN'|'USD';maxMonths:number;currencies?:string[];modules?:Module[];exchange?:{usdAzn:number;date:string;checkedAt:number}|null};
async function api<T>(path:string,body?:unknown):Promise<T>{const r=await fetch('/local-archive-api/'+path,{cache:'no-store',...(body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})});const data=await r.json() as T & {error?:string};if(!r.ok)throw Error(data.error||'Ödəniş xidməti cavab vermədi.');return data;}
export function LicensePayment({onKey}:{onKey:(key:string)=>void}){
  useUiTranslation();
 const [catalog,setCatalog]=useState<Catalog|null>(null),[months,setMonths]=useState(1),[currency,setCurrency]=useState('AZN'),[moduleId,setModuleId]=useState(''),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[order,setOrder]=useState(''),[url,setUrl]=useState(''),[code,setCode]=useState('');
 const activated=useRef(new Set<string>());
 useEffect(()=>{void api<Catalog>('billing/catalog').then(c=>{setCatalog(c);setCurrency(c.currencies?.[0]||c.currency);}).catch(e=>setMessage(e.message));try{setOrder(localStorage.getItem('radaz-payment-order')||'');}catch{}},[]);
 useEffect(()=>{
  if(!order)return;let alive=true,running=false;
  const check=async()=>{if(running)return;running=true;try{
   const paid=await api<{status:string;activationCode?:string;moduleId?:string}>(`billing/order?id=${encodeURIComponent(order)}`);if(!alive)return;
   if(paid.status==='paid'&&paid.activationCode){setCode(paid.activationCode);if(!activated.current.has(order)){
    activated.current.add(order);setMessage('Ödəniş təsdiqləndi. Aktivləşdirilir…');
    try{const result=await api<{message:string}>('license/activate',{key:paid.activationCode});if(!alive)return;setMessage(result.message);window.dispatchEvent(new Event('radaz-license-change'));setOrder('');try{localStorage.removeItem('radaz-payment-order');}catch{}}
    catch(error){if(alive)setMessage(`Ödəniş təsdiqləndi, aktivləşdirmə alınmadı: ${error instanceof Error?error.message:''} Aşağıdakı açarla yenidən sınayın.`);}
   }}else if(paid.status==='failed')setMessage('Ödəniş tamamlanmadı.');else setMessage('Provayderin ödəniş təsdiqi gözlənilir…');
  }catch(e){if(alive)setMessage(e instanceof Error?e.message:'Ödəniş yoxlanmadı.');}finally{running=false;}};
  void check();const timer=setInterval(()=>void check(),5000);return()=>{alive=false;clearInterval(timer);};
 },[order]);
 const selected=catalog?.modules?.find(m=>m.id===moduleId),baseMinor=selected?.monthlyMinor??Math.round((catalog?.monthly??10)*100);
 const rate=catalog?.exchange?.usdAzn;
 const converted=catalog&&currency!==catalog.currency;
 const unit=converted?(rate?Math.round(catalog.currency==='USD'?baseMinor*rate:baseMinor/rate):null):baseMinor;
 const stale=converted&&(!catalog?.exchange||Date.now()-catalog.exchange.checkedAt>7*86400000);
 const valid=Number.isInteger(months)&&months>=1&&months<=(catalog?.maxMonths||120);
 const total=valid&&unit!==null?unit*months/100:null;
 const checkout=async()=>{if(!catalog?.enabled||total===null)return;setBusy(true);setMessage('Ödəniş hazırlanır…');const tab=window.open('about:blank','_blank');if(tab)tab.opener=null;try{
  const result=await api<{id:string;url:string}>('billing/checkout',{months,currency,moduleId:moduleId||null});setCode('');setOrder(result.id);setUrl(result.url);try{localStorage.setItem('radaz-payment-order',result.id);}catch{}if(tab)tab.location.replace(result.url);
 }catch(e){try{tab?.close();}catch{}setMessage(e instanceof Error?e.message:'Ödəniş açılmadı.');}finally{setBusy(false);}};
 const saveKey=()=>{const link=document.createElement('a'),href=URL.createObjectURL(new Blob([code+'\n'],{type:'text/plain;charset=utf-8'}));link.href=href;link.download='RADAZ-lisenziya.txt';link.click();setTimeout(()=>URL.revokeObjectURL(href),1000);};
 return <section className="monthly-payment" aria-label={tr('ui.licence_payment_89576')}><h3>{tr('ui.licence_and_modules_8cf99')}</h3>
  <label>{tr('ui.product_dea7e')}<select aria-label={tr('ui.product_dea7e')} value={moduleId} disabled={busy} onChange={e=>setModuleId(e.target.value)}><option value="">{tr('ui.radaz_base_licence_f8f1c')}</option>{catalog?.modules?.filter(m=>m.enabled).map(m=><option key={m.id} value={m.id}>{m.name}</option>)}</select></label>
  <div className="product-actions"><label>{tr('ui.currency_1b86f')}<select aria-label={tr('ui.currency_1b86f')} value={currency} disabled={busy} onChange={e=>setCurrency(e.target.value)}><option>AZN</option><option>USD</option></select></label><label>{tr('ui.number_of_months_9ca86')}<input type="number" aria-label={tr('ui.licence_months_b8c14')} min={1} max={catalog?.maxMonths||120} value={Number.isNaN(months)?'':months} disabled={busy} onChange={e=>setMonths(e.target.valueAsNumber)}/></label></div>
  <strong className="license-price">{tr('ui.total_aa0a1')}{total===null?'—':total.toFixed(2)} {currency}</strong>
  <p>{(baseMinor/100).toFixed(2)} {catalog?.currency||'AZN'} {tr('ui._month_31047')}{rate?` · 1 USD = ${rate.toFixed(4)} AZN · ${catalog?.exchange?.date}`:''}</p>
  {!!moduleId&&<p>{tr('ui.this_payment_activates_only_the_selected_modu_8d6df')}</p>}
  <button disabled={busy||!catalog?.enabled||total===null||!!stale||!(catalog.currencies||['AZN']).includes(currency)} onClick={()=>void checkout()}>{busy?'Hazırlanır…':'Ödəniş sisteminə keç'}</button>
  {!catalog?.enabled&&<p className="product-note">{tr('ui.the_payment_provider_is_not_connected_an_invo_dbe9c')}</p>}
  {catalog?.enabled&&!(catalog.currencies||['AZN']).includes(currency)&&<p>{tr('ui.this_provider_8f5ff')}{currency} {tr('ui.is_not_supported_choose_another_currency_6eec2')}</p>}{stale&&<p>{tr('ui.the_exchange_rate_needs_refreshing_reopen_the_b4ec7')}</p>}
  {url&&<a href={url} target="_blank" rel="noreferrer">{tr('ui.open_payment_page_ef483')}</a>}{code&&<><label>{tr('ui.paid_activation_code_cee07')}<textarea readOnly value={code}/></label><button onClick={saveKey}>{tr('ui.save_key_as_txt_77f4f')}</button><button onClick={()=>void navigator.clipboard.writeText(code).then(()=>setMessage('Açar kopyalandı.')).catch(()=>setMessage('Açarı mətn sahəsindən kopyalayın.'))}>{tr('ui.copy_key_77550')}</button><button onClick={()=>onKey(code)}>{tr('ui.reopen_activation_e0017')}</button></>}{message&&<p role="status">{message}</p>}
 </section>;
}
