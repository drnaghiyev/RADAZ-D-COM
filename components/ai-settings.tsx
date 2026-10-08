'use client';
import { useEffect, useState } from 'react';
import { aiRequest, type AiSettings as Settings } from '@/lib/ai-client';

export function AiSettings() {
  const [settings, setSettings] = useState<Settings | null>(null), [key, setKey] = useState('');
  const [model, setModel] = useState('gpt-4.1'), [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  useEffect(() => { let alive = true; void aiRequest<Settings>('settings').then(value => { if(alive){setSettings(value);setModel(value.model);} }).catch(error => {if(alive)setMessage(error.message);}); return () => {alive=false;}; }, []);
  const action = async (kind: 'save' | 'test' | 'clear') => {
    setBusy(true); setMessage('');
    try {
      if (kind === 'test') {
        const result = await aiRequest<{message:string}>('test', {}); setMessage(result.message);
      } else {
        const next = await aiRequest<Settings>('settings', kind === 'clear' ? {clear:true} : {key,model});
        setSettings(next); setModel(next.model); setKey('');
        setMessage(kind === 'clear' ? 'API açarı silindi.' : 'API açarı saxlanıldı. Proqram yenidən açılanda da qalacaq.');
        window.dispatchEvent(new Event('radaz-ai-change'));
        const channel = new BroadcastChannel('radaz-ai-settings'); channel.postMessage('changed'); channel.close();
      }
    } catch (error) { setMessage(error instanceof Error ? error.message : 'AI ayarları saxlanmadı.'); }
    finally { setBusy(false); }
  };
  return <form className="ai-settings" onSubmit={event => {event.preventDefault();void action('save');}}>
    <p>OpenAI API açarı Windows hesabınıza bağlı şifrəli şəkildə bu kompüterdə saxlanır. Yeniləmədən sonra da qalır.</p>
    <p className="ai-key-status">{settings?.configured ? 'API açarı saxlanılıb · təhlükəsizlik üçün göstərilmir' : 'API açarı daxil edilməyib'}</p>
    <label>OpenAI API açarı<input type="password" name="openai-key" autoComplete="new-password" spellCheck={false} value={key} onChange={event => setKey(event.target.value)} placeholder={settings?.configured ? 'Saxlanmış açarı dəyişmək üçün yeni açar yazın' : 'sk-…'} disabled={busy}/></label>
    <label>OpenAI modeli<input value={model} onChange={event => setModel(event.target.value)} autoComplete="off" spellCheck={false} disabled={busy}/></label>
    <div className="ai-settings-actions"><button type="submit" disabled={busy || (!key.trim() && !settings?.configured)}>Yadda saxla</button><button type="button" disabled={busy || !settings?.configured || !!key || model !== settings.model} onClick={() => void action('test')}>Bağlantını yoxla</button><button type="button" disabled={busy || !settings?.configured} onClick={() => void action('clear')}>Açarı sil</button></div>
    <p role="status">{busy ? 'Gözləyin…' : message}</p>
    <small>Yalnız hesabat yaratma düyməsini basdıqda seçilmiş görüntülər və tapşırıq OpenAI-a göndərilir. OpenAI API istifadəsi ayrıca ödənişlidir.</small>
  </form>;
}
