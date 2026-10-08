'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { Activity, ArrowLeft, Check, Clipboard, Download, FileText, ImagePlus, LoaderCircle, Printer, Save, Settings2, Sparkles, Square, Trash2, X } from 'lucide-react';
import { getArchiveFiles, listArchiveStudies, type ArchiveStudy } from '@/lib/local-archive';
import { readReportMedia, readReportStudies, renderReportImage, type ReportImage, type ReportStudy } from '@/lib/report-dicom';
import { exportReportWord, listSavedReports, loadSavedReport, reportPlainText, saveReport, type SavedReport } from '@/lib/report-store';
import { ReportAssistant } from '@/components/report-assistant';
import { AppHelpMenu } from '@/components/app-product';
import { RadazLogo } from '@/components/radaz-logo';
import { watchMediaRemoval } from '@/lib/removable-media';
import { ReportRichEditor } from '@/components/report-rich-editor';
import { escapeReportHtml, plainReportHtml, reportHtmlText, safeReportLogo, sanitizeReportHtml } from '@/lib/report-rich';

type WindowMode = 'metadata' | 'lung' | 'soft' | 'bone';
const emptyReport = (study?: ReportStudy, header = '', logo = ''): SavedReport => ({ studyUID: study?.uid || `manual-${crypto.randomUUID()}`,
  patient: study?.patient || '', birth: study?.birth || '', date: study?.date || '',
  modality: study?.modality || '', studyDescription: study?.description || '', header, logoData: logo, body: '', bodyHtml: '', notes: {}, updatedAt: Date.now() });


