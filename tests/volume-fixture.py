"""Synthetic CT only; reproducible HU and physical slice ordering for benchmarks."""
import argparse
from pathlib import Path
import numpy as np
from pydicom.dataset import Dataset, FileMetaDataset
from pydicom.uid import ExplicitVRLittleEndian

p = argparse.ArgumentParser()
p.add_argument('--output', type=Path, required=True)
p.add_argument('--size', type=int, default=512)
p.add_argument('--slices', type=int, default=128)
p.add_argument('--metrology', action='store_true', help='Seven physical fiducials in a 128x128 anisotropic image for touch measurement QA.')
p.add_argument('--airway', action='store_true', help='Chest phantom with bronchi, lung and external objects.')
p.add_argument('--oblique', action='store_true')
p.add_argument('--plane-markers', action='store_true', help='Encode slice index in a small corner patch for 3D coverage tests.')
a = p.parse_args(); a.output.mkdir(parents=True, exist_ok=True)
y, x = np.mgrid[-1:1:complex(a.size), -1:1:complex(a.size)]
for z in range(a.slices):
    ds = Dataset(); ds.file_meta = FileMetaDataset(); ds.file_meta.TransferSyntaxUID = ExplicitVRLittleEndian
    ds.SOPClassUID = '1.2.840.10008.5.1.4.1.1.2'; ds.SOPInstanceUID = f'2.25.701.{z+1}'
    ds.StudyInstanceUID = '2.25.702'; ds.SeriesInstanceUID = '2.25.703'; ds.FrameOfReferenceUID = '2.25.704'
    ds.PatientName = 'SYNTHETIC^VOLUME'; ds.PatientID = 'PERFORMANCE-TEST'; ds.Modality = 'CT'
    ds.SeriesDescription = 'Synthetic CT volume'; ds.SeriesNumber = 1; ds.InstanceNumber = a.slices-z
    ds.Rows = ds.Columns = a.size; ds.SamplesPerPixel = 1; ds.PhotometricInterpretation = 'MONOCHROME2'
    ds.BitsAllocated = ds.BitsStored = 16; ds.HighBit = 15; ds.PixelRepresentation = 1
    ds.PixelSpacing = [.7, .7]; ds.SliceThickness = ds.SpacingBetweenSlices = 1.4
    ds.ImageOrientationPatient = [1, 0, 0, 0, .8, .6] if a.oblique else [1, 0, 0, 0, 1, 0]
    ds.ImagePositionPatient = [12, -80-z*1.4*.6, 20+z*1.4*.8] if a.oblique else [12, -80, 20+z*1.4]
    ds.RescaleSlope = 1.5; ds.RescaleIntercept = -1024; ds.WindowCenter = 40; ds.WindowWidth = 400
    r = x*x+y*y+((z-a.slices/2)/a.slices)**2
    hu = np.where(r < .65, 40, -1000); hu = np.where((r > .38) & (r < .44), 1100, hu)
    hu = np.where((x*x+(y+.1)**2) < .035, 300, hu)
    if a.airway:
        zz=(z-a.slices/2)/a.slices
        body=(x/.78)**2+((y+.04)/.62)**2 < 1
        hu=np.where(body,40,-1024)
        lungs=(((abs(x)-.335)/.345)**2+((y+.04)/.42)**2+(zz/.59)**2 < 1)
        hu=np.where(lungs,-906,hu)
        bronchus=(abs(x)-max(0, .11-zz)*.6)**2+(y+.04)**2 < .08**2
        hu=np.where(bronchus,-968,hu)
        hu=np.where((y>.80)&(y<.86)&(abs(x)<.94),-906,hu)
        hu=np.where((x<-.68)&(x>-.84)&(y<-.55)&(y>-.63),-941,hu)
    if a.metrology:
        if a.size != 128 or a.oblique:
            raise ValueError('Metrology fixture requires a non-oblique 128x128 image')
        ds.PixelSpacing = [.8, .5]
        hu = np.full((a.size, a.size), -1024)
        for xx, yy in [(22,29),(62,29),(108,21),(108,46),(37,75),(77,75),(77,100)]:
            hu[yy-1:yy+2,xx-1:xx+2] = 1400
    pixels = np.rint((hu+1024)/1.5).astype('<i2')
    if a.plane_markers:
        pixels[:24, :24] = 128 + z
    ds.PixelData = pixels.tobytes()
    ds.save_as(a.output/f'{z:04}.dcm', enforce_file_format=True)
print(f'{a.slices} synthetic {a.size}x{a.size} slices: {a.output}')
