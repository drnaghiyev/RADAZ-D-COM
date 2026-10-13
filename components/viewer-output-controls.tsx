'use client';
import {ToolbarGroup} from '@/components/toolbar-workspace';
import {useTranslation as useUiTranslation,translate as tr} from '@/lib/i18n';


import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CheckSquare, Printer, Download, Settings2, X, ChevronDown, Trash2, Images, FolderOpen, FileImage, SlidersHorizontal, Check, ImageIcon, Film } from 'lucide-react';
import JSZip from 'jszip';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from './ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from './ui/dropdown-menu';
import { captureViewport, capturePrintFrame } from '@/lib/export-viewport';
import { canvasBlob, readDisplayState, renderFullImage, resizeCanvas, fitCanvas } from '@/lib/image-output';
import { getOriginalDicom } from '@/lib/cornerstone';
import { outputRequest, saveOutputJob, type PrintFrame } from '@/lib/output-jobs';

type OutputSeries = { id: string; name: string; patient: string; imageIds: string[] };
type Format = 'jpeg'|'png'|'bmp'|'dicom'|'mp4'|'wmv';
type Selection = PrintFrame & { preview: string };
type ExportDirectory = { name: string; getFileHandle: (name: string, options?: { create: boolean }) => Promise<{ createWritable: () => Promise<{ write: (data: Blob) => Promise<void>; close: () => Promise<void>; abort: () => Promise<void> }> }> };
type DirectoryWindow = Window & { showDirectoryPicker?: (options: { mode: 'readwrite'; id: string }) => Promise<ExportDirectory> };
const formatChoices: { value: Format; label: string; detail: string }[] = [
  { value: 'jpeg', label: 'JPEG', detail: 'Kiçik həcm' }, { value: 'png', label: 'PNG', detail: 'İtkisiz şəkil' },
  { value: 'bmp', label: 'BMP', detail: 'Bitmap' }, { value: 'dicom', label: 'DICOM', detail: 'Orijinal fayl' },
  { value: 'mp4', label: 'MP4', detail: 'Video · H.264' }, { value: 'wmv', label: 'WMV', detail: 'Windows video' },
];
export function ViewerOutputControls({ panel, imageId, series, allSeries, datasetVersion, onStatus, panes = [] }: {
  panes?: { panel: string; imageId?: string; series?: OutputSeries }[]; panel: string; imageId?: string; series?: OutputSeries; allSeries: OutputSeries[]; datasetVersion: number; onStatus: (text: string) => void;
}) {
  useUiTranslation();
  const [targets, setTargets] = useState<HTMLElement[]>([]);
  useEffect(() => {
    const refresh = () => {
      const next = Array.from(document.querySelectorAll<HTMLElement>('.viewport[data-panel]'));
      setTargets(previous => previous.length === next.length && previous.every((value, i) => value === next[i]) ? previous : next);
    };
    refresh();
    const observer = new MutationObserver(refresh);
    observer.observe(document.querySelector('.viewer-body') || document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);
  const selecting = useRef(false);
  const generation = useRef(0);
  const [open, setOpen] = useState(false), [tray, setTray] = useState(false), [busy, setBusy] = useState(false);
  const [scope, setScope] = useState('image'), [format, setFormat] = useState<Format>('jpeg');
  const [annotations, setAnnotations] = useState<'full'|'basic'|'none'>('full'), [view, setView] = useState('screen');
  const [quality, setQuality] = useState(95), [fps, setFps] = useState(10), [step, setStep] = useState(1);
  const [fitWidth, setFitWidth] = useState(1920), [fitHeight, setFitHeight] = useState(1080);
  const [fitPreset, setFitPreset] = useState('1920x1080');
  const [directory, setDirectory] = useState<ExportDirectory | null>(null), [canPickDirectory, setCanPickDirectory] = useState(false);
  const [name, setName] = useState('RADAZ'), [message, setMessage] = useState('');
  const [ready, setReady] = useState<{ url: string; name: string; count: number; preview?: string; saved?: string } | null>(null);
  const [selection, setSelection] = useState<Selection[]>([]);
  const selectionRef = useRef(selection); selectionRef.current = selection;
  const [videoEncoder, setVideoEncoder] = useState(false);
  const abort = useRef(false);
  useEffect(() => { setReady(null); setMessage(''); }, [scope, format, quality, view, annotations, fitWidth, fitHeight, fps, step, name, directory, imageId, datasetVersion]);
  useEffect(() => { setCanPickDirectory(typeof (window as DirectoryWindow).showDirectoryPicker === 'function'); }, []);
  useEffect(() => { if (open) void outputRequest<{ videoEncoder: boolean }>('/output-devices').then(value => setVideoEncoder(value.videoEncoder)).catch(() => setVideoEncoder(false)); }, [open]);
  useEffect(() => () => { if (ready) { URL.revokeObjectURL(ready.url); if (ready.preview) URL.revokeObjectURL(ready.preview); } }, [ready]);
  useEffect(() => { generation.current++; selectionRef.current.forEach(item => URL.revokeObjectURL(item.preview)); setSelection([]); }, [datasetVersion]);
  useEffect(() => () => selectionRef.current.forEach(item => URL.revokeObjectURL(item.preview)), []);
  const clearSelection = () => {
    selectionRef.current.forEach(item => URL.revokeObjectURL(item.preview)); setSelection([]);
    setMessage('Seçilmiş görüntülər təmizləndi'); onStatus('Çap üçün seçilmiş görüntülər təmizləndi');
  };
  const chooseDirectory = async () => {
    try { const selected = await (window as DirectoryWindow).showDirectoryPicker?.({ mode: 'readwrite', id: 'radaz-export' }); if (selected) setDirectory(selected); }
    catch (error) { if ((error as Error).name !== 'AbortError') setMessage(`Qovluq seçilmədi: ${(error as Error).message}`); }
  };
  const writeToDirectory = async (blob: Blob, prefix: string, extension: string) => {
    if (!directory) return undefined;
    for (let suffix = 0; suffix < 1000; suffix++) {
      const filename = `${prefix}${suffix ? ` (${suffix})` : ''}.${extension}`;
      try { await directory.getFileHandle(filename); continue; }
      catch (error) { if ((error as Error).name !== 'NotFoundError') throw error; }
      const file = await directory.getFileHandle(filename, { create: true }), stream = await file.createWritable();
      try { await stream.write(blob); await stream.close(); }
      catch (error) { await stream.abort().catch(() => {}); throw error; }
      return `${directory.name}/${filename}`;
    }
    throw new Error('Bu adda çoxlu fayl var. Fayl adını dəyişin.');
  };
  const capture = async (targetPanel = panel, targetImage = imageId) => {
    const pane = document.querySelector<HTMLElement>(`[data-panel="${targetPanel}"]`);
    if (!pane || !targetImage) throw new Error('Əvvəlcə görüntü açın');
    return captureViewport(pane, true);
  };
  const selectCurrent = async (targetPanel = panel, targetImage = imageId, targetSeries = series) => {
    if (!targetImage || busy || selecting.current) return;
    const existing = selectionRef.current.find(item => item.id === targetImage);
    if (existing) { URL.revokeObjectURL(existing.preview); setSelection(items => items.filter(item => item.id !== targetImage)); return; }
    selecting.current = true; setBusy(true); const version = generation.current;
    try {
      if (selectionRef.current.length >= 200) throw new Error('Bir çap siyahısında ən çox 200 görüntü seçilə bilər');
      const pane = document.querySelector<HTMLElement>(`[data-panel="${targetPanel}"]`);
      if (!pane) throw Error('Görüntü paneli tapılmadı');
      const {canvas, overlay: labels} = await capturePrintFrame(pane);
      const blob = await canvasBlob(canvas, 'png'), overlay = await canvasBlob(labels, 'png');
      if (version !== generation.current) return;
      setSelection(items => [...items, { id: targetImage, name: `${targetSeries?.name || 'Görüntü'} · ${(targetSeries?.imageIds.indexOf(targetImage) ?? 0) + 1}`, blob, overlay, width: canvas.width, height: canvas.height, preview: URL.createObjectURL(blob) }]);
      onStatus('Görüntü cari görünüşü ilə çap siyahısına əlavə edildi');
    } catch (error) { onStatus(String(error)); } finally { selecting.current = false; setBusy(false); }
  };
  const print = async () => {
    if (!selection.length || busy) return;
    const tab = window.open('about:blank', '_blank');
    if (!tab) { setMessage('Çap vərəqəsi üçün brauzerdə yeni pəncərəyə icazə verin'); return; }
    setBusy(true);
    try { const id = await saveOutputJob({ title: 'Viewer-də seçilmiş görüntülər', frames: selection.map(({ preview, ...frame }) => frame) }); tab.opener = null; tab.location.replace(`/print?job=${id}`); }
    catch (error) { tab.close(); setMessage(String(error)); } finally { setBusy(false); }
  };
  const entries = (scope === 'all' ? allSeries : series ? [series] : []).flatMap((item, seriesIndex) =>
    (scope === 'image' ? item.imageIds.filter(id => id === imageId) : item.imageIds.filter((_, i) => i % Math.max(1, step) === 0)).map((id, i) => ({ id, item, path: `SERIES${String(seriesIndex + 1).padStart(3,'0')}/IMG${String(i + 1).padStart(6,'0')}` })));
  const runExport = async () => {
    if (busy || !entries.length) return;
    setBusy(true); setReady(null); abort.current = false;
    try {
      const video = format === 'mp4' || format === 'wmv';
      const prefix = name.replace(/[^\p{L}\p{N}_.-]+/gu, '_').slice(0,80).replace(/\.+$/, '') || 'RADAZ';
      const zip = new JSZip(); let single: Blob | undefined, preview: Blob | undefined;
      const state = format === 'dicom' ? null : await readDisplayState(panel);
      let totalBytes = 0;
      for (let index = 0; index < entries.length; index++) {
        if (abort.current) throw new Error('İxrac dayandırıldı');
        const entry = entries[index]; setMessage(`Hazırlanır: ${index + 1} / ${entries.length}`);
        let blob: Blob;
        if (format === 'dicom') {
          const source = await getOriginalDicom(entry.id); if (!source) throw new Error('Törəmə MPR üçün DICOM ixracı yoxdur; PNG və ya JPEG seçin');
          blob = new Blob([source as BlobPart], { type: 'application/dicom' });
        } else {
          const pane = document.querySelector<HTMLElement>(`[data-panel="${panel}"]`);
          let canvas = scope === 'image' && view === 'screen' && pane && !video ? await captureViewport(pane, annotations)
            : await renderFullImage(entry.id, state!, video ? 1920 : view === 'fit' ? Math.max(fitWidth, fitHeight) : 0, scope !== 'all');
          if (view === 'fit' && !video) canvas = fitCanvas(canvas, fitWidth, fitHeight);
          blob = await canvasBlob(canvas, video ? 'png' : format as 'jpeg'|'png'|'bmp', quality / 100);
          if (index === 0 && !video) preview = await canvasBlob(resizeCanvas(canvas,600),'png');
        }
        totalBytes += blob.size;
        if (totalBytes > 480 * 1024 * 1024) throw new Error('İxrac 480 MB həddini keçir. Seriyanı və ya ölçünü kiçildin.');
        const extension = format === 'dicom' ? 'dcm' : format === 'jpeg' ? 'jpg' : video ? 'png' : format;
        zip.file(video ? `FRAME${String(index).padStart(6,'0')}.png` : `${entry.path}.${extension}`, blob);
        single = blob;
        // Yield so progress and cancellation stay responsive on tablets.
        await new Promise(resolve => setTimeout(resolve,0));
      }
      let result: Blob, extension: string;
      if (video) {
        zip.file('video.json', JSON.stringify({ format, fps })); setMessage('Video kodlaşdırılır…');
        const response = await fetch('/local-archive-api/video', { method: 'POST', headers: { 'Content-Type':'application/zip' }, body: await zip.generateAsync({ type: 'blob', compression:'STORE' }) });
        if (!response.ok) throw new Error((await response.json() as {error?: string}).error || 'Video yaradıla bilmədi');
        result = await response.blob(); extension = format;
      } else if (entries.length === 1) { result = single!; extension = format === 'dicom' ? 'dcm' : format === 'jpeg' ? 'jpg' : format; }
      else { setMessage('ZIP hazırlanır…'); result = await zip.generateAsync({ type:'blob', compression:'STORE' }); extension = 'zip'; }
      if (abort.current) throw new Error('İxrac dayandırıldı');
      let saved: string | undefined, saveError = '';
      try { saved = await writeToDirectory(result, prefix, extension); }
      catch (error) { saveError = `Qovluğa yazılmadı: ${(error as Error).message}. Faylı aşağıdakı düymədən yükləyə bilərsiniz.`; }
      const downloadUrl = URL.createObjectURL(result);
      if (!saved && !saveError) { const link = document.createElement('a'); link.href = downloadUrl; link.download = `${prefix}.${extension}`; document.body.appendChild(link); link.click(); link.remove(); }
      setReady({ url: downloadUrl, name: `${prefix}.${extension}`, count: entries.length, preview: preview ? URL.createObjectURL(preview) : undefined, saved });
      setMessage(saveError || (saved ? `Saxlanıldı: ${saved}` : `${entries.length} görüntü · ${(result.size / 1024 / 1024).toFixed(1)} MB · yükləməyə hazırdır`));
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };
  const currentSelected = selection.some(item => item.id === imageId);
  const video = format === 'mp4' || format === 'wmv';
  const screenAnnotations = scope === 'image' && view === 'screen' && !video && format !== 'dicom';
  const fitValid = [fitWidth, fitHeight].every(n => Number.isInteger(n) && n >= 16 && n <= 8192) && fitWidth * fitHeight <= 32000000;
  return <>
    {targets.map(target => {
      const item = panes.find(value => value.panel === target.dataset.panel);
      if (!item?.imageId) return null;
      const checked = selection.some(value => value.id === item.imageId);
      return createPortal(<label className={`viewport-print-check ${checked ? 'is-checked' : ''}`} title={checked ? 'Çap seçimindən çıxar' : tr('ui.select_for_printing_d6e38')} onPointerDown={event => event.stopPropagation()} onClick={event => event.stopPropagation()} onDoubleClick={event => event.stopPropagation()}>
        <input type="checkbox" aria-label={`${item.panel} panelindəki görüntünü çap üçün seç`} checked={checked} disabled={busy} onChange={() => void selectCurrent(item.panel, item.imageId, item.series)}/><span>{tr('ui.select_for_printing_d6e38')}</span>
      </label>, target, item.panel);
    })}
    <ToolbarGroup className="toolbar-group output-command-group" role="group" aria-label={tr('ui.export_selection_and_printing_5c5b1')} groupId="output" order={35}>
      <Button variant="ghost" className="header-control" aria-label={tr('ui.export_images_fd961')} title={tr('ui.export_images_fd961')} onClick={() => { setMessage(''); setOpen(true); }}><Download size={18}/><span>{tr('ui.export_fd2ae')}</span></Button>
      <DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" className={`header-control ${currentSelected ? 'selected-tool' : ''}`} aria-label={tr('ui.select_images_7c3a3')} title={tr('ui.select_images_7c3a3')}><CheckSquare size={18}/><span>{tr('ui.select_images_7c3a3')}</span><ChevronDown size={12}/></Button></DropdownMenuTrigger><DropdownMenuContent className="header-menu" align="end">
        <DropdownMenuItem disabled={!imageId || busy} onSelect={() => void selectCurrent()}><CheckSquare size={16}/>{currentSelected ? 'Cari görüntünü seçimdən çıxar' : 'Cari görüntünü seç'}</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => { setMessage(''); setTray(true); }}><Images size={16}/>{tr('ui.selected_images_ca560')}{selection.length})</DropdownMenuItem>
        <div className="menu-separator"/>
        <DropdownMenuItem disabled={!selection.length || busy} onSelect={clearSelection}><Trash2 size={16}/>{tr('ui.clear_selection_ab49a')}</DropdownMenuItem>
      </DropdownMenuContent></DropdownMenu>
      <DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" className="header-control print-queue-trigger" aria-label={tr('ui.print_dd96a')} title={`Çap · ${selection.length} görüntü seçilib`}><Printer size={18}/><span>{tr('ui.print_dd96a')}</span>{selection.length > 0 && <small className="print-queue-count">{selection.length}</small>}<ChevronDown size={12}/></Button></DropdownMenuTrigger><DropdownMenuContent className="header-menu" align="end">
        <DropdownMenuItem disabled={!selection.length || busy} onSelect={() => void print()}><Printer size={16}/>{tr('ui.open_print_preview_f5482')}{selection.length})</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => { setMessage(''); setTray(true); }}><Images size={16}/>{tr('ui.selected_images_ca560')}{selection.length})</DropdownMenuItem>
        <div className="menu-separator"/>
        <DropdownMenuItem onSelect={() => window.open('/printer-settings', '_blank')}><Settings2 size={16}/>{tr('ui.printer_settings_75fe9')}</DropdownMenuItem>
      </DropdownMenuContent></DropdownMenu>
    </ToolbarGroup>
    <Dialog open={open} onOpenChange={value => { if (!busy) setOpen(value); }}><DialogContent className="output-dialog export-pro-dialog" showCloseButton={!busy}>
      <DialogHeader className="export-dialog-heading"><span className="export-heading-icon"><Download size={23}/></span><div><DialogTitle>{tr('ui.export_images_fd961')}</DialogTitle><DialogDescription>{tr('ui.choose_the_format_destination_and_image_setti_3c623')}</DialogDescription></div></DialogHeader>
      <div className="export-scroll-body">
        <fieldset disabled={busy} className="export-section"><legend><Images size={15}/>{tr('ui.images_and_format_7ac54')}</legend>
          <div className="export-scope output-options">{[['image','Cari görüntü'],['series','Cari seriya'],['all','Bütün açıq seriyalar']].map(([value,label]) => <label key={value}><input type="radio" name="export-scope" value={value} checked={scope === value} onChange={() => { setScope(value); if (value !== 'image' && view === 'screen') setView('original'); }}/>{label}</label>)}</div>
          <div className="export-format-grid">{formatChoices.map(({value,label,detail}) => <label key={value} className={format === value ? 'is-selected' : ''}><input type="radio" name="export-format" checked={format === value} disabled={(value === 'mp4' || value === 'wmv') && !videoEncoder} onChange={() => setFormat(value)}/>{value === 'mp4' || value === 'wmv' ? <Film size={17}/> : <FileImage size={17}/>}<span><strong>{label}</strong><small>{detail}</small></span>{format === value && <Check size={14}/>}</label>)}</div>
          <div className="export-summary"><span>{entries.length} {tr('ui.images_992d4')}</span><span>{entries.length > 1 && !video ? 'Seriyalar üzrə ZIP arxivi' : video ? `${fps} FPS · 1920 × 1080 px` : 'Tək fayl'}</span></div>
        </fieldset>
        <fieldset disabled={busy} className="export-section"><legend><FolderOpen size={15}/>{tr('ui.destination_9f8d8')}</legend>
          <div className="export-location-row"><label>{tr('ui.folder_d7ec4')}<input readOnly value={directory?.name || 'Brauzerin yükləmə qovluğu'} aria-label={tr('ui.export_folder_6f474')}/></label><button type="button" className="export-folder-button" disabled={!canPickDirectory} onClick={() => void chooseDirectory()}><FolderOpen size={16}/>{tr('ui.choose_folder_041d3')}</button>{directory && <button type="button" className="export-folder-reset" title={tr('ui.return_to_browser_download_c943b')} aria-label={tr('ui.return_to_browser_download_c943b')} onClick={() => setDirectory(null)}><X size={16}/></button>}</div>
          <div className="export-filename-row"><label htmlFor="export-prefix">{tr('ui.file_name_f4be5')}</label><input id="export-prefix" value={name} maxLength={80} onChange={event => setName(event.target.value)} placeholder="RADAZ"/><span>.{entries.length > 1 && !video ? 'zip' : format === 'jpeg' ? 'jpg' : format === 'dicom' ? 'dcm' : format}</span></div>
          <p className="output-note">{directory ? 'Eyni adlı fayl varsa, yeni fayla nömrə əlavə olunur.' : canPickDirectory ? 'Qovluq seçin və ya hazır faylı brauzerdən yükləyin.' : 'Qovluq seçimi bu bağlantıda əlçatan deyil. Yükləmə yerini brauzerin ayarlarından dəyişə bilərsiniz.'}</p>
        </fieldset>
        <fieldset disabled={busy || format === 'dicom'} className="export-section export-settings"><legend><SlidersHorizontal size={15}/>{tr('ui.file_settings_9462d')}</legend>
          <div className="export-setting-row"><span className="export-setting-label">{tr('ui.image_size_394d7')}</span><div className="output-options">
            <label><input type="radio" name="export-size" checked={view === 'original'} disabled={video} onChange={() => setView('original')}/>{tr('ui.original_1_1_531c1')}</label>
            <label><input type="radio" name="export-size" checked={view === 'screen'} disabled={scope !== 'image' || video} onChange={() => setView('screen')}/>{tr('ui.on_screen_size_38ca2')}</label>
            <label><input type="radio" name="export-size" checked={view === 'fit'} disabled={video} onChange={() => setView('fit')}/>{tr('ui.fit_to_size_87a0b')}</label>
          </div></div>
          {view === 'fit' && !video && <div className="export-fit-row"><select aria-label={tr('ui.export_size_preset_72eea')} value={fitPreset} onChange={event => { setFitPreset(event.target.value); if (event.target.value !== 'custom') { const [w,h] = event.target.value.split('x').map(Number); setFitWidth(w); setFitHeight(h); } }}><option value="640x480">640 × 480 px</option><option value="1024x768">1024 × 768 px</option><option value="1920x1080">1920 × 1080 px</option><option value="2048x2048">2048 × 2048 px</option><option value="custom">{tr('ui.custom_size_87725')}</option></select><input aria-label={tr('ui.export_width_3c319')} type="number" min="16" max="8192" value={fitWidth} onChange={event => { setFitWidth(Number(event.target.value)); setFitPreset('custom'); }}/><span>×</span><input aria-label={tr('ui.export_height_42090')} type="number" min="16" max="8192" value={fitHeight} onChange={event => { setFitHeight(Number(event.target.value)); setFitPreset('custom'); }}/><span>px</span><small>{tr('ui.aspect_ratio_is_preserved_empty_borders_are_f_5e54b')}</small></div>}
          <div className="export-setting-row"><span className="export-setting-label">{tr('ui.annotations_and_measurements_a9fc6')}</span><div className="output-options">{[['full','Tam'],['basic','Əsas'],['none','Gizli']].map(([value,label]) => <label key={value}><input type="radio" name="export-annotations" checked={annotations === value} disabled={!screenAnnotations} onChange={() => setAnnotations(value as 'full'|'basic'|'none')}/>{label}</label>)}</div></div>
          <p className="output-note">{screenAnnotations ? annotations === 'basic' ? 'Əsas: texniki yazılar və ölçmələr saxlanır, pasiyent başlıqları gizlənir. Pikselə yazılmış məlumatlar silinmir.' : 'Cari ekranda görünən yazılar və ölçmələrə tətbiq olunur.' : 'Yazı və ölçmə seçimi yalnız cari görüntünün ekrandakı ölçüsündə tətbiq olunur.'}</p>
          {format === 'jpeg' && <div className="export-setting-row export-quality-row"><label className="export-setting-label" htmlFor="export-quality">{tr('ui.jpeg_quality_5f107')}</label><div><div className="export-quality-slider"><input id="export-quality" type="range" min="10" max="100" step="1" value={quality} onChange={event => setQuality(Number(event.target.value))}/><output>{quality}%</output></div><div className="export-range-hints"><span>{tr('ui.smaller_file_f0966')}</span><span>{tr('ui.higher_quality_b0056')}</span></div></div></div>}
          {video && <div className="export-setting-row"><label className="export-setting-label" htmlFor="export-fps">{tr('ui.frame_rate_2d751')}</label><div className="export-inline-number"><input id="export-fps" type="number" min="1" max="60" value={fps} onChange={event => setFps(Math.max(1, Math.min(60, Number(event.target.value) || 1)))}/><span>{tr('ui.fps_1920_1080_px_video_70059')}</span></div></div>}
        </fieldset>
        {scope !== 'image' && <div className="export-sampling"><label htmlFor="export-step">{tr('ui.export_every_nth_image_c3fdf')}</label><input id="export-step" disabled={busy} type="number" min="1" max="1000" value={step} onChange={event => setStep(Math.max(1, Math.min(1000, Number(event.target.value) || 1)))}/></div>}
        <p className="output-note">{format === 'dicom' ? 'Orijinal DICOM: piksel və pasiyent məlumatları dəyişdirilmir. Ekrandakı çevirmələr bu fayla tətbiq edilmir.' : scope === 'image' && view === 'screen' && !video ? 'Cari WL / WW, pozitiv / neqativ, çevirmə və zoom saxlanır.' : 'Tam görüntü və aktiv panelin çevirmələri saxlanır; ekrandakı yazılar daxil edilmir. Bütün seriyalar öz DICOM window ayarları ilə ixrac olunur.'}</p>
        {ready?.preview && <div className="export-ready-preview"><img src={ready.preview} alt={tr('ui.exported_image_preview_8b16d')}/><div><Check size={18}/><strong>{ready.name}</strong><span>{ready.count} {tr('ui.images_ready_ddd9c')}</span></div></div>}
      </div>
      <div className="export-dialog-footer"><p role="status" className="output-status">{message || `${entries.length} görüntü · ${format.toUpperCase()}`}</p><div className="output-actions">{busy ? <button onClick={() => { abort.current = true; setMessage('Cari əməliyyat tamamlandıqda dayandırılır…'); }}>{tr('ui.cancel_01781')}</button> : <button onClick={() => setOpen(false)}>{tr('ui.close_c1cf9')}</button>}{ready && !busy && !ready.saved && <a className="output-primary" href={ready.url} download={ready.name}><Download size={16}/>{tr('ui.download_file_dab95')}</a>}<button className="output-primary" disabled={busy || !entries.length || (format !== 'dicom' && view === 'fit' && !video && !fitValid) || (video && !videoEncoder)} onClick={() => void runExport()}><Download size={16}/>{busy ? 'Hazırlanır…' : ready?.saved ? 'Yenidən ixrac et' : tr('ui.export_fd2ae')}</button></div></div>
    </DialogContent></Dialog>
    <Dialog open={tray} onOpenChange={value => { if (!busy) setTray(value); }}><DialogContent className="output-dialog print-selection-dialog"><DialogHeader><DialogTitle>{tr('ui.images_selected_for_printing_fc1d5')}</DialogTitle><DialogDescription>{tr('ui.images_retain_the_window_orientation_and_visi_adfe5')}</DialogDescription></DialogHeader>
      <div className="selection-summary"><span>{selection.length} {tr('ui.images_selected_bba10')}</span><button disabled={!selection.length || busy} onClick={clearSelection}><Trash2 size={16}/>{tr('ui.clear_selection_ab49a')}</button></div>
      {!selection.length && <p className="selection-empty"><ImageIcon size={30}/>{tr('ui.use_the_checkbox_on_the_left_edge_of_an_image_8d0ed')}</p>}
      <div className="print-selection-grid">{selection.map((item,index) => <article key={item.id}><img src={item.preview} alt={item.name}/><span>{index+1}. {item.name}</span><button aria-label={`${index+1}-ci görüntünü çıxar`} disabled={busy} onClick={() => { URL.revokeObjectURL(item.preview); setSelection(items => items.filter(value => value.id !== item.id)); }}><X size={16}/></button></article>)}</div>
      <p role="status">{message}</p><div className="output-actions"><button onClick={() => setTray(false)}>{tr('ui.continue_selecting_64f45')}</button><button className="output-primary" disabled={!selection.length || busy} onClick={() => void print()}><Printer size={16}/>{tr('ui.print_preview_aadda')}{selection.length} {tr('ui.images_992d4')}</button></div>
    </DialogContent></Dialog>
  </>;
}
