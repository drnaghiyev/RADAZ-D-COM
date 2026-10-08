/* This guard never clears IndexedDB, localStorage, licenses or archive data. */
(() => {
  const buildId = document.querySelector('meta[name="radaz-build"]')?.content;
  const report = (phase, message) => console.error('[RADAZ startup]', {phase, buildId, message});
  addEventListener('error', event => {
    if (event.target instanceof HTMLScriptElement || event.target instanceof HTMLLinkElement) {
      const resource = event.target.src || event.target.href;
      report('browser-resource', new URL(resource, location.href).pathname);
    } else if (event.message) report('browser-runtime', event.message);
  }, true);
  addEventListener('unhandledrejection', event => report('browser-promise', String(event.reason)));
  void (async () => {
    // RADAZ does not use a service worker. Retire only registrations controlling
    // this app URL; leave other scopes and all persistent application data alone.
    if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      let removed = false;
      for (const registration of registrations) {
        if (location.href.startsWith(registration.scope)) removed = await registration.unregister() || removed;
      }
      if (removed) {
        report('service-worker', 'Removed obsolete controller; loading verified build');
        const key = 'radaz-sw-reload:' + buildId;
        if (!sessionStorage.getItem(key)) {
          sessionStorage.setItem(key, '1');
          const url = new URL(location.href); url.searchParams.set('radaz-build', buildId); url.searchParams.set('radaz-refresh', String(Date.now()));
          location.replace(url.href); return;
        }
      }
    }
    const response = await fetch('/radaz-runtime.json', {cache:'no-store'});
    if (!response.ok) throw Error('Runtime HTTP ' + response.status);
    const runtime = await response.json();
    if (runtime.buildId !== buildId) report('build-mismatch', `Document ${buildId}; server ${runtime.buildId}. Reopen RADAZ to load one complete build.`);
  })().catch(error => report('bootstrap', String(error)));
})();
