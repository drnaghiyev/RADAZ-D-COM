import {preserveContextSizeOnRemoval} from './render-context-lifecycle';
import * as core from '@cornerstonejs/core';
import * as tools from '@cornerstonejs/tools';
import dicomParser from 'dicom-parser';
import type { ImageGeometry, Point3 } from './localizer';
import { themedMeasurement, installMeasurementTheme } from './measurement-tools';
import { yieldToBrowser } from './work-progress';
import { viewerPerformance } from './viewer-performance';
import { describeVolume } from './volume-geometry';
import { areaWeights, resamplePlane, volumeDimensions } from './volume-resampling';
import { parseDicomFile } from './dicom-file';
import {anatomyAutoError, type AnatomyPixels} from './anatomy-auto';
import type {AnatomyVolumeGeometry} from './anatomy-volume';

type DataSet = ReturnType<typeof dicomParser.parseDicom>;
type RecordItem = { dataSet: DataSet; pixels: Int16Array | Float32Array; rows: number; columns: number; bits: number; min: number; max: number };
const records = new Map<string, RecordItem>();
/** Decoded, rescaled pixels, independent of viewer WW/WL, flips and annotations.
 * Only allow original monochrome projection images; send no identifying tags.
 */
export async function getAnatomyPixels(imageId:string):Promise<AnatomyPixels> {
  if(!records.has(imageId)||derived.has(imageId))throw Error(anatomyAutoError('unsupported_image'));
  await decodeRegisteredDicom(imageId);
  const item=records.get(imageId);
  if(!item)throw Error('Görüntü artıq bağlıdır.');
  const ds=item.dataSet,modality=(ds.string('x00080060')||'').trim().toUpperCase();
  const photometric=(ds.string('x00280004')||'').trim().toUpperCase();
  const bodyPart=(ds.string('x00180015')||'').trim().toUpperCase();
  const sop=(ds.string('x00080016')||'').trim();
  if(!['DX','CR'].includes(modality)||!['MONOCHROME1','MONOCHROME2'].includes(photometric)||
    /BREAST|DENT|TOOTH|TEETH|MAMMO/.test(bodyPart)||['1.2.840.10008.5.1.4.1.1.1.2','1.2.840.10008.5.1.4.1.1.1.2.1','1.2.840.10008.5.1.4.1.1.1.3','1.2.840.10008.5.1.4.1.1.1.3.1'].includes(sop))throw Error(anatomyAutoError('unsupported_image'));
  if(item.rows*item.columns>16777216||item.rows<16||item.columns<16)throw Error(anatomyAutoError('invalid_size'));
  if(item.pixels.length!==item.rows*item.columns)throw Error(anatomyAutoError('invalid_pixels'));
  const floats=Float32Array.from(item.pixels),bytes=new Uint8Array(floats.buffer);
  let binary='';
  for(let i=0;i<bytes.length;i+=0x8000)binary+=String.fromCharCode(...bytes.subarray(i,i+0x8000));
  return {width:item.columns,height:item.rows,pixels:btoa(binary),modality,photometric,bodyPart};
}
const pendingDicoms = new Map<string, { bytes: Uint8Array; ds: DataSet; promise?: Promise<string> }>();
const diskDicoms = new Map<string, {url: string; signal: AbortSignal; metadata: DataSet; tags: Record<string,string>; promise?: Promise<string>; used: number}>();
const DISK_PIXEL_BUDGET = 256 * 1024 ** 2;
const borrowedUse = new Map<string, {used:number; promise?:Promise<void>}>();
function calibratedScalarBits(ds: DataSet): 16 | 32 {
  const allocated=ds.uint16('x00280100')||0, stored=ds.uint16('x00280101')||allocated;
  if (![8,16].includes(allocated) || stored<1 || stored>allocated) return 32;
  const signed=ds.uint16('x00280103')===1,slope=asNumber(ds,'x00281053',1),intercept=asNumber(ds,'x00281052',0);
  const low=(signed?-(2**(stored-1)):0)*slope+intercept;
  const high=(signed?2**(stored-1)-1:2**stored-1)*slope+intercept;
  return Number.isInteger(slope)&&Number.isInteger(intercept)&&Math.min(low,high)>=-32768&&Math.max(low,high)<=32767?16:32;
}
/** Metadata remains resident, while reloadable CD pixels use a bounded LRU. */
export function registerDiskDicom(tags: Record<string,string>, url: string, signal: AbortSignal): string {
  const ds = {byteArray: new Uint8Array(0), elements: {x7fe00010: {}},
    string: (tag:string) => tags[tag], uint16: (tag:string) => tags[tag] === undefined ? undefined : Number(tags[tag])} as unknown as DataSet;
  const rows = ds.uint16('x00280010') || 0, columns = ds.uint16('x00280011') || 0;
  if (!rows || !columns) throw Error('Disk metadatası natamamdır. RADAZ xidmətini yeniləyin.');
  const id = `localdicom:${serial++}`;
  // Plan texture memory using the calibrated type before pixels arrive. Assuming
  // every CT is Float32 would unnecessarily halve its available GPU resolution.
  const bits=calibratedScalarBits(ds);
  records.set(id, {dataSet: ds, pixels: bits===16?new Int16Array(0):new Float32Array(0), rows, columns, bits, min: -1024, max: 3071});
  diskDicoms.set(id, {url, signal, metadata: ds, tags, used: performance.now()});
  return id;
}
export function getDiskDicomSource(id: string) {
  const source = diskDicoms.get(id); return source ? {url:source.url,tags:source.tags} : null;
}
function trimDiskPixels(keep: string) {
  const candidates: [string,{used:number;promise?:unknown}][] = [...diskDicoms,...borrowedUse];
  let bytes = candidates.reduce((sum, [id]) => sum + (records.get(id)?.pixels.byteLength || 0), 0);
  for (const [id, source] of candidates.sort((a,b) => a[1].used - b[1].used)) {
    if (bytes <= DISK_PIXEL_BUDGET) break;
    if (id === keep || source.promise || engine?.getViewports().some(viewport => 'getCurrentImageId' in viewport && (viewport as core.Types.IStackViewport).getCurrentImageId() === id)) continue;
    const item = records.get(id); if (!item?.pixels.length) continue;
    // A streaming volume owns its source slices until it is closed.
    if (core.cache.getVolumes().some(volume => volume.imageIds?.includes(id))) continue;
    bytes -= item.pixels.byteLength;
    if (core.cache.getImageLoadObject(id)) core.cache.removeImageLoadObject(id, {force: true});
    records.set(id, {...item, pixels: new Float32Array(0)});
  }
}
const sourceScope = crypto.randomUUID();
const borrowedKeys = new Map<string,string>();
const borrowedLoads = new Map<string,()=>Promise<void>>();
export type SharedDicom = {key:string;record:RecordItem;resolve:()=>Promise<RecordItem>};

