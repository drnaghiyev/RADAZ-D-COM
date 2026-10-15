'use client';
import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Send, X } from 'lucide-react';
import { useTranslation } from '@/lib/i18n';
import { bridgeApi, sendBridgeStudy, type BridgeJob, type BridgePacs, type BridgeStudy, type BridgeTarget } from '@/lib/radaz-bridge';

const copy = {
  az: { title: 'RADAZBRIDGE-ə göndər', send: 'Göndər', test: 'Bağlantını yoxla', close: 'Bağla', cancel: 'Dayandır', study: 'müayinə', received: 'fayl qəbul edilib', warning: 'xəbərdarlıq', complete: 'Göndəriş tamamlandı', stopped: 'Göndəriş dayandırıldı', failed: 'Göndəriş tamamlanmadı', ready: 'Ünvanı yoxlayıb göndərin.', testing: 'Bağlantı yoxlanır…', connected: 'DICOM bağlantısı işləyir.', progress: 'Göndərilir…', hint: 'Bridge bu kompüterdədirsə IP: 127.0.0.1. Başqa kompüterdədirsə onun lokal IP ünvanını yazın. Bridge ayarlarında bu kompüterin IP-si və Calling AE adı icazəli olmalıdır.', scope: 'Seçilmiş müayinələrin bütün orijinal DICOM faylları göndərilir. Qəbul təsdiqi Bridge-ə aiddir; bulud sinxronizasiyasını Bridge panelində izləyin.', unavailable: 'RADAZ xidmətinə bağlantı alınmadı. Proqramı yeniləyib yenidən açın.', pending: 'Cari faylın nəticəsi gözlənilir…' },
  en: { title: 'Send to RADAZBRIDGE', send: 'Send', test: 'Test connection', close: 'Close', cancel: 'Stop', study: 'studies', received: 'files acknowledged', warning: 'warnings', complete: 'Transfer completed', stopped: 'Transfer stopped', failed: 'Transfer incomplete', ready: 'Check the destination and send.', testing: 'Testing connection…', connected: 'DICOM connection works.', progress: 'Sending…', hint: 'Use 127.0.0.1 for a Bridge on this computer, or the LAN IP of the Bridge computer. Allow this computer’s IP and Calling AE in Bridge settings.', scope: 'All original DICOM files in the selected studies are sent. Acknowledgements confirm Bridge reception; check cloud synchronization in the Bridge panel.', unavailable: 'RADAZ service unavailable. Update and reopen the application.', pending: 'Waiting for the current file’s result…' },
  ru: { title: 'Отправить в RADAZBRIDGE', send: 'Отправить', test: 'Проверить связь', close: 'Закрыть', cancel: 'Остановить', study: 'исследований', received: 'файлов принято', warning: 'предупреждений', complete: 'Передача завершена', stopped: 'Передача остановлена', failed: 'Передача не завершена', ready: 'Проверьте адрес получателя.', testing: 'Проверка связи…', connected: 'DICOM-соединение работает.', progress: 'Отправка…', hint: 'Для Bridge на этом компьютере укажите 127.0.0.1, иначе — локальный IP компьютера с Bridge. Добавьте IP этого компьютера и Calling AE в разрешения Bridge.', scope: 'Передаются все исходные DICOM-файлы выбранных исследований. Подтверждение относится к приёму Bridge; синхронизация с облаком отображается в панели Bridge.', unavailable: 'Сервис RADAZ недоступен. Обновите и перезапустите приложение.', pending: 'Ожидается результат текущего файла…' },
};

