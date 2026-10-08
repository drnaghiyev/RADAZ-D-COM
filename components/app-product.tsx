'use client';

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { licenseAccess } from '@/lib/license-access';
import { isNewerRelease } from '@/lib/release-version';
import {activatedBuild,reloadBuild,reportUpdateDiagnostic,type InstallationState} from '@/lib/update-activation';
import { BookOpen, CircleHelp, ExternalLink, Info, Keyboard, KeyRound, Mail, MessageCircle, RefreshCw, ShieldCheck, ShoppingBag, X } from 'lucide-react';
import { createPortal } from 'react-dom';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { RadazLogo } from './radaz-logo';
import { DesktopUpdatePanel } from './desktop-update-panel';
import { LicensePayment } from './license-payment';

type Product = { name:string;version:string;channel:string;owner:string;email:string;telegram:string;repository:string;updateRepository?:string;salesUrl:string;licenseRequired:boolean;currency:string;monthly:number|null;billingUrl?:string };
type License = { modules?:Record<string,{valid:boolean;expiresAt:number}>;valid:boolean;required:boolean;deviceId:string;message:string;kind?:'owner'|'paid'|'trial'|'expired';trial?:{valid:boolean;startedAt?:number;expiresAt?:number;daysRemaining:number};claims?:{customer:string;plan:string;seats:number;expiresAt:number;licenseId:string;entitlement?:'owner'} };
type Update = { state:'available'|'current'|'unpublished'|'error';message:string;version?:string;url?:string;automatic?:boolean;phase?:string };
type Panel = ''|'help'|'keys'|'license'|'plans'|'about'|'support'|'updates'|'agreement';
const LicenseContext=createContext<{limited:boolean;label:string;owner:boolean;modules:Record<string,{valid:boolean;expiresAt:number}>}>({limited:true,label:'',owner:false,modules:{}});
function licenseLabel(license:License|null){
 if(license?.valid&&license.claims?.entitlement==='owner')return 'Sahib lisenziyası · bütün funksiyalar açıqdır';
 if(license?.valid&&license.kind==='trial')return `Pulsuz demo · ${license.trial?.daysRemaining??0} gün qalıb`;
 if(license?.valid)return 'Lisenziya aktivdir';
 return license?.kind==='expired'?'Demo bitib · yalnız listələmə':'Yalnız listələmə';
}
export const useViewerLicense=()=>useContext(LicenseContext);
export function useModuleLicense(id:string){const state=useViewerLicense();return !state.limited&&(state.owner||!!state.modules[id]?.valid);}
let productRequest:Promise<Product>|undefined;
function productInfo() { return productRequest ||= fetch('/product.json',{cache:'no-store'}).then(r=>{if(!r.ok) throw new Error('Proqram məlumatı açıla bilmədi');return r.json() as Promise<Product>;}).catch(e=>{productRequest=undefined;throw e;}); }
async function releaseUpdate(force = false): Promise<Update> {
  try {
    const response = await fetch('/radaz-installation.json', {cache:'no-store'});
    if(response.ok) {
      const desktop = await response.json() as InstallationState;
      reportUpdateDiagnostic(desktop);
      if(desktop.managed) {
        if(force && !['checking','downloading','verifying','installing','activating','rolling-back'].includes(desktop.state)) {
          const started = await fetch('/radaz-update',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'check'})});
          return {automatic:true,state:started.ok?'current':'error',message:started.ok?'Yeniləmələr yoxlanılır…':'Yeniləmə xidməti başladılmadı. Yenidən cəhd edin.'};
        }
        return {automatic:true,phase:desktop.state,state:['available','ready','deferred','downloading','verifying','installing'].includes(desktop.state)?'available':desktop.state==='error'?'error':'current',message:desktop.message,version:desktop.version};
      }
    }
  } catch { /* Source and older portable servers use the existing release check. */ }
  const [update, product] = await Promise.all([api<Update>(`updates${force ? '?force=1' : ''}`), productInfo()]);
  return update.state === 'available' && !isNewerRelease(update.version, product.version)
    ? { state: 'current', message: `RADAZ ${product.version} — ən yeni versiya işləyir` } : update;
}
async function api<T>(path:string,body?:unknown):Promise<T> { const r=await fetch(`/local-archive-api/${path}`,body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{cache:'no-store'}); const d=await r.json() as T & {error?:string};if(!r.ok)throw new Error(d.error||'Lokal xidmətə qoşulmaq mümkün olmadı');return d; }
export function AppHelpMenu({initial=''}:{initial?:Panel}) {
  const [panel,setPanel]=useState<Panel>(initial),[product,setProduct]=useState<Product|null>(null),[license,setLicense]=useState<License|null>(null),[update,setUpdate]=useState<Update|null>(null);
  const [key,setKey]=useState(''),[message,setMessage]=useState(''),[busy,setBusy]=useState(false),[issue,setIssue]=useState('');
  const dialog=useRef<HTMLDialogElement>(null);
  const open=(next:Panel)=>{setMessage('');setPanel(next);};
  useEffect(()=>{void productInfo().then(setProduct).catch(()=>{});const listener=(e:KeyboardEvent)=>{if(e.key==='F1'){e.preventDefault();setPanel(e.ctrlKey?'about':'help');}};const showUpdates=()=>setPanel('updates');window.addEventListener('radaz-show-updates',showUpdates);window.addEventListener('keydown',listener);return()=>{window.removeEventListener('keydown',listener);window.removeEventListener('radaz-show-updates',showUpdates);};},[]);
  useEffect(()=>{if(!panel)return;if(!dialog.current?.open)dialog.current?.showModal();if(panel==='license')void api<License>('license').then(setLicense).catch(e=>setMessage(e.message));},[panel]);
  const check=async()=>{open('updates');setBusy(true);try{setUpdate(await releaseUpdate(true));}catch(e){setMessage(e instanceof Error?e.message:'Yeniləmə yoxlanmadı');}finally{setBusy(false);}};
  const activate=async()=>{setBusy(true);setMessage('');try{const result=await api<License>('license/activate',{key:key.trim()});setLicense(result);setKey('');setMessage(result.message);window.dispatchEvent(new Event('radaz-license-change'));}catch(e){setMessage(e instanceof Error?e.message:'Aktivləşdirmə alınmadı');}finally{setBusy(false);}};
  const title={help:'Yardım mərkəzi',keys:'Klaviatura qısa yolları',license:'Lisenziyanı aktivləşdir',plans:'Aylıq ödəniş',about:'RADAZ haqqında',support:'Dəstək ilə əlaqə',updates:'Proqram yeniləmələri',agreement:'Lisenziya şərtləri','':''}[panel];
  return <><DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" className="header-control help-trigger" title="Yardım · F1" aria-label="Yardım və lisenziya"><CircleHelp size={18}/><span>Yardım</span></Button></DropdownMenuTrigger><DropdownMenuContent className="header-menu product-menu" align="end">
    <DropdownMenuItem onClick={()=>open('help')}><BookOpen size={16}/>Yardım<span className="product-shortcut">F1</span></DropdownMenuItem>
    <DropdownMenuItem onClick={()=>open('keys')}><Keyboard size={16}/>Qısa yollar</DropdownMenuItem>
    <DropdownMenuItem onClick={()=>open('support')}><MessageCircle size={16}/>Problemi bildir</DropdownMenuItem><DropdownMenuSeparator/>
    <DropdownMenuItem onClick={()=>void check()}><RefreshCw size={16}/>Yeniləmələri yoxla</DropdownMenuItem>
    <DropdownMenuItem onClick={()=>open('license')}><KeyRound size={16}/>Lisenziya açarını daxil et</DropdownMenuItem>
    <DropdownMenuItem onClick={()=>open('plans')}><ShoppingBag size={16}/>Aylıq ödəniş</DropdownMenuItem>
    <DropdownMenuItem onClick={()=>open('agreement')}><ShieldCheck size={16}/>Lisenziya şərtləri</DropdownMenuItem><DropdownMenuSeparator/>
    <DropdownMenuItem onClick={()=>open('about')}><Info size={16}/>Proqram haqqında<span className="product-shortcut">Ctrl+F1</span></DropdownMenuItem>
  </DropdownMenuContent></DropdownMenu>
  {panel && typeof document!=='undefined' && createPortal(<dialog ref={dialog} className="product-dialog" onCancel={()=>setPanel('')} onClick={e=>{if(e.target===dialog.current)setPanel('');}} aria-label={title}>
    <header><RadazLogo size={42}/><div><small>RADAZ · {product?.version||'…'}</small><h2>{title}</h2></div><button type="button" onClick={()=>setPanel('')} aria-label="Bağla"><X size={20}/></button></header>
    <div className="product-dialog-body">
    {panel==='help'&&<><p>DICOM fayl və ya qovluğunu yükləyin, yaxud Local arxiv / PACS-dan müayinə açın. Arxivdən seçilən müayinə həmin brauzerdə açıq olan viewer-də göstərilir.</p><div className="help-cards"><article><b>Barmaqla listələmə</b><p><strong>S</strong> və ya Listələ düyməsi. Görüntü üzərində yuxarı / aşağı sürüşdürün. Sağdakı nazik zolaqla kəsit seçin.</p></article><article><b>Çap və ixrac</b><p>Görüntüləri seç menyusu ilə çap siyahısı yaradın. İxrac et pəncərəsində format, ölçü, keyfiyyət və yazıları seçin.</p></article><article><b>AI asistent və hesabat</b><p>Aktiv müayinənin bütün seriyaları AI asistentdə açılır. Hesabatı redaktə edib saxlamaq, Word və PDF çıxarmaq mümkündür. AI bağlantısı qoşulana qədər avtomatik analiz aktiv deyil.</p></article><article><b>Cihazdan DICOM qəbulu</b><p>Local arxivdə AE Title, IP və port göstərilir. Qarşı cihazda bu ünvanları destination kimi qeyd edin.</p></article></div><button onClick={()=>open('support')}>Dəstək ilə əlaqə</button></>}
    {panel==='keys'&&<dl className="shortcut-list">{[['N','Neqativ / pozitiv'],['O','Ox'],['Q','Qələm'],['K','3D kursor'],['S','Listələ / barmaqla sürüşdür'],['W','Pəncərələmə'],['Orta düymə + sürüklə','Görüntünü daşı'],['Sağ düymə + sürüklə','Zoom'],['Sağ klik','Ölçmə üçün silmə menyusu'],['Ctrl+D','Cari kəsitdə bütün ölçüləri sil'],['Delete','Seçilmiş ölçünü sil'],['P','Görüntünü sürüşdür'],['Z','Yaxınlaşdır'],['Ctrl + siçan çarxı','Görüntünü böyüt / kiçilt'],['Siçan çarxı','Əvvəlki / növbəti kəsit'],['Ctrl+[ / Ctrl+]','90° sola / sağa fırlat'],['Ctrl+Shift+[ / ]','Üfüqi / şaquli çevir'],['F11','Siçan görüntü üzərindədirsə tam ekran'],['F1','Yardım'],['Ctrl+F1','Proqram haqqında']].map(([k,v])=><div key={k}><dt><kbd>{k}</kbd></dt><dd>{v}</dd></div>)}</dl>}
    {panel==='license'&&<><p className="product-note">Açar RADAZ serverinin quraşdırıldığı kompüterə bağlanır. Telefon və planşetlər həmin serverə brauzerdən qoşulur.</p>{license&&<><div className={`license-state ${license.valid?'valid':''}`}><ShieldCheck size={21}/><div><b>{licenseLabel(license)}</b><p>{license.required===false&&!license.valid?'Lisenziya açarını daxil edin.':license.message}</p></div></div><label>Kompüter kodu<input readOnly value={license.deviceId} onFocus={e=>e.target.select()}/></label>{license.claims&&<p>{license.claims.customer} · {license.claims.entitlement==='owner'?'Müddətsiz sahib lisenziyası':`Bitmə: ${new Date(license.claims.expiresAt*1000).toLocaleDateString('az-AZ')}`} · {license.claims.seats} kompüter</p>}{license.kind==='trial'&&license.trial?.expiresAt&&<p>Demo bitir: {new Date(license.trial.expiresAt*1000).toLocaleString('az-AZ')}. Bu müddətdə bütün funksiyalar açıqdır.</p>}</>}
      <label>Lisenziya açarı<textarea value={key} onChange={e=>setKey(e.target.value)} rows={4} placeholder="RADAZ-ACT-… və ya RADAZ1.…" spellCheck={false}/></label><div className="product-actions"><button disabled={busy||!key.trim()||!license} onClick={()=>void activate()}><KeyRound size={16}/>{busy?'Yoxlanılır…':'Aktivləşdir'}</button></div><LicensePayment onKey={setKey}/></>}
    {panel==='plans'&&<LicensePayment onKey={value=>{setKey(value);open('license');}}/>}
    {panel==='support'&&<><p>Problemi, təkrarlama addımlarını və gözlənilən nəticəni yazın.</p><label>Problem haqqında<textarea value={issue} onChange={e=>setIssue(e.target.value)} rows={6} placeholder="Məsələn: İxrac et düyməsini basanda…"/></label><p className="product-note">Mesaja pasiyent məlumatı avtomatik əlavə edilmir.</p><div className="product-actions"><a href={`mailto:${product?.email||'drnaghiyev@gmail.com'}?subject=RADAZ%20dəstək&body=${encodeURIComponent(`RADAZ ${product?.version||''}\n\n${issue}`)}`}><Mail size={16}/>E-poçt yaz</a><a href={`https://t.me/${product?.telegram||'TNNZsfjfHuP'}`} target="_blank" rel="noreferrer"><MessageCircle size={16}/>Telegram</a></div><p>{product?.email} · @{product?.telegram}</p></>}
    {panel==='updates'&&<><p>Quraşdırılmış versiya: <b>{product?.version}</b> ({product?.channel})</p><DesktopUpdatePanel busy={busy} onCheck={()=>void check()} fallback={<><div className="license-state"><RefreshCw size={22}/><p>{busy?'Buraxılışlar yoxlanılır…':update?.message||'Yoxlamanı başladın.'}</p></div><p className="product-note">Avtomatik yeniləmə üçün RADAZ-ı bu kompüterdəki proqram qısayolundan başladın.</p></>}/></>}
    {panel==='about'&&<div className="product-about"><img src="/radaz-wordmark.svg" alt="RADAZ — Radiology, Connected" width={262} height={80} style={{margin:"0 auto",borderRadius:8}}/><h3>RADAZ <small>{product?.version}</small></h3><p>Radiologiya üçün DICOM iş sahəsi</p><p>{product?.owner}</p><p>Local arxiv · PACS · MPR · 3D · AI asistent</p><a href={`https://github.com/${product?.updateRepository||product?.repository||'cesur9872-droid/RADAZ-Releases'}/releases/latest`} target="_blank" rel="noreferrer">GitHub və buraxılışlar <ExternalLink size={14}/></a><p className="product-note">Hazırkı buraxılış: ilkin sınaq versiyası. ChatGPT mətni radioloqun yoxlaması üçün hesabat layihəsidir.</p></div>}
    {panel==='agreement'&&<><p>Demo müddəti satıcının yayımlanmış ayarına əsaslanır; qalan gün Lisenziya bölməsində görünür. Demo üçün kart və açar tələb olunmur. Yenidən quraşdırma demo müddətini uzatmır.</p><p>Cari AZN və USD qiymətləri Aylıq ödəniş bölməsində göstərilir. Alınmış müddət ilk aktivləşdirmədən hesablanır və açar bir RADAZ server kompüterinə bağlanır.</p><p>Müddət bitdikdə PACS, Local arxiv və cihazlardan DICOM qəbulu işləyir. Viewer-də yalnız görüntülər listələnir; ölçmə, pəncərələmə, MPR/3D, hesabat, çap və ixrac üçün aktiv lisenziya tələb olunur. Arxiv faylları silinmir.</p><p>Ödəniş və ilk aktivləşdirmə internetlə təsdiqlənir. İmzalı aktivləşdirmə sonradan lokal yoxlanır.</p><button onClick={()=>open('support')}>Əlaqə saxla</button></>}
    {message&&<p role="status" className="product-message">{message}</p>}
    </div><footer><span>{product?.email}</span><button onClick={()=>setPanel('')}>Bağla</button></footer>
  </dialog>,document.body)}</>;
}

