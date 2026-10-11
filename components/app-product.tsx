'use client';
import {useTranslation as useUiTranslation,translate as tr} from '@/lib/i18n';


import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { licenseAccess } from '@/lib/license-access';
import { isNewerRelease } from '@/lib/release-version';
import {activatedBuild,reloadBuild,reportUpdateDiagnostic,type InstallationState} from '@/lib/update-activation';
import { BookOpen, CircleHelp, Info, Keyboard, KeyRound, Mail, MessageCircle, RefreshCw, ShieldCheck, X } from 'lucide-react';
import { createPortal } from 'react-dom';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { RadazLogo } from './radaz-logo';
import { DesktopUpdatePanel } from './desktop-update-panel';
import {LanguageSettings} from './language-settings';
import {AnatomyLicenseSettings} from './anatomy-license-settings';
import {useTranslation} from '@/lib/i18n';
import { AiSettings } from './ai-settings';

type Product = { name:string;version:string;channel:string;owner:string;email:string;telegram:string;repository:string;updateRepository?:string;salesUrl:string;licenseRequired:boolean;currency:string;monthly:number|null;billingUrl?:string };
type License = { modules?:Record<string,{valid:boolean;expiresAt:number}>;valid:boolean;required:boolean;deviceId:string;message:string;kind?:'owner'|'paid'|'trial'|'expired';trial?:{valid:boolean;startedAt?:number;expiresAt?:number;daysRemaining:number};claims?:{customer:string;plan:string;seats:number;expiresAt:number;licenseId:string;entitlement?:'owner'} };
type Update = { state:'available'|'current'|'unpublished'|'error';message:string;version?:string;url?:string;automatic?:boolean;phase?:string };
type Panel = ''|'help'|'keys'|'license'|'about'|'support'|'updates'|'agreement'|'ai'|'settings';
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
  useUiTranslation();
  const {t}=useTranslation();
  const [panel,setPanel]=useState<Panel>(initial),[product,setProduct]=useState<Product|null>(null),[license,setLicense]=useState<License|null>(null),[update,setUpdate]=useState<Update|null>(null);
  const [key,setKey]=useState(''),[message,setMessage]=useState(''),[busy,setBusy]=useState(false),[issue,setIssue]=useState('');
  const dialog=useRef<HTMLDialogElement>(null);
  const open=(next:Panel)=>{setMessage('');setPanel(next);};
  useEffect(()=>{const show=()=>open('ai');window.addEventListener('radaz-ai-settings',show);return()=>window.removeEventListener('radaz-ai-settings',show);},[]);
  useEffect(()=>{void productInfo().then(setProduct).catch(()=>{});const listener=(e:KeyboardEvent)=>{if(e.key==='F1'){e.preventDefault();setPanel(e.ctrlKey?'about':'help');}};const showUpdates=()=>setPanel('updates');window.addEventListener('radaz-show-updates',showUpdates);window.addEventListener('keydown',listener);return()=>{window.removeEventListener('keydown',listener);window.removeEventListener('radaz-show-updates',showUpdates);};},[]);
  useEffect(()=>{if(!panel)return;if(!dialog.current?.open)dialog.current?.showModal();if(panel==='license')void api<License>('license').then(setLicense).catch(e=>setMessage(e.message));},[panel]);
  const check=async()=>{open('updates');setBusy(true);try{setUpdate(await releaseUpdate(true));}catch(e){setMessage(e instanceof Error?e.message:'Yeniləmə yoxlanmadı');}finally{setBusy(false);}};
  const activate=async()=>{setBusy(true);setMessage('');try{const result=await api<License>('license/activate',{key:key.trim()});setLicense(result);setKey('');setMessage(result.message);window.dispatchEvent(new Event('radaz-license-change'));}catch(e){setMessage(e instanceof Error?e.message:'Aktivləşdirmə alınmadı');}finally{setBusy(false);}};
  const title={settings:t('settings.title'),help:'Yardım mərkəzi',keys:'Klaviatura qısa yolları',license:'Lisenziyanı aktivləşdir',about:'RADAZ haqqında',support:'Dəstək ilə əlaqə',updates:'Proqram yeniləmələri',agreement:'Lisenziya şərtləri',ai:'AI ayarları','':''}[panel];
  return <><DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" className="header-control help-trigger" title={tr('ui.help_f1_8115e')} aria-label={tr('ui.help_and_licence_be57c')}><CircleHelp size={18}/><span>{tr('ui.help_a5212')}</span></Button></DropdownMenuTrigger><DropdownMenuContent className="header-menu product-menu" align="end">
    <DropdownMenuItem onClick={()=>open('settings')}><Info size={16}/>{t('settings.title')}</DropdownMenuItem>
    <DropdownMenuItem onClick={()=>open('help')}><BookOpen size={16}/>{tr('ui.help_a5212')}<span className="product-shortcut">F1</span></DropdownMenuItem>
    <DropdownMenuItem onClick={()=>open('keys')}><Keyboard size={16}/>{tr('ui.keyboard_shortcuts_8b928')}</DropdownMenuItem>
    <DropdownMenuItem onClick={()=>open('ai')}><KeyRound size={16}/>{tr('ui.ai_settings_b1308')}</DropdownMenuItem>
    <DropdownMenuItem onClick={()=>open('support')}><MessageCircle size={16}/>{tr('ui.report_a_problem_0fe73')}</DropdownMenuItem><DropdownMenuSeparator/>
    <DropdownMenuItem onClick={()=>void check()}><RefreshCw size={16}/>{tr('ui.check_for_updates_adc6c')}</DropdownMenuItem>
    <DropdownMenuItem onClick={()=>open('license')}><KeyRound size={16}/>{tr('ui.enter_licence_key_14b07')}</DropdownMenuItem>
    <DropdownMenuItem onClick={()=>open('agreement')}><ShieldCheck size={16}/>{tr('ui.licence_terms_b2286')}</DropdownMenuItem><DropdownMenuSeparator/>
    <DropdownMenuItem onClick={()=>open('about')}><Info size={16}/>{tr('ui.about_radaz_d4182')}<span className="product-shortcut">Ctrl+F1</span></DropdownMenuItem>
  </DropdownMenuContent></DropdownMenu>
  {panel && typeof document!=='undefined' && createPortal(<dialog ref={dialog} className="product-dialog" onCancel={()=>setPanel('')} onClick={e=>{if(e.target===dialog.current)setPanel('');}} aria-label={title}>
    <header><RadazLogo size={42}/><div><small>RADAZ · {product?.version||'…'}</small><h2>{title}</h2></div><button type="button" onClick={()=>setPanel('')} aria-label={tr('ui.close_c1cf9')}><X size={20}/></button></header>
    <div className="product-dialog-body">
    {panel==='settings'&&<><LanguageSettings/><AnatomyLicenseSettings/></>}
    {panel==='ai'&&<AiSettings/>}
    {panel==='help'&&<><p>{tr('ui.load_a_dicom_file_or_folder_or_open_a_study_f_a9700')}</p><div className="help-cards"><article><b>{tr('ui.scroll_through_images_08ed8')}</b><p><strong>S</strong> {tr('ui.or_the_scroll_tool_drag_up_or_down_on_the_ima_4f08e')}</p></article><article><b>{tr('ui.printing_and_export_1ae88')}</b><p>{tr('ui.use_image_selection_to_build_a_print_list_cho_1a615')}</p></article><article><b>{tr('ui.ai_assistant_and_report_fd718')}</b><p>{tr('ui.all_series_from_the_active_study_open_in_the_e8828')}</p></article><article><b>{tr('ui.receive_dicom_from_a_device_7b268')}</b><p>{tr('ui.the_local_archive_shows_its_ae_title_ip_and_p_9c768')}</p></article></div><button onClick={()=>open('support')}>{tr('ui.contact_support_9352c')}</button></>}
    {panel==='keys'&&<dl className="shortcut-list">{[['N','Neqativ / pozitiv'],['O','Ox'],['Q','Qələm'],['K','3D kursor'],['S','Listələ / barmaqla sürüşdür'],['W','Pəncərələmə'],['Orta düymə + sürüklə','Görüntünü daşı'],['Sağ düymə + sürüklə','Zoom'],['Sağ klik','Ölçmə üçün silmə menyusu'],['Ctrl+D','Cari kəsitdə bütün ölçüləri sil'],['Delete','Seçilmiş ölçünü sil'],['P','Görüntünü sürüşdür'],['Z','Yaxınlaşdır'],['Ctrl + siçan çarxı','Görüntünü böyüt / kiçilt'],['Siçan çarxı','Əvvəlki / növbəti kəsit'],['Ctrl+[ / Ctrl+]','90° sola / sağa fırlat'],['Ctrl+Shift+[ / ]','Üfüqi / şaquli çevir'],['F11','Siçan görüntü üzərindədirsə tam ekran'],['F1','Yardım'],['Ctrl+F1','Proqram haqqında']].map(([k,v])=><div key={k}><dt><kbd>{k}</kbd></dt><dd>{v}</dd></div>)}</dl>}
    {panel==='license'&&<><p className="product-note">{tr('ui.the_key_is_bound_to_the_computer_hosting_rada_64217')}</p>{license&&<><div className={`license-state ${license.valid?'valid':''}`}><ShieldCheck size={21}/><div><b>{licenseLabel(license)}</b><p>{license.required===false&&!license.valid?'Lisenziya açarını daxil edin.':license.message}</p></div></div><label>{tr('ui.computer_id_b3ade')}<input readOnly value={license.deviceId} onFocus={e=>e.target.select()}/></label>{license.claims&&<p>{license.claims.customer} · {license.claims.entitlement==='owner'?'Müddətsiz sahib lisenziyası':`Bitmə: ${new Date(license.claims.expiresAt*1000).toLocaleDateString('az-AZ')}`} · {license.claims.seats} {tr('ui.computers_fe53c')}</p>}{license.kind==='trial'&&license.trial?.expiresAt&&<p>{tr('ui.trial_ends_eddfd')}{new Date(license.trial.expiresAt*1000).toLocaleString('az-AZ')}{tr('ui._all_functions_are_available_during_this_peri_8b3de')}</p>}</>}
      <label>{tr('ui.licence_key_d6825')}<textarea value={key} onChange={e=>setKey(e.target.value)} rows={4} placeholder={tr('ui.radaz_act_or_radaz1_549fd')} spellCheck={false}/></label><div className="product-actions"><button disabled={busy||!key.trim()||!license} onClick={()=>void activate()}><KeyRound size={16}/>{busy?'Yoxlanılır…':'Aktivləşdir'}</button></div></>}
    {panel==='support'&&<><p>{tr('ui.describe_the_problem_steps_to_reproduce_and_e_f8ceb')}</p><label>{tr('ui.problem_description_caf7b')}<textarea value={issue} onChange={e=>setIssue(e.target.value)} rows={6} placeholder={tr('ui.for_example_when_i_press_export_a8092')}/></label><p className="product-note">{tr('ui.patient_data_is_not_added_to_the_message_auto_7c264')}</p><div className="product-actions"><a href={`mailto:${product?.email||'drnaghiyev@gmail.com'}?subject=RADAZ%20dəstək&body=${encodeURIComponent(`RADAZ ${product?.version||''}\n\n${issue}`)}`}><Mail size={16}/>{tr('ui.write_email_7ab7b')}</a><a href={`https://t.me/${product?.telegram||'TNNZsfjfHuP'}`} target="_blank" rel="noreferrer"><MessageCircle size={16}/>Telegram</a></div><p>{product?.email} · @{product?.telegram}</p></>}
    {panel==='updates'&&<><p>{tr('ui.installed_version_91a20')}<b>{product?.version}</b> ({product?.channel})</p><DesktopUpdatePanel busy={busy} onCheck={()=>void check()} fallback={<><div className="license-state"><RefreshCw size={22}/><p>{busy?'Buraxılışlar yoxlanılır…':update?.message||'Yoxlamanı başladın.'}</p></div><p className="product-note">{tr('ui.launch_radaz_using_its_shortcut_on_this_compu_eab8e')}</p></>}/></>}
    {panel==='about'&&<div className="product-about"><h3>RADAZ <small>{product?.version}</small></h3><p>{product?.owner||'Radioloq Rövşən Nağıyev'} {tr('ui.developed_this_application_26da1')}</p><p>{tr('ui.dicom_application_for_working_with_radiologic_ac3ff')}</p><p>{tr('ui.dicom_file_folder_zip_rar_and_cd_dvd_import_l_1985e')}</p><p>{tr('ui.image_viewing_and_windowing_measurement_tools_e8457')}</p><p>{tr('ui.reporting_ai_assistant_printing_and_image_exp_bcb82')}</p></div>}
    {panel==='agreement'&&<><p>{tr('ui.trial_duration_follows_the_seller_policy_rema_40451')}</p><p>{tr('ui.the_licence_period_begins_at_first_activation_641a3')}</p><p>{tr('ui.after_expiration_pacs_local_archive_and_dicom_3cd0d')}</p><p>{tr('ui.first_activation_is_verified_online_the_signe_ed019')}</p><button onClick={()=>open('support')}>{tr('ui.contact_us_d6cbc')}</button></>}
    {message&&<p role="status" className="product-message">{message}</p>}
    </div><footer><span>{product?.email}</span><button onClick={()=>setPanel('')}>{tr('ui.close_c1cf9')}</button></footer>
  </dialog>,document.body)}</>;
}

