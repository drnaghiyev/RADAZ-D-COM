'use client';
import {useTranslation as useUiTranslation,translate as tr} from '@/lib/i18n';


import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Sparkles, Settings2 } from 'lucide-react';
import { renderReportImage, defaultReportWindow, reportWindowKey, type ReportWindow, type ReportImage } from '@/lib/report-dicom';
import {ChatGPTTransfer} from './chatgpt-transfer';
import profile from '../bridge/radiology-profile.json' with {type:'json'};
import { aiRequest, openAiSettings, type AiSettings } from '@/lib/ai-client';

export function ReportAssistant({ images, windowMode, instruction, onInstruction, onReport, enabled }: {
  images: ReportImage[]; windowMode: 'metadata' | 'lung' | 'soft' | 'bone'; instruction: string; onInstruction: (text: string) => void;
  onReport: (text: string) => void; enabled: boolean;
}) {
  useUiTranslation();
  const [index, setIndex] = useState(0), [preview, setPreview] = useState(''), [error, setError] = useState('');
  const [configured, setConfigured] = useState(false), [busy, setBusy] = useState(false), [status, setStatus] = useState('');
  const [provider,setProvider]=useState<'api'|'chatgpt'>('api');
  useEffect(()=>{if(new URLSearchParams(location.search).get('provider')==='chatgpt')setProvider('chatgpt');},[]);
  const [windows,setWindows]=useState<Record<string,ReportWindow>>({});
  const imageArea=useRef<HTMLDivElement>(null),pointer=useRef<{id:number;x:number;y:number;window:ReportWindow}|null>(null);
  const windowForImage=useCallback((image:ReportImage)=>windows[reportWindowKey(image)],[windows]);
  const current=images[Math.min(index,Math.max(0,images.length-1))];
  const selectedWindow=current?(windowForImage(current)||defaultReportWindow(current,windowMode)):{ww:400,wl:50};
  const {ww,wl}=selectedWindow,manualWindow=!!current&&!!windowForImage(current);
  const setWindow=(value:ReportWindow)=>{if(current&&!busy)setWindows(old=>({...old,[reportWindowKey(current)]:value}));};
  const resetWindow=()=>{if(current)setWindows(old=>{const next={...old};delete next[reportWindowKey(current)];return next;});};
  const wheelAction=useRef((_delta:number)=>{});
  wheelAction.current=delta=>{if(busy||!current)return;const peers=images.map((image,i)=>({image,i})).filter(p=>p.image.seriesUID===current.seriesUID);const at=peers.findIndex(p=>p.i===index);setIndex(peers[Math.max(0,Math.min(peers.length-1,at+(delta>0?1:-1)))].i);};
  useEffect(()=>{const node=imageArea.current;if(!node)return;let accumulated=0;
    const wheel=(e:WheelEvent)=>{e.preventDefault();accumulated+=e.deltaY*(e.deltaMode===1?16:e.deltaMode===2?200:1);if(Math.abs(accumulated)>=35){wheelAction.current(accumulated);accumulated=0;}};
    node.addEventListener('wheel',wheel,{passive:false});return()=>node.removeEventListener('wheel',wheel);
  },[!!images.length]);
  const previewImage=useRef<ReportImage|undefined>(undefined);
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
    const modalities=[...new Set(images.map(image=>image.modality))].map(m=>['CT','MR','CR','DX','XA','RF','MG','US','OT','PT','NM','XR'].includes(m)?m:'DICOM');
    const request = (body: Record<string,unknown>) => aiRequest<{text:string}>('report',{...body,modalities},controller.signal);
    try {
      if (images.some(image => !image.supported)) throw new Error('Seçimdə analiz üçün dəstəklənməyən görüntülər var. Həmin seriyaları seçimdən çıxarın.');
      const series = [...new Set(images.map(image => image.seriesUID))];
      let observations = '';
      for (let start = 0; start < images.length; start += 8) {
        controller.signal.throwIfAborted();
        const batch = [];
        for (let i = start; i < Math.min(start+8,images.length); i++) {
          setStatus(`Görüntülər hazırlanır: ${i+1} / ${images.length}`);
          const data = await renderReportImage(images[i],windowMode,windowForImage(images[i]));controller.signal.throwIfAborted();
          batch.push({data,label:`Görüntü ${i+1}/${images.length}; seriya ${series.indexOf(images[i].seriesUID)+1}; kəsit ${images[i].instance}; ${images[i].modality}; window ${windowForImage(images[i])?`WW ${windowForImage(images[i])!.ww} WL ${windowForImage(images[i])!.wl}`:windowMode}`});
        }
        setStatus(`Görüntülər incələnir: ${start+1}–${start+batch.length} / ${images.length}`);
        observations += '\n' + (await request({instruction,images:batch,phase:'observations'})).text;
        if (observations.length > 110000) {
          setStatus('Seriyaların müşahidələri birləşdirilir…');
          observations = (await request({phase:'summary',instruction:'Aralıq müşahidələri yığcamlaşdır; bütün tapıntıları, görüntü nömrələrini və qeyri-müəyyənliyi saxla. Bu son hesabat deyil.',observations})).text;
        }
      }
      setStatus('Yekun hesabat layihəsi yazılır…');
      const result = await request({instruction,observations,phase:'report'});controller.signal.throwIfAborted();
      if (active.current !== controller) return;
      onReport(result.text);setStatus('AI layihəsi redaktora əlavə edildi. Yoxlayıb yadda saxlayın.');
    } catch (cause) {
      if (active.current === controller) setStatus(controller.signal.aborted ? 'Analiz dayandırıldı. Hesabat dəyişdirilmədi.' : cause instanceof Error ? cause.message : 'Analiz tamamlanmadı.');
    } finally {if(active.current===controller){active.current=null;setBusy(false);}}
  };
  useEffect(() => { setIndex(0); }, [images]);
  useEffect(() => {
    let alive = true;
    setError('');if(!current)setPreview('');
    const timer=setTimeout(()=>{if (current) void renderReportImage(current, windowMode,windowForImage(current)).then(value => { if (alive) {previewImage.current=current;setPreview(value);} })
      .catch(cause => { if (alive) {setPreview('');setError(cause instanceof Error ? cause.message : String(cause));} });},40);
    return () => { alive = false;clearTimeout(timer); };
  }, [current, windowMode,windowForImage]);
  return <div className="report-assistant">
    <div className="assistant-heading"><Sparkles size={21}/><strong>{tr('ui.ai_assistant_eb79d')}</strong><button type="button" onClick={openAiSettings} aria-label={tr('ui.ai_settings_b1308')}><Settings2 size={18}/></button></div>
    <p className="assistant-selection">{new Set(images.map(image => image.seriesUID)).size} {tr('ui.series_cbc9e')} {images.length} {tr('ui.images_992d4')}</p>
    {!!images.length && <div className="assistant-preview">
      <label className="assistant-series">Seriya<select aria-label="AI seriyası" value={current.seriesUID} disabled={busy} onChange={e=>setIndex(images.findIndex(im=>im.seriesUID===e.target.value))}>{[...new Map(images.map(im=>[im.seriesUID,im])).values()].map(im=><option key={im.seriesUID} value={im.seriesUID}>{im.modality} · {im.seriesName}</option>)}</select></label>
      <div className="assistant-image" ref={imageArea} tabIndex={0} aria-label="Görüntü: sürükləmə WW/WL, təkər kəsiklər" onPointerDown={e=>{if(e.button!==0||busy)return;e.preventDefault();e.currentTarget.setPointerCapture(e.pointerId);pointer.current={id:e.pointerId,x:e.clientX,y:e.clientY,window:selectedWindow};}} onPointerMove={e=>{const start=pointer.current;if(!start||start.id!==e.pointerId)return;const gain=Math.max(1,start.window.ww/200);setWindow({ww:Math.max(1,Math.min(65536,start.window.ww+(e.clientX-start.x)*gain)),wl:Math.max(-65536,Math.min(65536,start.window.wl+(e.clientY-start.y)*gain))});}} onPointerUp={e=>{pointer.current=null;if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId);}} onPointerCancel={()=>{pointer.current=null;}} onLostPointerCapture={()=>{pointer.current=null;}}>{preview&&previewImage.current===current ? <img src={preview} alt={`${current.seriesName} · ${index + 1}-ci görüntü`}/> : <p role="status">{error || 'Görüntü hazırlanır…'}</p>}</div>
      <div className="assistant-window-controls"><label><input type="checkbox" checked={manualWindow} disabled={busy} onChange={e=>e.target.checked?setWindow(selectedWindow):resetWindow()}/> WW / WL</label><label>WW<input aria-label="AI WW" type="number" min="1" max="65536" value={ww} disabled={busy} onChange={e=>setWindow({ww:Math.max(1,Math.min(65536,+e.target.value||1)),wl})}/></label><label>WL<input aria-label="AI WL" type="number" min="-65536" max="65536" value={wl} disabled={busy} onChange={e=>setWindow({ww,wl:Math.max(-65536,Math.min(65536,+e.target.value||0))})}/></label></div><div className="assistant-navigation"><button aria-label={tr('ui.previous_image_a07ca')} disabled={index === 0} onClick={() => setIndex(value => value - 1)}><ChevronLeft size={18}/></button><span>{index + 1} / {images.length} · {current.seriesName}</span><button aria-label={tr('ui.next_image_0b8ca')} disabled={index >= images.length - 1} onClick={() => setIndex(value => value + 1)}><ChevronRight size={18}/></button></div>
    </div>}
    <small className="assistant-mouse-help">Sol düymə ilə sürükləyin: kontrast / parlaqlıq. Təkər: seçilmiş seriyanın kəsikləri.</small>
    <p className="assistant-profile">{profile.name} · {profile.version} · hesabat qaydaları</p>
    <div className="assistant-providers" role="group" aria-label="Hesabat mənbəyi"><button aria-pressed={provider==='api'} disabled={busy} onClick={()=>setProvider('api')}>OpenAI API</button><button aria-pressed={provider==='chatgpt'} disabled={busy} onClick={()=>setProvider('chatgpt')}>ChatGPT</button></div>
    <label className="assistant-instruction">{tr('ui.additional_instructions_8b533')}<textarea aria-label={tr('ui.additional_ai_instructions_89d7a')} value={instruction} onChange={event => onInstruction(event.target.value)} disabled={busy} maxLength={8000} rows={4} placeholder={tr('ui.for_example_draft_a_bronchitis_report_6bb65')}/></label>
    {provider==='chatgpt'?<ChatGPTTransfer images={images} windowMode={windowMode} modality={[...new Set(images.map(im=>im.modality))].join(',')} onPaste={onReport} instruction={instruction} windowForImage={windowForImage} enabled={enabled}/>:<>
    <button className="assistant-analyze" disabled={busy || !enabled || !configured || (!images.length && !instruction.trim())} onClick={() => void analyze()} aria-describedby="assistant-connection"><Sparkles size={17}/>{tr('ui.review_thoroughly_and_draft_a_report_0de23')}</button>
    {busy&&<button className="assistant-stop" onClick={() => active.current?.abort()}>{tr('ui.cancel_01781')}</button>}
    <p id="assistant-connection" className="assistant-connection" role="status">{status || (configured ? 'Hazırdır. Düyməni basdıqda seçilmiş görüntülər və tapşırıq OpenAI-a göndərilir.' : 'AI ayarlarında OpenAI API açarını daxil edib saxlayın.')}</p>
    </>}
    <small className="assistant-limitation">{tr('ui.ai_output_is_a_draft_for_radiologist_review_a_0b297')}</small>
  </div>;
}
