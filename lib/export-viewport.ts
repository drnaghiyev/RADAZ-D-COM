/** Export the rendered viewport, including only currently visible annotations/text. */
export async function captureViewport(pane: HTMLElement, annotations: boolean | 'full' | 'basic' | 'none', includeText = true) {
  const source = pane.querySelector<HTMLCanvasElement>('.dicom-canvas canvas');
  if (!source || !source.width || !source.height) throw new Error('Əvvəlcə DICOM görüntüsü açın');
  const bounds = pane.querySelector('.dicom-canvas')!.getBoundingClientRect();
  const canvas = document.createElement('canvas');
  canvas.width = source.width; canvas.height = source.height;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(source, 0, 0);
  const sx = canvas.width / bounds.width, sy = canvas.height / bounds.height;
  if (annotations && annotations !== 'none') {
    for (const svg of pane.querySelectorAll<SVGSVGElement>('svg.measurement-overlay, svg.drawing-overlay, svg.localizer-overlay, .dicom-canvas svg')) {
      const clone = svg.cloneNode(true) as SVGSVGElement;
      const originals = [svg, ...svg.querySelectorAll('*')];
      const copies = [clone, ...clone.querySelectorAll('*')];
      originals.forEach((node, i) => {
        const style = getComputedStyle(node);
        for (const property of ['display','visibility','fill','stroke','stroke-width','stroke-dasharray','opacity','font-family','font-size','font-weight']) {
          (copies[i] as SVGElement).style.setProperty(property, style.getPropertyValue(property));
        }
      });
      clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
      clone.setAttribute('width', String(bounds.width)); clone.setAttribute('height', String(bounds.height));
      clone.style.width = `${bounds.width}px`; clone.style.height = `${bounds.height}px`;
      const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(clone)], { type: 'image/svg+xml' }));
      try {
        const image = new Image(); image.src = url; await image.decode();
        ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      } finally { URL.revokeObjectURL(url); }
    }
    if (includeText) drawViewportText(pane, canvas, annotations);
  }
  return canvas;
}

export async function exportViewport(pane: HTMLElement, format: 'png' | 'jpeg', annotations: boolean) {
  const canvas = await captureViewport(pane, annotations);
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('Şəkil yaradıla bilmədi')), `image/${format}`, .95));
  return { url: URL.createObjectURL(blob), filename: `RADAZ-${Date.now()}.${format === 'jpeg' ? 'jpg' : 'png'}`, width: canvas.width, height: canvas.height };
}

function drawViewportText(pane: HTMLElement, canvas: HTMLCanvasElement, annotations: boolean | string) {
  const bounds = pane.querySelector('.dicom-canvas')!.getBoundingClientRect();
  const ctx = canvas.getContext('2d')!, sx = canvas.width / bounds.width, sy = canvas.height / bounds.height;
    ctx.save(); ctx.scale(sx, sy);
    for (const label of pane.querySelectorAll<HTMLElement>('.overlay strong, .overlay span, .pane-badge, .cursor-readout')) {
      if (annotations === 'basic' && label.closest('.top-left, .top-right')) continue;
      if (!label.getClientRects().length || getComputedStyle(label).visibility === 'hidden') continue;
      const style = getComputedStyle(label), rect = label.getBoundingClientRect();
      ctx.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
      ctx.fillStyle = style.color; ctx.textBaseline = 'top';
      ctx.fillText(label.innerText, rect.left - bounds.left, rect.top - bounds.top, rect.width);
    }
    ctx.restore();
}

/** The fixed label layer is printed after image zoom and brightness adjustments. */
export async function capturePrintFrame(pane: HTMLElement) {
  const canvas = await captureViewport(pane, true, false);
  const overlay = document.createElement('canvas');
  overlay.width = canvas.width; overlay.height = canvas.height;
  drawViewportText(pane, overlay, true);
  return {canvas, overlay};
}
