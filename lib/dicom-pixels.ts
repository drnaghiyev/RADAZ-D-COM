import { parseDicomFile } from './dicom-file';

export type DicomPixelImage = {
  overlay?: HTMLCanvasElement;
  name: string; rows: number; columns: number; pixels: Uint8Array;
  windowCenter: number; windowWidth: number; photometric: string;
};

const firstNumber = (value: string | undefined, fallback: number) => {
  if (!value?.trim()) return fallback;
  const parsed = Number((value || '').split('\\')[0]);
  return Number.isFinite(parsed) ? parsed : fallback;
};

/** Extract an 8-bit display raster from an uncompressed monochrome DICOM instance. */
export async function readDicomPixels(file: File): Promise<DicomPixelImage | null> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const data = parseDicomFile(bytes);
  const transferSyntax = data.string('x00020010')?.trim() || '1.2.840.10008.1.2';
  if (!['1.2.840.10008.1.2', '1.2.840.10008.1.2.1', '1.2.840.10008.1.2.2'].includes(transferSyntax)) return null;
  const rows = data.uint16('x00280010') || 0;
  const columns = data.uint16('x00280011') || 0;
  const bitsAllocated = data.uint16('x00280100') || 0;
  const pixel = data.elements.x7fe00010;
  if (!rows || !columns || !pixel || ![8, 16].includes(bitsAllocated)) return null;
  const count = rows * columns;
  const slope = firstNumber(data.string('x00281053'), 1);
  const intercept = firstNumber(data.string('x00281052'), 0);
  const signed = (data.uint16('x00280103') || 0) === 1;
  const littleEndian = transferSyntax !== '1.2.840.10008.1.2.2';
  const raw = new Float32Array(count);
  const view = new DataView(bytes.buffer, bytes.byteOffset + pixel.dataOffset, Math.min(pixel.length, bytes.byteLength - pixel.dataOffset));
  let low = Infinity, high = -Infinity;
  for (let index = 0; index < count; index++) {
    const offset = index * (bitsAllocated / 8);
    if (offset + bitsAllocated / 8 > view.byteLength) break;
    const stored = bitsAllocated === 8 ? (signed ? view.getInt8(offset) : view.getUint8(offset))
      : signed ? view.getInt16(offset, littleEndian) : view.getUint16(offset, littleEndian);
    const value = stored * slope + intercept;
    raw[index] = value; low = Math.min(low, value); high = Math.max(high, value);
  }
  const windowCenter = firstNumber(data.string('x00281050'), (low + high) / 2);
  const windowWidth = Math.max(1, firstNumber(data.string('x00281051'), high - low || 1));
  const minimum = windowCenter - windowWidth / 2;
  const pixels = new Uint8Array(count);
  const invert = (data.string('x00280004') || '').toUpperCase().includes('MONOCHROME1');
  for (let index = 0; index < count; index++) {
    let value = Math.max(0, Math.min(255, Math.round(((raw[index] - minimum) / windowWidth) * 255)));
    if (invert) value = 255 - value;
    pixels[index] = value;
  }
  return { name: file.name, rows, columns, pixels, windowCenter, windowWidth, photometric: invert ? 'MONOCHROME1' : 'MONOCHROME2' };
}

export function bytesToBase64(bytes: Uint8Array): string {
  let output = '';
  const block = 0x8000;
  for (let index = 0; index < bytes.length; index += block) output += String.fromCharCode(...bytes.subarray(index, index + block));
  return btoa(output);
}