export function ProductBoundary({children}:{children:ReactNode}) {
  useUiTranslation();
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
  if(!product||!licenseChecked||failed) return <div className="product-loading" role="status">{failed?<><span>{tr('ui.application_verification_did_not_complete_che_3c1f2')}</span><button onClick={()=>window.dispatchEvent(new Event('radaz-license-change'))}>{tr('ui.check_again_9c69a')}</button></>:'RADAZ açılır…'}</div>;
  const access=licenseAccess(product.licenseRequired,!!license?.valid&&!failed,path);
  if(access.blocked)return <main className="license-gate"><RadazLogo size={96}/><h1>{tr('ui.activate_a_licence_for_this_function_3300f')}</h1><p>{tr('ui.pacs_and_local_archive_are_available_you_can_15d75')}</p><div className="product-actions"><a href="/">{tr('ui.viewer_678bf')}</a><a href="/archive">{tr('ui.local_archive_c13fe')}</a><a href="/pacs">PACS</a></div><AppHelpMenu initial={license?.kind==='expired'?'license':''}/></main>;
  return <LicenseContext.Provider value={{limited:access.limited,label:licenseLabel(license),owner:license?.kind==='owner',modules:license?.modules||{}}}>{children}{update&&!dismissed&&<aside className="update-toast" role="status"><RefreshCw size={18}/><div><b>RADAZ {update.version} {update.phase==='ready'||update.phase==='deferred'?'hazırdır':'— yeni versiya'}</b><span>{update.automatic?(update.phase==='ready'||update.phase==='deferred'?'Yenilənmə hazırdır. Yenilənmə pəncərəsində “Proqramı yenidən aç” düyməsini basın.':update.message):'Yenilənmə üçün proqram qısayolundan RADAZ-ı başladın.'}</span>{<button className="update-open" onClick={()=>window.dispatchEvent(new Event('radaz-show-updates'))}>{tr('ui.view_update_a3676')}</button>}</div><button onClick={()=>setDismissed(true)} aria-label={tr('ui.dismiss_notification_cfbe6')}><X size={16}/></button></aside>}</LicenseContext.Provider>;
}
