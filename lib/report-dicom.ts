import { parseDicomFile } from './dicom-file';

export type ReportImage = {
  file?: File;
  sourceUrl?: string;
  studyUID: string;
  seriesUID: string;
  sopUID: string;
  seriesName: string;
  modality: string;
  instance: number;
  rows: number;
  columns: number;
  supported: boolean;
};

export type ReportStudy = {
  uid: string;
  patient: string;
  birth: string;
  date: string;
  modality: string;
  description: string;
  images: ReportImage[];
};

const dateInput = (raw: string) => /^\d{8}$/.test(raw) ? `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}` : '';

export async function readReportStudies(files: File[], onProgress?: (done: number, total: number) => void): Promise<ReportStudy[]> {
  const studies = new Map<string, ReportStudy>();
  const seen = new Set<string>();
  for (let i = 0; i < files.length; i++) {
    try {
      const bytes = new Uint8Array(await files[i].arrayBuffer());
      const ds = parseDicomFile(bytes);
      const tag = (id: string) => ds.string(id)?.trim() || '';
      const uid = tag('x0020000d'), seriesUID = tag('x0020000e'), sopUID = tag('x00080018');
      if (!uid || !seriesUID || !sopUID) continue;
      if (seen.has(`${uid}|${sopUID}`)) continue;
      let study = studies.get(uid);
      if (!study) {
        study = { uid, patient: tag('x00100010').replaceAll('^', ' ') || 'Naməlum pasiyent',
          birth: dateInput(tag('x00100030')), date: dateInput(tag('x00080020')),
          modality: tag('x00080060') || 'DICOM', description: tag('x00081030'), images: [] };
        studies.set(uid, study);
      }
      const rows = ds.uint16('x00280010') || 0, columns = ds.uint16('x00280011') || 0;
      const bits = ds.uint16('x00280100') || 0, syntax = tag('x00020010') || '1.2.840.10008.1.2.1';
      const pixel = ds.elements.x7fe00010;
      seen.add(`${uid}|${sopUID}`);
      study.images.push({ file: files[i], studyUID: uid, seriesUID, sopUID,
        seriesName: tag('x0008103e') || `Seriya ${tag('x00200011') || '—'}`,
        modality: tag('x00080060') || study.modality, instance: Number(tag('x00200013')) || i + 1,
        rows, columns, supported: !!pixel && !pixel.encapsulatedPixelData && rows > 0 && columns > 0 &&
          [8, 16].includes(bits) && ds.uint16('x00280002') === 1 &&
          ['1.2.840.10008.1.2', '1.2.840.10008.1.2.1'].includes(syntax) });
    } catch { /* Skip DICOMDIR and non-DICOM files without blocking the remaining study. */ }
    if (i % 12 === 0 || i === files.length - 1) onProgress?.(i + 1, files.length);
  }
  return [...studies.values()].map(study => ({ ...study,
    images: study.images.sort((a, b) => a.seriesUID.localeCompare(b.seriesUID) || a.instance - b.instance),
  }));
}

/** Optical reports retain metadata, and read one image at a time during export. */
export function readReportMedia(sources: {url:string;tags:Record<string,string>}[]): ReportStudy[] {
  const studies = new Map<string,ReportStudy>();
  for (const source of sources) {
    const optical = /^\/local-archive-api\/removable\/file\/[a-zA-Z0-9-]+\/[a-zA-Z0-9-]+$/.test(source.url);
    const archived = /^\/local-archive-api\/file\/[0-9]+(?:\.[0-9]+)+$/.test(source.url);
    if (!optical && !archived) continue;
    const tag=(key:string)=>source.tags[key]||'',uid=tag('x0020000d'),seriesUID=tag('x0020000e');
    let study=studies.get(uid);
    if(!study){study={uid,patient:tag('x00100010').replaceAll('^',' '),birth:dateInput(tag('x00100030')),date:dateInput(tag('x00080020')),modality:tag('x00080060'),description:tag('x00081030'),images:[]};studies.set(uid,study);}
    const rows=Number(tag('x00280010')),columns=Number(tag('x00280011'));
    study.images.push({sourceUrl:source.url,studyUID:uid,seriesUID,sopUID:tag('x00080018'),seriesName:tag('x0008103e'),modality:tag('x00080060'),instance:Number(tag('x00200013')),rows,columns,
      supported:rows>0&&columns>0&&Number(tag('x00280002'))===1&&[8,16].includes(Number(tag('x00280100')))&&['1.2.840.10008.1.2','1.2.840.10008.1.2.1'].includes(tag('x00020010'))});
  }
  return [...studies.values()].map(study=>({...study,images:study.images.sort((a,b)=>a.instance-b.instance)}));
}