export function RadazBridgeSend({ studies, pacs, disabled, onBusyChange }: { studies: BridgeStudy[]; pacs?: BridgePacs; disabled?: boolean; onBusyChange: (busy: boolean) => void }) {
  const { language } = useTranslation(), t = copy[language];
  const dialog = useRef<HTMLDialogElement>(null), cancelled = useRef(false), running = useRef(false), jobId = useRef('');
  const [opened, setOpened] = useState(false), [busy, setBusy] = useState(false), [ready, setReady] = useState(false);
  const [batch, setBatch] = useState<BridgeStudy[]>([]), [source, setSource] = useState<BridgePacs>();
  const [target, setTarget] = useState<BridgeTarget>({ host: '127.0.0.1', port: '11112', aeTitle: 'RADAZBRIDGE', callingAe: 'RADAZ' });
  const [status, setStatus] = useState(''), [sent, setSent] = useState(0), [warnings, setWarnings] = useState(0);
  const [error, setError] = useState(false);
  const open = async () => {
    setBatch([...studies]); setSource(pacs ? { ...pacs } : undefined); setSent(0); setWarnings(0); setError(false); setStatus(t.ready); setReady(false); setOpened(true);
    try { setTarget(await bridgeApi<BridgeTarget>('settings')); setReady(true); }
    catch { setStatus(t.unavailable); setError(true); }
  };
  const close = () => { if (!running.current) { dialog.current?.close(); setOpened(false); } };
  const setRunning = (value: boolean) => { running.current = value; setBusy(value); onBusyChange(value); };
  const test = async () => {
    if (running.current) return;
    setRunning(true); setStatus(t.testing); setError(false);
    try { await bridgeApi('test', target); setStatus(t.connected); }
    catch (error) { setStatus(error instanceof Error ? error.message : String(error)); setError(true); }
    finally { setRunning(false); }
  };
  const send = async () => {
    if (running.current) return;
    setRunning(true); cancelled.current = false; jobId.current = ''; setError(false); setSent(0); setWarnings(0); setStatus(t.progress);
    let done = 0, warned = 0;
    try {
      for (const [index, study] of batch.entries()) {
        if (cancelled.current) break;
        setStatus(`${t.progress} ${index + 1}/${batch.length}`);
        const result = await sendBridgeStudy(study, target, source, (job: BridgeJob) => { setSent(done + job.sent); setWarnings(warned + job.warnings); }, () => cancelled.current, id => { jobId.current = id; });
        done += result.sent; warned += result.warnings;
        if (result.state === 'cancelled') { cancelled.current = true; break; }
      }
      setStatus(cancelled.current ? t.stopped : t.complete);
    } catch (error) { setStatus(`${t.failed}: ${error instanceof Error ? error.message : String(error)}`); setError(true); }
    finally { jobId.current = ''; setRunning(false); }
  };
  const cancel = async () => {
    cancelled.current = true; setStatus(t.pending);
    if (jobId.current) await bridgeApi('cancel', { id: jobId.current }).catch(error => { setStatus(String(error)); });
  };
  return <>
    <button type="button" title={t.title} aria-label={t.title} disabled={disabled || !studies.length} onClick={() => void open()}><Send size={18}/><span>{t.title}</span></button>
    {opened && createPortal(<dialog ref={element => { dialog.current = element; if (element && !element.open) element.showModal(); }} className="radazbridge-dialog" aria-labelledby="radazbridge-title" onCancel={event => { event.preventDefault(); close(); }}>
      <div className="radazbridge-heading"><h2 id="radazbridge-title">{t.title}</h2><button aria-label={t.close} disabled={busy} onClick={close}><X size={20}/></button></div>
      <p>{batch.length} {t.study} · {batch.reduce((n, study) => n + study.count, 0)} DICOM</p>
      <ul className="radazbridge-studies">{batch.map(study => <li key={study.uid}>{study.patient} <small>{study.count} DICOM</small></li>)}</ul>
      <fieldset disabled={busy || !ready} className="radazbridge-fields">
        <label>RADAZBRIDGE IP / host<input value={target.host} onChange={event => setTarget({ ...target, host: event.currentTarget.value })}/></label>
        <label>Port<input inputMode="numeric" value={target.port} onChange={event => setTarget({ ...target, port: event.currentTarget.value })}/></label>
        <label>Called AE Title<input maxLength={16} value={target.aeTitle} onChange={event => setTarget({ ...target, aeTitle: event.currentTarget.value })}/></label>
        <label>Calling AE Title<input maxLength={16} value={target.callingAe} onChange={event => setTarget({ ...target, callingAe: event.currentTarget.value })}/></label>
      </fieldset>
      <p className="radazbridge-hint">{t.hint}</p><p className="radazbridge-hint">{t.scope}</p>
      <div className="radazbridge-result" role={error ? 'alert' : 'status'}><strong>{status}</strong><span>{sent} {t.received}{warnings > 0 ? ` · ${warnings} ${t.warning}` : ''}</span></div>
      <div className="radazbridge-actions"><button disabled={busy || !ready} onClick={() => void test()}>{t.test}</button>{busy ? <button onClick={() => void cancel()}>{t.cancel}</button> : <button className="records-primary" disabled={!ready} onClick={() => void send()}><Send size={16}/>{t.send}</button>}<button disabled={busy} onClick={close}>{t.close}</button></div>
    </dialog>, document.body)}
  </>;
}
