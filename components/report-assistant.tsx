'use client';
import {useTranslation as useUiTranslation,translate as tr} from '@/lib/i18n';


import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Sparkles, Settings2 } from 'lucide-react';
import { renderReportImage, type ReportImage } from '@/lib/report-dicom';
import { aiRequest, openAiSettings, type AiSettings } from '@/lib/ai-client';

export function ReportAssistant({ images, windowMode, instruction, onInstruction, onReport, enabled }: {
  images: ReportImage[]; windowMode: 'metadata' | 'lung' | 'soft' | 'bone'; instruction: string; onInstruction: (text: string) => void;
  onReport: (text: string) => void; enabled: boolean;
}) {
  useUiTranslation();
  const [index, setIndex] = useState(0), [preview, setPreview] = useState(''), [error, setError] = useState('');
  const [configured, setConfigured] = useState(false), [busy, setBusy] = useState(false), [status, setStatus] = useState('');
  const [manualWindow,setManualWindow]=useState(false),[ww,setWw]=useState(400),[wl,setWl]=useState(50);
  const active = useRef<AbortController | null>(null);
  useEffect(() => {
    let alive = true;
    const refresh = () => {void aiRequest<AiSettings>('settings').then(value => {if(alive)setConfigured(value.configured);}).catch(() => {if(alive)setConfigured(false);});};
    refresh(); window.addEventListener('radaz-ai-change',refresh);
    const channel = new BroadcastChannel('radaz-ai-settings'); channel.onmessage = refresh;
    return () => {alive=false;window.removeEventListener('radaz-ai-change',refresh);channel.close();};
  }, []);
  useEffect(() => {active.current?.abort();active.current=null;setBusy(false);setStatus('');return () => {active.current?.abort();active.current=null;};}, [images, windowMode]);
  const analyze = async () => {
    const controller = new AbortController(); active.current=controller;setBusy(true);setStatus('Hesabat hazırlanır…');
    const request = (body: unknown) => aiRequest<{text:string}>('report',body,controller.signal);
    try {
      if (images.some(image => !image.supported)) throw new Error('Seçimdə analiz üçün dəstəklənməyən görüntülər var. Həmin seriyaları seçimdən çıxarın.');
      const series = [...new Set(images.map(image => image.seriesUID))];
      let observations = '';
      for (let start = 0; start < images.length; start += 8) {
        controller.signal.throwIfAborted();
        const batch = [];
        for (let i = start; i < Math.min(start+8,images.length); i++) {
          setStatus(`Görüntülər hazırlanır: ${i+1} / ${images.length}`);
          const data = await renderReportImage(images[i],windowMode,manualWindow?{ww,wl}:undefined);controller.signal.throwIfAborted();
          batch.push({data,label:`Görüntü ${i+1}/${images.length}; seriya ${series.indexOf(images[i].seriesUID)+1}; kəsit ${images[i].instance}; ${images[i].modality}; window ${manualWindow?`WW ${ww} WL ${wl}`:windowMode}`});
        }
        setStatus(`Görüntülər incələnir: ${start+1}–${start+batch.length} / ${images.length}`);
        observations += '\n' + (await request({instruction,images:batch})).text;
        if (observations.length > 110000) {
          setStatus('Seriyaların müşahidələri birləşdirilir…');
          observations = (await request({instruction:'Aralıq müşahidələri yığcamlaşdır; bütün tapıntıları, görüntü nömrələrini və qeyri-müəyyənliyi saxla. Bu son hesabat deyil.',observations})).text;
        }
      }
      setStatus('Yekun hesabat layihəsi yazılır…');
      const result = await request({instruction,observations});controller.signal.throwIfAborted();
      if (active.current !== controller) return;
      onReport(result.text);setStatus('AI layihəsi redaktora əlavə edildi. Yoxlayıb yadda saxlayın.');
    } catch (cause) {
      if (active.current === controller) setStatus(controller.signal.aborted ? 'Analiz dayandırıldı. Hesabat dəyişdirilmədi.' : cause instanceof Error ? cause.message : 'Analiz tamamlanmadı.');
    } finally {if(active.current===controller){active.current=null;setBusy(false);}}
  };
  const current = images[Math.min(index, Math.max(0, images.length - 1))];
  useEffect(() => { setIndex(0); }, [images]);
  useEffect(() => {
    let alive = true;
    setPreview(''); setError('');
    if (current) void renderReportImage(current, windowMode,manualWindow?{ww,wl}:undefined).then(value => { if (alive) setPreview(value); })
      .catch(cause => { if (alive) setError(cause instanceof Error ? cause.message : String(cause)); });
    return () => { alive = false; };
  }, [current, windowMode,manualWindow,ww,wl]);
  return <div className="report-assistant">
    <div className="assistant-heading"><Sparkles size={21}/><strong>{tr('ui.ai_assistant_eb79d')}</strong><button type="button" onClick={openAiSettings} aria-label={tr('ui.ai_settings_b1308')}><Settings2 size={18}/></button></div>
    <p className="assistant-selection">{new Set(images.map(image => image.seriesUID)).size} {tr('ui.series_cbc9e')}{images.length} {tr('ui.images_992d4')}</p>
    {!!images.length && <div className="assistant-preview">
      <div className="assistant-image">{preview ? <img src={preview} alt={`${current.seriesName} · ${index + 1}-ci görüntü`}/> : <p role="status">{error || 'Görüntü hazırlanır…'}</p>}</div>
      <div className="assistant-window-controls"><label><input type="checkbox" checked={manualWindow} disabled={busy} onChange={e=>setManualWindow(e.target.checked)}/> WW / WL</label><label>WW<input aria-label="AI WW" type="number" min="1" max="65536" value={ww} disabled={!manualWindow||busy} onChange={e=>setWw(Math.max(1,Math.min(65536,+e.target.value||1)))}/></label><label>WL<input aria-label="AI WL" type="number" min="-65536" max="65536" value={wl} disabled={!manualWindow||busy} onChange={e=>setWl(Math.max(-65536,Math.min(65536,+e.target.value||0)))}/></label></div><div className="assistant-navigation"><button aria-label={tr('ui.previous_image_a07ca')} disabled={index === 0} onClick={() => setIndex(value => value - 1)}><ChevronLeft size={18}/></button><span>{index + 1} / {images.length} · {current.seriesName}</span><button aria-label={tr('ui.next_image_0b8ca')} disabled={index >= images.length - 1} onClick={() => setIndex(value => value + 1)}><ChevronRight size={18}/></button></div>
    </div>}
    <label className="assistant-instruction">{tr('ui.additional_instructions_8b533')}<textarea aria-label={tr('ui.additional_ai_instructions_89d7a')} value={instruction} onChange={event => onInstruction(event.target.value)} disabled={busy} maxLength={8000} rows={4} placeholder={tr('ui.for_example_draft_a_bronchitis_report_6bb65')}/></label>
    <button className="assistant-analyze" disabled={busy || !enabled || !configured || (!images.length && !instruction.trim())} onClick={() => void analyze()} aria-describedby="assistant-connection"><Sparkles size={17}/>{tr('ui.review_thoroughly_and_draft_a_report_0de23')}</button>
    {busy&&<button className="assistant-stop" onClick={() => active.current?.abort()}>{tr('ui.cancel_01781')}</button>}
    <p id="assistant-connection" className="assistant-connection" role="status">{status || (configured ? 'Hazırdır. Düyməni basdıqda seçilmiş görüntülər və tapşırıq OpenAI-a göndərilir.' : 'AI ayarlarında OpenAI API açarını daxil edib saxlayın.')}</p>
    <small className="assistant-limitation">{tr('ui.ai_output_is_a_draft_for_radiologist_review_a_0b297')}</small>
  </div>;
}
