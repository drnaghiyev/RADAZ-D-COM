'use client';
import {useTranslation as useUiTranslation,translate as tr} from '@/lib/i18n';

import { OutputPageHeader } from '@/components/output-page-header';
import { useEffect, useState } from 'react';
import { Printer, ArrowLeft, Radio } from 'lucide-react';
import { defaultPrinter, loadPrinterSettings, savePrinterSettings } from '@/lib/printer-settings';
import { outputRequest } from '@/lib/output-jobs';

export default function PrinterSettingsPage() {
  useUiTranslation();
  useEffect(() => { document.title = 'RADAZ · Printer ayarları'; }, []);
  const [settings, setSettings] = useState(defaultPrinter), [printers, setPrinters] = useState<string[]>([]);
  const [status, setStatus] = useState('Ayarlar oxunur…'), [busy, setBusy] = useState(false);
  useEffect(() => { void loadPrinterSettings().then(setSettings); void outputRequest<{ printers: string[] }>('/output-devices').then(value => { setPrinters(value.printers); setStatus('Ayarlar bu RADAZ serverinə qoşulan cihazlar üçün ortaqdır.'); }).catch(error => setStatus(String(error))); }, []);
  const save = async () => { setBusy(true); try { setSettings(await savePrinterSettings(settings)); setStatus('Printer ayarları saxlanıldı'); } catch(error) { setStatus(String(error)); } finally { setBusy(false); } };
  const test = async () => { setBusy(true); try { const value = await outputRequest<{message:string}>('/printer-test',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(settings)}); setStatus(value.message); } catch(error) { setStatus(String(error)); } finally { setBusy(false); } };
  return <main className="output-settings-page"><OutputPageHeader kind="settings"/><form onSubmit={event => { event.preventDefault(); void save(); }}>
    <section><h2><Printer size={20}/> {tr('ui.standard_printer_2b033')}</h2><p>{tr('ui.choose_printer_copies_and_paper_in_the_browse_a4362')}</p><label>{tr('ui.default_paper_becb9')}<select value={settings.paperSize} onChange={e => setSettings({...settings,paperSize:e.target.value})}><option>A4</option><option>A3</option><option>Letter</option></select></label><p>{tr('ui.on_the_radaz_computer_83efc')}{printers.join(', ') || 'Printer siyahısı əlçatan deyil'}</p></section>
    <section><h2><Radio size={20}/> {tr('ui.dicom_printer_0ced9')}</h2><div className="output-fields">
      <label>{tr('ui.printer_ip_host_60023')}<input placeholder="192.168.1.50" value={settings.host} onChange={e => setSettings({...settings,host:e.target.value})}/></label>
      <label>{tr('ui.port_72e9a')}<input required type="number" min="1" max="65535" value={settings.port} onChange={e => setSettings({...settings,port:e.target.value})}/></label>
      <label>{tr('ui.printer_ae_title_06d85')}<input required maxLength={16} value={settings.aeTitle} onChange={e => setSettings({...settings,aeTitle:e.target.value.toUpperCase()})}/></label>
      <label>{tr('ui.radaz_ae_title_b43e9')}<input required maxLength={16} value={settings.callingAe} onChange={e => setSettings({...settings,callingAe:e.target.value.toUpperCase()})}/></label>
      <label>{tr('ui.media_d3571')}<select value={settings.mediumType} onChange={e => setSettings({...settings,mediumType:e.target.value})}><option>BLUE FILM</option><option>CLEAR FILM</option><option>PAPER</option></select></label>
      <label>{tr('ui.number_of_copies_74fb6')}<input type="number" min="1" max="99" value={settings.copies} onChange={e => setSettings({...settings,copies:+e.target.value})}/></label>
      <label>{tr('ui.film_size_298cb')}<select value={settings.filmSize} onChange={e => setSettings({...settings,filmSize:e.target.value})}>{['8INX10IN','10INX12IN','11INX14IN','14INX17IN','A4','A3'].map(value => <option key={value}>{value}</option>)}</select></label>
      <label>{tr('ui.default_layout_c925b')}<select value={settings.layout} onChange={e => setSettings({...settings,layout:e.target.value})}>{['1,1','1,2','2,2','2,3','2,4','3,3','3,4','4,4'].map(value => <option key={value} value={value}>{value.replace(',',' × ')}</option>)}</select></label>
      <label>{tr('ui.orientation_4eb06')}<select value={settings.orientation} onChange={e => setSettings({...settings,orientation:e.target.value as 'PORTRAIT'|'LANDSCAPE'})}><option value="PORTRAIT">{tr('ui.portrait_0787f')}</option><option value="LANDSCAPE">{tr('ui.landscape_a7bc2')}</option></select></label>
    </div><button type="button" disabled={busy || !settings.host} onClick={() => void test()}>{tr('ui.test_connection_no_printing_54092')}</button></section>
    <p role="status">{status}</p><button type="submit" className="output-primary" disabled={busy}>{busy ? 'Gözləyin…' : 'Ayarları yadda saxla'}</button>
  </form></main>;
}