export function ProductBoundary({children}:{children:ReactNode}) {
  const path=usePathname()||'/';
  const [licenseChecked,setLicenseChecked]=useState(false);
  const [product,setProduct]=useState<Product|null>(null),[license,setLicense]=useState<License|null>(null),[failed,setFailed]=useState(false),[update,setUpdate]=useState<Update|null>(null),[dismissed,setDismissed]=useState(false);
  useEffect(()=>{let alive=true,lastUpdateVersion:string|undefined;const check=async()=>{try{const p=await productInfo();if(!alive)return;setProduct(p);const l=p.licenseRequired?await api<License>('license'):null;if(alive){setLicense(l);setLicenseChecked(true);setFailed(false);}}catch{if(alive)setFailed(true);}};void check();const timer=setInterval(()=>void check(),60000);window.addEventListener('radaz-license-change',check);const checkUpdate=()=>{void releaseUpdate().then(u=>{if(alive){if(u.state==='available'){setUpdate(u);if(u.version!==lastUpdateVersion){lastUpdateVersion=u.version;setDismissed(false);}}else setUpdate(null);}}).catch(()=>{});};const updateTimer=setTimeout(checkUpdate,1000);const updateInterval=setInterval(checkUpdate,15000);return()=>{alive=false;clearInterval(timer);clearTimeout(updateTimer);clearInterval(updateInterval);window.removeEventListener('radaz-license-change',check);};},[]);
  useEffect(()=>{
    const channel=new BroadcastChannel('radaz-update-applied');let alive=true;
    channel.onmessage=event=>{const version=event.data?.version;if(typeof version!=='string'||!/^\d+\.\d+\.\d+$/.test(version))return;
      void activatedBuild(version).then(buildId=>{
        if(alive&&buildId)reloadBuild(buildId);
      }).catch(()=>{});
    };
    return()=>{alive=false;channel.close();};
  },[]);
  if(!product||!licenseChecked||failed) return <div className="product-loading" role="status">{failed?<><span>Proqramın yoxlanması tamamlanmadı. Lokal xidmətlə əlaqəni yoxlayın.</span><button onClick={()=>window.dispatchEvent(new Event('radaz-license-change'))}>Yenidən yoxla</button></>:'RADAZ açılır…'}</div>;
  const access=licenseAccess(product.licenseRequired,!!license?.valid&&!failed,path);
  if(access.blocked)return <main className="license-gate"><RadazLogo size={96}/><h1>Bu funksiya üçün lisenziyanı aktivləşdirin</h1><p>PACS və Local arxiv işləyir. Viewer-də görüntüləri listələyə bilərsiniz.</p><div className="product-actions"><a href="/">Viewer</a><a href="/archive">Local arxiv</a><a href="/pacs">PACS</a></div><AppHelpMenu initial={license?.kind==='expired'?'license':''}/></main>;
  return <LicenseContext.Provider value={{limited:access.limited,label:licenseLabel(license),owner:license?.kind==='owner',modules:license?.modules||{}}}>{children}{update&&!dismissed&&<aside className="update-toast" role="status"><RefreshCw size={18}/><div><b>RADAZ {update.version} {update.phase==='ready'||update.phase==='deferred'?'hazırdır':'— yeni versiya'}</b><span>{update.automatic?(update.phase==='ready'||update.phase==='deferred'?'Yenilənmə hazırdır. Yenilənmə pəncərəsində “Proqramı yenidən aç” düyməsini basın.':update.message):'Yenilənmə üçün proqram qısayolundan RADAZ-ı başladın.'}</span>{<button className="update-open" onClick={()=>window.dispatchEvent(new Event('radaz-show-updates'))}>Yenilənməyə bax</button>}</div><button onClick={()=>setDismissed(true)} aria-label="Bildirişi bağla"><X size={16}/></button></aside>}</LicenseContext.Provider>;
}