/** Same-origin child tabs borrow calibrated buffers, without cloning bytes or decoding again. */
export function shareLocalDicoms(imageIds:string[]):SharedDicom[] {
  return imageIds.map(id=>({key:`${sourceScope}/${id}`,record:records.get(id)!,resolve:async()=>{
    await decodeRegisteredDicom(id);
    const record=records.get(id);if(!record)throw Error('Mənbə müayinə artıq bağlıdır');return record;
  }}));
}
export function borrowLocalDicoms(images:SharedDicom[]):string[] {
  const localRecord=(record:RecordItem):RecordItem=>({...record,pixels:record.bits===16
    ?new Int16Array(record.pixels.buffer,record.pixels.byteOffset,record.pixels.length)
    :new Float32Array(record.pixels.buffer,record.pixels.byteOffset,record.pixels.length)});
  return images.map(image=>{
    const existing=borrowedKeys.get(image.key);
    if(existing&&records.has(existing))return existing;
    const id=`localdicom:${serial++}`;borrowedKeys.set(image.key,id);records.set(id,localRecord(image.record));
    const source={used:performance.now(),promise:undefined as Promise<void>|undefined},resolve=image.resolve;
    borrowedUse.set(id,source);
    borrowedLoads.set(id,()=>source.promise??=(async()=>{
      try {
        const record=await resolve();
        if(!records.has(id))throw new DOMException('Source closed','AbortError');
        records.set(id,localRecord(record));source.used=performance.now();trimDiskPixels(id);
      } finally {source.promise=undefined;}
    })());
    return id;
  });
}
const geometryOverrides = new Map<string,ImageGeometry>();
type SeriesVolume = {volumeId:string;volume:Awaited<ReturnType<typeof core.volumeLoader.createAndCacheVolume>>;
  geometry:ReturnType<typeof describeVolume>;imageIds:string[];range:[number,number];reduced:boolean;bytes:number;sourceSliceCount:number};
const seriesVolumes=new Map<string,{sourceIds:string[];owned:string[];promise:Promise<SeriesVolume>}>();
export type MprMode = 'MPR' | 'MIP' | 'MinIP' | 'Avg';
type MprPlane = 'SAG' | 'COR' | 'AX';
export type MprSettings = Record<MprPlane, { mode: MprMode; thickness: number }>;
export type MprAxes = { u: Point3; v: Point3; w: Point3 };
export type MprOrientation = { normal: Point3; horizontal: Point3; vertical: Point3 };
export type MprOrientations = Record<MprPlane, MprOrientation>;
type ObliqueVolume = { source: RecordItem[]; origin: Point3; axes: MprAxes; spacing: Point3; outside: number };
type Derived = { sourceIds: string[]; plane: MprPlane; index: number; mode: MprMode; thickness: number; geometry: ImageGeometry;
  superiorFirst: boolean; reverseHorizontal: boolean; oblique?: { volume: ObliqueVolume; normal: Point3; step: number } };
const derived = new Map<string, Derived>();
let serial = 0;
let dicomDecoder: Promise<typeof import('@cornerstonejs/dicom-image-loader')> | undefined;
let initialized: Promise<void> | undefined;
let engine: core.RenderingEngine | undefined;

function asNumber(ds: DataSet, tag: string, fallback: number) {
  const n = Number(ds.string(tag));
  return Number.isFinite(n) && ds.string(tag) ? n : fallback;
}
function values(ds: DataSet, tag: string, fallback: number[]) {
  const s = ds.string(tag);
  return s ? s.split('\\').map(Number) : fallback;
}

function defaultWindow(item: RecordItem): { wl: number; ww: number } {
  const ds = item.dataSet;
  const centers = values(ds, 'x00281050', []);
  const widths = values(ds, 'x00281051', []);
  const explanations = (ds.string('x00281055') || '').split('\\').map(value => value.toLowerCase());
  const description = `${ds.string('x0008103e') || ''} ${ds.string('x00180015') || ''}`.toLowerCase();
  const lung = /lung|pulmon|chest|thorax|ağciy|akciğ/.test(description);
  const candidates = centers.map((wl, index) => ({ wl, ww: widths[index], explanation: explanations[index] || '' }))
    .filter(({ wl, ww }) => Number.isFinite(wl) && Number.isFinite(ww) && ww > 0);
  const preferred = lung ? candidates.find(candidate => /lung|pulmon|ağciy|akciğ/.test(candidate.explanation)) : undefined;
  const chosen = preferred || candidates[0];
  if (chosen) return { wl: chosen.wl, ww: chosen.ww };
  if (lung && (ds.string('x00080060') || '').toUpperCase() === 'CT') return { wl: -600, ww: 1500 };
  return { wl: 50, ww: 400 };
}

export function getDefaultWindow(imageId: string) {
  const item = records.get(imageId);
  return item ? defaultWindow(item) : { wl: 50, ww: 400 };
}

/** Original source bytes; derived MPR frames deliberately have no source DICOM. */
export async function getOriginalDicom(imageId: string): Promise<Uint8Array | null> {
  const disk = diskDicoms.get(imageId);
  if (disk) {
    const response = await fetch(disk.url, {signal: disk.signal, cache: 'no-store'});
    if (!response.ok) throw Error('Disk çıxarılıb və ya fayl oxunmadı');
    return new Uint8Array(await response.arrayBuffer());
  }
  const item = records.get(imageId);
  return item && !derived.has(imageId) ? new Uint8Array(item.dataSet.byteArray) : null;
}

export function getLocalizerGeometry(imageId: string): ImageGeometry | null {
  if(geometryOverrides.has(imageId))return geometryOverrides.get(imageId)!;
  if (derived.has(imageId)) return derived.get(imageId)!.geometry;
  const item = records.get(imageId);
  if (!item) return null;
  const ds = item.dataSet;
  const orientation = values(ds, 'x00200037', []);
  const origin = values(ds, 'x00200032', []);
  const spacing = values(ds, 'x00280030', []);
  const studyId = ds.string('x0020000d') || '';
  if (!studyId || orientation.length !== 6 || origin.length !== 3 || spacing.length !== 2 ||
      ![...orientation, ...origin, ...spacing].every(Number.isFinite) || spacing.some(value => value <= 0)) return null;
  const columnDirection = orientation.slice(0, 3) as Point3;
  const rowDirection = orientation.slice(3, 6) as Point3;
  if (Math.hypot(...columnDirection) < .9 || Math.hypot(...rowDirection) < .9) return null;
  return { studyId, frameId: ds.string('x00200052') || '', origin: origin as Point3,
    columnDirection, rowDirection, rowSpacing: spacing[0], columnSpacing: spacing[1],
    rows: item.rows, columns: item.columns };
}

/** Only display physical measurement units when spacing is supplied by the DICOM image. */
export function getMeasurementUnit(imageId: string): 'mm' | 'px' {
  const reformat = derived.get(imageId);
  if (reformat) return reformat.geometry.rowSpacing > 0 && reformat.geometry.columnSpacing > 0 ? 'mm' : 'px';
  const item = records.get(imageId);
  if (!item) return 'px';
  const spacing = values(item.dataSet, 'x00280030', []);
  return spacing.length === 2 && spacing.every(value => Number.isFinite(value) && value > 0) ? 'mm' : 'px';
}

export async function loadDicomThumbnail(imageId: string): Promise<string | undefined> {
  await decodeRegisteredDicom(imageId);
  return thumbnailLocalDicom(imageId);
}

