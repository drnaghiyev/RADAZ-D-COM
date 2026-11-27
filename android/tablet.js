// Runs only inside the packaged, same-origin Android viewer.
(() => {
  'use strict';
  const call = (operation, value = '') => window.prompt('radaz-tablet/' + operation, value);
  const workspace = location.pathname.replace(/^\/|\/$/g, '');
  if (['archive','pacs','mpr','3d'].includes(workspace)) document.documentElement.dataset.tabletWorkspace = workspace;
  // The volume and stitch toolbars already own their close controls.
  if (workspace && workspace !== '3d') {
    const close = document.createElement('button');
    close.type = 'button';
    close.dataset.tabletClose = '';
    const icon=document.createElementNS('http://www.w3.org/2000/svg','svg');
    icon.setAttribute('viewBox','0 0 24 24');
    icon.setAttribute('aria-hidden','true');
    const cross=document.createElementNS(icon.namespaceURI,'path');
    cross.setAttribute('d','M4 4l16 16M20 4L4 20');
    icon.append(cross);
    close.append(icon);
    close.title = 'Pəncərəni bağla';
    close.setAttribute('aria-label', close.title);
    close.addEventListener('click', () => {
      if (call('close-window') !== 'ok') window.close();
    });
    const primary = {
      archive: '.records-header:has(.flat-toolbar-top)', pacs: '.records-header:has(.flat-toolbar-top)', mpr: '.topbar:has(.flat-toolbar-top)',
      report: '.report-top-actions', print: '.output-page-nav', media: '.output-page-nav',
      'printer-settings': '.output-page-nav', 'private-network': '.dn-top',
      'private-network/settings': '.dn-top', 'chatgpt-help': '.chatgpt-help-page header',
    };
    const place = () => {
      if (workspace === 'stitch' && document.querySelector('[aria-label="Stitch pəncərəsini bağla"]')) {
        close.remove();
        return;
      }
      if (close.isConnected && !close.classList.contains('tablet-close-floating')) return;
      const bar = document.querySelector(primary[workspace] || 'header');
      const target = bar || document.body;
      if (!target) return;
      close.classList.toggle('tablet-close-floating', !bar);
      if (target !== close.parentNode) target.append(close);
    };
    const changes = new MutationObserver(place);
    changes.observe(document.documentElement, {childList:true, subtree:true});
    place();
    window.addEventListener('pagehide', () => changes.disconnect(), {once:true});
  }
  const dockPreference = 'radaz-tablet-dock-columns';
  const applyDock = () => {
    document.documentElement.dataset.tabletColumns = localStorage.getItem(dockPreference) === '1' ? '1' : '2';
  };
  applyDock();
  window.addEventListener('storage',event=>{if(event.key===dockPreference || event.key===null)applyDock();});
  if (location.pathname.replace(/\/$/,'') === '/private-network/settings') {
    const pending = new Map();
    window.radazTabletNetworkResult = (id,serialized) => {
      const receive=pending.get(id);
      if(receive){pending.delete(id);receive(JSON.parse(serialized));}
    };
    window.radazTabletNetwork = (action,data,session,profile) => new Promise(resolve => {
      const id=crypto.randomUUID();
      const timer=setTimeout(()=>{
        if(pending.delete(id))resolve({error:'Cavab vaxtında alınmadı. Vəziyyəti yeniləyib yoxlayın.'});
      },90000);
      const finish=reply=>{clearTimeout(timer);resolve(reply);};
      pending.set(id,finish);
      if(call('network',JSON.stringify({id,action,data,session,profile}))!=='ok'){
        pending.delete(id);finish({error:'Planşetin DICOM Network ayarlarını yenidən açın.'});
      }
    });
    window.addEventListener('pagehide',()=>{
      for(const receive of pending.values())receive({error:'Ayarlar pəncərəsi bağlandı.'});
      pending.clear();
    });
  }
  let selectedInput = null;
  let importing = Promise.resolve();
  function note(message) {
    let node = document.getElementById('radaz-tablet-status');
    if (!node) {
      node = document.createElement('div');
      node.id = 'radaz-tablet-status';
      node.setAttribute('role','status');
      node.style.cssText = 'position:fixed;left:50%;bottom:28px;transform:translateX(-50%);z-index:2147483646;background:#152c3c;color:white;padding:8px 18px;border-radius:8px;font:14px sans-serif;pointer-events:none';
      document.body.appendChild(node);
    }
    node.textContent = message;
    node.hidden = !message;
  }
  document.addEventListener('click', event => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement) || input.type !== 'file') return;
    event.preventDefault();
    const mode = input.webkitdirectory ? 'folder' : input.multiple ? 'multiple' : 'single';
    if(call('pick', mode)==='ok') selectedInput = input;
  }, true);
  async function defaultInput() {
    for (let t = 0; t < 150; t++) {
      const list = [...document.querySelectorAll('input[type=file][multiple]')];
      const target = list.find(input => !input.webkitdirectory && !/zip|rar/i.test(input.accept));
      if (target) return target;
      await new Promise(ok => setTimeout(ok, 150));
    }
    throw new Error('DICOM idxalını Viewer pəncərəsində açın.');
  }
  async function deliver(ticket, target) {
    const base = '/_tablet/files/' + encodeURIComponent(ticket) + '/';
    try {
      const response = await fetch(base + 'list');
      if (!response.ok) throw new Error('Fayl seçimi artıq açıq deyil.');
      const items = await response.json();
      const input = target?.isConnected ? target : await defaultInput();
      const transfer = new DataTransfer();
      for (const [index,item] of items.entries()) {
        note('Fayllar açılır · ' + (index+1) + ' / ' + items.length);
        const result = await fetch(base + index);
        if (!result.ok) throw new Error('Seçilmiş faylı oxumaq mümkün olmadı.');
        const blob = await result.blob();
        const file = new File([blob], item.name, {type:item.mime || 'application/octet-stream'});
        if (item.relative) Object.defineProperty(file, 'webkitRelativePath', {value:item.relative});
        transfer.items.add(file);
      }
      input.files = transfer.files;
      input.dispatchEvent(new Event('change', {bubbles:true}));
      note('');
    } catch (error) {
      note(error.message || 'Görüntü açıla bilmədi.');
      setTimeout(() => note(''), 6000);
    } finally {
      call('release', ticket);
    }
  }
  window.radazTabletReceive = (ticket,external) => {
    const target = external ? null : selectedInput;
    selectedInput = null;
    importing = importing.then(() => deliver(ticket,target));
  };
  // Use Android's system print and save pickers for generated reports and image copies.
  window.print = () => {call('print');};
  const downloads = new Map();
  document.addEventListener('click', event => {
    const link = event.target.closest?.('a[download]');
    if (!link || !/^(blob:|data:)/.test(link.href)) return;
    event.preventDefault();
    const id = crypto.randomUUID();
    const blob = fetch(link.href).then(result => result.blob());
    blob.catch(() => {});
    downloads.set(id, blob);
    if (call('save', JSON.stringify({id,name:link.download || 'RADAZ'})) !== 'ok') downloads.delete(id);
  }, true);
  // Desktop exports also click detached anchors, which never bubble to document.
  const originalClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function() {
    if (this.isConnected || !this.hasAttribute('download') || !/^(blob:|data:)/.test(this.href)) return originalClick.call(this);
    this.hidden = true;
    document.body.appendChild(this);
    try {return originalClick.call(this);} finally {this.remove();}
  };
  window.radazTabletSave = async (id,accepted) => {
    const promise = downloads.get(id);
    downloads.delete(id);
    if (!accepted || !promise) return;
    try {
      const blob = await promise;
      for (let offset = 0; offset < blob.size; offset += 96*1024) {
        const bytes = new Uint8Array(await blob.slice(offset,offset+96*1024).arrayBuffer());
        let raw = '';
        for(let i=0;i<bytes.length;i+=8192) raw += String.fromCharCode(...bytes.subarray(i,i+8192));
        if(call('write', id + ':' + btoa(raw)) !== 'ok') throw Error('Faylı yazmaq mümkün olmadı.');
      }
      if (call('finish',id) !== 'ok') throw Error('Fayl tamamlanmadı.');
    } catch(error) {call('abort',id); note(error.message);setTimeout(() => note(''),6000);}
  };
  call('ready');
})();
