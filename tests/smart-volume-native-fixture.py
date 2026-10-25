import runpy,sys
from pathlib import Path
sys.path.insert(0,str(Path('tests').resolve()))
runpy.run_path('tests/features-041-fixture.py')
import pydicom
for num,direction in [(4,[0,1,0,0,0,1]),(5,[1,0,0,0,0,1])]:
 for i in range(12):
  ds=pydicom.dcmread(f'outputs/features-041-fixture/2-{i}.dcm')
  ds.SeriesInstanceUID=f'2.25.410.{num}';ds.SOPInstanceUID=f'2.25.410.{num}.{i+1}';ds.SeriesNumber=num
  ds.SeriesDescription='SYNTHETIC MR '+('Sagittal' if num==4 else 'Coronal');ds.ImageOrientationPatient=direction
  ds.ImagePositionPatient=[i*2,0,0] if num==4 else [0,22-i*2,0]
  ds.save_as(f'outputs/features-041-fixture/{num}-{i}.dcm',enforce_file_format=True)