export function thumbnailLocalDicom(imageId: string): string | undefined {
  const item = records.get(imageId);
  if (!item || !item.pixels.length || typeof document === 'undefined') return;
  const { rows, columns, pixels, dataSet } = item;
  const width = Math.min(112, columns), height = Math.min(112, rows);
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) return;
  const image = context.createImageData(width, height);
  const { wl, ww } = defaultWindow(item);
  const lower = wl - ww / 2;
  const invert = dataSet.string('x00280004') === 'MONOCHROME1';
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const sample = pixels[Math.min(rows - 1, Math.floor((y + .5) * rows / height)) * columns + Math.min(columns - 1, Math.floor((x + .5) * columns / width))];
    const level = Math.round(Math.max(0, Math.min(1, (sample - lower) / ww)) * 255);
    const value = invert ? 255 - level : level;
    const offset = (y * width + x) * 4;
    image.data[offset] = image.data[offset + 1] = image.data[offset + 2] = value;
    image.data[offset + 3] = 255;
  }
  context.putImageData(image, 0, 0);
  return canvas.toDataURL('image/png');
}

function metadata(type: string, imageId: string) {
  const item = records.get(imageId);
  if (!item) return;
  const { dataSet: ds, rows, columns, bits } = item;
  const m = core.Enums.MetadataModules;
  if (type === m.IMAGE_PLANE) {
    const reformat = derived.get(imageId);
    if (reformat || geometryOverrides.has(imageId)) {
      const g = reformat?.geometry || geometryOverrides.get(imageId)!;
      return { frameOfReferenceUID: g.frameId || g.studyId, rows: g.rows, columns: g.columns,
        rowCosines: g.columnDirection, columnCosines: g.rowDirection,
        imageOrientationPatient: [...g.columnDirection, ...g.rowDirection], imagePositionPatient: g.origin,
        rowPixelSpacing: g.rowSpacing, columnPixelSpacing: g.columnSpacing,
        pixelSpacing: [g.rowSpacing, g.columnSpacing], sliceThickness: reformat?.thickness || 1, usingDefaultValues: false };
    }
    const orientation = values(ds, 'x00200037', [1, 0, 0, 0, 1, 0]);
    const spacing = values(ds, 'x00280030', [1, 1]);
    return { frameOfReferenceUID: ds.string('x00200052') || ds.string('x0020000d') || 'local-study',
      rows, columns, rowCosines: orientation.slice(0, 3), columnCosines: orientation.slice(3, 6),
      imageOrientationPatient: orientation, imagePositionPatient: values(ds, 'x00200032', [0, 0, 0]),
      rowPixelSpacing: spacing[0], columnPixelSpacing: spacing[1], pixelSpacing: spacing,
      sliceThickness: asNumber(ds, 'x00180050', 1), usingDefaultValues: !ds.string('x00280030') };
  }
  if (type === m.IMAGE_PIXEL) return { rows, columns, bitsAllocated: bits, bitsStored: bits,
    highBit: bits - 1, pixelRepresentation: 1,
    samplesPerPixel: 1, photometricInterpretation: ds.string('x00280004') || 'MONOCHROME2' };
  if (type === m.VOI_LUT) { const { wl, ww } = defaultWindow(item); return { windowCenter: [wl], windowWidth: [ww] }; }
  if (type === m.MODALITY_LUT) return { rescaleIntercept: 0, rescaleSlope: 1 };
  if (type === 'generalImageModule') return { instanceNumber: asNumber(ds, 'x00200013', 0) };
  if (type === m.GENERAL_SERIES) return { modality: ds.string('x00080060') || 'OT', seriesInstanceUID: ds.string('x0020000e') };
  if (type === m.SOP_COMMON) return { sopClassUID: ds.string('x00080016'), sopInstanceUID: ds.string('x00080018') };
}

function loadImage(imageId: string): core.Types.IImageLoadObject {
  const borrowed=borrowedLoads.get(imageId);
  if(borrowed){borrowedUse.get(imageId)!.used=performance.now();if(!records.get(imageId)?.pixels.length)return {promise:borrowed().then(()=>loadImage(imageId).promise)};}
  if (pendingDicoms.has(imageId)) return { promise: decodeRegisteredDicom(imageId).then(() => loadImage(imageId).promise) };
  if (diskDicoms.has(imageId)) {
    diskDicoms.get(imageId)!.used = performance.now();
    if (!records.get(imageId)?.pixels.length) return {promise: decodeRegisteredDicom(imageId).then(() => loadImage(imageId).promise)};
  }
  const item = records.get(imageId);
  if (!item) return { promise: Promise.reject(new Error('DICOM görüntüsü tapılmadı')) };
  if (derived.has(imageId) && !item.pixels.length) materialize(imageId);
  const { pixels, rows, columns, dataSet: ds } = item;
  const { wl: wc, ww } = defaultWindow(item);
  const geometry = derived.get(imageId)?.geometry || geometryOverrides.get(imageId);
  const spacing = geometry ? [geometry.rowSpacing, geometry.columnSpacing] : values(ds, 'x00280030', [1, 1]);
  const voxelManager = core.utilities.VoxelManager.createImageVoxelManager({ scalarData: pixels, width: columns, height: rows, numberOfComponents: 1 });
  const image = {
    imageId, rows, columns, width: columns, height: rows, color: false,
    dataType: pixels.constructor.name, sizeInBytes: pixels.byteLength,
    rowPixelSpacing: spacing[0], columnPixelSpacing: spacing[1],
    minPixelValue: item.min, maxPixelValue: item.max,
    slope: 1, intercept: 0,
    windowCenter: wc, windowWidth: ww, invert: ds.string('x00280004') === 'MONOCHROME1',
    voxelManager, getPixelData: () => pixels,
  } as core.Types.IImage;
  return { promise: Promise.resolve(image) };
}

/** vtk.js local volumes expose their generated slices through the image cache. */
function loadCachedVolumeSlice(imageId: string): core.Types.IImageLoadObject {
  const image = core.cache.getImage(imageId);
  return image ? { promise: Promise.resolve(image) } : { promise: Promise.reject(new Error(`3D həcm kəsiti cache-də tapılmadı: ${imageId}`)) };
}

