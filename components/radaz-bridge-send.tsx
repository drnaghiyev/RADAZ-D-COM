'use client';
import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, CircleAlert, Network, RotateCw, Send, Square, X } from 'lucide-react';
import { useTranslation } from '@/lib/i18n';
import { bridgeApi, sendBridgeStudy, type BridgeJob, type BridgePacs, type BridgeStudy, type BridgeTarget } from '@/lib/radaz-bridge';

const copy = {
  az: { title: 'RADAZBRIDGE-ə göndər', settings: 'RADAZBRIDGE ayarları', save: 'Saxla', saved: 'Bağlantı ayarları saxlanıldı.', test: 'Saxla və bağlantını yoxla', close: 'Bağla', cancel: 'Dayandır', received: 'fayl qəbul edilib', warning: 'Xəbərdarlıqla göndərildi', complete: 'Göndərildi', stopped: 'Dayandırıldı', failed: 'Xəta', ready: 'Bağlantını bir dəfə sazlayın. Sonra müayinənin sağındakı göndərmə düyməsindən istifadə edin.', testing: 'Bağlantı yoxlanır…', connected: 'DICOM bağlantısı işləyir. Ayarlar saxlanıldı.', progress: 'Göndərilir', preparing: 'Hazırlanır…', retry: 'Yenidən göndər', hint: 'RADAZBRIDGE olan kompüterin lokal IP ünvanını yazın. Bridge ayarlarında bu kompüterin IP-si və Calling AE adı icazəli olmalıdır.', unavailable: 'RADAZ xidmətinə bağlantı alınmadı. Proqramı yeniləyib yenidən açın.', pending: 'Dayandırılır…', percent: 'Göndəriş faizi' },
  en: { title: 'Send to RADAZBRIDGE', settings: 'RADAZBRIDGE settings', save: 'Save', saved: 'Connection settings saved.', test: 'Save and test connection', close: 'Close', cancel: 'Stop', received: 'files acknowledged', warning: 'Sent with warnings', complete: 'Sent', stopped: 'Stopped', failed: 'Error', ready: 'Configure the connection once, then use the send button beside each study.', testing: 'Testing connection…', connected: 'DICOM connection works. Settings saved.', progress: 'Sending', preparing: 'Preparing…', retry: 'Send again', hint: 'Enter the LAN IP of the RADAZBRIDGE computer. Allow this computer’s IP and Calling AE in Bridge settings.', unavailable: 'RADAZ service unavailable. Update and reopen the application.', pending: 'Stopping…', percent: 'Transfer progress' },
  ru: { title: 'Отправить в RADAZBRIDGE', settings: 'Настройки RADAZBRIDGE', save: 'Сохранить', saved: 'Настройки подключения сохранены.', test: 'Сохранить и проверить связь', close: 'Закрыть', cancel: 'Остановить', received: 'файлов принято', warning: 'Отправлено с предупреждением', complete: 'Отправлено', stopped: 'Остановлено', failed: 'Ошибка', ready: 'Настройте подключение один раз, затем используйте кнопку справа от исследования.', testing: 'Проверка связи…', connected: 'DICOM-соединение работает. Настройки сохранены.', progress: 'Отправка', preparing: 'Подготовка…', retry: 'Отправить повторно', hint: 'Укажите локальный IP компьютера с RADAZBRIDGE. Добавьте IP этого компьютера и Calling AE в разрешения Bridge.', unavailable: 'Сервис RADAZ недоступен. Обновите и перезапустите приложение.', pending: 'Остановка…', percent: 'Ход передачи' },
};

type RowTransfer = Pick<BridgeJob, 'sent' | 'total' | 'warnings' | 'error'> & { state: BridgeJob['state'] | 'preparing'; stopping?: boolean };
const studyKey = (study: BridgeStudy, pacs?: BridgePacs) => JSON.stringify([pacs ? [pacs.dicomwebUrl, pacs.host, pacs.port, pacs.aeTitle] : 'archive', study.uid]);

