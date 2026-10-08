'use client';

import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Sparkles } from 'lucide-react';
import { renderReportImage, type ReportImage } from '@/lib/report-dicom';

export function ReportAssistant({ images, windowMode, instruction, onInstruction }: {
  images: ReportImage[]; windowMode: 'metadata' | 'lung' | 'soft' | 'bone'; instruction: string; onInstruction: (text: string) => void;
}) {
  const [index, setIndex] = useState(0), [preview, setPreview] = useState(''), [error, setError] = useState('');
  const current = images[Math.min(index, Math.max(0, images.length - 1))];
  useEffect(() => { setIndex(0); }, [images]);
  useEffect(() => {
    let alive = true;
    setPreview(''); setError('');
    if (current) void renderReportImage(current, windowMode).then(value => { if (alive) setPreview(value); })
      .catch(cause => { if (alive) setError(cause instanceof Error ? cause.message : String(cause)); });
    return () => { alive = false; };
  }, [current, windowMode]);
  return <div className="report-assistant">
    <div className="assistant-heading"><Sparkles size={21}/><strong>AI asistent</strong></div>
    <p className="assistant-selection">{new Set(images.map(image => image.seriesUID)).size} seriya · {images.length} görüntü</p>
    {!!images.length && <div className="assistant-preview">
      <div className="assistant-image">{preview ? <img src={preview} alt={`${current.seriesName} · ${index + 1}-ci görüntü`}/> : <p role="status">{error || 'Görüntü hazırlanır…'}</p>}</div>
      <div className="assistant-navigation"><button aria-label="Əvvəlki görüntü" disabled={index === 0} onClick={() => setIndex(value => value - 1)}><ChevronLeft size={18}/></button><span>{index + 1} / {images.length} · {current.seriesName}</span><button aria-label="Növbəti görüntü" disabled={index >= images.length - 1} onClick={() => setIndex(value => value + 1)}><ChevronRight size={18}/></button></div>
    </div>}
    <label className="assistant-instruction">Əlavə tapşırıq<textarea aria-label="AI üçün əlavə tapşırıq" value={instruction} onChange={event => onInstruction(event.target.value)} rows={4} placeholder="Məsələn: bronxit raporu yaz"/></label>
    <button className="assistant-analyze" disabled aria-describedby="assistant-connection"><Sparkles size={17}/>Dərindən incələ və rapor yaz</button>
    <p id="assistant-connection" className="assistant-connection" role="status">AI bağlantısı hələ qoşulmayıb. Avtomatik analiz və hesabat yaratma aktiv deyil. Hesabatı sağdakı redaktorda yaza və saxlaya bilərsiniz.</p>
  </div>;
}
