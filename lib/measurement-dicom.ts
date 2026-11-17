import dcmjs from 'dcmjs';

const SECONDARY_CAPTURE = '1.2.840.10008.5.1.4.1.1.7';
const EXPLICIT_LITTLE_ENDIAN = '1.2.840.10008.1.2.1';
const IMPLEMENTATION_UID = '2.25.266717627124879618832963211731725107721';

export type MeasurementDicomSource = {
  studyUID: string; sopUID: string; sopClassUID: string; patientName: string; patientId: string;
  studyDate: string; studyTime: string; accessionNumber: string; studyDescription: string;
  birthDate: string; patientSex: string; instanceNumber: string;
};

const randomUID = () => `2.25.${BigInt('0x' + crypto.randomUUID().replaceAll('-', '')).toString(10)}`;

async function measuredSeriesUID(studyUID: string,description:string) {
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`RADAZ-${description}-${studyUID}`)));
  return `2.25.${BigInt('0x' + [...hash.subarray(0, 16)].map(byte => byte.toString(16).padStart(2, '0')).join('')).toString(10)}`;
}

/** A derived RGB Secondary Capture. It never mutates the source DICOM. */
export async function createMeasurementDicom(source: MeasurementDicomSource, width: number, height: number, rgba: Uint8ClampedArray): Promise<Blob> {
  return createDerivedRgbDicom(source,[source],width,height,rgba,'RADAZ Measured Images',true);
}

/** A separate stitched image with both originals referenced in DICOM metadata. */
export async function createStitchedDicom(sources: [MeasurementDicomSource,MeasurementDicomSource], width:number,height:number,rgba:Uint8ClampedArray,pixelSpacing?:[number,number],burnedIn=true):Promise<Blob>{
  if(sources[0].studyUID!==sources[1].studyUID||sources[0].patientId!==sources[1].patientId)throw Error('Yalnız eyni pasiyent və müayinənin görüntüləri birləşdirilə bilər');
  return createDerivedRgbDicom(sources[0],sources,width,height,rgba,'RADAZ Stitched Radiograph',burnedIn,pixelSpacing);
}

async function createDerivedRgbDicom(source:MeasurementDicomSource,references:MeasurementDicomSource[],width:number,height:number,rgba:Uint8ClampedArray,description:string,burnedIn:boolean,pixelSpacing?:[number,number]):Promise<Blob>{
  if (!source.studyUID || !source.sopUID || !source.sopClassUID || width < 1 || height < 1 || width > 65535 || height > 65535 || rgba.length !== width * height * 4)
    throw new Error('Ölçülü DICOM üçün mənbə və görüntü ölçüsü düzgün deyil');
  const rgb = new Uint8Array(width * height * 3);
  for (let pixel = 0; pixel < width * height; pixel++) rgb.set(rgba.subarray(pixel * 4, pixel * 4 + 3), pixel * 3);
  const now = new Date(), date = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
  const time = `${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`;
  const sopUID = randomUID();
  const dataset: Record<string, unknown> = {
    SpecificCharacterSet: 'ISO_IR 192', SOPClassUID: SECONDARY_CAPTURE, SOPInstanceUID: sopUID,
    StudyInstanceUID: source.studyUID, SeriesInstanceUID: await measuredSeriesUID(source.studyUID,description),
    PatientName: source.patientName || 'UNKNOWN', PatientID: source.patientId || '',
    PatientBirthDate: source.birthDate || '', PatientSex: source.patientSex || '',
    StudyDate: source.studyDate || date, StudyTime: source.studyTime || time,
    SeriesDate: date, SeriesTime: time, ContentDate: date, ContentTime: time,
    InstanceCreationDate: date, InstanceCreationTime: time,
    AccessionNumber: source.accessionNumber || '', StudyDescription: source.studyDescription || '',
    Modality: 'OT', SeriesDescription: description, SeriesNumber: description.includes('Stitched')?'901':'900',
    InstanceNumber: source.instanceNumber || '1', Manufacturer: 'RADAZ',
    ImageType: ['DERIVED', 'SECONDARY'], ConversionType: 'WSD', BurnedInAnnotation: burnedIn?'YES':'NO',
    SourceImageSequence: references.map(item=>({ReferencedSOPClassUID:item.sopClassUID,ReferencedSOPInstanceUID:item.sopUID})),
    ...(pixelSpacing?{PixelSpacing:pixelSpacing.map(String)}:{}),
    SamplesPerPixel: 3, PhotometricInterpretation: 'RGB', PlanarConfiguration: 0,
    Rows: height, Columns: width, BitsAllocated: 8, BitsStored: 8, HighBit: 7, PixelRepresentation: 0,
  };
  const {DicomDict, DicomMetaDictionary} = dcmjs.data;
  const meta = DicomMetaDictionary.denaturalizeDataset({
    FileMetaInformationVersion: new Uint8Array([0, 1]),
    MediaStorageSOPClassUID: SECONDARY_CAPTURE, MediaStorageSOPInstanceUID: sopUID,
    TransferSyntaxUID: EXPLICIT_LITTLE_ENDIAN, ImplementationClassUID: IMPLEMENTATION_UID,
    ImplementationVersionName: 'RADAZ_0_2_73',
  });
  const file = new DicomDict(meta);
  file.dict = DicomMetaDictionary.denaturalizeDataset(dataset);
  file.dict['7FE00010'] = {vr: 'OB', Value: [rgb.buffer]};
  return new Blob([file.write()], {type: 'application/dicom'});
}
