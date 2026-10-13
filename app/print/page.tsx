'use client';
import {useTranslation as useUiTranslation,translate as tr} from '@/lib/i18n';

import { OutputPageHeader } from '@/components/output-page-header';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {flushSync} from 'react-dom';
import { ArrowLeft, ChevronLeft, ChevronRight, Printer, Radio, Settings2 } from 'lucide-react';
import { getArchiveFiles } from '@/lib/local-archive';
import { bytesToBase64, readDicomPixels, type DicomPixelImage } from '@/lib/dicom-pixels';
import { printDicomFilm } from '@/lib/dicom-print';
import { defaultPrinter, loadPrinterSettings } from '@/lib/printer-settings';
import { readOutputJob } from '@/lib/output-jobs';
import {defaultPrintAdjustment,renderPrintImage,printImagePixels,type PrintAdjustment} from '@/lib/print-image';

const layouts = ['1,1','1,2','2,2','2,3','2,4','3,3','3,4','4,4','5,5','6,6'];
function FilmImage({image,adjustment,ratio}:{image:DicomPixelImage;adjustment:PrintAdjustment;ratio:number}){
  const ref=useRef<HTMLCanvasElement>(null);
  useLayoutEffect(()=>{
    const canvas=ref.current;if(!canvas)return;
    const rendered=renderPrintImage(image,adjustment,ratio);
    canvas.width=rendered.width;canvas.height=rendered.height;
    canvas.getContext('2d')!.drawImage(rendered,0,0);
  },[image,adjustment,ratio]);
  return <canvas ref={ref}/>;
}

