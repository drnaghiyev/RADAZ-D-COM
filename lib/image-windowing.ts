import type { Types } from '@cornerstonejs/core';

export type ImageWindowLevels = Map<string, { lower: number; upper: number }>;

/** Window level belongs to a panel AND an image, never the rest of its stack. */
export function isolateImageWindowing(viewport: Types.IStackViewport, panel: string, values: ImageWindowLevels,
  events: { PRE_STACK_NEW_IMAGE: string; STACK_NEW_IMAGE: string; VOI_MODIFIED: string },
  defaults: (imageId: string) => { wl: number; ww: number }) {
  let loading = false, disposed = false, revision = 0;
  let displayed = viewport.getCurrentImageId() || '';
  const key = (id: string) => `${panel}:${id}`;
  const before = () => { loading = true; revision++; };
  const remember = () => {
    if (loading || !displayed || displayed !== viewport.getCurrentImageId()) return;
    const range = viewport.getProperties().voiRange;
    if (range) values.set(key(displayed), { ...range });
  };
  const show = () => {
    displayed = viewport.getCurrentImageId() || '';
    if (!displayed) return;
    const id = displayed, current = ++revision;
    loading = true;
    const { wl, ww } = defaults(id);
    const range = values.get(key(id)) || { lower: wl - ww / 2, upper: wl + ww / 2 };
    viewport.setProperties({ voiRange: { ...range } }, true);
    // CPU rendering finishes its image transition after STACK_NEW_IMAGE.
    queueMicrotask(() => {
      if (disposed || current !== revision || viewport.getCurrentImageId() !== id) return;
      viewport.setProperties({ voiRange: { ...range } }, true);
      loading = false;
      viewport.render();
    });
  };
  viewport.element.addEventListener(events.PRE_STACK_NEW_IMAGE, before);
  viewport.element.addEventListener(events.STACK_NEW_IMAGE, show);
  viewport.element.addEventListener(events.VOI_MODIFIED, remember);
  return () => {
    disposed = true;
    viewport.element.removeEventListener(events.PRE_STACK_NEW_IMAGE, before);
    viewport.element.removeEventListener(events.STACK_NEW_IMAGE, show);
    viewport.element.removeEventListener(events.VOI_MODIFIED, remember);
  };
}
