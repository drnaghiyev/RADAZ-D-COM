'use client';
import {ToolbarWorkspace, ToolbarGroup, ToolbarOverflow} from '@/components/toolbar-workspace';
import {useTranslation as useUiTranslation,translate as tr} from '@/lib/i18n';

import { recordsWindowTitle, registerRecordsWindow, openStudiesInViewer } from '@/lib/viewer-session';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Activity, FolderOpen, FileArchive, Search, Trash2, ExternalLink, HardDriveDownload, RefreshCw, Settings2, Disc3, X } from 'lucide-react';
import { deleteLocalStudies, getArchiveFiles, listArchiveStudies, recordStudyOpened, saveArchiveFiles, type ArchiveStudy } from '@/lib/local-archive';
import { expandSources, filesFromDrop } from '@/lib/import-sources';
import { ResizableTable, ResizableHeader } from '@/components/resizable-table';
import { SortHeader, useTableSort } from '@/components/table-sort';
import { RadazBridgeSend } from '@/components/radaz-bridge-send';
import { ArchiveReceiverPanel } from '@/components/archive-receiver-panel';
import { saveDiskFiles } from '@/lib/disk-archive';
import { AppHelpMenu } from '@/components/app-product';
import { useStudySelection } from '@/components/study-selection';
import { StudyFilterControls, localDate } from '@/components/study-filter-controls';

const date = (raw: string) => raw?.length === 8 ? `${raw.slice(6,8)}.${raw.slice(4,6)}.${raw.slice(0,4)}` : '—';
const clock = (value: number | null) => value ? new Date(value).toLocaleString('az-AZ') : '—';
const size = (bytes: number) => bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;
const modalityOptions = ['CR','DX','CT','MR','XA','MG','US','PT','NM','RF','RG','PX','ES','XC','GM','SC','OT','SR'];

