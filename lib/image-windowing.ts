import type { Types } from '@cornerstonejs/core';

type Range = { lower: number; upper: number };
type Scope = { seriesId?: string; modality?: string; mpr?: boolean };
type Listener = (key: string, range: Range, remote: boolean) => void;
const validRange = (range: Range) => Number.isFinite(range?.lower) && Number.isFinite(range?.upper) && range.upper > range.lower;
const isSeriesKey = (key: string) => key.startsWith('["series",');

export function windowingKey(panel: string, image: string, scope: Scope) {
  if (scope.seriesId && (scope.mpr || ['CT', 'MR'].includes(scope.modality?.trim().toUpperCase() || ''))) {
    // CD and archive openings of the same DICOM series share a stable identity.
    return JSON.stringify(['series', scope.seriesId.replace(/^media:[^:]+:/, '')]);
  }
  return JSON.stringify(['image', panel, image]);
}

export class WindowLevels {
  private values = new Map<string, Range>();
  private listeners = new Set<Listener>();
  get(key: string) { return this.values.get(key); }
  set(key: string, range: Range, remote = false) {
    if (!validRange(range)) return;
    const previous = this.values.get(key);
    if (previous?.lower === range.lower && previous.upper === range.upper) return;
    this.values.set(key, { ...range });
    this.listeners.forEach(listener => listener(key, range, remote));
  }
  subscribe(listener: Listener) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  seriesValues() { return [...this.values].filter(([key]) => isSeriesKey(key)); }
}

/** Keep separate Viewer/MPR windows on the same CT/MR series in agreement. */
export function connectWindowLevels(values: WindowLevels, channel: BroadcastChannel) {
  channel.onmessage = event => {
    const message = event.data;
    if (message?.kind === 'request') { channel.postMessage({ kind: 'snapshot', values: values.seriesValues() }); return; }
    if (!['change', 'snapshot'].includes(message?.kind) || !Array.isArray(message.values)) return;
    for (const entry of message.values) {
      if (!Array.isArray(entry) || entry.length !== 2) continue;
      const [key, range] = entry;
      if (typeof key !== 'string' || !isSeriesKey(key) || !validRange(range)) continue;
      // A late initial snapshot must not replace a more recent local adjustment.
      if (message.kind === 'snapshot' && values.get(key)) continue;
      values.set(key, range, true);
    }
  };
  const unsubscribe = values.subscribe((key, range, remote) => {
    if (!remote && isSeriesKey(key)) channel.postMessage({ kind: 'change', values: [[key, range]] });
  });
  channel.postMessage({ kind: 'request' });
  return () => { unsubscribe(); channel.close(); };
}

/** CT/MR and MPR use a series window; projection images keep a panel/image window. */
export function bindWindowing(viewport: Types.IStackViewport, panel: string, values: WindowLevels,
  events: { PRE_STACK_NEW_IMAGE: string; STACK_NEW_IMAGE: string; VOI_MODIFIED: string },
  defaults: (imageId: string) => { wl: number; ww: number }, scope: () => Scope) {
  let loading = false, disposed = false, revision = 0;
  let displayed = viewport.getCurrentImageId() || '', displayedKey = '';
  const key = (id: string) => windowingKey(panel, id, scope());
  const rangeFor = (id: string) => {
    const { wl, ww } = defaults(id);
    return values.get(displayedKey) || { lower: wl - ww / 2, upper: wl + ww / 2 };
  };
  const before = () => { loading = true; revision++; };
  const remember = () => {
    if (loading || !displayed || displayed !== viewport.getCurrentImageId() || displayedKey !== key(displayed)) return;
    const range = viewport.getProperties().voiRange;
    if (range) values.set(displayedKey, range);
  };
  const unsubscribe = values.subscribe((changed, range) => {
    if (loading || changed !== displayedKey || displayed !== viewport.getCurrentImageId()) return;
    const current = viewport.getProperties().voiRange;
    if (current?.lower === range.lower && current.upper === range.upper) return;
    viewport.setProperties({ voiRange: { ...range } }, true);
    viewport.render();
  });
  const show = () => {
    displayed = viewport.getCurrentImageId() || '';
    if (!displayed) return;
    displayedKey = key(displayed);
    const id = displayed, current = ++revision;
    loading = true;
    viewport.setProperties({ voiRange: { ...rangeFor(id) } }, true);
    // CPU rendering finishes its image transition after STACK_NEW_IMAGE.
    queueMicrotask(() => {
      if (disposed || current !== revision || viewport.getCurrentImageId() !== id) return;
      viewport.setProperties({ voiRange: { ...rangeFor(id) } }, true);
      loading = false;
      viewport.render();
    });
  };
  viewport.element.addEventListener(events.PRE_STACK_NEW_IMAGE, before);
  viewport.element.addEventListener(events.STACK_NEW_IMAGE, show);
  viewport.element.addEventListener(events.VOI_MODIFIED, remember);
  return () => {
    disposed = true; unsubscribe();
    viewport.element.removeEventListener(events.PRE_STACK_NEW_IMAGE, before);
    viewport.element.removeEventListener(events.STACK_NEW_IMAGE, show);
    viewport.element.removeEventListener(events.VOI_MODIFIED, remember);
  };
}
