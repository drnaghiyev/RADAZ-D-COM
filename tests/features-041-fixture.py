"""Synthetic volumes and radiographs, no clinical files."""
from pathlib import Path
from removable_media_test import write_image
root=Path(__file__).resolve().parents[1]/'outputs/features-041-fixture'
root.mkdir(parents=True,exist_ok=True)
for series,count,spacing,patient,modality in [(1,24,1,'VOLUME','CT'),(2,12,2,'VOLUME','MR'),(3,2,1,'XRAY','CR')]:
    for index in range(count):
        file=root/f'{series}-{index}.dcm';ds=write_image(file,index)
        ds.PatientName='RADAZ^'+patient;ds.PatientID=patient
        ds.StudyInstanceUID='2.25.410' if series<3 else '2.25.411'
        ds.SeriesInstanceUID=f'{ds.StudyInstanceUID}.{series}'
        ds.SOPInstanceUID=f'{ds.SeriesInstanceUID}.{index+1}'
        ds.Modality=modality;ds.SeriesDescription=f'SYNTHETIC {modality} {spacing}mm';ds.SeriesNumber=series
        ds.ImagePositionPatient=[0,0,index*spacing];ds.SliceThickness=spacing;ds.SpacingBetweenSlices=spacing
        ds.InstitutionName='RADAZ SYNTHETIC CLINIC'
        if series==3:ds.SOPClassUID='1.2.840.10008.5.1.4.1.1.1'
        ds.save_as(file,enforce_file_format=True)
