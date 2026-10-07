export type MediaSession = { id: string; label: string; stage: 'scanning' | 'ready' | 'error'; scanned: number; total: number; error: string; dicomdir: boolean };
export type MediaImage = { id: string; studyId: string; seriesUID: string; sopUID: string; name: string; modality: string;
  patient: string; patientId: string; birth: string; date: string; number: string; instance: number; size: number; decodedBytes: number; archived?: boolean; tags: Record<string,string> };
export type MediaProgress = { sessions: number; discovered: number; loaded: number; skipped: number; scanning: boolean; error: string };
type SessionState = { session: MediaSession; controller: AbortController; next: number; queue: MediaImage[];
  loaded: number; skipped: number; pumping: boolean; bytes: number; error: string };
type Callbacks = {
  discovered: (session: string, images: MediaImage[]) => void;
  image: (session: string, metadata: MediaImage, url: string, signal: AbortSignal) => Promise<void>;
  removed: (session: string) => void;
  progress: (progress: MediaProgress) => void;
};

const base = '/local-archive-api/removable';
async function json<T>(path: string, signal: AbortSignal, body?: object): Promise<T> {
  const response = await fetch(base + path, { signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]), cache: 'no-store', ...(body ? {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  } : {}) });
  if (!response.ok) throw new Error(response.status === 404
    ? 'CD/DVD import üçün RADAZ və lokal xidməti yeni Setup ilə yeniləyin.'
    : 'CD/DVD xidməti ilə əlaqə alınmadı. Lokal RADAZ-ı başladın.');
  return response.json();
}

/** Discovery and removal polling is independent of slow pixel transfers. */
export function watchRemovableMedia(callbacks: Callbacks, onlySessions?: string[]) {
  const client = crypto.randomUUID(), controller = new AbortController();
  const sessions = new Map<string, SessionState>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let failures = 0;
  const progress = (error = '') => {
    const items = [...sessions.values()];
    callbacks.progress({ sessions: items.length, discovered: items.reduce((n, s) => n + s.session.total, 0),
      loaded: items.reduce((n, s) => n + s.loaded, 0), skipped: items.reduce((n, s) => n + s.skipped, 0),
      scanning: items.some(s => s.session.stage === 'scanning'),
      error: error || items.map(s => s.error || s.session.error).find(Boolean) || '' });
  };
  const remove = (id: string) => {
    const state = sessions.get(id);
    if (!state) return;
    state.controller.abort(); state.queue.length = 0; sessions.delete(id);
    callbacks.removed(id);
  };
  const pump = async (state: SessionState) => {
    if (state.pumping || state.error) return;
    state.pumping = true;
    try {
      while (state.queue.length && !state.controller.signal.aborted) {
        const item = state.queue.shift()!;
        try {
          const url = item.archived ? `/local-archive-api/file/${encodeURIComponent(item.sopUID)}` : `${base}/file/${state.session.id}/${item.id}`;
          if (state.controller.signal.aborted) break;
          await callbacks.image(state.session.id, item, url, state.controller.signal);
          if (state.controller.signal.aborted) break;
          state.loaded++;
        } catch (error) {
          if (state.controller.signal.aborted) break;
          state.skipped++;
          // Show unsupported or unreadable images; never count them as loaded.
          state.session.error = error instanceof Error ? error.message : 'Görüntü oxunmadı';
        }
        progress();
        // Metadata is small. Yield per batch: background-tab timer throttling
        // must not turn a 700-slice disc index into a 700-second operation.
        if ((state.loaded + state.skipped) % 64 === 0) await new Promise(resolve => setTimeout(resolve, 0));
      }
    } finally { state.pumping = false; }
  };
  const poll = async () => {
    try {
      const snapshot = await json<{ sessions: MediaSession[] }>('/watch', controller.signal, { client });
      if (controller.signal.aborted) return;
      failures = 0;
      const current = snapshot.sessions.filter(s => !onlySessions || onlySessions.includes(s.id));
      for (const id of sessions.keys()) if (!current.some(s => s.id === id)) remove(id);
      for (const session of current) {
        let state = sessions.get(session.id);
        if (!state) {
          state = { session, controller: new AbortController(), next: 0, queue: [], loaded: 0, skipped: 0, pumping: false, bytes: 0, error: '' };
          sessions.set(session.id, state);
        }
        state.session = { ...session, error: session.error || state.session.error };
        // Metadata pages are small; pixels load on an independent queue.
        while (state.next < session.total && !state.error) {
          const page = await json<{ items: MediaImage[]; next: number }>(`/entries?session=${session.id}&after=${state.next}`, controller.signal);
          if (controller.signal.aborted || state.controller.signal.aborted || page.next <= state.next) break;
          state.next = page.next;
          state.session.total = Math.max(state.session.total, state.next);
          callbacks.discovered(session.id, page.items);
          state.queue.push(...page.items);
          void pump(state);
        }
      }
      progress();
    } catch (error) {
      if (controller.signal.aborted) return;
      // Fail closed: a stopped/restarted bridge must not leave media pixels on screen.
      if (++failures >= 3) for (const id of sessions.keys()) remove(id);
      progress(error instanceof Error ? error.message : 'CD/DVD xidməti işləmir');
    } finally {
      if (!controller.signal.aborted) timer = setTimeout(poll, 800);
    }
  };
  void poll();
  return () => {
    controller.abort(); clearTimeout(timer);
    for (const id of sessions.keys()) remove(id);
    void fetch(base + '/close', { method: 'POST', keepalive: true,
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ client }) }).catch(() => {});
  };
}

/** Report tabs also discard source images on eject, including after the Viewer closes. */
export function watchMediaRemoval(ids: string[], onRemoved: (id: string) => void) {
  const client = crypto.randomUUID(), controller = new AbortController();
  const remaining = new Set(ids);
  let timer: ReturnType<typeof setTimeout> | undefined, failures = 0;
  const poll = async () => {
    try {
      const state = await json<{ sessions: MediaSession[] }>('/watch', controller.signal, { client });
      failures = 0;
      for (const id of remaining) if (!state.sessions.some(s => s.id === id)) { remaining.delete(id); onRemoved(id); }
    } catch { if (++failures >= 3) { remaining.forEach(onRemoved); remaining.clear(); } }
    finally { if (!controller.signal.aborted) timer = setTimeout(poll, 1000); }
  };
  void poll();
  return () => { controller.abort(); clearTimeout(timer);
    void fetch(base + '/close', { method: 'POST', keepalive: true, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ client }) }).catch(() => {}); };
}
