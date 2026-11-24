import type { DataSet } from 'dicom-parser';

// Enhanced DICOM stores these attributes in per-frame or shared functional groups.
const groupOf: Record<string, string> = {
  x00200032: 'x00209113', x00200037: 'x00209116',
  x00280030: 'x00289110', x00180050: 'x00289110', x00180088: 'x00289110',
  x00281050: 'x00289132', x00281051: 'x00289132', x00281055: 'x00289132', x00281056: 'x00289132',
  x00281052: 'x00289145', x00281053: 'x00289145', x00281054: 'x00289145',
};

export function frameMetadata(source: DataSet, index: number): DataSet {
  const frame = source.elements.x52009230?.items?.[index]?.dataSet;
  const shared = source.elements.x52009229?.items?.[0]?.dataSet;
  if (!frame && !shared) return source;
  const view: DataSet = Object.create(source);
  view.string = (tag, component) => {
    const group = groupOf[tag];
    if (group) {
      for (const owner of [frame, shared]) {
        const value = owner?.elements[group]?.items?.[0]?.dataSet?.string(tag, component);
        if (value !== undefined && value !== '') return value;
      }
    }
    return source.string(tag, component);
  };
  return view;
}

/** Native monochrome frames can be validated by their byte ranges, then decoded on demand. */
export function indexableNativeFrames(ds: DataSet, byteLength: number, frames: number): boolean {
  if (frames <= 1 || !['1.2.840.10008.1.2', '1.2.840.10008.1.2.1', '1.2.840.10008.1.2.2'].includes(ds.string('x00020010') || '1.2.840.10008.1.2.1')) return false;
  const pixel = ds.elements.x7fe00010;
  const bits = ds.uint16('x00280100') || 0;
  const stored = ds.uint16('x00280101') || bits;
  const high = ds.uint16('x00280102') ?? stored - 1;
  const size = frames * (ds.uint16('x00280010') || 0) * (ds.uint16('x00280011') || 0) * bits / 8;
  return !!pixel && !pixel.encapsulatedPixelData && [8,16].includes(bits) && stored >= 1 && stored <= bits &&
    high >= stored - 1 && high < bits && ds.uint16('x00280002') === 1 &&
    ['MONOCHROME1','MONOCHROME2'].includes(ds.string('x00280004') || '') &&
    Number.isSafeInteger(size) && size > 0 && pixel.length >= size && pixel.dataOffset + size <= byteLength;
}
