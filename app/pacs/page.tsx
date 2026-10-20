'use client';
import {ToolbarWorkspace, ToolbarGroup, ToolbarOverflow} from '@/components/toolbar-workspace';
import {useTranslation as useUiTranslation,translate as tr} from '@/lib/i18n';

import { ResizableTable, ResizableHeader } from '@/components/resizable-table';
import { SortHeader, useTableSort } from '@/components/table-sort';
import { registerRecordsWindow, recordsWindowTitle, openStudyInViewer, openStudiesInViewer, focusViewer, notifyViewerProgress, refreshStudyInViewer, type ViewerTarget } from '@/lib/viewer-session';

import { useEffect, useRef, useState } from 'react';
import { Activity, ExternalLink, Network, Plus, Search, Settings2, Trash2, Wifi, Download, Database, RefreshCw, X, Disc3 } from 'lucide-react';
import { queryRemoteSeries, queryRemoteStudies, retrieveRemoteStudy, type RemoteSeries, type RemoteStudy } from '@/lib/dicomweb';
import { echoDimse, getDimseBridgeVersion, queryDimseSeries, queryDimseStudies, retrieveDimseStudy } from '@/lib/pacs-bridge';
import { preparePacsTransferTab } from '@/lib/pacs-transfer-tab';
import { deleteLocalStudies, listArchiveStudies, recordStudyOpened, saveArchiveFiles } from '@/lib/local-archive';
import { RadazBridgeRowSend, RadazBridgeSettings, useRadazBridgeTransfers } from '@/components/radaz-bridge-send';
import { AppHelpMenu } from '@/components/app-product';
import { useStudySelection } from '@/components/study-selection';
import { StudyFilterControls, localDate } from '@/components/study-filter-controls';

type PacsLocation = { id: string; host: string; port: string; aeTitle: string; description: string; dicomwebUrl: string };
const blank = (): PacsLocation => ({ id: '', host: '', port: '11112', aeTitle: '', description: '', dicomwebUrl: '' });
const date = (raw: string) => raw.length === 8 ? `${raw.slice(6,8)}.${raw.slice(4,6)}.${raw.slice(0,4)}` : '—';
const validAeTitle = (title: string) => /^[\x20-\x7E]{1,16}$/.test(title) && !title.includes('\\');
const modalityOptions = ['CR','DX','CT','MR','XA','MG','US','PT','NM','RF','RG','PX','ES','XC','GM','SC','OT','SR'];

