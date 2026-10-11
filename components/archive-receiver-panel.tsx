'use client';
import {useTranslation as useUiTranslation,translate as tr} from '@/lib/i18n';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Database, Settings2, X } from 'lucide-react';
import { configureReceiver, receiverStatus, type ArchiveReceiverStatus } from '@/lib/disk-archive';

export function ArchiveReceiverPanel() {
  useUiTranslation();
  const [status, setStatus] = useState<ArchiveReceiverStatus | null>(null);
  const [open, setOpen] = useState(false);
  const dialog=useRef<HTMLDialogElement>(null);
  useEffect(()=>{if(open)dialog.current?.showModal();else dialog.current?.close();},[open]);
  const [aeTitle, setAeTitle] = useState('RADAZ_ARCHIVE');
  const [port, setPort] = useState('11113');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let disposed = false;
    const refresh = () => void receiverStatus().then(value => {
      if (disposed) return;
      setStatus(value); setError('');
      if (!open) { setAeTitle(value.aeTitle); setPort(String(value.port)); }
    }).catch(reason => { if (!disposed) { setStatus(null); setError(reason instanceof Error ? reason.message : String(reason)); } });
    refresh(); const timer = setInterval(refresh, 10000);
    return () => { disposed = true; clearInterval(timer); };
  }, [open]);
  const save = async (enabled: boolean) => {
    setBusy(true); setError('');
    try { const value = await configureReceiver({ aeTitle: aeTitle.trim(), port: Number(port), enabled }); setStatus(value); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  };
  return <><button type="button" title={tr('ui.receiver_settings_01c07')} aria-label={tr('ui.receiver_settings_01c07')} aria-haspopup="dialog" aria-expanded={open} onClick={()=>setOpen(true)}><Settings2 size={18}/><span>{tr('ui.receiver_settings_01c07')}</span></button>
   {open && createPortal(<dialog ref={dialog} className="product-dialog receiver-dialog" aria-label={tr('ui.receiver_settings_01c07')} onCancel={()=>setOpen(false)} onClick={event=>{if(event.target===dialog.current)setOpen(false);}}>
    <header><Database size={24}/><h2>{tr('ui.receiver_settings_01c07')}</h2><button type="button" aria-label={tr('ui.close_receiver_settings_891cf')} onClick={()=>setOpen(false)}><X size={20}/></button></header><div className="product-dialog-body"><section className="archive-receiver" aria-label={tr('ui.permanent_dicom_archive_67c02')}>
    <div className="receiver-summary"><Database size={18}/><strong>{status?.running ? 'DICOM qəbulu hazırdır' : status ? 'DICOM qəbul dayandırılıb' : 'Disk arxivi bağlı deyil'}</strong>
      {status && <span>AE: <b>{status.aeTitle}</b> · IP: <b>{status.addresses.join(', ') || '127.0.0.1'}</b> · Port: <b>{status.port}</b> · {status.instanceCount} {tr('ui.files_46c6f')}</span>}
    </div>
    <div className="receiver-settings">
      <p>{tr('ui.add_this_computer_as_a_destination_on_the_x_r_9e979')}</p>
      {status && <section className="receiver-destination" aria-label={tr('ui.sending_settings_on_the_cr_device_85d4c')}>
        <h3>{tr('ui.settings_to_enter_on_the_cr_device_82543')}</h3>
        <dl><dt>{tr('ui.ip_address_3c3de')}</dt><dd>{status.addresses.length ? status.addresses.join(' / ') : 'Lokal şəbəkə IP-si tapılmadı'}</dd>
          <dt>{tr('ui.called_ae_title_cfc7f')}</dt><dd><strong>{status.aeTitle}</strong></dd>
          <dt>{tr('ui.port_72e9a')}</dt><dd><strong>{status.port}</strong></dd>
          <dt>{tr('ui.calling_ae_title_30d0d')}</dt><dd>{tr('ui.the_cr_device_s_own_ae_name_b8128')}</dd></dl>
        <p className="receiver-port-note">{tr('ui.the_port_must_match_on_both_sides_26055')}{status.port === 11113 ? 'CR-də 104 yazılıbsa, onu 11113 edin.' : `CR-də portu ${status.port} yazın.`} {tr('ui.5173_is_for_the_browser_only_8f10e')}</p>
        <p className="receiver-calling-note">{tr('ui.calling_ae_title_belongs_to_the_sending_cr_de_34f8c')}</p>
        {(!status.running || aeTitle.trim() !== status.aeTitle || Number(port) !== status.port) && <p role="status">{tr('ui.this_table_shows_saved_settings_after_changes_cf6ba')}</p>}
      </section>}
      <form className="receiver-fields" onSubmit={event => { event.preventDefault(); void save(true); }}>
        <label>{tr('ui.radaz_ae_title_b43e9')}<input aria-label={tr('ui.local_archive_ae_title_8b727')} required value={aeTitle} maxLength={16} onChange={event => setAeTitle(event.target.value)}/></label><label>{tr('ui.dicom_port_f71dc')}<input aria-label={tr('ui.local_archive_dicom_port_e8f19')} required type="number" min="1" max="65535" step="1" value={port} onChange={event => setPort(event.target.value)}/></label>
        <button type="submit" disabled={busy || !status}>{busy ? 'Saxlanılır…' : 'Saxla və qəbulu başlat'}</button>
        <button type="button" disabled={busy || !status?.running} onClick={() => void save(false)}>{tr('ui.stop_receiver_f02e2')}</button>
      </form>
      <p>{tr('ui.default_port_11113_if_the_cr_port_cannot_be_c_04f77')}</p>
      {status && <><p>{tr('ui.database_c7e7c')}<code>{status.databasePath}</code><br/>{tr('ui.dicom_files_bf069')}<code>{status.storagePath}</code></p>
        <p>{tr('ui.phone_tablet_52c6f')}{status.addresses.map(address => <a key={address} href={`http://${address}:5173/`} target="_blank" rel="noreferrer">http://{address}:5173/ </a>)} {tr('ui._connect_to_the_same_local_network_521d9')}</p>
        <p>{tr('ui.in_windows_firewall_allow_tcp_only_on_a_trust_9dc2d')}{status.port} {tr('ui._dicom_and_5173_viewer_back_up_the_database_a_57d9c')}</p></>}
    </div>
    {(error || status?.error) && <p className="receiver-error" role="status">{error || status?.error}</p>}
  </section></div><footer><button type="button" onClick={()=>setOpen(false)}>{tr('ui.close_c1cf9')}</button></footer></dialog>,document.body)}</>;
}