export default function ArchivePage() {
  useUiTranslation();
  const [studies, setStudies] = useState<ArchiveStudy[]>([]);
  const [selected, setSelected] = useState('');
  const [search, setSearch] = useState('');
  const [dateFrom, setDateFrom] = useState(localDate);
  const [dateTo, setDateTo] = useState(localDate);
  const [modalities, setModalities] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('Arxiv hazırlanır…');
  const folderRef = useRef<HTMLInputElement>(null);
  const zipRef = useRef<HTMLInputElement>(null);
  const filesRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    const entries = await listArchiveStudies();
    setStudies(entries);
    setSelected(current => entries.some(item => item.uid === current) ? current : entries[0]?.uid || '');
    return entries;
  }, []);
  useEffect(() => {
    recordsWindowTitle('Local arxiv');
    const stopWindow = registerRecordsWindow('archive');
    folderRef.current?.setAttribute('webkitdirectory', '');
    folderRef.current?.setAttribute('directory', '');
    void refresh().then(entries => setMessage(`${entries.length} müayinə arxivdədir`)).catch(error => setMessage(`Arxiv açıla bilmədi: ${String(error)}`));
    const timer = setInterval(() => { void refresh().catch(() => undefined); }, 5000);
    return () => { clearInterval(timer); stopWindow(); };
  }, [refresh]);

  const addFiles = async (sources: File[]) => {
    if (!sources.length || busy) return;
    setBusy(true);
    try {
      const files = await expandSources(sources, setMessage);
      setMessage(`${files.length} fayl arxivlənir…`);
      const added = await saveArchiveFiles(files, (done, total) => setMessage(`Arxivlənir: ${done} / ${total}`));
      const entries = await refresh();
      setMessage(added ? `${added} müayinə saxlanıldı · ${entries.length} müayinə arxivdədir` : 'Uyğun DICOM faylı tapılmadı');
    } catch (error) { setMessage(`İdxal alınmadı: ${error instanceof Error ? error.message : String(error)}`); }
    finally { setBusy(false); }
  };

  const filtered = useMemo(() => studies.filter(study => {
    const key = `${study.patient} ${study.patientId} ${study.date} ${date(study.date)} ${study.modality} ${study.description} ${study.accession}`.toLocaleLowerCase('az');
    const rawFrom = dateFrom.replaceAll('-', ''), rawTo = dateTo.replaceAll('-', '');
    const studyModalities = study.modality.toUpperCase().split(/[\\,\s]+/).filter(Boolean);
    return key.includes(search.toLocaleLowerCase('az').trim()) && (!rawFrom || study.date >= rawFrom) && (!rawTo || study.date <= rawTo)
      && (!modalities.length || modalities.some(item => studyModalities.includes(item)));
  }), [studies, search, dateFrom, dateTo, modalities]);
  const selection = useStudySelection(filtered.map(item => item.uid));
  const current = filtered.find(item => item.uid === selected) || filtered[0];
  const studySort=useTableSort(filtered,{date:r=>r.date+r.time,patient:r=>r.patient,birth:r=>r.birth,patientId:r=>r.patientId,modality:r=>r.modality,description:r=>r.description,accession:r=>r.accession,series:r=>r.series.length,imageCount:r=>r.imageCount,referring:r=>r.referring},{key:'date',direction:'desc'});
  const seriesSort=useTableSort((current?.series||[]).map((r,i)=>({...r,ordinal:i+1})),{ordinal:r=>r.ordinal,addedAt:r=>r.addedAt,number:r=>r.number,modality:r=>r.modality,description:r=>r.description,protocol:r=>r.protocol,imageCount:r=>r.imageCount,openedAt:()=>current?.openedAt},{key:'number',direction:'asc'});
  const openStudy = async (uid: string) => {
    try {
      const targets=selection.checked.length?selection.checked:[uid];
      await openStudiesInViewer(targets);
      await Promise.all(targets.map(recordStudyOpened));
      await refresh();
      setMessage(`${targets.length} seçilmiş müayinə Viewer-də açıldı`);
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
  };
  const remove = async () => {
    const targets = selection.checked.length ? filtered.filter(item => selection.checked.includes(item.uid)) : current ? [current] : [];
    if (busy || !targets.length || !window.confirm(`${targets.length} müayinənin ${targets.reduce((sum, item) => sum + item.imageCount, 0)} görüntüsü bu kompüterin disk və brauzer arxivindən birdəfəlik silinsin?`)) return;
    setBusy(true);
    try { setMessage(await deleteLocalStudies(targets)); selection.clear(); }
    catch (error) { setMessage(`Silmək alınmadı: ${error instanceof Error ? error.message : String(error)}`); }
    finally { await refresh().catch(() => undefined); setBusy(false); }
  };

  return <ToolbarWorkspace scope="archive"><main className="archive-shell grouped-records" onDragOver={event => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; }} onDrop={event => { event.preventDefault(); void filesFromDrop(event.dataTransfer.items, event.dataTransfer.files).then(addFiles).catch(error => setMessage(String(error))); }}>
    <header className="records-header records-unified-header archive-unified-header">
      <div className="records-summary records-filterbar records-header-filters"><StudyFilterControls from={dateFrom} to={dateTo} modalities={modalities} options={modalityOptions} onFromChange={setDateFrom} onToChange={setDateTo} onModalitiesChange={setModalities}/><label className="records-search"><Search size={16}/><input aria-label={tr('ui.search_all_studies_d068d')} placeholder={tr('ui.patient_id_description_4c33a')} value={search} onChange={event => setSearch(event.currentTarget.value)}/>{search && <button type="button" className="search-clear" aria-label={tr('ui.clear_archive_search_de9e0')} title={tr('ui.clear_1e4f8')} onClick={() => setSearch('')}><X size={16}/></button>}</label></div>
      <div className="records-header-actions labeled-header-actions">
        <ToolbarGroup groupId="archive-open" order={10} aria-label="Aç"><RadazBridgeSend disabled={busy} onBusyChange={setBusy} studies={(selection.checked.length ? filtered.filter(item => selection.checked.includes(item.uid)) : current ? [current] : []).map(item => ({uid:item.uid,patient:item.patient,count:item.imageCount,storage:item.storage}))}/><button className="records-primary" title={`Seçilmişləri aç (${selection.checked.length})`} aria-label={`Seçilmişləri aç (${selection.checked.length})`} disabled={!selection.checked.length||busy} onClick={()=>void openStudy(selection.checked[0])}><ExternalLink size={18}/><span>{tr('ui.open_selected_d1078')}{selection.checked.length})</span></button></ToolbarGroup>
        <ToolbarGroup className="toolbar-group" role="group" aria-label={tr('ui.dicom_import_e8ec8')} groupId="archive-import" order={20}>        <button title={tr('ui.add_dicom_folder_14c24')} aria-label={tr('ui.add_dicom_folder_14c24')} disabled={busy} onClick={() => folderRef.current?.click()}><FolderOpen size={18}/><span>{tr('ui.folder_d7ec4')}</span></button>        <button title={tr('ui.add_zip_rar_archive_ac3df')} aria-label={tr('ui.add_zip_rar_archive_ac3df')} disabled={busy} onClick={() => zipRef.current?.click()}><FileArchive size={18}/><span>ZIP / RAR</span></button>        <button title={tr('ui.add_dicom_files_49d47')} aria-label={tr('ui.add_dicom_files_49d47')} disabled={busy} onClick={() => filesRef.current?.click()}><HardDriveDownload size={18}/><span>DICOM</span></button></ToolbarGroup>
        <ToolbarGroup className="toolbar-group" role="group" aria-label={tr('ui.study_5f4fb')} groupId="archive-study" order={30}>        <button title={tr('ui.refresh_list_98a42')} aria-label={tr('ui.refresh_list_98a42')} onClick={() => { void refresh(); }}><RefreshCw size={18}/><span>{tr('ui.refresh_da261')}</span></button>        <button title={tr('ui.prepare_selected_study_for_cd_00c17')} aria-label={tr('ui.prepare_for_cd_e3471')} disabled={!current || busy} onClick={() => current && window.open(`/media?study=${encodeURIComponent(current.uid)}`, '_blank')}><Disc3 size={18}/><span>CD / DVD</span></button>                <button title={tr('ui.delete_selected_study_147d7')} aria-label={tr('ui.delete_selected_study_147d7')} disabled={(!current && !selection.checked.length) || busy} onClick={() => { void remove(); }}><Trash2 size={18}/><span>{tr('ui.delete_f698e')}{selection.checked.length ? ` (${selection.checked.length})` : ''}</span></button></ToolbarGroup>
        <ToolbarGroup groupId="archive-settings" order={40} aria-label="Ayarlar"><ArchiveReceiverPanel/><AppHelpMenu/></ToolbarGroup>
      </div>
      <input hidden ref={folderRef} type="file" multiple onChange={event => { const files=Array.from(event.currentTarget.files||[]); event.currentTarget.value=''; void addFiles(files); }}/>
      <input hidden ref={zipRef} type="file" multiple accept=".zip,.rar,application/vnd.rar,application/x-rar-compressed,application/zip" onChange={event => { const files=Array.from(event.currentTarget.files||[]); event.currentTarget.value=''; void addFiles(files); }}/>
      <input hidden ref={filesRef} type="file" multiple onChange={event => { const files=Array.from(event.currentTarget.files||[]); event.currentTarget.value=''; void addFiles(files); }}/>
      <ToolbarOverflow/>
    </header>
    <div className="records-upper">
      <ResizableTable storageKey="archive-studies" className="records-table" aria-label={tr('ui.archived_studies_905a2')}><thead><tr><ResizableHeader column="select" label="Seç" minimum={24} className="study-check-column">{selection.all}</ResizableHeader><ResizableHeader column="open" label="Aç" className="study-open-column">{tr('ui.open_dcc08')}</ResizableHeader><SortHeader column="date" label="Müayinə tarixi" {...studySort}/><SortHeader column="patient" label="Pasiyent" {...studySort}/><SortHeader column="birth" label="Doğum tarixi" {...studySort}/><SortHeader column="patientId" label="Pasiyent ID" {...studySort}/><SortHeader column="modality" label="Müayinə" {...studySort}/><SortHeader column="description" label="Təsvir" {...studySort}/><SortHeader column="accession" label="Accession" {...studySort}/><SortHeader column="series" label="Seriya" {...studySort}/><SortHeader column="imageCount" label="Görüntü" {...studySort}/><SortHeader column="referring" label="Göndərən həkim" {...studySort}/></tr></thead><tbody>
        {studySort.rows.map(study => <tr key={study.uid} className={current?.uid === study.uid ? 'selected' : ''} onClick={() => setSelected(study.uid)} onDoubleClick={() => void openStudy(study.uid)} title={tr('ui.double_click_to_open_in_the_viewer_442ac')}><td onClick={event => event.stopPropagation()} onDoubleClick={event => event.stopPropagation()}><input type="checkbox" aria-label={`${study.patient} müayinəsini seç`} checked={selection.checked.includes(study.uid)} onChange={event => selection.toggle(study.uid, event.currentTarget.checked)}/></td><td><button className="record-open-button" aria-label={tr('ui.open_study_in_viewer_3dddd')} onClick={event => { event.stopPropagation(); setSelected(study.uid); void openStudy(study.uid); }}><ExternalLink size={16}/></button></td><td>{date(study.date)} {study.time && `${study.time.slice(0,2)}:${study.time.slice(2,4)}`}</td><td>{study.patient}<small className="archive-storage-label">{study.storage === 'disk' ? 'Disk / SQLite' : 'Brauzer'}</small></td><td>{date(study.birth)}</td><td title={study.patientId}>{study.patientId || '—'}</td><td>{study.modality}</td><td title={study.description}>{study.description || '—'}</td><td>{study.accession || '—'}</td><td>{study.series.length}</td><td>{study.imageCount}</td><td>{study.referring || '—'}</td></tr>)}
      </tbody></ResizableTable>
      {!filtered.length && <div className="records-empty">{studies.length ? 'Seçilmiş tarix və müayinə filtrlərinə uyğun nəticə tapılmadı' : 'Arxiv boşdur. Qovluq, ZIP, RAR və ya DICOM faylları əlavə edin.'}</div>}
    </div>
    <div className="records-lower"><div className="records-section-title"><strong>{tr('ui.series_c5d36')}</strong><span>{current?.patient || 'Müayinə seçin'}</span><div className="records-section-actions"><button disabled={!current || busy || current.storage === 'disk'} onClick={() => {
        if (!current) return; setBusy(true);
        void getArchiveFiles(current.uid).then(files => saveDiskFiles(files)).then(refresh).then(() => setMessage('Müayinə daimi disk arxivinə köçürüldü')).catch(error => setMessage(String(error))).finally(() => setBusy(false));
      }}><HardDriveDownload size={15}/> {tr('ui.save_to_disk_96e45')}</button><button disabled={!current} onClick={() => current && void openStudy(current.uid)}><ExternalLink size={15}/> {tr('ui.viewer_678bf')}</button></div></div>
      <div className="records-series-scroll"><ResizableTable storageKey="archive-series" className="records-table" aria-label={tr('ui.series_in_selected_study_610f0')}><thead><tr><ResizableHeader column="open" label="Aç">{tr('ui.open_dcc08')}</ResizableHeader><SortHeader column="ordinal" label="#" {...seriesSort}/><SortHeader column="addedAt" label="Əlavə olunub" {...seriesSort}/><SortHeader column="number" label="Seriya nömrəsi" {...seriesSort}/><SortHeader column="modality" label="Modallıq" {...seriesSort}/><SortHeader column="description" label="Təsvir" {...seriesSort}/><SortHeader column="protocol" label="Protokol" {...seriesSort}/><SortHeader column="imageCount" label="Görüntü sayı" {...seriesSort}/><SortHeader column="openedAt" label="Son açılma" {...seriesSort}/></tr></thead><tbody>{current && seriesSort.rows.map(series => <tr key={series.uid} onDoubleClick={() => void openStudy(current.uid)}><td><button className="record-open-button" aria-label={`${series.description || 'Seriya'} viewer-də aç`} onClick={() => void openStudy(current.uid)}><ExternalLink size={16}/></button></td><td>{series.ordinal}</td><td>{clock(series.addedAt)}</td><td>{series.number}</td><td>{series.modality}</td><td>{series.description}</td><td>{series.protocol || '—'}</td><td>{series.imageCount}</td><td>{clock(current.openedAt)}</td></tr>)}</tbody></ResizableTable></div>
    </div>
    <footer className="records-status" role="status">{busy && <span className="records-spinner"/>}<span className="records-count">{selection.checked.length > 0 && `${selection.checked.length} seçilib · `}{filtered.length}/{studies.length} {tr('ui.studies_fc1a8')}</span><span>{message}</span></footer>
  </main></ToolbarWorkspace>;
}
