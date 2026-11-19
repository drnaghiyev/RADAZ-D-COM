/** Keep the pending PACS tab useful while a long DIMSE transfer finishes or fails. */
export function preparePacsTransferTab(tab: Window | null): (message: string, failed?: boolean,done?:number,total?:number) => void {
  if (!tab) return () => {};
  const doc = tab.document;
  doc.title = 'RADAZ · PACS görüntüləri';
  doc.documentElement.lang = 'az';
  doc.body.style.cssText = 'margin:0;min-height:100vh;display:grid;place-items:center;background:#09131e;color:#e5f0f7;font:16px system-ui,sans-serif';

  const panel = doc.createElement('main');
  panel.style.cssText = 'box-sizing:border-box;width:min(540px,calc(100vw - 32px));padding:28px;border:1px solid #375a70;border-radius:10px;background:#112637;box-shadow:0 18px 65px #0005';
  const brand = doc.createElement('strong');
  brand.textContent = 'RADAZ';
  brand.style.cssText = 'font-size:21px;letter-spacing:.08em';
  const title = doc.createElement('h1');
  title.textContent = 'PACS görüntüləri gətirilir';
  title.style.cssText = 'font-size:18px;margin:20px 0 12px';
  const progress = doc.createElement('p');
  progress.setAttribute('role', 'status');
  progress.setAttribute('aria-live', 'polite');
  progress.style.cssText = 'line-height:1.55;color:#bed8e5;overflow-wrap:anywhere';
  const download = doc.createElement('a');
  const bar=doc.createElement('progress');bar.style.cssText='width:100%;height:10px;accent-color:#57d7e5';bar.setAttribute('aria-label','PACS görüntülərinin yüklənməsi');
  download.href = `${window.location.origin}/radaz-pacs-bridge-v4.zip`;
  download.textContent = 'Yeni PACS körpüsünü endir';
  download.style.cssText = 'display:none;margin-top:17px;color:#85dafa';
  const alternative = doc.createElement('p');
  alternative.textContent = 'Server ayarı dəyişdirilənədək ClearCanvas-dan DICOM fayllarını ixrac etmək mümkündürsə, RADAZ-da İmport → Qovluq və ya ZIP ilə açın.';
  alternative.style.cssText = 'display:none;margin:18px 0 0;line-height:1.55;color:#bed8e5';
  for (const element of [brand, title, progress,bar, download, alternative]) panel.appendChild(element);
  doc.body.replaceChildren(panel);

  return (message: string, failed = false,done=0,total=0) => {
    if (tab.closed) return;
    title.textContent = failed ? 'Görüntü açıla bilmədi' : 'PACS görüntüləri gətirilir';
    progress.textContent = message;
    if(total>0){bar.max=total;bar.value=done;}else bar.removeAttribute('value');bar.hidden=failed;
    progress.setAttribute('role', failed ? 'alert' : 'status');
    progress.style.color = failed ? '#ffcca6' : '#bed8e5';
    download.style.display = failed && message.includes('körpü') ? 'inline-block' : 'none';
    alternative.style.display = failed && message.includes('0xA801') ? 'block' : 'none';
  };
}