// State belongs to the page, not a table row: filtering, sorting and the archive's
// periodic refresh must not lose an in-flight transfer or its result.
export function useRadazBridgeTransfers(onBusyChange: (busy: boolean) => void) {
  const [states, setStates] = useState<Record<string, RowTransfer>>({});
  const [activeKey, setActiveKey] = useState('');
  const active = useRef<{ key: string; id: string; cancelled: boolean } | null>(null);
  const update = (key: string, value: Partial<RowTransfer>) => setStates(previous => ({ ...previous, [key]: { ...previous[key], ...value } }));
  const send = async (study: BridgeStudy, pacs?: BridgePacs) => {
    if (active.current) return;
    const key = studyKey(study, pacs), transfer = { key, id: '', cancelled: false };
    active.current = transfer; setActiveKey(key); onBusyChange(true);
    update(key, { state: 'preparing', sent: 0, total: study.count, warnings: 0, error: '', stopping: false });
    try {
      const target = await bridgeApi<BridgeTarget>('settings');
      if (transfer.cancelled) { update(key, { state: 'cancelled' }); return; }
      const result = await sendBridgeStudy({ ...study }, target, pacs ? { ...pacs } : undefined,
        job => update(key, { state: job.state, sent: job.sent, total: job.total, warnings: job.warnings, error: job.error }),
        () => transfer.cancelled, id => { transfer.id = id; });
      update(key, { state: result.state, sent: result.sent, total: result.total, warnings: result.warnings, error: result.error });
    } catch (error) {
      update(key, { state: 'failed', error: error instanceof Error ? error.message : String(error) });
    } finally {
      active.current = null; setActiveKey(''); onBusyChange(false);
    }
  };
  const cancel = async () => {
    const transfer = active.current;
    if (!transfer) return;
    transfer.cancelled = true; update(transfer.key, { stopping: true });
    if (transfer.id) await bridgeApi('cancel', { id: transfer.id }).catch(error => update(transfer.key, { error: String(error) }));
  };
  return { states, activeKey, send, cancel };
}

export function RadazBridgeRowSend({ study, pacs, transfers, disabled }: { study: BridgeStudy; pacs?: BridgePacs; transfers: ReturnType<typeof useRadazBridgeTransfers>; disabled?: boolean }) {
  const { language } = useTranslation(), t = copy[language];
  const key = studyKey(study, pacs), result = transfers.states[key], active = transfers.activeKey === key;
  const completed = result?.state === 'completed' || result?.state === 'warning';
  // A final PACS/C-STORE response may still fail after the last file, so reserve
  // 100% for the confirmed terminal result, not merely the expected file count.
  const percent = completed ? 100 : result?.total ? Math.min(99, Math.floor(100 * result.sent / result.total)) : result && ['failed', 'cancelled'].includes(result.state) ? 0 : undefined;
  const label = !result ? '' : result.state === 'failed' ? t.failed : result.state === 'cancelled' ? t.stopped : result.state === 'warning' ? t.warning : completed ? t.complete : result.stopping ? t.pending : result.state === 'preparing' ? t.preparing : t.progress;
  const detail = result ? `${result.sent}${result.total ? ` / ${Math.max(result.total, result.sent)}` : ''} ${t.received}${result.error ? ` · ${result.error}` : ''}` : '';
  return <div className="radazbridge-row" data-state={result?.state || 'idle'} onClick={event => event.stopPropagation()} onDoubleClick={event => event.stopPropagation()}>
    <button type="button" className="radazbridge-row-button" title={active ? t.cancel : result ? t.retry : t.title} aria-label={`${study.patient}: ${active ? t.cancel : t.title}`} disabled={active ? result?.stopping : disabled || !!transfers.activeKey} onClick={() => void (active ? transfers.cancel() : transfers.send(study, pacs))}>
      {active ? <Square size={14}/> : result ? <RotateCw size={16}/> : <Send size={16}/>}
    </button>
    {result && <div className="radazbridge-row-result" role={result.state === 'failed' ? 'alert' : 'status'} title={detail}>
      <div className="radazbridge-row-status"><span>{completed ? result.state === 'warning' ? <CircleAlert size={12}/> : <Check size={12}/> : result.state === 'failed' ? <CircleAlert size={12}/> : null}{label}</span><b>{percent !== undefined ? `${percent}%` : `${result.sent}`}</b></div>
      <progress max={100} value={percent} aria-label={`${study.patient}: ${t.percent}`}/>
      <small>{result.state === 'failed' ? detail : `${result.sent}${result.total ? ` / ${Math.max(result.total, result.sent)}` : ''} ${t.received}`}</small>
    </div>}
  </div>;
}