export default function PrintPage() {
  useUiTranslation();
  useEffect(() => { document.title = 'RADAZ · Çap'; }, []);
  const [images,setImages] = useState<DicomPixelImage[]>([]), [title,setTitle] = useState('Görüntülər');
  const [printer,setPrinter] = useState(defaultPrinter), [layout,setLayout] = useState('2,2'), [filmSize,setFilmSize] = useState('14INX17IN');
  const [paper,setPaper] = useState('A4'), [orientation,setOrientation] = useState<'PORTRAIT'|'LANDSCAPE'>('PORTRAIT');
  const [page,setPage] = useState(0), [scope,setScope] = useState('all'), [copies,setCopies] = useState(1);
  const [selected,setSelected]=useState(0),[editScope,setEditScope]=useState<'single'|'all'>('single');
  const [adjustments,setAdjustments]=useState<Record<number,PrintAdjustment>>({});
  const [previewTarget,setPreviewTarget]=useState<'paper'|'film'>('paper');
  const [printing,setPrinting]=useState(false);
  const [status,setStatus] = useState('Görüntülər hazırlanır…'), [busy,setBusy] = useState(false);
  const [columns,rows] = layout.split(',').map(Number), perPage = columns * rows, pageCount = Math.max(1,Math.ceil(images.length/perPage));
  const pages = Array.from({length:pageCount},(_,index) => images.slice(index*perPage,(index+1)*perPage));
  useEffect(() => {
    let disposed = false;
    void loadPrinterSettings().then(value => { if(disposed)return; setPrinter(value);setLayout(value.layout);setFilmSize(value.filmSize);setOrientation(value.orientation);setPaper(value.paperSize);setCopies(value.copies); });
    void (async () => {
      const query = new URLSearchParams(location.search), jobId = query.get('job');
      const decoded: DicomPixelImage[] = []; let skipped=0;
      if (jobId) {
        const job = await readOutputJob(jobId);
        if (!job?.frames?.length) throw new Error('Çap siyahısı tapılmadı. Viewer-də görüntüləri yenidən seçin.');
        if(!disposed)setTitle(job.title);
        for (const frame of job.frames) {
          const bitmap = await createImageBitmap(frame.blob), canvas = document.createElement('canvas');
          // Keep printer rasters within Basic Grayscale Print's configured limits.
          const scale = Math.min(1,4096/Math.max(bitmap.width,bitmap.height));
          canvas.width = Math.max(1,Math.round(bitmap.width*scale)); canvas.height = Math.max(1,Math.round(bitmap.height*scale));
          const ctx = canvas.getContext('2d')!;ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close();
          const rgba = ctx.getImageData(0,0,canvas.width,canvas.height).data,pixels = new Uint8Array(canvas.width*canvas.height);
          for(let i=0;i<pixels.length;i++)pixels[i]=Math.round(.299*rgba[i*4]+.587*rgba[i*4+1]+.114*rgba[i*4+2]);
          let overlay: HTMLCanvasElement | undefined;
          if (frame.overlay) {
            const labels = await createImageBitmap(frame.overlay);
            overlay = document.createElement('canvas'); overlay.width = canvas.width; overlay.height = canvas.height;
            overlay.getContext('2d')!.drawImage(labels,0,0,overlay.width,overlay.height); labels.close();
          }
          decoded.push({overlay,name:frame.name,rows:canvas.height,columns:canvas.width,pixels,windowCenter:127.5,windowWidth:255,photometric:'MONOCHROME2'});
        }
      } else {
        const uid = query.get('study'); if(!uid)throw new Error('Çap üçün viewer-də görüntü və ya arxivdə müayinə seçin.');
        const files = await getArchiveFiles(uid);
        for(const file of files) { try { const image=await readDicomPixels(file);if(image)decoded.push(image);else skipped++; }catch { skipped++; } }
      }
      if(!disposed){setImages(decoded);setStatus(`${decoded.length} görüntü hazırdır${skipped ? ` · ${skipped} görüntü açıla bilmədi` : ''}`);}
    })().catch(error => { if(!disposed)setStatus(error instanceof Error ? error.message : String(error)); });
    return () => { disposed=true; };
  },[]);
  useEffect(() => setPage(value => Math.min(value,pageCount-1)),[pageCount]);
  const filmRatio=({'8INX10IN':8/10,'10INX12IN':10/12,'11INX14IN':11/14,'14INX17IN':14/17,A4:210/297,A3:297/420}[filmSize]||14/17);
  const paperSize=({A4:[210,297],A3:[297,420],Letter:[215.9,279.4]}[paper]||[210,297]);
  const paperWidth=paperSize[orientation==='PORTRAIT'?0:1]-10,paperHeight=paperSize[orientation==='PORTRAIT'?1:0]-10;
  const ratio=previewTarget==='paper'?paperWidth/paperHeight:orientation==='PORTRAIT'?filmRatio:1/filmRatio;
  const cellRatio=ratio*rows/columns;
  const currentAdjustment=adjustments[selected]||defaultPrintAdjustment;
  const change=(values:Partial<PrintAdjustment>,target=selected)=>{
    setAdjustments(previous=>{
      const next={...previous},indices=editScope==='all'?images.map((_,i)=>i):[target];
      for(const i of indices)next[i]={...(previous[i]||defaultPrintAdjustment),...values};
      return next;
    });
  };
  const selectPage=(index:number)=>{setPage(index);setSelected(index*perPage);};
  // Switch to the actual paper shape before opening the browser's print dialog.
  useEffect(()=>{const before=()=>flushSync(()=>{setPreviewTarget('paper');setPrinting(true);});const after=()=>setPrinting(false);window.addEventListener('beforeprint',before);window.addEventListener('afterprint',after);return()=>{window.removeEventListener('beforeprint',before);window.removeEventListener('afterprint',after);};},[]);
  const send = async () => {
    setBusy(true);setPreviewTarget('film'); let sent=0;
    const indices = scope==='all' ? pages.map((_,i)=>i) : [page];
    try {
      for(const index of indices) {
        selectPage(index);setStatus(`DICOM printer: plyonka ${index+1} / ${pageCount} göndərilir…`);
        const result = await printDicomFilm({...printer,copies},{filmSize,orientation,layout,images:pages[index].map((image,i)=>{const raster=printImagePixels(renderPrintImage(image,adjustments[index*perPage+i]||defaultPrintAdjustment,(orientation==='PORTRAIT'?filmRatio:1/filmRatio)*rows/columns));return {...raster,pixels:bytesToBase64(raster.pixels)};})});
        sent++;setStatus(result.message);
      }
      setStatus(`${sent} plyonkanın çap əmri printer tərəfindən qəbul edildi · hərəsindən ${copies} nüsxə`);
    } catch(error){setScope('page');setStatus(`${sent} plyonka qəbul edildi. Cari plyonkada dayandırıldı: ${error instanceof Error ? error.message : String(error)}`);}
    finally{setBusy(false);}
  };

  return <main className="print-shell print-output-shell">
    <style>{`@media print { @page { size: ${paper} ${orientation==='PORTRAIT'?'portrait':'landscape'}; margin: 5mm; } .print-output-shell .print-sheet {height:${paperHeight}mm!important;width:${paperWidth}mm!important;} }`}</style>
    <OutputPageHeader kind="print">{title} · {images.length} {tr('ui.images_992d4')}</OutputPageHeader>
    <aside className="print-controls"><label>{tr('ui.preview_3f088')}<select aria-label={tr('ui.preview_format_7207d')} disabled={busy} value={previewTarget} onChange={e=>setPreviewTarget(e.target.value as 'paper'|'film')}><option value="paper">{tr('ui.standard_printer_pdf_dae40')}</option><option value="film">{tr('ui.dicom_film_465a4')}</option></select></label><label>{tr('ui.pages_to_print_44d08')}<select disabled={busy} value={scope} onChange={e=>setScope(e.target.value)}><option value="all">{tr('ui.all_selected_images_bd947')}</option><option value="page">{tr('ui.current_film_only_bf542')}</option></select></label>
      <label>{tr('ui.layout_915a8')}<select disabled={busy} value={layout} onChange={e=>{setLayout(e.target.value);selectPage(0);}}>{layouts.map(value=><option key={value} value={value}>{value.replace(',',' × ')} · {value.split(',').map(Number).reduce((a,b)=>a*b)} {tr('ui.images_992d4')}</option>)}</select></label>
      <label>{tr('ui.dicom_film_size_79a53')}<select disabled={busy} value={filmSize} onChange={e=>{setFilmSize(e.target.value);setPreviewTarget('film');}}>{['8INX10IN','10INX12IN','11INX14IN','14INX17IN','A4','A3'].map(value=><option key={value}>{value}</option>)}</select></label>
      <label>{tr('ui.standard_printer_paper_608cd')}<select value={paper} onChange={e=>setPaper(e.target.value)}><option>A4</option><option>A3</option><option>Letter</option></select></label>
      <label>{tr('ui.orientation_4eb06')}<select disabled={busy} value={orientation} onChange={e=>setOrientation(e.target.value as 'PORTRAIT'|'LANDSCAPE')}><option value="PORTRAIT">{tr('ui.portrait_0787f')}</option><option value="LANDSCAPE">{tr('ui.landscape_a7bc2')}</option></select></label>
      <label>{tr('ui.dicom_copy_count_19c6a')}<input disabled={busy} type="number" min="1" max="99" value={copies} onChange={e=>setCopies(Math.max(1,Math.min(99,+e.target.value || 1)))}/></label>
      <fieldset className="print-edit-scope" disabled={busy||!images.length}><legend>{tr('ui.apply_changes_to_bfebf')}</legend>
        <label><input type="checkbox" checked={editScope==='single'} onChange={()=>setEditScope('single')}/>{tr('ui.selected_980e6')}</label>
        <label><input type="checkbox" checked={editScope==='all'} onChange={()=>setEditScope('all')}/>{tr('ui.all_fba8f')}</label>
        <small>{editScope==='single'?`${selected+1}-ci görüntü · dəyişmək üçün xananı seçin`:'Bütün səhifələrdəki görüntülər'}</small>
      </fieldset>
      <label>{tr('ui.image_zoom_9689c')}<output>{Math.round(currentAdjustment.zoom*100)}%</output><input aria-label={tr('ui.image_zoom_9689c')} disabled={busy||!images.length} type="range" min="0.25" max="4" step="0.05" value={currentAdjustment.zoom} onChange={e=>change({zoom:+e.target.value})}/></label>
      <label>{tr('ui.brightness_38dda')}<output>{currentAdjustment.brightness}</output><input aria-label={tr('ui.brightness_38dda')} disabled={busy||!images.length} type="range" min="-128" max="128" value={currentAdjustment.brightness} onChange={e=>change({brightness:+e.target.value})}/></label>
      <label>{tr('ui.contrast_f857e')}<output>{currentAdjustment.contrast.toFixed(1)}</output><input aria-label={tr('ui.contrast_f857e')} disabled={busy||!images.length} type="range" min="0.2" max="3" step="0.1" value={currentAdjustment.contrast} onChange={e=>change({contrast:+e.target.value})}/></label>
      <button className="print-settings-toggle" disabled={busy} onClick={()=>change(defaultPrintAdjustment)}>{tr('ui.restore_appearance_7fd7c')}</button>
      <div className="print-pages"><button aria-label={tr('ui.previous_film_ef644')} disabled={page===0||busy} onClick={()=>selectPage(page-1)}><ChevronLeft size={18}/></button><span>{page+1} / {pageCount}</span><button aria-label={tr('ui.next_film_7c0ce')} disabled={page+1>=pageCount||busy} onClick={()=>selectPage(page+1)}><ChevronRight size={18}/></button></div>
      <button className="print-action" disabled={!images.length||busy} onClick={()=>{setPreviewTarget('paper');requestAnimationFrame(()=>requestAnimationFrame(()=>window.print()));}}><Printer size={17}/> {tr('ui.standard_printer_pdf_dae40')}</button>
      <button className="print-action dicom" disabled={!images.length||busy||!printer.host} onClick={()=>void send()}><Radio size={17}/> {tr('ui.send_to_dicom_printer_157c0')}</button>
      {!printer.host&&<p className="output-note">{tr('ui.enter_the_printer_ip_port_and_ae_title_for_di_662d3')}</p>}
      <a className="print-settings-toggle" href="/printer-settings" target="_blank" rel="noreferrer"><Settings2 size={17}/> {tr('ui.printer_settings_75fe9')}</a>
      <button className="output-link" disabled={busy} onClick={()=>void loadPrinterSettings().then(value=>{setPrinter(value);setStatus('Printer ayarları yeniləndi');})}>{tr('ui.refresh_settings_adc23')}</button>
    </aside>
    <div className="print-sheets">{pages.map((frames,index)=><section key={index} data-print-page={index+1} className={`film-preview print-sheet ${index===page?'is-preview':''} ${scope==='page'&&index!==page?'skip-print':''}`} style={{'--film-columns':columns,'--film-rows':rows,aspectRatio:ratio} as React.CSSProperties}>{frames.map((image,i)=>{const number=index*perPage+i;return <button type="button" aria-label={`${number+1}-ci görüntü`} aria-pressed={selected===number} disabled={busy} className={`film-cell ${selected===number?'is-selected':''}`} key={i} onClick={()=>setSelected(number)}>{(index===page||printing)&&<FilmImage image={image} adjustment={adjustments[number]||defaultPrintAdjustment} ratio={cellRatio}/>}<span>{number+1}</span></button>;})}</section>)}</div>
    <footer className="print-status" role="status">{busy&&<i/>}{status}</footer>
  </main>;
}
