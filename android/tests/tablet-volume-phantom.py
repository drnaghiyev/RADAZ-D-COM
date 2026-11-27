"""Create a compressible DICOM volume with an asymmetric one-pixel landmark on every plane."""
from io import BytesIO
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile
import sys

import numpy as np
from pydicom.dataset import Dataset, FileMetaDataset
from pydicom.uid import CTImageStorage, ExplicitVRLittleEndian

def write_volume(path, depth):
    ds = Dataset()
    ds.file_meta = FileMetaDataset()
    ds.file_meta.TransferSyntaxUID = ExplicitVRLittleEndian
    ds.SOPClassUID = CTImageStorage
    ds.PatientName, ds.PatientID = 'RADAZ^PHANTOM', 'TEST512'
    ds.Modality, ds.SeriesNumber = 'CT', 1
    ds.StudyInstanceUID, ds.SeriesInstanceUID, ds.FrameOfReferenceUID = '2.25.51231', '2.25.51232', '2.25.51233'
    ds.SeriesDescription = 'QA 512 PHANTOM'
    ds.Rows = ds.Columns = 512
    ds.SamplesPerPixel, ds.PhotometricInterpretation = 1, 'MONOCHROME2'
    ds.BitsAllocated = ds.BitsStored = 16
    ds.HighBit, ds.PixelRepresentation = 15, 1
    ds.PixelSpacing, ds.SliceThickness = [0.8, 0.7], 1.25
    ds.ImageOrientationPatient = [1, 0, 0, 0, 1, 0]
    ds.WindowCenter, ds.WindowWidth = 64, 2500
    plane = np.full((512, 512), -1024, dtype='<i2')
    plane[160:352, 140:370] = 650
    with ZipFile(path,'w',ZIP_DEFLATED,compresslevel=1) as out:
        for z in reversed(range(depth)):
            ds.SOPInstanceUID = f'2.25.51234.{z+1}'
            ds.file_meta.MediaStorageSOPInstanceUID = ds.SOPInstanceUID
            ds.InstanceNumber, ds.ImagePositionPatient = z+1, [0,0,z*1.25]
            plane[191,247:249] = [1100+z, -200-z]
            ds.PixelData = plane.tobytes()
            packet=BytesIO()
            ds.save_as(packet,enforce_file_format=True)
            out.writestr(f'{z:04d}.dcm',packet.getvalue())

if __name__=='__main__':
    write_volume(Path(sys.argv[1]), int(sys.argv[2]))