export function RadazBridgeSettings({ disabled }: { disabled?: boolean }) {
  const { language } = useTranslation(), t = copy[language];
  const dialog = useRef<HTMLDialogElement>(null), working = useRef(false);
  const [opened, setOpened] = useState(false), [busy, setBusy] = useState(false), [ready, setReady] = useState(false);
  const [target, setTarget] = useState<BridgeTarget>({ host: '', port: '11112', aeTitle: 'RADAZBRIDGE', callingAe: 'RADAZ' });
  const [status, setStatus] = useState(''), [error, setError] = useState(false);
  const open = async () => {
    setError(false); setStatus(t.ready); setReady(false); setOpened(true);
    try { setTarget(await bridgeApi<BridgeTarget>('settings')); setReady(true); }
    catch { setStatus(t.unavailable); setError(true); }
  };
  const close = () => { if (!working.current) { dialog.current?.close(); setOpened(false); } };
  const save = async (test: boolean) => {
    if (working.current) return;
    working.current = true; setBusy(true); setError(false);
    if (test) setStatus(t.testing);
    try { await bridgeApi(test ? 'test' : 'settings', target); setStatus(test ? t.connected : t.saved); }
    catch (error) { setStatus(error instanceof Error ? error.message : String(error)); setError(true); }
    finally { working.current = false; setBusy(false); }
  };
  return <>
    <button type="button" title={t.settings} aria-label={t.settings} disabled={disabled} onClick={() => void open()}><Network size={18}/><span>{t.settings}</span></button>
    {opened && createPortal(<dialog ref={element => { dialog.current = element; if (element && !element.open) element.showModal(); }} className="radazbridge-dialog" aria-labelledby="radazbridge-title" onCancel={event => { event.preventDefault(); close(); }}>
      <div className="radazbridge-heading"><h2 id="radazbridge-title">{t.settings}</h2><button aria-label={t.close} disabled={busy} onClick={close}><X size={20}/></button></div>
      <p className="radazbridge-hint">{t.hint}</p>
      <fieldset disabled={busy || !ready} className="radazbridge-fields">
        <label>RADAZBRIDGE IP / host<input value={target.host} onChange={event => setTarget({ ...target, host: event.currentTarget.value })}/></label>
        <label>Port<input inputMode="numeric" value={target.port} onChange={event => setTarget({ ...target, port: event.currentTarget.value })}/></label>
        <label>Called AE Title<input maxLength={16} value={target.aeTitle} onChange={event => setTarget({ ...target, aeTitle: event.currentTarget.value })}/></label>
        <label>Calling AE Title<input maxLength={16} value={target.callingAe} onChange={event => setTarget({ ...target, callingAe: event.currentTarget.value })}/></label>
      </fieldset>
      <div className="radazbridge-result" role={error ? 'alert' : 'status'}>{status}</div>
      <div className="radazbridge-actions"><button disabled={busy || !ready} onClick={() => void save(true)}>{t.test}</button><button className="records-primary" disabled={busy || !ready} onClick={() => void save(false)}>{t.save}</button><button disabled={busy} onClick={close}>{t.close}</button></div>
    </dialog>, document.body)}
  </>;
}
