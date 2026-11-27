/** Identify the exterior on axial CT slices. Work on a coarse grid so the scratch
 * space is independent of the full voxel count. Only the display copy is masked.
 * Internal low-density spaces (lungs and bronchi) stay inside the body outline. */
export function airwayBodyRows(values: Float32Array, dimensions: readonly number[]) {
  const [width, height, slices] = dimensions;
  const step = Math.max(1, Math.ceil(Math.max(width, height) / 96));
  const cols = Math.ceil(width / step), rows = Math.ceil(height / step);
  const labels = new Int32Array(cols * rows), queue = new Int32Array(labels.length);
  const left = new Int32Array(rows), right = new Int32Array(rows);
  const bounds = new Int32Array(2 * height * slices);
  const center = Math.floor(step / 2);
  for (let z = 0; z < slices; z++) {
    const base = z * width * height;
    for (let y = 0; y < rows; y++) {
      const top = base + y * step * width, bottom = base + Math.min(height - 1, (y + 1) * step - 1) * width;
      const row = base + Math.min(height - 1, y * step + center) * width;
      for (let x = 0; x < cols; x++) {
        const x0 = x * step, x1 = Math.min(width - 1, (x + 1) * step - 1);
        const tissue = values[row + Math.min(width - 1, x0 + center)] > -450 ||
          values[top + x0] > -450 || values[top + x1] > -450 || values[bottom + x0] > -450 || values[bottom + x1] > -450;
        labels[y * cols + x] = tissue ? -1 : 0;
      }
    }
    let best = 0, bestArea = 0;
    for (let start = 0; start < labels.length; start++) {
      if (labels[start] !== -1) continue;
      const id = start + 1;
      let head = 0, count = 1, minX = cols, maxX = -1, minY = rows, maxY = -1;
      queue[0] = start;
      labels[start] = id;
      while (head < count) {
        const i = queue[head++], x = i % cols, y = Math.floor(i / cols);
        minX = Math.min(minX, x); maxX = Math.max(maxX, x);
        minY = Math.min(minY, y); maxY = Math.max(maxY, y);
        if (x && labels[i - 1] === -1) { labels[i - 1] = id; queue[count++] = i - 1; }
        if (x + 1 < cols && labels[i + 1] === -1) { labels[i + 1] = id; queue[count++] = i + 1; }
        if (y && labels[i - cols] === -1) { labels[i - cols] = id; queue[count++] = i - cols; }
        if (y + 1 < rows && labels[i + cols] === -1) { labels[i + cols] = id; queue[count++] = i + cols; }
      }
      // Do not classify a thin couch, a small label or a peripheral object as the patient.
      if (count > bestArea && count >= labels.length * .04 &&
          maxX - minX >= cols * .18 && maxY - minY >= rows * .18 &&
          minX <= cols * .72 && maxX >= cols * .28 && minY <= rows * .72 && maxY >= rows * .28) {
        best = id; bestArea = count;
      }
    }
    left.fill(width); right.fill(0);
    if (best) {
      for (let i = 0; i < labels.length; i++) {
        if (labels[i] !== best) continue;
        const y = Math.floor(i / cols), x = (i % cols) * step;
        left[y] = Math.min(left[y], x);
        right[y] = Math.max(right[y], Math.min(width, x + step));
      }
    }
    for (let y = 0; y < height; y++) {
      const i = 2 * (z * height + y), row = Math.floor(y / step);
      // Unsure about this slice: leave it intact.
      let x0 = best ? left[row] : 0, x1 = best ? right[row] : width;
      if (best && x0 < x1) {
        // Snap the full-resolution row to the actual skin. A coarse cell may straddle air.
        const at = base + y * width;
        while (x0 < x1 && !(values[at + x0] > -450)) x0++;
        while (x1 > x0 && !(values[at + x1 - 1] > -450)) x1--;
      }
      bounds[i] = x0;
      bounds[i + 1] = x1;
    }
  }
  return bounds;
}

export function maskAirwayExterior(pixels: Float32Array, width: number, bounds: Int32Array, fill: number) {
  for (let row = 0; row < bounds.length / 2; row++) {
    const start = row * width;
    pixels.fill(fill, start, start + bounds[2 * row]);
    pixels.fill(fill, start + bounds[2 * row + 1], start + width);
  }
}
