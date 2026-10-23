/** Cornerstone 5.10 updates pool maxima on removal but leaves the GPU canvas
 * at its old size. The next draw then copies from the wrong Y origin. Keep the
 * public offscreen surface in step with the remaining viewports in that pool.
 * This adapter is only installed for ContextPool (not tiled/CPU rendering).
 */
export function preserveContextSizeOnRemoval(engine: any) {
  const disable = engine.disableElement.bind(engine);
  engine.disableElement = (id: string) => {
    const viewport = engine.getViewport(id);
    if (!viewport) return disable(id);
    const context = engine.getOffscreenMultiRenderWindow(id);
    disable(id);
    const peers = engine.getViewports().filter((vp: any) => engine.getOffscreenMultiRenderWindow(vp.id) === context);
    if (!peers.length) return;
    const width = Math.max(...peers.map((vp: any) => vp.sWidth));
    const height = Math.max(...peers.map((vp: any) => vp.sHeight));
    const container = context.getContainer();
    if (container.width !== width || container.height !== height) {
      container.width = width; container.height = height;
      context.resize();
      engine.renderViewports(peers.map((vp: any) => vp.id));
    }
  };
}