export function registerLocalDicom(bytes: Uint8Array, ds: DataSet): string {
  const rows=ds.uint16('x00280010')||0,columns=ds.uint16('x00280011')||0;
  if(!rows||!columns||!ds.elements.x7fe00010)throw Error('DICOM piksel məlumatı tapılmadı');
  const id=`localdicom:${serial++}`;
  records.set(id,{dataSet:ds,pixels:new Float32Array(0),rows,columns,bits:32,min:-1024,max:3071});
  pendingDicoms.set(id,{bytes,ds});return id;
}
function decodeRegisteredDicom(id:string):Promise<string> {
  const disk = diskDicoms.get(id);
  if (disk && !records.get(id)?.pixels.length) return disk.promise ??= (async () => {
    try {
      const response = await fetch(disk.url, {signal: AbortSignal.any([disk.signal, AbortSignal.timeout(60000)]), cache: 'no-store'});
      if (!response.ok) throw Error('Disk çıxarılıb və ya görüntü oxunmadı');
      const bytes = new Uint8Array(await response.arrayBuffer());
      await decodeLocalDicom(bytes, parseDicomFile(bytes), id);
      const item = records.get(id)!;
      // Release original pixel bytes; exporting can read the disc again.
      records.set(id, {...item, dataSet: disk.metadata});
      trimDiskPixels(id); return id;
    } finally { disk.promise = undefined; }
  })();
  const entry=pendingDicoms.get(id);
  if(!entry)return Promise.resolve(id);
  return entry.promise ??= decodeLocalDicom(entry.bytes,entry.ds,id).then(value=>{pendingDicoms.delete(id);return value;});
}
export async function addLocalDicom(bytes: Uint8Array, ds: DataSet): Promise<string> {
  return decodeRegisteredDicom(registerLocalDicom(bytes,ds));
}
async function decodeLocalDicom(bytes: Uint8Array, ds: DataSet, imageId: string): Promise<string> {
  const decodeStart = performance.now();
  const syntax = ds.string('x00020010') || '1.2.840.10008.1.2.1';
  const rows = ds.uint16('x00280010') || 0;
  const columns = ds.uint16('x00280011') || 0;
  const bits = ds.uint16('x00280100') || 0;
  const storedBits = ds.uint16('x00280101') || bits;
  const highBit = ds.uint16('x00280102') ?? (storedBits - 1);
  const signed = ds.uint16('x00280103') === 1;
  const pixelElement = ds.elements.x7fe00010;
  const photometric = ds.string('x00280004') || 'MONOCHROME2';
  if (!rows || !columns || ![8, 16].includes(bits) || storedBits < 1 || storedBits > bits || highBit >= bits || highBit < storedBits - 1 ||
      ds.uint16('x00280002') !== 1 || !['MONOCHROME1', 'MONOCHROME2'].includes(photometric) || !pixelElement)
    throw new Error('Bu görüntünün piksel formatı dəstəklənmir (monoxrom 8/16-bit tələb olunur)');
  const uncompressed = ['1.2.840.10008.1.2', '1.2.840.10008.1.2.1', '1.2.840.10008.1.2.2'].includes(syntax);
  const byteLength = rows * columns * (bits / 8);
  let stored: Uint8Array | Uint16Array | Int16Array | Float32Array;
  if (uncompressed && !pixelElement.encapsulatedPixelData) {
    if (pixelElement.length < byteLength || pixelElement.dataOffset + byteLength > bytes.length) throw new Error('Piksel məlumatı natamamdır');
    const view = new DataView(bytes.buffer, bytes.byteOffset + pixelElement.dataOffset, byteLength);
    if(bits===8) stored=bytes.subarray(pixelElement.dataOffset,pixelElement.dataOffset+byteLength);
    else if(syntax!=='1.2.840.10008.1.2.2' && (bytes.byteOffset+pixelElement.dataOffset)%2===0)
      stored=new Uint16Array(bytes.buffer,bytes.byteOffset+pixelElement.dataOffset,rows*columns);
    else { stored=new Uint16Array(rows*columns); for(let i=0;i<stored.length;i++)stored[i]=view.getUint16(i*2,syntax!=='1.2.840.10008.1.2.2'); }
  } else {
    // The DICOM loader supplies JPEG, JPEG-LS, JPEG 2000 and RLE codecs.
    // Decode directly because a second worker registry can stall when this
    // viewer's rendering engine is already running in a different tab.
    dicomDecoder ??= import('@cornerstonejs/dicom-image-loader');
    const decoder = await dicomDecoder;
    try {
      const frame = decoder.wadouri.getPixelData(ds, 0);
      if (!frame) throw new Error('Piksel kadrı tapılmadı');
      const image = await decoder.decodeImageFrame({ rows, columns, bitsAllocated: bits, bitsStored: storedBits,
        pixelRepresentation: signed ? 1 : 0, samplesPerPixel: 1, photometricInterpretation: photometric,
        planarConfiguration: 0, pixelData: undefined, imageId }, syntax, frame,
        { wasmBasePath: '/dicom-codecs' }, { preScale: { enabled: false } }, undefined);
      const decoded = image.pixelData;
      if (!decoded) throw new Error('Dekodlanmış piksellər tapılmadı');
      if (decoded.length !== rows * columns) throw new Error('Dekodlanmış piksel sayı uyğun deyil');
      stored = decoded as typeof stored;
    } catch (error) {
      throw new Error(`Sıxılmış rentgen açıla bilmədi: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  const slope = asNumber(ds, 'x00281053', 1), intercept = asNumber(ds, 'x00281052', 0);
  const shift = highBit + 1 - storedBits, mask = 2 ** storedBits - 1, signBit = 2 ** (storedBits - 1);
  const pixelValue = (value: number) => {
    // Decoders return signed pixels already expanded; native pixels need
    // high-bit masking and sign extension (common in 12-bit CR/DX files).
    if (!uncompressed || pixelElement.encapsulatedPixelData) return value;
    const encoded = (value >>> shift) & mask;
    return signed && encoded >= signBit ? encoded - (mask + 1) : encoded;
  };
  const useInt16 = calibratedScalarBits(ds)===16;
  const pixels = useInt16 ? new Int16Array(stored.length) : new Float32Array(stored.length);
  let min = Infinity, max = -Infinity;
  for (let i = 0; i < stored.length; i++) {
    const value = pixelValue(stored[i]) * slope + intercept;
    pixels[i] = value;
    if (value < min) min = value;
    if (value > max) max = value;
  }
  if(!records.has(imageId))throw new DOMException('DICOM import cancelled','AbortError');
  records.set(imageId, { dataSet: ds, pixels, rows, columns, bits: useInt16 ? 16 : 32, min, max });
  viewerPerformance.decodeCount++; viewerPerformance.decodeMs += performance.now() - decodeStart;
  return imageId;
}

export function sampleLocalDicom(imageId: string, world: readonly number[]): number | null {
  const item = records.get(imageId);
  if (!item) return null;
  if (derived.has(imageId) && !item.pixels.length) materialize(imageId);
  const ds = item.dataSet;
  const geometry = derived.get(imageId)?.geometry || geometryOverrides.get(imageId);
  const origin = geometry?.origin || values(ds, 'x00200032', [0, 0, 0]);
  const orientation = geometry ? [...geometry.columnDirection, ...geometry.rowDirection] : values(ds, 'x00200037', [1, 0, 0, 0, 1, 0]);
  const [rowSpacing, columnSpacing] = geometry ? [geometry.rowSpacing, geometry.columnSpacing] : values(ds, 'x00280030', [1, 1]);
  if (!rowSpacing || !columnSpacing) return null;
  const delta = [world[0] - origin[0], world[1] - origin[1], world[2] - origin[2]];
  const column = Math.round(delta.reduce((sum, value, i) => sum + value * orientation[i], 0) / columnSpacing);
  const row = Math.round(delta.reduce((sum, value, i) => sum + value * orientation[i + 3], 0) / rowSpacing);
  if (column < 0 || column >= item.columns || row < 0 || row >= item.rows) return null;
  return item.pixels[row * item.columns + column];
}

export function releaseLocalDicoms(imageIds: string[]) {
  releaseSeriesVolumes(imageIds);
  for (const imageId of imageIds) {
    derived.delete(imageId);
    geometryOverrides.delete(imageId);
    pendingDicoms.delete(imageId);
    diskDicoms.delete(imageId);
    borrowedLoads.delete(imageId);
    borrowedUse.delete(imageId);
    records.delete(imageId);
    if (core.cache.getImageLoadObject(imageId)) core.cache.removeImageLoadObject(imageId, { force: true });
  }
  const removed=new Set(imageIds);
  for(const [key,id] of borrowedKeys)if(removed.has(id))borrowedKeys.delete(key);
}

const dot3 = (a: readonly number[], b: readonly number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const plus3 = (a: Point3, b: Point3, multiplier = 1): Point3 => [a[0] + b[0] * multiplier, a[1] + b[1] * multiplier, a[2] + b[2] * multiplier];
const cross3 = (a: Point3, b: Point3): Point3 => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
const normalized = (point: Point3): Point3 => point.map(value => value / Math.hypot(...point)) as Point3;

export function seriesGeometry(imageIds:string[]) {
  return describeVolume(imageIds.map(id=>{
    const g=getLocalizerGeometry(id),ds=records.get(id)?.dataSet;
    if(!g||!ds)throw Error('Volume üçün DICOM məkan koordinatları tələb olunur');
    return {...g,id,sopUID:derived.has(id)||geometryOverrides.has(id)?undefined:ds.string('x00080018')?.trim(),sliceThickness:asNumber(ds,'x00180050',0),spacingBetweenSlices:asNumber(ds,'x00180088',0)};
  }));
}
/** Stream a complete, geometry-validated CT/MR volume at the model's 3 mm scale.
 * Area averaging preserves every source voxel and the physical voxel centres;
 * it never uses screen captures, display windowing or arbitrary slice numbers.
 */
export function anatomyVolumeSource(imageIds:string[]) {
  const source=seriesGeometry(imageIds),first=records.get(imageIds[0])!;
  const modality=first.dataSet.string('x00080060')?.trim().toUpperCase();
  if(modality!=='CT'&&modality!=='MR')throw Error('KT və ya MRT seriyası seçin.');
  for(const id of imageIds){
    const ds=records.get(id)?.dataSet;
    if(!ds||derived.has(id)||ds.string('x00080060')?.trim().toUpperCase()!==modality||/LOCALIZER|SCOUT|PROJECTION/.test(ds.string('x00080008')||''))throw Error('Analiz üçün orijinal, eyni sekvensə aid KT/MRT kəsiklərini seçin.');
  }
  const dimensions=source.dimensions.map((n,i)=>Math.max(3,Math.min(n,Math.ceil(n*source.spacing[i]/3)))) as Point3;
  if(dimensions.reduce((a,b)=>a*b,1)>32000000)throw Error('Seriya lokal analizin yaddaş limitini aşır.');
  const scale=source.dimensions.map((n,i)=>n/dimensions[i]);
  const spacing=source.spacing.map((n,i)=>n*scale[i]) as Point3;
  const origin=source.origin.map((n,axis)=>n+scale.reduce((sum,ratio,i)=>sum+source.direction[i*3+axis]*source.spacing[i]*(ratio-1)/2,0)) as Point3;
  const geometry:AnatomyVolumeGeometry={dimensions,spacing,origin,direction:source.direction,modality};
  const weights=source.dimensions.map((n,i)=>areaWeights(n,dimensions[i]));
  let last=-1,plane:Float32Array|null=null;
  return {geometry,async slice(z:number,signal:AbortSignal){
    const pixels=new Float32Array(dimensions[0]*dimensions[1]);
    for(const item of weights[2][z]){
      signal.throwIfAborted();
      if(last!==item.index){await core.imageLoader.loadAndCacheImage(source.imageIds[item.index]);signal.throwIfAborted();const record=records.get(source.imageIds[item.index]);if(!record)throw Error('Seriya bağlandı.');plane=resamplePlane(record.pixels,record.columns,weights[0],weights[1]);last=item.index;}
      for(let i=0;i<pixels.length;i++)pixels[i]+=plane![i]*item.weight;
    }
    await yieldToBrowser();return pixels;
  }};
}
/** One streaming volume and the same decoded slice buffers serve MPR and 3D. */
export async function getSeriesVolume(imageIds:string[],limits?:{maxDimension:number;budgetBytes:number}):Promise<SeriesVolume> {
  const geometry=seriesGeometry(imageIds),ids=geometry.imageIds;
  const dimension=limits?.maxDimension||Infinity,budget=limits?.budgetBytes||Infinity;
  const dimensions=volumeDimensions(geometry.dimensions,dimension,budget,ids.some(id=>records.get(id)?.bits===32)?4:2);
  const reduced=dimensions.some((n,i)=>n!==geometry.dimensions[i]);
  const key=ids.join('|')+`@${dimensions.join('x')}`;
  const cached=seriesVolumes.get(key);
  if(cached){viewerPerformance.volumeCacheHits++;return cached.promise;}
  // A growing media series supersedes its partial volume; never retain every prefix.
  const sourceSet=new Set(ids);
  for(const [oldKey,entry] of seriesVolumes)if(entry.sourceIds.length<ids.length&&entry.sourceIds.every(id=>sourceSet.has(id))){
    seriesVolumes.delete(oldKey);disposeSeriesVolume(entry);
  }
  const owned:string[]=[];
  const promise=(async()=>{
    const start=performance.now();
    await getViewer();
    let volumeIds=ids;
    if(reduced){
      volumeIds=[];
      const [columns,rows,depth]=dimensions;
      const weights=geometry.dimensions.map((n,i)=>areaWeights(n,dimensions[i]));
      const scale=geometry.dimensions.map((n,i)=>n/dimensions[i]);
      const spacing=geometry.spacing.map((n,i)=>n*scale[i]);
      const g=getLocalizerGeometry(ids[0])!;
      const origin=geometry.origin.map((n,axis)=>n+scale.reduce((offset,ratio,i)=>offset+geometry.direction[i*3+axis]*geometry.spacing[i]*(ratio-1)/2,0)) as Point3;
      let lastIndex=-1,lastPlane:Float32Array|undefined;
      for(let z=0;z<depth;z++){
        const pixels=new Float32Array(rows*columns);
        for(const source of weights[2][z]){
          if(lastIndex!==source.index){
            await core.imageLoader.loadAndCacheImage(ids[source.index]);
            const record=records.get(ids[source.index])!;
            lastPlane=resamplePlane(record.pixels,record.columns,weights[0],weights[1]);lastIndex=source.index;
          }
          for(let i=0;i<pixels.length;i++)pixels[i]+=lastPlane![i]*source.weight;
        }
        const id=`localdicom:${serial++}`;owned.push(id);volumeIds.push(id);
        const record=records.get(ids[weights[2][z][0].index])!;
        records.set(id,{...record,pixels,rows,columns,bits:32});
        geometryOverrides.set(id,{...g,rows,columns,rowSpacing:spacing[1],columnSpacing:spacing[0],
          origin:origin.map((n,axis)=>n+geometry.direction[6+axis]*z*spacing[2]) as Point3});
        if(z%4===0)await yieldToBrowser();
      }
    }
    // A cached first image also supplies the actual calibrated scalar type.
    await core.imageLoader.loadAndCacheImage(volumeIds[0]);
    const volumeId=`radaz-stream:${serial++}`;
    const volume=await core.volumeLoader.createAndCacheVolume(volumeId,{imageIds:[...volumeIds]});
    // Per-slice rescale can differ. A later fractional slice must never be cast
    // to the first slice's Int16 type by the streaming GPU uploader.
    if(volumeIds.some(id=>records.get(id)?.bits===32)){
      volume.dataType='Float32Array';volume.imageData!.set({dataType:'Float32Array'},true);
    }
    const bytes=volume.dimensions.reduce((n,d)=>n*d,volume.dataType==='Float32Array'?4:2);
    viewerPerformance.volumeBuildCount++;viewerPerformance.volumeBuildMs+=performance.now()-start;
    viewerPerformance.voxelBytes=bytes;
    volume.load();
    return {volumeId,volume,geometry:reduced?seriesGeometry(volumeIds):geometry,imageIds:volumeIds,
      get range():[number,number]{return [Math.min(...ids.map(id=>records.get(id)?.min??-1024)),Math.max(...ids.map(id=>records.get(id)?.max??3071))];},reduced,bytes,sourceSliceCount:ids.length};
  })();
  seriesVolumes.set(key,{sourceIds:ids,owned,promise});
  promise.catch(()=>{seriesVolumes.delete(key);for(const id of owned){records.delete(id);geometryOverrides.delete(id);}});
  return promise;
}
function releaseSeriesVolumes(imageIds:string[]) {
  const removed=new Set(imageIds);
  for(const [key,entry] of seriesVolumes)if(entry.sourceIds.some(id=>removed.has(id))){
    seriesVolumes.delete(key);
    disposeSeriesVolume(entry);
  }
}
function disposeSeriesVolume(entry:{owned:string[];promise:Promise<SeriesVolume>}) {
  void entry.promise.then(({volumeId,volume})=>{
    volume.cancelLoading?.();
    if(core.cache.getVolume(volumeId))core.cache.removeVolumeLoadObject(volumeId);
    volume.vtkOpenGLTexture.releaseGraphicsResources();
    volume.vtkOpenGLTexture.delete();
    for(const id of entry.owned){records.delete(id);geometryOverrides.delete(id);if(core.cache.getImageLoadObject(id))core.cache.removeImageLoadObject(id,{force:true});}
  }).catch(()=>{});
}

export function getMprAxes(imageId: string): MprAxes | null {
  const g = getLocalizerGeometry(imageId);
  if (!g) return null;
  return { u: normalized(g.columnDirection), v: normalized(g.rowDirection), w: normalized(cross3(g.columnDirection, g.rowDirection)) };
}

/** Initial patient-oriented MPR planes; each plane can subsequently turn independently. */
export function getMprOrientations(imageId: string): MprOrientations | null {
  const frame = getMprAxes(imageId);
  if (!frame) return null;
  const vertical: Point3 = frame.w.map(value => value * (frame.w[2] >= 0 ? -1 : 1)) as Point3;
  const geometry = getLocalizerGeometry(imageId)!;
  return {
    SAG: { normal: frame.u, horizontal: frame.v.map(value => value * (geometry.rowDirection[1] >= 0 ? 1 : -1)) as Point3, vertical },
    COR: { normal: frame.v, horizontal: frame.u.map(value => value * (geometry.columnDirection[0] >= 0 ? 1 : -1)) as Point3, vertical },
    AX: { normal: frame.w, horizontal: frame.u, vertical: frame.v },
  };
}

/** Rodrigues rotation of one reformat plane about the intersection with the target plane. */
export function rotateMprOrientation(orientation: MprOrientation, axis: Point3, angle: number): MprOrientation {
  const n = normalized(axis), cos = Math.cos(angle), sin = Math.sin(angle);
  const rotate = (point: Point3): Point3 => normalized(plus3(plus3(point.map(value => value * cos) as Point3,
    cross3(n, point), sin), n, dot3(n, point) * (1 - cos)));
  return { normal: rotate(orientation.normal), horizontal: rotate(orientation.horizontal), vertical: rotate(orientation.vertical) };
}

/** Reconstruct one actual oblique frame from the original calibrated voxel volume. */
export function createObliqueMprStacks(imageIds: string[], settings: MprSettings, orientations: MprOrientations, pivot: Point3, planes: MprPlane[] = ['SAG','COR','AX']): Record<MprPlane, string[]> {
  imageIds=seriesGeometry(imageIds).imageIds;
  // Use the existing volume validation before registering any new derived images.
  const slices = imageIds.map(id => ({ id, record: records.get(id), geometry: getLocalizerGeometry(id) }));
  if (slices.length < 3 || slices.some(s => !s.record || !s.geometry)) throw new Error('MPR üçün məkan koordinatlı kəsitlər lazımdır');
  const first = slices[0].geometry!;
  const sourceAxes = getMprAxes(imageIds[0])!;
  slices.sort((a, b) => dot3(a.geometry!.origin, sourceAxes.w) - dot3(b.geometry!.origin, sourceAxes.w));
  const start = slices[0].geometry!;
  const gap = (dot3(slices.at(-1)!.geometry!.origin, sourceAxes.w) - dot3(start.origin, sourceAxes.w)) / (slices.length - 1);
  if (gap < .01 || slices.some((s, index) => s.geometry!.rows !== first.rows || s.geometry!.columns !== first.columns ||
    s.geometry!.studyId !== first.studyId || s.geometry!.frameId !== first.frameId ||
    Math.abs(dot3(s.geometry!.columnDirection, sourceAxes.u) - 1) > .001 ||
    Math.abs(dot3(s.geometry!.rowDirection, sourceAxes.v) - 1) > .001 ||
    Math.abs(s.geometry!.rowSpacing - first.rowSpacing) > .001 || Math.abs(s.geometry!.columnSpacing - first.columnSpacing) > .001 ||
    Math.abs(dot3(plus3(s.geometry!.origin, start.origin, -1), sourceAxes.u)) > .5 ||
    Math.abs(dot3(plus3(s.geometry!.origin, start.origin, -1), sourceAxes.v)) > .5 ||
    Math.abs(dot3(s.geometry!.origin, sourceAxes.w) - dot3(start.origin, sourceAxes.w) - index * gap) > Math.max(.1, gap * .2)))
    throw new Error('MPR üçün eyni ölçülü, paralel və bərabər aralıqlı kəsitlər seçin');
  const sourceIds = slices.map(s => s.id);
  const volume: ObliqueVolume = { source: slices.map(s => s.record!), origin: start.origin, axes: sourceAxes,
    spacing: [first.columnSpacing, first.rowSpacing, gap], outside: slices[0].record!.dataSet.string('x00080060') === 'CT' ? -1024 : slices[0].record!.min };
  // Project all eight volume corners into each rotated direction to retain the full anatomy.
  const corners: Point3[] = [];
  for (const x of [-.5, first.columns - .5]) for (const y of [-.5, first.rows - .5]) for (const z of [-.5, slices.length - .5])
    corners.push(plus3(plus3(plus3(start.origin, sourceAxes.u, x * first.columnSpacing), sourceAxes.v, y * first.rowSpacing), sourceAxes.w, z * gap));
  const projected = (axis: Point3) => corners.map(corner => dot3(plus3(corner, pivot, -1), axis));
  const spacingFor = (axis: Point3) => 1 / Math.hypot(dot3(axis, sourceAxes.u) / first.columnSpacing,
    dot3(axis, sourceAxes.v) / first.rowSpacing, dot3(axis, sourceAxes.w) / gap);
  const descriptor = (axis: Point3, anchor = false) => {
    const coordinates = projected(axis), min = Math.min(...coordinates), max = Math.max(...coordinates);
    const step = Math.max(spacingFor(axis), (max - min) / 799);
    if (anchor) { const first = Math.floor(min / step), last = Math.ceil(max / step); return { start: first * step, count: last - first + 1, step }; }
    return { start: min + step / 2, count: Math.max(1, Math.ceil((max - min) / step)), step };
  };
  const stacks: Record<MprPlane, string[]> = { SAG: [], COR: [], AX: [] };
  for (const plane of planes) {
    const { mode, thickness } = settings[plane];
    const axes = orientations[plane];
    const n = descriptor(axes.normal, true), h = descriptor(axes.horizontal), v = descriptor(axes.vertical);
    const baseOrigin = plus3(plus3(pivot, axes.horizontal, h.start), axes.vertical, v.start);
    for (let index = 0; index < n.count; index++) {
      const geometry: ImageGeometry = { ...start, origin: plus3(baseOrigin, axes.normal, n.start + index * n.step),
        columnDirection: axes.horizontal, rowDirection: axes.vertical,
        columns: h.count, rows: v.count, columnSpacing: h.step, rowSpacing: v.step };
      const id = `localdicom:${serial++}`;
      const reference = slices[0].record!;
      records.set(id, { ...reference, pixels: new Float32Array(0), bits: 32, rows: geometry.rows, columns: geometry.columns });
      derived.set(id, { sourceIds, plane, index, mode, thickness, geometry, superiorFirst: axes.vertical[2] < 0,
        reverseHorizontal: false, oblique: { volume, normal: axes.normal, step: n.step } });
      stacks[plane].push(id);
    }
  }
  return stacks;
}

/** Reformat one parallel, regularly spaced mono volume into three patient-space stacks. */
export function createMprStacks(imageIds: string[], settings: MprSettings, planes: MprPlane[] = ['SAG','COR','AX']): Record<MprPlane, string[]> {
  imageIds=seriesGeometry(imageIds).imageIds;
  if (imageIds.length < 3) throw new Error('MPR üçün ən azı 3 məkan koordinatlı kəsit lazımdır');
  const slices = imageIds.map(id => ({ id, record: records.get(id), geometry: getLocalizerGeometry(id) }));
  if (slices.some(s => !s.record || !s.geometry)) throw new Error('MPR üçün DICOM məkan koordinatları tələb olunur');
  const base = slices[0].geometry!;
  const normal = ((): Point3 => {
    const c = base.columnDirection, r = base.rowDirection;
    const n: Point3 = [c[1]*r[2]-c[2]*r[1], c[2]*r[0]-c[0]*r[2], c[0]*r[1]-c[1]*r[0]];
    const size = Math.hypot(...n); return n.map(v => v / size) as Point3;
  })();
  if (!normal.every(Number.isFinite)) throw new Error('DICOM müstəvi istiqaməti etibarsızdır');
  const dot = (a: Point3, b: Point3) => a.reduce((sum, value, i) => sum + value * b[i], 0);
  const ordered = slices.map(s => ({ ...s, z: dot(s.geometry!.origin, normal) })).sort((a, b) => a.z - b.z);
  const gap = (ordered.at(-1)!.z - ordered[0].z) / (ordered.length - 1);
  const firstOrigin = ordered[0].geometry!.origin;
  if (gap < .01 || ordered.some((s, i) => s.geometry!.rows !== base.rows || s.geometry!.columns !== base.columns ||
    s.geometry!.studyId !== base.studyId || s.geometry!.frameId !== base.frameId ||
    Math.abs(dot(s.geometry!.columnDirection, base.columnDirection) - 1) > .001 ||
    Math.abs(dot(s.geometry!.rowDirection, base.rowDirection) - 1) > .001 ||
    Math.abs(s.geometry!.rowSpacing - base.rowSpacing) > .001 ||
    Math.abs(s.geometry!.columnSpacing - base.columnSpacing) > .001 ||
    Math.abs(dot(s.geometry!.origin.map((v, j) => v - firstOrigin[j]) as Point3, base.columnDirection)) > .5 ||
    Math.abs(dot(s.geometry!.origin.map((v, j) => v - firstOrigin[j]) as Point3, base.rowDirection)) > .5 ||
    Math.abs(s.z - ordered[0].z - i * gap) > Math.max(.1, gap * .2)))
    throw new Error('MPR üçün eyni ölçülü, paralel və bərabər aralıqlı kəsitlər seçin');
  const sourceIds = ordered.map(s => s.id);
  const first = ordered[0].geometry!;
  const superiorFirst = normal[2] > 0;
  const vertical: Point3 = normal.map(v => superiorFirst ? -v : v) as Point3;
  const coronalSign = first.columnDirection[0] < 0 ? -1 : 1;
  const sagittalSign = first.rowDirection[1] < 0 ? -1 : 1;
  const originAt = (origin: Point3, axis: Point3, distance: number): Point3 => origin.map((v, i) => v + axis[i] * distance) as Point3;
  const stacks = { SAG: [] as string[], COR: [] as string[], AX: [] as string[] };
  for (const plane of planes) {
    const { mode, thickness } = settings[plane];
    const count = plane === 'SAG' ? first.columns : plane === 'COR' ? first.rows : sourceIds.length;
    for (let index = 0; index < count; index++) {
      if (plane === 'AX' && mode === 'MPR' && thickness < gap * 2) { stacks.AX.push(sourceIds[index]); continue; }
      const horizontal = plane === 'SAG' ? first.rowDirection : first.columnDirection;
      const horizontalSign = plane === 'AX' ? 1 : plane === 'SAG' ? sagittalSign : coronalSign;
      const fixedAxis = plane === 'SAG' ? first.columnDirection : first.rowDirection;
      const fixedSpacing = plane === 'SAG' ? first.columnSpacing : first.rowSpacing;
      const horizontalSize = plane === 'SAG' ? first.rows : first.columns;
      const horizontalSpacing = plane === 'SAG' ? first.rowSpacing : first.columnSpacing;
      const topOrigin = superiorFirst ? ordered.at(-1)!.geometry!.origin : first.origin;
      const geometry: ImageGeometry = plane === 'AX' ? { ...ordered[index].geometry! } : {
        ...first, origin: originAt(originAt(topOrigin, fixedAxis, index * fixedSpacing), horizontal,
          horizontalSign < 0 ? (horizontalSize - 1) * horizontalSpacing : 0),
        columnDirection: horizontal.map(v => v * horizontalSign) as Point3,
        rowDirection: vertical,
        columnSpacing: plane === 'SAG' ? first.rowSpacing : first.columnSpacing,
        rowSpacing: gap,
        columns: plane === 'SAG' ? first.rows : first.columns,
        rows: sourceIds.length,
      };
      const reference = ordered[0].record!;
      const id = `localdicom:${serial++}`;
      records.set(id, { ...reference, rows: geometry.rows, columns: geometry.columns,
        bits: mode === 'Avg' || (mode === 'MPR' && thickness > 1) ? 32 : reference.bits,
        pixels: new Int16Array(0) });
      derived.set(id, { sourceIds, plane, index, mode, thickness, geometry, superiorFirst, reverseHorizontal: horizontalSign < 0 });
      stacks[plane].push(id);
    }
  }
  return stacks;
}

function materialize(imageId: string) {
  const target = records.get(imageId)!;
  const { sourceIds, plane, index, mode, thickness, superiorFirst, reverseHorizontal, oblique, geometry } = derived.get(imageId)!;
  if (oblique) {
    const { volume, normal, step } = oblique;
    const displacement = plus3(geometry.origin, volume.origin, -1);
    const project = (axis: Point3): Point3 => [dot3(axis, volume.axes.u) / volume.spacing[0],
      dot3(axis, volume.axes.v) / volume.spacing[1], dot3(axis, volume.axes.w) / volume.spacing[2]];
    const base: Point3 = project(displacement), horizontal = project(geometry.columnDirection).map(v => v * geometry.columnSpacing) as Point3;
    const vertical = project(geometry.rowDirection).map(v => v * geometry.rowSpacing) as Point3;
    const output = new Float32Array(target.rows * target.columns);
    const slab = Math.min(20, Math.floor(thickness / (2 * step)));
    const sampleStep = slab ? Math.max(step, thickness / (2 * slab)) : step;
    const slabStep = project(normal).map(v => v * sampleStep) as Point3;
    for (let row = 0; row < target.rows; row++) for (let column = 0; column < target.columns; column++) {
      const x = base[0] + row * vertical[0] + column * horizontal[0];
      const y = base[1] + row * vertical[1] + column * horizontal[1];
      const z = base[2] + row * vertical[2] + column * horizontal[2];
      let value = mode === 'MinIP' ? Infinity : mode === 'MIP' ? -Infinity : 0;
      let count = 0;
      for (let offset = -slab; offset <= slab; offset++) {
        const sample = sampleOblique(volume, x + offset * slabStep[0], y + offset * slabStep[1], z + offset * slabStep[2]);
        if (sample === null) continue;
        value = mode === 'MIP' ? Math.max(value, sample) : mode === 'MinIP' ? Math.min(value, sample) : value + sample;
        count++;
      }
      output[row * target.columns + column] = count ? mode === 'Avg' || mode === 'MPR' ? value / count : value : volume.outside;
    }
    target.pixels = output;
    return;
  }
  const source = sourceIds.map(id => records.get(id)!);
  const width = source[0].columns, height = source[0].rows;
  const output = target.bits === 32 ? new Float32Array(target.rows * target.columns) : new Int16Array(target.rows * target.columns);
  const sourceGeometry = getLocalizerGeometry(sourceIds[0])!;
  const sliceStep = plane === 'SAG' ? sourceGeometry.columnSpacing : plane === 'COR' ? sourceGeometry.rowSpacing :
    Math.abs(dot3(plus3(getLocalizerGeometry(sourceIds[1])!.origin, getLocalizerGeometry(sourceIds[0])!.origin, -1),
      getMprAxes(sourceIds[0])!.w));
  const slab = Math.min(20, Math.floor(thickness / (2 * sliceStep)));
  const sampleStride = slab ? Math.max(1, thickness / (2 * sliceStep * slab)) : 1;
  for (let z = 0; z < target.rows; z++) for (let x = 0; x < target.columns; x++) {
    const horizontal = reverseHorizontal ? target.columns - 1 - x : x;
    const sx = plane === 'SAG' ? index : horizontal;
    const sy = plane === 'SAG' ? horizontal : plane === 'COR' ? index : z;
    const sz = plane === 'AX' ? index : superiorFirst ? source.length - 1 - z : z;
    let accumulator = mode === 'MinIP' ? Infinity : mode === 'MIP' ? -Infinity : 0;
    let count = 0;
    for (let offset = -slab; offset <= slab; offset++) {
      const sampleOffset = Math.round(offset * sampleStride);
      const currentX = sx + (plane === 'SAG' ? sampleOffset : 0);
      const currentY = sy + (plane === 'COR' ? sampleOffset : 0);
      const currentZ = sz + (plane === 'AX' ? sampleOffset : 0);
      if (currentX < 0 || currentX >= width || currentY < 0 || currentY >= height || currentZ < 0 || currentZ >= source.length) continue;
      const value = source[currentZ].pixels[currentY * width + currentX];
      accumulator = mode === 'MIP' ? Math.max(accumulator, value) : mode === 'MinIP' ? Math.min(accumulator, value) : accumulator + value;
      count++;
    }
    output[z * target.columns + x] = mode === 'Avg' || mode === 'MPR' ? accumulator / count : accumulator;
  }
  target.pixels = output;
}

/** Trilinear sampling keeps intensities continuous as the reformat plane turns. */
function sampleOblique(volume: ObliqueVolume, x: number, y: number, z: number): number | null {
  const width = volume.source[0].columns, height = volume.source[0].rows, depth = volume.source.length;
  if (x < -.5 || x > width - .5 || y < -.5 || y > height - .5 || z < -.5 || z > depth - .5) return null;
  const cx = Math.max(0, Math.min(width - 1, x)), cy = Math.max(0, Math.min(height - 1, y)), cz = Math.max(0, Math.min(depth - 1, z));
  const x0 = Math.floor(cx), y0 = Math.floor(cy), z0 = Math.floor(cz);
  const x1 = Math.min(width - 1, x0 + 1), y1 = Math.min(height - 1, y0 + 1), z1 = Math.min(depth - 1, z0 + 1);
  const dx = cx - x0, dy = cy - y0, dz = cz - z0;
  const interpolate = (slice: RecordItem) => {
    const data = slice.pixels;
    const top = data[y0 * width + x0] * (1 - dx) + data[y0 * width + x1] * dx;
    const bottom = data[y1 * width + x0] * (1 - dx) + data[y1 * width + x1] * dx;
    return top * (1 - dy) + bottom * dy;
  };
  const first = interpolate(volume.source[z0]);
  return z0 === z1 ? first : first * (1 - dz) + interpolate(volume.source[z1]) * dz;
}

export async function getViewer() {
  initialized ??= (async () => {
    // Each detached window owns an engine. Seven contexts per engine exhaust
    // Chromium's shared GPU-context budget with Viewer + MPR + 3D open.
    // ContextPool multiplexes any number of panes over these two contexts.
    await core.init({...core.getConfiguration(),rendering:{...core.getConfiguration().rendering,webGlContextCount:2}});

    // Cornerstone 5.10 starts an auxiliary cache promise without consuming its
    // rejection. Observe that branch; callers still receive the original image
    // rejection and IMAGE_LOAD_FAILED, including real decode/IO failures.
    const cacheImage = core.cache.putImageLoadObject.bind(core.cache);
    core.cache.putImageLoadObject = (id, object) => {
      const pending = cacheImage(id, object);
      if (id.startsWith('localdicom:')) void pending.catch(() => {});
      return pending;
    };
    core.imageLoader.registerImageLoader('localdicom', loadImage);
    core.imageLoader.registerImageLoader('radaz-volume', loadCachedVolumeSlice);
    core.metaData.addProvider(metadata, 1000);
    await tools.init();
    [tools.WindowLevelTool, tools.PanTool, tools.ZoomTool, tools.TrackballRotateTool, tools.EraserTool].forEach(tools.addTool);
    [tools.LengthTool, tools.AngleTool, tools.CobbAngleTool, tools.EllipticalROITool].map(themedMeasurement).forEach(tool => tools.addTool(tool as any));
    installMeasurementTheme();
    engine = new core.RenderingEngine('radiology-viewer');
    if (!core.getShouldUseCPURendering() && core.getConfiguration().rendering?.renderingEngineMode === core.Enums.RenderingEngineModeEnum.ContextPool) preserveContextSizeOnRemoval(engine);
  })();
  await initialized;
  return { core, tools, engine: engine! };
}
