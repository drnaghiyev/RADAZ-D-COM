/** Share presentation only; never copy camera orientation or annotation state. */
export function bindPresentationSync(root: HTMLElement, viewports: () => any[], source: () => string) {
  let applying = false;
  const copy = (event: Event) => {
    if (applying) return;
    const panes = viewports();
    const from = panes.find(v => v.id === `panel-${source()}` && v.element === event.target);
    if (!from?.getCurrentImageId?.()) return;
    if (event.type === 'CORNERSTONE_CAMERA_MODIFIED') {
      const {previousCamera: before, camera: after} = (event as CustomEvent).detail || {};
      // Rotating/flipping/reorienting a pane is not a shared presentation action.
      if (before && after && ['viewUp','viewPlaneNormal','flipHorizontal','flipVertical'].some(key =>
        JSON.stringify(before[key]) !== JSON.stringify(after[key]))) return;
    }
    applying = true;
    try {
      for (const to of panes) {
        if (to === from || !to.getCurrentImageId?.()) continue;
        if (event.type === 'CORNERSTONE_VOI_MODIFIED') {
          const voiRange = from.getProperties().voiRange;
          if (voiRange) to.setProperties({voiRange: {...voiRange}});
        } else {
          const pan = from.getPan();
          to.setZoom(from.getZoom());
          to.setPan([pan[0] * to.element.clientWidth / Math.max(1, from.element.clientWidth),
            pan[1] * to.element.clientHeight / Math.max(1, from.element.clientHeight)]);
        }
        to.render();
      }
    } finally { applying = false; }
  };
  root.addEventListener('CORNERSTONE_CAMERA_MODIFIED', copy, true);
  root.addEventListener('CORNERSTONE_VOI_MODIFIED', copy, true);
  return () => {
    root.removeEventListener('CORNERSTONE_CAMERA_MODIFIED', copy, true);
    root.removeEventListener('CORNERSTONE_VOI_MODIFIED', copy, true);
  };
}