export default function PacsPage({embedded=false}:{embedded?:boolean}={}) {
  useUiTranslation();
  const [locations, setLocations] = useState<PacsLocation[]>([]);
  const [selected, setSelected] = useState('');
  const [editor, setEditor] = useState<PacsLocation>(blank);
  const [aeTitle, setAeTitle] = useState('RADAZ');
  const [listenerPort, setListenerPort] = useState('11112');
  const [draftAeTitle, setDraftAeTitle] = useState('RADAZ');
  const [draftListenerPort, setDraftListenerPort] = useState('11112');
  const [configOpen, setConfigOpen] = useState(false);
  const [configStatus, setConfigStatus] = useState('');
  const modalRef = useRef<HTMLDialogElement>(null);
  const [token, setToken] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [status, setStatus] = useState('PACS konfiqurasiyasını yükləyin');
  const [busy, setBusy] = useState(false);
  const bridgeTransfers = useRadazBridgeTransfers(setBusy);
  const studyQuery = useRef(0), openingStudy = useRef(false);
  const [patient, setPatient] = useState('');
  const [dateFrom, setDateFrom] = useState(localDate);
  const [dateTo, setDateTo] = useState(localDate);
  const [modalities, setModalities] = useState<string[]>([]);
  const [studies, setStudies] = useState<RemoteStudy[]>([]);
  const [hasSearched, setHasSearched] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [dimseReady, setDimseReady] = useState('');
  const [bridgeVersion, setBridgeVersion] = useState<number | null>(null);
  const [study, setStudy] = useState('');
  const [series, setSeries] = useState<RemoteSeries[]>([]);
  const [checked, setChecked] = useState<string[]>([]);
  const location = locations.find(item => item.id === selected);
  const visibleStudies = studies.filter(item => (!dateFrom || item.date >= dateFrom.replaceAll('-', '')) && (!dateTo || item.date <= dateTo.replaceAll('-', '')) && (!modalities.length || modalities.some(modality => item.modality.split(/[\\/,\s]+/).includes(modality))));
  const selection = useStudySelection(visibleStudies.map(item => item.uid));
  const activeStudy = visibleStudies.find(item => item.uid === study);
  const studySort=useTableSort(visibleStudies,{date:r=>r.date,patient:r=>r.patient,patientId:r=>r.patientId,modality:r=>r.modality,description:r=>r.description,seriesCount:r=>r.seriesCount,instanceCount:r=>r.instanceCount},{key:'date',direction:'desc'});
  const seriesSort=useTableSort(series,{number:r=>r.number,modality:r=>r.modality,description:r=>r.description,instanceCount:r=>r.instanceCount},{key:'number',direction:'asc'});
  const nodeSort=useTableSort(locations,{host:r=>r.host,port:r=>Number(r.port),aeTitle:r=>r.aeTitle,description:r=>r.description,dicomwebUrl:r=>r.dicomwebUrl},{key:'description',direction:'asc'});
  const canSearch = !!location && (!!location.dicomwebUrl || !!(location.host && location.aeTitle));

  useEffect(() => {
    if(!embedded)recordsWindowTitle('PACS müayinələri');
    const stopWindow = embedded?()=>{}:registerRecordsWindow('pacs');
    try {
      const saved = JSON.parse(localStorage.getItem('radaz-pacs-config-v1') || '{}');
      if (Array.isArray(saved.locations)) {
        const valid = saved.locations.filter((item: PacsLocation) => item && typeof item.id === 'string' && typeof item.dicomwebUrl === 'string');
        setLocations(valid); setSelected(valid.some((item: PacsLocation) => item.id === saved.selected) ? saved.selected : valid[0]?.id || '');
      }
      if (typeof saved.aeTitle === 'string') setAeTitle(saved.aeTitle);
      if (typeof saved.listenerPort === 'string') setListenerPort(saved.listenerPort);
      setStatus('Konfiqurasiya bu brauzerdə saxlanılır');
    } catch { setStatus('Saxlanılmış PACS konfiqurasiyası oxunmadı'); }
    setLoaded(true);
    return stopWindow;
  }, []);
  useEffect(() => {
    if (loaded) localStorage.setItem('radaz-pacs-config-v1', JSON.stringify({ locations, selected, aeTitle, listenerPort }));
  }, [loaded, locations, selected, aeTitle, listenerPort]);
  useEffect(() => {
    const modal = modalRef.current;
    if (!modal) return;
    if (configOpen && !modal.open) modal.showModal();
    if (!configOpen && modal.open) modal.close();
  }, [configOpen]);

  const openConfig = () => {
    setDraftAeTitle(aeTitle); setDraftListenerPort(listenerPort);
    setEditor(location || blank()); setConfigStatus(''); setConfigOpen(true);
  };
  const choose = (item: PacsLocation) => {
    selection.clear();
    setSelected(item.id); setEditor(item); setStudies([]); setSeries([]); setStudy(''); setHasSearched(false); setSearchError(''); setDimseReady(''); setBridgeVersion(null);
  };
  const save = () => {
    const next = { ...editor, host: editor.host.trim(), port: editor.port.trim(),
      aeTitle: editor.aeTitle.trim().toUpperCase(), description: editor.description.trim(), dicomwebUrl: editor.dicomwebUrl.trim().replace(/\/$/, '') };
    if (!next.host && !next.aeTitle && !next.description && !next.dicomwebUrl) { setConfigStatus('PACS üçün IP/host, AE title və ya təsvir daxil edin'); return false; }
    if (!/^[1-9]\d{0,4}$/.test(next.port) || Number(next.port) > 65535) { setConfigStatus('PACS portu 1–65535 arası olmalıdır'); return false; }
    if (next.aeTitle && !validAeTitle(next.aeTitle)) { setConfigStatus('AE Title 1–16 ASCII simvol olmalıdır'); return false; }
    if (next.dicomwebUrl) {
      try {
        const url = new URL(next.dicomwebUrl);
        if (url.protocol !== 'https:' && !(window.location.protocol === 'http:' && url.protocol === 'http:'))
          throw new Error('DICOMweb üçün HTTPS ünvanı daxil edin');
        if (url.username || url.password) throw new Error('Şifrəni URL-də yazmayın; Bearer token sahəsindən istifadə edin');
      } catch (error) { setConfigStatus(error instanceof Error && error.message !== 'Invalid URL' ? error.message : 'DICOMweb URL düzgün deyil'); return false; }
    }
    next.id ||= Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('');
    setLocations(current => current.some(item => item.id === next.id) ? current.map(item => item.id === next.id ? next : item) : [...current, next]);
    setSelected(next.id); setEditor(next); setStudies([]); setSeries([]); setStudy(''); setChecked([]); setHasSearched(false); setSearchError(''); setDimseReady(''); setBridgeVersion(null);
    setConfigStatus('PACS ünvanı yadda saxlanıldı'); setStatus('PACS ünvanı yadda saxlanıldı');
    return true;
  };
  const saveConfig = () => {
    const nextAe = draftAeTitle.trim().toUpperCase(), nextPort = draftListenerPort.trim();
    if (!validAeTitle(nextAe)) { setConfigStatus('Mənim AE Title 1–16 ASCII simvol olmalıdır'); return; }
    if (!/^[1-9]\d{0,4}$/.test(nextPort) || Number(nextPort) > 65535) { setConfigStatus('Listener port 1–65535 arası olmalıdır'); return; }
    const existing = locations.find(item => item.id === editor.id);
    const addressEdited = existing
      ? editor.host !== existing.host || editor.port !== existing.port || editor.aeTitle !== existing.aeTitle || editor.description !== existing.description || editor.dicomwebUrl !== existing.dicomwebUrl
      : editor.host.trim() || editor.aeTitle.trim() || editor.description.trim() || editor.dicomwebUrl.trim() || editor.port !== blank().port;
    if (addressEdited && !save()) return;
    setAeTitle(nextAe); setListenerPort(nextPort);
    setStatus('PACS konfiqurasiyası bu brauzerdə yadda saxlanıldı');
    setConfigOpen(false);
  };
  const remove = () => {
    const target = locations.find(item => item.id === editor.id);
    if (!target || !window.confirm(`“${target.description || target.host || target.dicomwebUrl}” PACS ünvanı silinsin?`)) return;
    setLocations(current => current.filter(item => item.id !== target.id));
    if (selected === target.id) { setSelected(''); setStudies([]); setSeries([]); setStudy(''); setHasSearched(false); setSearchError(''); setDimseReady(''); setBridgeVersion(null); }
    setEditor(blank()); setConfigStatus('PACS ünvanı silindi'); setStatus('PACS ünvanı silindi');
  };
  const test = async (target = location, caller = aeTitle) => {
    if (!target || (!target.dicomwebUrl && (!target.host || !target.aeTitle))) { setStatus('PACS IP, port və AE Title daxil edin'); setConfigStatus('PACS IP, port və AE Title daxil edin'); return; }
    setBusy(true); setStatus(target.dicomwebUrl ? 'DICOMweb QIDO-RS əlaqəsi yoxlanır…' : 'PACS C-ECHO əlaqəsi yoxlanır…'); setConfigStatus('PACS əlaqəsi yoxlanır…');
    try {
      let message = 'PACS C-ECHO əlaqəsi işləyir';
      if (target.dicomwebUrl) {
        const results = await queryRemoteStudies(target.dicomwebUrl, token);
        setStudies(results);
        message = `DICOMweb əlaqəsi işləyir · ${results.length} müayinə qaytarıldı`;
      } else {
        await echoDimse(target, caller);
        setBridgeVersion(await getDimseBridgeVersion());
        setDimseReady(target.id);
      }
      setStatus(message); setConfigStatus(message);
    }
    catch (error) { const message = error instanceof Error ? error.message : String(error); setDimseReady(''); setStatus(message); setConfigStatus(message); }
    finally { setBusy(false); }
  };
  const search = async () => {
    if (!location || !canSearch) { setStatus('PACS serverinin IP, port və AE Title məlumatlarını tamamlayın'); return; }
    setBusy(true); setStatus('PACS müayinələri axtarılır…'); setSearchError('');
    selection.clear();
    setStudies([]); setStudy(''); setSeries([]); setChecked([]); setHasSearched(false);
    try {
      const response = location.dicomwebUrl
        ? { items: await queryRemoteStudies(location.dicomwebUrl, token, patient, dateFrom, dateTo, modalities), truncated: false }
        : await queryDimseStudies(location, aeTitle, patient, dateFrom && dateFrom === dateTo ? dateFrom : '');
      if (!location.dicomwebUrl) {
        setDimseReady(location.id);
        setBridgeVersion(await getDimseBridgeVersion().catch(() => 0));
      }
      const fromRaw = dateFrom.replaceAll('-', ''), toRaw = dateTo.replaceAll('-', '');
      const filtered = response.items.filter(item => {
        const itemModalities = item.modality.toUpperCase().split(/[\\,\s]+/).filter(Boolean);
        return (!fromRaw || item.date >= fromRaw) && (!toRaw || item.date <= toRaw)
          && (!modalities.length || modalities.some(modality => itemModalities.includes(modality)));
      });
      setStudies(filtered); setHasSearched(true);
      setStatus(`${filtered.length} müayinə tapıldı${response.truncated ? ' · ilk 200 nəticə, filtri dəqiqləşdirin' : ''}`);
    }
    catch (error) { const message = error instanceof Error ? error.message : String(error); if (!location.dicomwebUrl) setDimseReady(''); setStatus(message); setSearchError(message); }
    finally { setBusy(false); }
  };
  const chooseStudy = async (item: RemoteStudy, open = false) => {
    if(open&&selection.checked.length){await openSelectedStudies(true);return;}
    if (openingStudy.current || (busy && !open)) return;
    const query = ++studyQuery.current;
    if (open) openingStudy.current = true;
    const reservedViewer = open ? await focusViewer() : undefined;
    if(open)notifyViewerProgress(reservedViewer||null,{label:'PACS yüklənir',done:0,total:0});
    setStudy(item.uid); setSeries([]); setChecked([]); setBusy(true); setStatus('PACS seriyaları oxunur…');
    try {
      const response = location!.dicomwebUrl
        ? { items: await queryRemoteSeries(location!.dicomwebUrl, token, item.uid), truncated: false }
        : await queryDimseSeries(location!, aeTitle, item.uid);
      if (query !== studyQuery.current) return;
      setSeries(response.items); setChecked(response.items.map(series => series.uid));
      setStatus(`${response.items.length} seriya tapıldı${response.truncated ? ' · ilk 200 seriya' : ''}`);
      if (open) await retrieve('viewer', undefined, item, response.items, reservedViewer);
    }
    catch (error) { if (query === studyQuery.current) {const message=error instanceof Error?error.message:String(error);setStatus(message);if(open)notifyViewerProgress(reservedViewer||null,null,message);} }
    finally { if (query === studyQuery.current) setBusy(false); if (open) openingStudy.current = false; }
  };
  const retrieve = async (destination: 'viewer' | 'media' = 'viewer', onlySeries?: string, selectedStudy = activeStudy, selectedSeries?: RemoteSeries[], reservedViewer?: ViewerTarget | null) => {
    if(destination==='viewer'&&!onlySeries&&!selectedSeries&&selection.checked.length){await openSelectedStudies();return;}
    if ((busy && !selectedSeries) || !location || !selectedStudy || (!selectedSeries && !onlySeries && !checked.length)) return;
    // Discover or reserve a Viewer before the long PACS transfer.
    const mediaTab=destination==='media'?window.open('about:blank','_blank'):null;
    const viewer = destination === 'viewer' ? (reservedViewer === undefined ? await focusViewer() : reservedViewer) : null;
    const updateTab = preparePacsTransferTab(mediaTab);
    const report = (message: string) => { setStatus(message); updateTab(message); };
    notifyViewerProgress(destination === 'viewer' ? viewer : null, {label:'PACS yüklənir',done:0,total:0});
    const progress = (done:number,total:number,label='PACS yüklənir') => { report(`${label}: ${done} / ${total}`); if(destination === 'viewer')notifyViewerProgress(viewer,{label,done,total}); };
    setBusy(true);
    try {
      if (!location.dicomwebUrl) {
        const version = await getDimseBridgeVersion();
        setBridgeVersion(version);
        if (version < 3) throw new Error('Görüntü endirmək üçün köhnə RADAZ PACS körpüsünü bağlayın, yeni v4 ZIP-ni endirib başladın. Köhnə körpü axtarış aparır, amma görüntü göndərə bilmir.');
      }
      const chosen = selectedSeries || series.filter(item => onlySeries ? item.uid === onlySeries : checked.includes(item.uid));
      if (!chosen.length) throw new Error('Müayinədə açılacaq seriya tapılmadı');
      if (!location.dicomwebUrl && chosen.length > 30) throw new Error('Bir köçürmədə ən çox 30 seriya seçin.');
      const expected = chosen.reduce((total, item) => total + item.instanceCount, 0);
      let count=0,opened=false;
      for(const item of chosen){
        const files=location.dicomwebUrl
          ? await retrieveRemoteStudy(location.dicomwebUrl,token,selectedStudy.uid,[item],(done)=>progress(count+done,expected))
          : await retrieveDimseStudy(location,aeTitle,listenerPort,selectedStudy.uid,[item.uid],(done)=>progress(count+done,expected));
        if(!await saveArchiveFiles(files,(done,total)=>progress(count+done,expected,'PACS arxivə yazılır')))throw new Error('PACS fayllarında oxuna bilən DICOM görüntüsü tapılmadı');
        count+=files.length;
        if(destination==='viewer'){
          if(!opened){await openStudyInViewer(selectedStudy.uid,viewer);opened=true;}
          else refreshStudyInViewer(selectedStudy.uid,viewer);
        }
      }
      await recordStudyOpened(selectedStudy.uid);
      const target = destination === 'media' ? `/media?study=${encodeURIComponent(selectedStudy.uid)}` : `/#archive-study=${encodeURIComponent(selectedStudy.uid)}`;
      if (destination === 'viewer') notifyViewerProgress(viewer,null);
      else if (mediaTab) mediaTab.location.href = target;
      setStatus(`${count} görüntü local arxivə saxlanıldı${viewer || destination === 'viewer' ? ' və seçilmiş modul açıldı' : '. Arxiv vərəqəsindən açın'}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      updateTab(message, true); if(destination === 'viewer')notifyViewerProgress(viewer,null,message);
      if (message.includes('yeni versiyasını') || message.includes('yeni v3')) setBridgeVersion(0);
      setStatus(`PACS idxalı alınmadı: ${message}`);
    }
    finally { setBusy(false); }
  };

  const openSelectedStudies = async (fromRow = false) => {
    if((busy&&!fromRow)||openingStudy.current||!location||!selection.checked.length)return;
    ++studyQuery.current; // Supersede the single-click series query on double-click.
    const targets=visibleStudies.filter(item=>selection.checked.includes(item.uid));
    const viewer=await focusViewer();if(!viewer){setStatus('Viewer açıla bilmədi. Pop-up icazəsini yoxlayın.');return;}
    setBusy(true);openingStudy.current=true;
    try{
      if(!location.dicomwebUrl&&await getDimseBridgeVersion()<3)throw Error('PACS körpüsünü yeni versiyaya yeniləyin');
      for(const [index,item] of targets.entries()){
        const label=`PACS ${index+1}/${targets.length}`;
        const progress=(done:number,total:number)=>{setStatus(`${label}: ${done}/${total}`);notifyViewerProgress(viewer,{label,done,total});};
        progress(0,0);
        const entries=location.dicomwebUrl?await queryRemoteSeries(location.dicomwebUrl,token,item.uid):(await queryDimseSeries(location,aeTitle,item.uid)).items;
        if(!entries.length)throw Error(`${index+1}-ci müayinədə seriya tapılmadı`);
        let done=0;const total=entries.reduce((n,s)=>n+s.instanceCount,0);
        for(const [seriesIndex,entry] of entries.entries()){
          const files=location.dicomwebUrl?await retrieveRemoteStudy(location.dicomwebUrl,token,item.uid,[entry],n=>progress(done+n,total)):
            await retrieveDimseStudy(location,aeTitle,listenerPort,item.uid,[entry.uid],n=>progress(done+n,total));
          if(!await saveArchiveFiles(files,n=>progress(done+n,total)))throw Error(`${index+1}-ci müayinədə oxuna bilən DICOM tapılmadı`);
          done+=files.length;
          if(index===0&&seriesIndex===0)await openStudyInViewer(item.uid,viewer);
          else refreshStudyInViewer(item.uid,viewer);
        }
        await recordStudyOpened(item.uid);
      }
      notifyViewerProgress(viewer,null);
      setStatus(`${targets.length} seçilmiş müayinə Viewer-də açıldı`);
    }catch(error){const message=error instanceof Error?error.message:String(error);setStatus(message);notifyViewerProgress(viewer,null,message);}
    finally{setBusy(false);openingStudy.current=false;}
  };

  const removeCopies = async () => {
    const ids = selection.checked.length ? selection.checked : activeStudy ? [activeStudy.uid] : [];
    if (busy || !ids.length) return;
    setBusy(true);
    try {
      const copies = (await listArchiveStudies(true)).filter(item => ids.includes(item.uid));
      if (!copies.length) { setStatus('Seçilmiş müayinələrin bu kompüterdə endirilmiş nüsxəsi yoxdur'); return; }
      if (!window.confirm(`${copies.length} müayinənin bu kompüterdəki nüsxələri birdəfəlik silinsin? PACS serverindəki orijinallar saxlanılır.`)) return;
      setStatus(await deleteLocalStudies(copies)); selection.clear();
    } catch (error) { setStatus(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };

  return <ToolbarWorkspace scope="pacs"><main className="pacs-shell grouped-records">
    <header className="records-header records-unified-header pacs-unified-header">
      <div className="pacs-query records-header-filters">
        <label className="pacs-server">{tr('ui.pacs_server_d81a7')}<select disabled={!!bridgeTransfers.activeKey} aria-label={tr('ui.pacs_server_d81a7')} value={location?.id || ''} onChange={event => { const target = locations.find(item => item.id === event.currentTarget.value); if (target) choose(target); }}><option value="">{locations.length ? 'Server seçin' : 'Konfiqurasiya əlavə edin'}</option>{locations.map(item => <option key={item.id} value={item.id}>{item.description || item.host || item.aeTitle || item.dicomwebUrl}</option>)}</select></label>
        <label className="pacs-patient">{tr('ui.patient_name_01761')}<span className="search-field"><input aria-label={tr('ui.pacs_patient_search_6978c')} placeholder={tr('ui.first_or_last_name_18b98')} value={patient} onChange={event => setPatient(event.currentTarget.value)}/>{patient && <button type="button" className="search-clear" aria-label={tr('ui.clear_pacs_search_7dcf4')} title={tr('ui.clear_1e4f8')} onClick={() => setPatient('')}><X size={16}/></button>}</span></label>
        <StudyFilterControls from={dateFrom} to={dateTo} modalities={modalities} options={modalityOptions} onFromChange={setDateFrom} onToChange={setDateTo} onModalitiesChange={setModalities}/>

        <label className="pacs-token">Bearer token <input aria-label="PACS Bearer token" type="password" autoComplete="off" placeholder={location?.dicomwebUrl ? 'Yalnız bu vərəqədə istifadə edilir' : 'Yalnız DICOMweb üçün'} disabled={!location?.dicomwebUrl} value={token} onChange={event => setToken(event.currentTarget.value)}/></label>
      </div>
        <ToolbarGroup groupId="pacs-query" order={20} aria-label="PACS axtarış"><button className="records-primary pacs-search-button" title={tr('ui.search_e036c')} aria-label={tr('ui.search_e036c')} disabled={busy || !canSearch} onClick={() => { void search(); }}><Search size={16}/> {tr('ui.search_e036c')}</button>
        <button className="pacs-check-button" title={tr('ui.test_connection_f3128')} aria-label={tr('ui.test_pacs_connection_6608c')} disabled={busy || !canSearch} onClick={() => { void test(); }}><RefreshCw size={16}/></button></ToolbarGroup>
      <ToolbarGroup className="pacs-action-toolbar" groupId="pacs-actions" order={30}><button title={`Seçilmişləri aç (${selection.checked.length})`} aria-label={`Seçilmişləri aç (${selection.checked.length})`} disabled={busy || !selection.checked.length} onClick={() => void openSelectedStudies()}><ExternalLink size={18}/><span>{tr('ui.open_selected_d1078')}{selection.checked.length})</span></button><button disabled={busy || (!selection.checked.length && !activeStudy)} onClick={() => void removeCopies()} title={tr('ui.delete_copies_downloaded_to_this_computer_ef549')} aria-label={tr('ui.delete_local_copies_ec8fe')}><Trash2 size={16}/><span>{tr('ui.delete_local_copies_ec8fe')}{selection.checked.length ? ` (${selection.checked.length})` : ''}</span></button><button type="button" title={tr('ui.pacs_configuration_f5584')} disabled={!!bridgeTransfers.activeKey} onClick={openConfig} aria-label={tr('ui.open_pacs_configuration_327fe')}><Settings2 size={18}/><span>{tr('ui.pacs_settings_3f4c4')}</span></button><RadazBridgeSettings disabled={busy}/><AppHelpMenu/></ToolbarGroup>
      <ToolbarOverflow/>
    </header>
    <div className="pacs-content">
      <div className="pacs-browser"><div className="pacs-card-title"><Network size={19}/><div><strong>{tr('ui.pacs_studies_d77a3')}</strong><span>{location ? `${location.description || location.host || location.aeTitle || location.dicomwebUrl} · ${location.dicomwebUrl ? 'DICOMweb' : 'DICOM C-FIND'}` : 'Server seçin'}</span></div></div>
        {location && !location.dicomwebUrl && dimseReady !== location.id && <div className="pacs-connect-note">{tr('ui.for_ip_port_connections_on_this_computer_84946')}<a href="/radaz-pacs-bridge-v4.zip" download>{tr('ui.download_the_radaz_pacs_bridge_58b74')}</a>{tr('ui._extract_the_zip_and_run_c90bb')}<strong>start-radaz-pacs.cmd</strong> {tr('ui._close_any_old_bridge_and_start_the_new_versi_4c09d')}</div>}
        {location && !location.dicomwebUrl && dimseReady === location.id && bridgeVersion !== null && bridgeVersion < 3 && <div className="pacs-connect-note">{tr('ui.search_works_but_this_bridge_cannot_download_33441')}<a href="/radaz-pacs-bridge-v4.zip" download>{tr('ui.download_the_new_v4_zip_7196f')}</a> {tr('ui.and_5b121')}<strong>start-radaz-pacs.cmd</strong> {tr('ui.and_run_the_file_edc2b')}</div>}
        <div className="pacs-results"><ResizableTable storageKey="pacs-studies" className="records-table" aria-label={tr('ui.pacs_studies_d77a3')}><thead><tr><ResizableHeader column="select" label="Seç" minimum={24} className="study-check-column">{selection.all}</ResizableHeader><ResizableHeader column="open" label="Aç" className="study-open-column">{tr('ui.open_dcc08')}</ResizableHeader><SortHeader column="date" label="Tarix" {...studySort}/><SortHeader column="patient" label="Pasiyent" {...studySort}/><SortHeader column="patientId" label="Pasiyent ID" {...studySort}/><SortHeader column="modality" label="Modallıq" {...studySort}/><SortHeader column="description" label="Təsvir" {...studySort}/><SortHeader column="seriesCount" label="Seriya" {...studySort}/><SortHeader column="instanceCount" label="Görüntü" {...studySort}/><ResizableHeader column="bridgeSend" label="RADAZBRIDGE" minimum={210} className="bridge-send-column">RADAZBRIDGE</ResizableHeader></tr></thead><tbody>{studySort.rows.map(item => <tr key={item.uid} className={study === item.uid ? 'selected' : ''} onClick={() => { void chooseStudy(item); }} onDoubleClick={() => { void chooseStudy(item, true); }} title={tr('ui.double_click_to_open_in_the_viewer_442ac')}><td onClick={event => event.stopPropagation()} onDoubleClick={event => event.stopPropagation()}><input type="checkbox" aria-label={`${item.patient} müayinəsini seç`} checked={selection.checked.includes(item.uid)} onChange={event => selection.toggle(item.uid, event.currentTarget.checked)}/></td><td><button className="record-open-button" disabled={busy} aria-label={`${item.patient} müayinəsini viewer-də aç`} onClick={event => { event.stopPropagation(); void chooseStudy(item, true); }}><ExternalLink size={16}/></button></td><td>{date(item.date)}</td><td>{item.patient}</td><td>{item.patientId || '—'}</td><td>{item.modality}</td><td>{item.description || '—'}</td><td>{item.seriesCount}</td><td>{item.instanceCount}</td><td className="bridge-send-column"><RadazBridgeRowSend study={{uid:item.uid,patient:item.patient,count:item.instanceCount}} pacs={location ? {...location,callingAe:aeTitle,listenerPort,token} : undefined} transfers={bridgeTransfers} disabled={busy || !location}/></td></tr>)}</tbody></ResizableTable>{!visibleStudies.length && <div className={`records-empty${searchError ? ' pacs-search-error' : ''}`} role={searchError ? 'alert' : undefined}>{searchError || (hasSearched ? 'Filtrə uyğun müayinə tapılmadı' : 'PACS ünvanını seçin və müayinə axtarın')}</div>}</div>
        <div className="pacs-series-title"><strong>{activeStudy ? `${activeStudy.patient} · seriyalar` : tr('ui.series_c5d36')}</strong><div className="pacs-series-actions"><button className="records-primary" disabled={busy || !activeStudy || !checked.length} onClick={() => { void retrieve('media'); }}><Disc3 size={16}/> CD / DVD</button><button className="records-primary" disabled={busy || !activeStudy || !checked.length} onClick={() => { void retrieve('viewer'); }}><Download size={16}/> {tr('ui.download_to_archive_and_open_c66ec')}</button></div></div>
        <div className="pacs-series-scroll"><ResizableTable storageKey="pacs-series" className="records-table" aria-label={tr('ui.pacs_series_f313c')}><thead><tr><ResizableHeader column="select" label="Seç" minimum={24}>{tr('ui.select_6caa0')}</ResizableHeader><ResizableHeader column="open" label="Aç">{tr('ui.open_dcc08')}</ResizableHeader><SortHeader column="number" label="#" {...seriesSort}/><SortHeader column="modality" label="Modallıq" {...seriesSort}/><SortHeader column="description" label="Təsvir" {...seriesSort}/><SortHeader column="instanceCount" label="Görüntü" {...seriesSort}/></tr></thead><tbody>{(activeStudy ? seriesSort.rows : []).map(item => <tr key={item.uid} onDoubleClick={() => void retrieve('viewer', item.uid)}><td><input type="checkbox" aria-label={`${item.description} seç`} checked={checked.includes(item.uid)} onChange={event => setChecked(current => event.currentTarget.checked ? [...current, item.uid] : current.filter(uid => uid !== item.uid))}/></td><td><button className="record-open-button" disabled={busy} aria-label={`${item.description || 'Seriya'} viewer-də aç`} onClick={() => void retrieve('viewer', item.uid)}><ExternalLink size={16}/></button></td><td>{item.number}</td><td>{item.modality}</td><td>{item.description}</td><td>{item.instanceCount}</td></tr>)}</tbody></ResizableTable></div>
      </div>
    </div>
    <dialog ref={modalRef} className="pacs-modal" aria-labelledby="pacs-modal-title" onCancel={() => setConfigOpen(false)} onClose={() => setConfigOpen(false)}>
      <div className="pacs-modal-inner">
        <div className="pacs-card-title"><Settings2 size={20}/><div><strong id="pacs-modal-title">{tr('ui.pacs_configuration_51b74')}</strong><span>{tr('ui.server_addresses_and_connection_settings_41bcb')}</span></div><button className="pacs-modal-close" type="button" aria-label={tr('ui.close_configuration_bce22')} onClick={() => setConfigOpen(false)}><X size={19}/></button></div>
        <div className="pacs-ae-row"><label>{tr('ui.my_ae_title_6ef3e')}<input aria-label={tr('ui.my_ae_title_6ef3e')} maxLength={16} value={draftAeTitle} onChange={event => setDraftAeTitle(event.currentTarget.value.toUpperCase())}/></label><label>{tr('ui.listener_port_60e16')}<input aria-label={tr('ui.listener_port_60e16')} type="number" min="1" max="65535" value={draftListenerPort} onChange={event => setDraftListenerPort(event.currentTarget.value)}/></label></div>
        {(!editor.id || dimseReady !== editor.id) && <p className="pacs-note">{tr('ui.for_ip_port_connections_63f08')}<a href="/radaz-pacs-bridge-v4.zip" download>{tr('ui.download_the_local_pacs_bridge_ddfc9')}</a> {tr('ui.and_start_it_c_get_is_tried_first_if_the_pacs_92203')}</p>}
        <div className="pacs-section-head"><strong>{tr('ui.pacs_addresses_888b4')}</strong><div><button type="button" aria-label={tr('ui.new_pacs_address_702ec')} onClick={() => { setEditor(blank()); setConfigStatus(''); }}><Plus size={17}/></button><button type="button" aria-label={tr('ui.delete_selected_pacs_address_3268f')} disabled={!editor.id} onClick={remove}><Trash2 size={17}/></button><button type="button" aria-label={tr('ui.test_pacs_connection_6608c')} disabled={!editor.id || busy} onClick={() => { void test(editor, draftAeTitle); }}><Wifi size={17}/></button></div></div>
        <div className="pacs-nodes-scroll"><ResizableTable storageKey="pacs-nodes" className="records-table" aria-label={tr('ui.pacs_addresses_888b4')}><thead><tr><SortHeader column="host" label="IP / host" {...nodeSort}/><SortHeader column="port" label="Port" {...nodeSort}/><SortHeader column="aeTitle" label="AE title" {...nodeSort}/><SortHeader column="description" label="Təsvir" {...nodeSort}/><SortHeader column="dicomwebUrl" label="DICOMweb URL" {...nodeSort}/></tr></thead><tbody>{nodeSort.rows.map(item => <tr key={item.id} className={editor.id === item.id ? 'selected' : ''} onClick={() => choose(item)}><td>{item.host || '—'}</td><td>{item.port}</td><td>{item.aeTitle || '—'}</td><td>{item.description || '—'}</td><td title={item.dicomwebUrl}>{item.dicomwebUrl || 'Əlavə olunmayıb'}</td></tr>)}</tbody></ResizableTable>{!locations.length && <div className="records-empty">{tr('ui.add_a_pacs_address_6d8e2')}</div>}</div>
        <div className="pacs-form-grid"><label>{tr('ui.ip_host_ab9c4')}<input aria-label={tr('ui.pacs_ip_or_host_b3f5a')} placeholder="pacs.hospital.local" value={editor.host} onChange={event => setEditor({ ...editor, host: event.currentTarget.value })}/></label><label>{tr('ui.port_72e9a')}<input aria-label={tr('ui.pacs_port_3cfcc')} type="number" min="1" max="65535" value={editor.port} onChange={event => setEditor({ ...editor, port: event.currentTarget.value })}/></label><label>AE title <input aria-label="PACS AE title" maxLength={16} placeholder="PACS_AE" value={editor.aeTitle} onChange={event => setEditor({ ...editor, aeTitle: event.currentTarget.value })}/></label><label>{tr('ui.description_41e23')}<input aria-label={tr('ui.pacs_description_93526')} placeholder={tr('ui.central_pacs_9c8b3')} value={editor.description} onChange={event => setEditor({ ...editor, description: event.currentTarget.value })}/></label><label className="pacs-url-field">{tr('ui.dicomweb_https_url_optional_ec89d')}<input aria-label="PACS DICOMweb URL" type="url" placeholder="https://pacs.example/dicom-web" value={editor.dicomwebUrl} onChange={event => setEditor({ ...editor, dicomwebUrl: event.currentTarget.value })}/></label><button type="button" className="records-primary" onClick={save}>{editor.id ? 'Ünvanı yenilə' : 'Ünvanı əlavə et'}</button></div>
        <div className="pacs-modal-footer"><span role="status">{configStatus || 'Server ünvanları və AE ayarları bu brauzerdə saxlanılır'}</span><button type="button" className="records-primary" onClick={saveConfig}>{tr('ui.save_and_close_0da56')}</button></div>
      </div>
    </dialog>
    <footer className="records-status" role="status">{busy && <span className="records-spinner"/>}<span className="records-count">{selection.checked.length > 0 && `${selection.checked.length} seçilib · `}{visibleStudies.length} {tr('ui.studies_00cf3')}{series.length} {tr('ui.series_1ebd2')}</span><span>{status}</span></footer>
  </main></ToolbarWorkspace>;
}
