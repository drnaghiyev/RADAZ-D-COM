"""Public TotalSegmentator reference volumes -> explicitly non-patient DICOM.

Fetch reference_files/example_{ct,mr}_sm.nii.gz from the official repository
into outputs/anatomy-volume before running. Never reads the clinical archive.
"""
from pathlib import Path
import json
import numpy as np
import nibabel as nib
from pydicom.dataset import FileDataset, FileMetaDataset
from pydicom.uid import ExplicitVRLittleEndian, CTImageStorage, MRImageStorage

root=Path(__file__).resolve().parents[1]/'outputs/anatomy-volume'
for kind in ('ct','mr'):
    image=nib.load(root/f'example_{kind}_sm.nii.gz')
    pixels=np.asarray(image.dataobj,dtype=np.float32)
    affine=np.diag([-1,-1,1,1])@image.affine
    spacing=np.linalg.norm(affine[:3,:3],axis=0)
    direction=(affine[:3,:3]/spacing).T.reshape(-1)
    meta=dict(modality=kind.upper(),dimensions=list(image.shape),spacing=spacing.tolist(),origin=affine[:3,3].tolist(),direction=direction.tolist())
    folder=root/kind;folder.mkdir(exist_ok=True)
    (folder/'meta.json').write_text(json.dumps(meta))
    pixels.transpose(2,1,0).astype('<f4').tofile(folder/'input.bin')
    study=f'2.25.9910{1 if kind=="ct" else 2}'
    slope=1 if float(pixels.max())-float(pixels.min())<60000 else (float(pixels.max())-float(pixels.min()))/60000
    intercept=float(pixels.min())
    stored=np.rint((pixels-intercept)/slope).astype('<u2')
    sop=CTImageStorage if kind=='ct' else MRImageStorage
    for z in range(image.shape[2]):
        uid=f'{study}.1.{z+1}'
        fm=FileMetaDataset();fm.TransferSyntaxUID=ExplicitVRLittleEndian;fm.MediaStorageSOPClassUID=sop;fm.MediaStorageSOPInstanceUID=uid;fm.ImplementationClassUID='2.25.991099'
        ds=FileDataset(str(folder/f'{z:03}.dcm'),{},file_meta=fm,preamble=b'\0'*128)
        ds.SOPClassUID=sop;ds.SOPInstanceUID=uid;ds.StudyInstanceUID=study;ds.SeriesInstanceUID=study+'.1';ds.FrameOfReferenceUID=study+'.9'
        ds.PatientName='PUBLIC^MODEL_REFERENCE';ds.PatientID='NOT-A-PATIENT';ds.StudyDate='20000101';ds.StudyTime='120000'
        ds.Modality=kind.upper();ds.StudyDescription='Public research fixture';ds.SeriesDescription=f'{kind.upper()} public reference';ds.SeriesNumber=1;ds.InstanceNumber=z+1
        ds.ImageType=['ORIGINAL','PRIMARY','AXIAL'];ds.Rows=image.shape[1];ds.Columns=image.shape[0]
        ds.ImageOrientationPatient=direction[:6].tolist();ds.ImagePositionPatient=(affine@np.array([0,0,z,1]))[:3].tolist()
        ds.PixelSpacing=[float(spacing[1]),float(spacing[0])];ds.SliceThickness=float(spacing[2]);ds.SpacingBetweenSlices=float(spacing[2])
        ds.SamplesPerPixel=1;ds.PhotometricInterpretation='MONOCHROME2';ds.BitsAllocated=16;ds.BitsStored=16;ds.HighBit=15;ds.PixelRepresentation=0
        ds.RescaleSlope=slope;ds.RescaleIntercept=intercept;ds.WindowCenter=50 if kind=='ct' else float(np.percentile(pixels,98))/2;ds.WindowWidth=400 if kind=='ct' else float(np.percentile(pixels,98))
        ds.PixelData=stored[:,:,z].T.copy().tobytes();ds.save_as(folder/f'{z:03}.dcm',enforce_file_format=True)
    print(kind,image.shape,'DICOM and LPS volume ready')