export default function ReportPage() {
  const [studies, setStudies] = useState<ReportStudy[]>([]);
  const [study, setStudy] = useState<ReportStudy | null>(null);
  const [report, setReport] = useState<SavedReport | null>(null);
  const [saved, setSaved] = useState<SavedReport[]>([]);
  const [archive, setArchive] = useState<ArchiveStudy[]>([]);
  const [viewerOnly, setViewerOnly] = useState(false);
  const loadEpoch = useRef(0);
  const mediaCleanup = useRef<(() => void) | null>(null);
  const [series, setSeries] = useState<string[]>([]);
  const [windowMode, setWindowMode] = useState<WindowMode>('metadata');
  const [status, setStatus] = useState('Müayinə gözlənilir');
  const [parseProgress, setParseProgress] = useState('');
  const logoInput = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    try { setSaved(await listSavedReports()); if (!new URLSearchParams(window.location.search).has('handoff')) setArchive(await listArchiveStudies()); }
    catch { setStatus('Yerli yaddaş açıla bilmədi; saxlanılan hesabatlar göstərilmir'); }
  }, []);

  const openStudy = useCallback(async (next: ReportStudy, preferredSeriesId?: string) => {
    const epoch = loadEpoch.current;
    setStudy(next);
    const ids = [...new Set(next.images.map(image => image.seriesUID))];
    setSeries(ids);
    const existing = await loadSavedReport(next.uid).catch(() => undefined);
    if (epoch !== loadEpoch.current) return;
    const header = localStorage.getItem('radaz-report-clinic-header') || '';
    const logo = safeReportLogo(localStorage.getItem('radaz-report-clinic-logo') || '');
    setReport(existing ? { ...existing, bodyHtml: sanitizeReportHtml(existing.bodyHtml?.trim() || plainReportHtml(existing.body)),
      logoData: safeReportLogo(existing.logoData) || logo } : emptyReport(next, header, logo));
    setStatus(`${next.images.length} kəsit · ${ids.length} seriya açıldı`);
  }, []);

  const loadFiles = useCallback(async (files: File[], preferredSeriesId?: string) => {
    const epoch = ++loadEpoch.current;
    setParseProgress(`0 / ${files.length}`);
    const next = await readReportStudies(files, (done, total) => setParseProgress(`${done} / ${total}`));
    if (epoch !== loadEpoch.current) return;
    setParseProgress('');
    if (!next.length) { setStatus('DICOM müayinəsi tapılmadı'); return; }
    setStudies(next);
    const found = next.find(item => preferredSeriesId?.startsWith(`${item.uid}/`)) || next[0];
    await openStudy(found, preferredSeriesId);
  }, [openStudy]);

  useEffect(() => {
    document.title = 'RADAZ · AI asistent';
    void Promise.resolve().then(refresh);
    const params = new URLSearchParams(window.location.search);
    const token = params.get('handoff');
    const archivedStudy = params.get('archive-study');
    if (archivedStudy) {
      void getArchiveFiles(archivedStudy).then(files => files.length ? loadFiles(files) : setStatus('Müayinə arxivdə tapılmadı'))
        .catch(() => setStatus('Arxiv müayinəsi açıla bilmədi'));
    }
    if (!token) return;
    setViewerOnly(true);
    setArchive([]);
    const channel = new BroadcastChannel(`radaz-${token}`);
    channel.onmessage = event => {
      if (event.data?.kind === 'LOAD_ERROR') { setStatus(String(event.data.message)); setParseProgress(''); return; }
      if ((event.data?.kind === 'LOAD' && Array.isArray(event.data.files)) || (event.data?.kind === 'MEDIA_REPORT' && Array.isArray(event.data.sources))) {
        mediaCleanup.current?.(); mediaCleanup.current = null;
        if (Array.isArray(event.data.mediaSessions) && event.data.mediaSessions.length) {
          mediaCleanup.current = watchMediaRemoval(event.data.mediaSessions, () => {
            loadEpoch.current++; setStudies([]); setStudy(null); setReport(null); setSeries([]); setParseProgress('');
            setStatus('CD/DVD çıxarıldı. Müvəqqəti görüntülər təmizləndi.');
          });
        }
        if (event.data.kind === 'MEDIA_REPORT') {
          loadEpoch.current++; const next=readReportMedia(event.data.sources);setStudies(next);
          if(next[0])void openStudy(next[0],event.data.preferredSeriesId);return;
        }
        void loadFiles(event.data.files as File[], event.data.preferredSeriesId).catch(() => setStatus('Viewer görüntüləri ötürə bilmədi'));
      }
    };
    channel.postMessage({ kind: 'READY' });
    return () => { loadEpoch.current++; mediaCleanup.current?.(); channel.close(); };
  }, [loadFiles, refresh, openStudy]);

  const update = (patch: Partial<SavedReport>) => setReport(current => current ? { ...current, ...patch } : current);
  const allImages = useMemo(() => study?.images.filter(image => series.includes(image.seriesUID)) || [], [study, series]);
  const eligible = useMemo(() => allImages.filter(image => image.supported), [allImages]);
  const excluded = allImages.length - eligible.length;

  const save = async () => {
    if (!report) return;
    try {
      const bodyHtml = sanitizeReportHtml(report.bodyHtml || plainReportHtml(report.body));
      const next = { ...report, bodyHtml, body: reportHtmlText(bodyHtml), logoData: safeReportLogo(report.logoData), updatedAt: Date.now() };
      await saveReport(next); setReport(next); await refresh(); setStatus('Hesabat bu brauzerdə saxlanıldı');
    }
    catch { setStatus('Hesabat saxlanmadı. Brauzer yaddaşını yoxlayın.'); }
  };

  const copy = async () => {
    if (!report) return;
    try {
      const plain = reportPlainText(report);
      const rich = `${safeReportLogo(report.logoData) ? `<p><img src="${safeReportLogo(report.logoData)}" alt="Klinika loqosu" style="max-width:180px"></p>` : ''}<h2>${escapeReportHtml(report.header).replaceAll('\n', '<br>')}</h2><p>Pasiyent: ${escapeReportHtml(report.patient)}<br>Təvəllüd: ${escapeReportHtml(report.birth)}<br>Müayinə tarixi: ${escapeReportHtml(report.date)}<br>Müayinə: ${escapeReportHtml(report.modality)}</p>${sanitizeReportHtml(report.bodyHtml || plainReportHtml(report.body))}`;
      if (typeof ClipboardItem !== 'undefined') await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([rich], { type: 'text/html' }), 'text/plain': new Blob([plain], { type: 'text/plain' }) })]);
      else await navigator.clipboard.writeText(plain);
      setStatus('Formatlanmış hesabat kopyalandı');
    }
    catch { setStatus('Kopyalama alınmadı; brauzer icazəsini yoxlayın'); }
  };

  const uploadLogo = async (file?: File) => {
    if (!file) return;
    try {
      if (!['image/jpeg', 'image/png'].includes(file.type) || file.size > 6_000_000) throw new Error('JPEG/PNG seçin (maksimum 6 MB)');
      const bytes = new Uint8Array(await file.slice(0, 8).arrayBuffer());
      const png = [137,80,78,71,13,10,26,10].every((byte, i) => bytes[i] === byte);
      const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
      if (!(file.type === 'image/png' && png || file.type === 'image/jpeg' && jpeg)) throw new Error('Fayl düzgün JPEG/PNG deyil');
      const image = await createImageBitmap(file);
      try {
        const scale = Math.min(1, 650 / image.width, 180 / image.height);
        if (!Number.isFinite(scale) || scale <= 0) throw new Error('Şəkil açıla bilmədi');
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(image.width * scale));
        canvas.height = Math.max(1, Math.round(image.height * scale));
        canvas.getContext('2d')?.drawImage(image, 0, 0, canvas.width, canvas.height);
        const logoData = canvas.toDataURL('image/png');
        if (!safeReportLogo(logoData)) throw new Error('Loqo ölçüsü böyükdür');
        update({ logoData });
        try { localStorage.setItem('radaz-report-clinic-logo', logoData); setStatus('Loqo şablona əlavə olundu'); }
        catch { setStatus('Loqo bu hesabatda görünür, lakin ümumi şablon üçün yaddaş kifayət etmir'); }
      } finally { image.close(); }
    } catch (error) { setStatus(error instanceof Error ? error.message : 'Loqo əlavə olunmadı'); }
    if (logoInput.current) logoInput.current.value = '';
  };

  const removeLogo = () => {
    update({ logoData: '' }); localStorage.removeItem('radaz-report-clinic-logo');
    setStatus('Loqo şablondan çıxarıldı');
  };

  const selectSaved = (item: SavedReport) => {
    const source = studies.find(entry => entry.uid === item.studyUID) || null;
    setStudy(source);
    setSeries(source ? [...new Set(source.images.map(image => image.seriesUID))] : []);
    setReport({ ...item, bodyHtml: sanitizeReportHtml(item.bodyHtml?.trim() || plainReportHtml(item.body)), logoData: safeReportLogo(item.logoData) }); setStatus('Saxlanmış hesabat açıldı');
  };
  const openArchive = async (uid: string) => {
    try { setStatus('Arxiv görüntüləri açılır…'); await loadFiles(await getArchiveFiles(uid)); }
    catch { setStatus('Arxiv görüntüləri açıla bilmədi'); }
  };

  return <main className="report-shell">
    <header className="report-topbar"><Link href="/" className="report-brand"><RadazLogo size={34}/><span><strong>RADAZ</strong><small>AI ASİSTENT</small></span></Link><div className="report-top-actions"><div className="record-action-group"><span className="command-group-title">İş sahəsi</span><div className="toolbar-group"><Link href="/" title="Viewer" aria-label="Viewer"><ArrowLeft size={15}/> Viewer</Link><AppHelpMenu/></div></div><div className="record-action-group"><span className="command-group-title">Hesabat</span><div className="toolbar-group"><button title="Yadda saxla" onClick={() => void save()} disabled={!report}><Save size={15}/> Yadda saxla</button><button title="Kopyala" onClick={() => void copy()} disabled={!report}><Clipboard size={15}/> Kopyala</button></div></div><div className="record-action-group"><span className="command-group-title">İxrac və çap</span><div className="toolbar-group"><button title="PDF" onClick={() => { window.print(); setStatus('Çap dialoqunda “PDF kimi saxla” seçərək PDF çıxarın'); }} disabled={!report}><Download size={15}/> PDF</button><button title="MS Word" onClick={() => { if (!report) return; setStatus('Word faylı hazırlanır…'); void exportReportWord(report).then(() => setStatus('Word faylı hazırdır')).catch(() => setStatus('Word faylı yaradılmadı')); }} disabled={!report}><FileText size={15}/> MS Word</button><button title="Çap et" onClick={() => window.print()} disabled={!report}><Printer size={15}/> Çap et</button></div></div></div></header>
    <div className="report-layout">
      <aside className="report-sidebar"><div className="report-side-head"><strong>Müayinələr</strong><span>{parseProgress ? `Oxunur ${parseProgress}` : `${studies.length + archive.length} mənbə`}</span></div>
        {studies.map(item => <button key={item.uid} className={`report-study ${study?.uid === item.uid ? 'active' : ''}`} onClick={() => void openStudy(item)}><strong>{item.patient}</strong><span>{item.modality} · {item.date || 'Tarixsiz'} · {item.images.length} kəsit</span></button>)}
        {!!archive.length && <div className="report-list-label">Yerli arxiv</div>}
        {archive.filter(item => !studies.some(entry => entry.uid === item.uid)).map(item => <button key={item.uid} className="report-study" onClick={() => void openArchive(item.uid)}><strong>{item.patient}</strong><span>{item.modality} · {item.imageCount} kəsit</span></button>)}
        {!viewerOnly && !!saved.length && <div className="report-list-label">Saxlanmış hesabatlar</div>}
        {!viewerOnly && saved.map(item => <button key={item.studyUID} className="report-study" onClick={() => selectSaved(item)}><strong>{item.patient || 'Adsız pasiyent'}</strong><span>{item.date || 'Tarixsiz'} · {new Date(item.updatedAt).toLocaleDateString('az-AZ')}</span></button>)}
        {!study && !report && <div className="report-side-empty">Viewer-də müayinəni açıb yuxarıdakı AI asistent düyməsini seçin.<button className="assistant-new-report" onClick={() => { setReport(emptyReport(undefined, localStorage.getItem('radaz-report-clinic-header') || '', safeReportLogo(localStorage.getItem('radaz-report-clinic-logo') || ''))); setStatus('Yeni hesabat açıldı'); }}>Yeni hesabat</button></div>}
      </aside>
      <section className="report-images"><div className="report-panel-title"><strong>Görüntü analizi</strong><span>{study ? `${eligible.length} uyğun kəsit${excluded ? ` · ${excluded} dəstəklənmir` : ''}` : 'Müayinə seçin'}</span></div>
        {study && <><div className="report-image-options"><label>Pəncərə <select value={windowMode} onChange={e => { setWindowMode(e.target.value as WindowMode); }}><option value="metadata">DICOM metadatası</option><option value="lung">Ağciyər</option><option value="soft">Yumşaq toxuma</option><option value="bone">Sümük</option></select></label><span>Seçilən seriyaların bütün görüntüləri aşağıdakı önbaxışda açılır.</span></div>
          <div className="report-series-list">{[...new Map(study.images.map(image => [image.seriesUID, image.seriesName])).entries()].map(([uid, name]) => <label key={uid}><input type="checkbox" checked={series.includes(uid)} onChange={e => { setSeries(current => e.target.checked ? [...current, uid] : current.filter(item => item !== uid)); }}/><span>{name}</span><em>{study.images.filter(image => image.seriesUID === uid).length}</em></label>)}</div>
        </>}
        <ReportAssistant key={report?.studyUID || 'empty'} images={allImages} windowMode={windowMode} instruction={report?.aiInstruction || ''} onInstruction={aiInstruction => update({aiInstruction})}/>
      </section>
      <section className="report-editor"><div className="report-panel-title"><strong>Hesabat redaktoru</strong><span>{report ? 'Dəyişiklikləri yadda saxlayın' : 'Müayinə seçin'}</span></div>
        {report ? <><div className="report-fields"><label className="report-field-full">Klinika şablonunun başlığı<textarea value={report.header} placeholder="Klinikanın adı, ünvanı və əlaqə məlumatları" onChange={e => { update({ header: e.target.value }); localStorage.setItem('radaz-report-clinic-header', e.target.value); }}/></label><div className="report-logo-field"><input ref={logoInput} className="report-logo-input" type="file" accept="image/png,image/jpeg" aria-label="Klinika loqosunu seç" onChange={event => void uploadLogo(event.currentTarget.files?.[0])}/><button type="button" onClick={() => logoInput.current?.click()}><ImagePlus size={15}/> JPEG/PNG loqo əlavə et</button>{safeReportLogo(report.logoData) && <><img src={safeReportLogo(report.logoData)} alt="Klinika loqosu"/><button type="button" onClick={removeLogo}><Trash2 size={15}/> Sil</button></>}</div><label>Pasiyentin adı, soyadı<input value={report.patient} onChange={e => update({ patient: e.target.value })}/></label><label>Təvəllüd<input type="date" value={report.birth} onChange={e => update({ birth: e.target.value })}/></label><label>Müayinə tarixi<input type="date" value={report.date} onChange={e => update({ date: e.target.value })}/></label><label>Müayinə növü<input value={report.modality} onChange={e => update({ modality: e.target.value })}/></label></div><div className="report-body-label"><span>Hesabat mətni</span><ReportRichEditor key={report.studyUID} html={report.bodyHtml || (report.body ? plainReportHtml(report.body) : '')} onChange={(bodyHtml, body) => update({ bodyHtml, body })}/></div></> : <div className="report-editor-empty"><FileText size={35}/><p>Görüntüləri viewer-də açın, sonra AI asistent düyməsinə basın.</p></div>}
        <div className="report-bottom-status" role="status">{status.includes('saxlanıldı') && <Check size={15}/>} {status}</div>
      </section>
    </div>
    {report && <div className="report-print"><div className="report-print-header">{safeReportLogo(report.logoData) && <img src={safeReportLogo(report.logoData)} alt="Klinika loqosu" className="report-print-logo"/>}{report.header}</div><h1>RADİOLOJİ HESABAT</h1><table><tbody><tr><th>Pasiyent</th><td>{report.patient || '—'}</td><th>Təvəllüd</th><td>{report.birth || '—'}</td></tr><tr><th>Müayinə tarixi</th><td>{report.date || '—'}</td><th>Müayinə</th><td>{report.modality || '—'}</td></tr></tbody></table><div className="report-print-body" dangerouslySetInnerHTML={{ __html: sanitizeReportHtml(report.bodyHtml || plainReportHtml(report.body)) }}/></div>}
  </main>;
}