/** Render the diagnostic pixel matrix only; patient tags are never painted into the image. */
export async function renderReportImage(image: ReportImage, windowMode: 'metadata' | 'lung' | 'soft' | 'bone', customWindow?:{ww:number;wl:number}): Promise<string> {
  if (!image.supported) throw new Error('Bu kəsitin piksel formatı analiz üçün dəstəklənmir');
  const response = image.sourceUrl ? await fetch(image.sourceUrl,{cache:'no-store'}) : null;
  if (response && !response.ok) throw new Error('Mənbə disk çıxarılıb və ya görüntü oxunmadı');
  const bytes = new Uint8Array(await (response || image.file!).arrayBuffer());
  const ds = parseDicomFile(bytes);
  const pixel = ds.elements.x7fe00010;
  const bits = ds.uint16('x00280100') || 0;
  const storedBits = ds.uint16('x00280101') || bits;
  const signed = ds.uint16('x00280103') === 1;
  const slope = Number(ds.string('x00281053') || 1), intercept = Number(ds.string('x00281052') || 0);
  const windowValue = (tag: string, fallback: number) => {
    const value = Number((ds.string(tag) || '').split('\\')[0]);
    return Number.isFinite(value) && ds.string(tag) ? value : fallback;
  };
  const windows = { lung: [-600, 1500], soft: [50, 400], bone: [300, 1800] };
  const [wl, ww] = customWindow ? [customWindow.wl,customWindow.ww] : windowMode === 'metadata'
    ? [windowValue('x00281050', 50), windowValue('x00281051', 400)] : windows[windowMode];
  if (!pixel || !Number.isFinite(ww) || !Number.isFinite(wl) || ww <= 0) throw new Error('DICOM pəncərələməsi oxunmadı');
  const scale = Math.min(1, 1600 / Math.max(image.columns, image.rows));
  const width = Math.max(1, Math.round(image.columns * scale)), height = Math.max(1, Math.round(image.rows * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Görüntü üçün canvas açıla bilmədi');
  const frame = context.createImageData(width, height);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const invert = ds.string('x00280004') === 'MONOCHROME1';
  const unit = bits / 8, mask = 2 ** storedBits - 1, signBit = 2 ** (storedBits - 1);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const sourceX = Math.min(image.columns - 1, Math.floor((x + .5) * image.columns / width));
    const sourceY = Math.min(image.rows - 1, Math.floor((y + .5) * image.rows / height));
    const offset = pixel.dataOffset + (sourceY * image.columns + sourceX) * unit;
    if (offset + unit > bytes.byteLength) throw new Error('DICOM piksel məlumatı natamamdır');
    const encoded = bits === 8 ? view.getUint8(offset) : view.getUint16(offset, true);
    let value = encoded % (mask + 1);
    if (signed && value >= signBit) value -= mask + 1;
    const gray = Math.max(0, Math.min(255, Math.round(((value * slope + intercept - wl) / ww + .5) * 255)));
    const level = invert ? 255 - gray : gray;
    const position = (y * width + x) * 4;
    frame.data[position] = frame.data[position + 1] = frame.data[position + 2] = level;
    frame.data[position + 3] = 255;
  }
  context.putImageData(frame, 0, 0);
  return canvas.toDataURL('image/jpeg', .89);
}
