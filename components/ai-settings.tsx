'use client';
import {useTranslation as useUiTranslation,translate as tr} from '@/lib/i18n';

import { useEffect, useState } from 'react';
import { aiRequest, type AiSettings as Settings } from '@/lib/ai-client';

export function AiSettings() {
  useUiTranslation();
  const [settings, setSettings] = useState<Settings | null>(null), [key, setKey] = useState('');
  const [model, setModel] = useState('gpt-6-astra'), [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  const [reasoning,setReasoning]=useState<Settings['reasoning']>('low');
  useEffect(() => { let alive = true; void aiRequest<Settings>('settings').then(value => { if(alive){setSettings(value);setReasoning(value.reasoning||'low');setModel(value.configured?value.model:'gpt-6-astra');} }).catch(error => {if(alive)setMessage(error.message);}); return () => {alive=false;}; }, []);
  const action = async (kind: 'save' | 'test' | 'clear') => {
    setBusy(true); setMessage('');
    try {
      if (kind === 'test') {
        const result = await aiRequest<{message:string}>('test', {}); setMessage(result.message);
      } else {
        const next = await aiRequest<Settings>('settings', kind === 'clear' ? {clear:true} : {key,model,reasoning});
        setSettings(next); setReasoning(next.reasoning||'low'); setModel(next.model); setKey('');
        setMessage(kind === 'clear' ? 'API açarı silindi.' : 'AI ayarları saxlanıldı. Proqram yenidən açılanda da qalacaq.');
        window.dispatchEvent(new Event('radaz-ai-change'));
        const channel = new BroadcastChannel('radaz-ai-settings'); channel.postMessage('changed'); channel.close();
      }
    } catch (error) { setMessage(error instanceof Error ? error.message : 'AI ayarları saxlanmadı.'); }
    finally { setBusy(false); }
  };
  return <form className="ai-settings" onSubmit={event => {event.preventDefault();void action('save');}}>
    <p>{tr('ui.the_openai_api_key_is_encrypted_for_your_wind_9ed14')}</p>
    <p className="ai-key-status">{settings?.configured ? 'API açarı saxlanılıb · təhlükəsizlik üçün göstərilmir' : 'API açarı daxil edilməyib'}</p>
    <label>{tr('ui.openai_api_key_ae56f')}<input type="password" name="openai-key" autoComplete="new-password" spellCheck={false} value={key} onChange={event => setKey(event.target.value)} placeholder={settings?.configured ? 'Saxlanmış açarı dəyişmək üçün yeni açar yazın' : 'sk-…'} disabled={busy}/></label>
    <label>ChatGPT / OpenAI modeli<select aria-label="AI modeli" value={model} onChange={event => setModel(event.target.value)} disabled={busy}>{[...new Set(['gpt-6-astra','gpt-6.1-sol','gpt-6.1-terra','gpt-6-luna',model])].map(id=><option key={id} value={id}>{id}</option>)}</select></label>
    <label>Düşünmə səviyyəsi<select aria-label="Düşünmə səviyyəsi" value={reasoning} onChange={event=>setReasoning(event.target.value as Settings['reasoning'])} disabled={busy || !model.startsWith('gpt-6')}><option value="low">Aşağı</option><option value="medium">Orta</option><option value="high">Yüksək</option></select></label>
    <small>{model.startsWith('gpt-6')?'Yüksək səviyyədə cavabın hazırlanması daha uzun çəkə və daha çox API istifadəsi tələb edə bilər.':'Bu model üçün düşünmə səviyyəsi tətbiq edilmir.'} Bu seçimlər API ilə analizə aiddir; ChatGPT saytındakı ayarlar ayrıca idarə olunur.</small>
    <div className="ai-settings-actions"><button type="submit" disabled={busy || (!key.trim() && !settings?.configured)}>{tr('ui.save_78db9')}</button><button type="button" disabled={busy || !settings?.configured || !!key || model !== settings.model || reasoning !== (settings.reasoning||'low')} onClick={() => void action('test')}>{tr('ui.test_connection_87a65')}</button><button type="button" disabled={busy || !settings?.configured} onClick={() => void action('clear')}>{tr('ui.delete_key_70bc1')}</button></div>
    <p role="status">{busy ? 'Gözləyin…' : message}</p>
    <small>{tr('ui.selected_images_and_instructions_are_sent_to_0739a')}</small>
  </form>;
}
