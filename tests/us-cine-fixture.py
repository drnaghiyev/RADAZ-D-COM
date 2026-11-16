from pathlib import Path
from removable_media_test import write_image
from pydicom.encaps import encapsulate
from pydicom.uid import JPEGBaseline8Bit
from PIL import Image
import io
root=Path(__file__).resolve().parents[1]/'outputs/us-fixture';root.mkdir(parents=True,exist_ok=True)
for variant,color,jpeg in [('MONO',False,False),('RGB',True,False),('JPEG',True,True)]:
 path=root/(variant+'.dcm');ds=write_image(path,1);n=['MONO','RGB','JPEG'].index(variant)+1
 ds.Modality='US';ds.SOPClassUID='1.2.840.10008.5.1.4.1.1.3.1';ds.SOPInstanceUID=f'2.25.7070.{n}.1';ds.StudyInstanceUID='2.25.7070';ds.SeriesInstanceUID=f'2.25.7070.{n}';ds.SeriesDescription='SYNTHETIC US '+variant;ds.SeriesNumber=n
 ds.Rows=ds.Columns=64;ds.BitsAllocated=ds.BitsStored=8;ds.HighBit=7;ds.PixelRepresentation=0;ds.WindowCenter=128;ds.WindowWidth=256;ds.NumberOfFrames=12;ds.FrameTime=100
 ds.SamplesPerPixel=3 if color else 1;ds.PhotometricInterpretation='RGB' if color else 'MONOCHROME2'
 if color:ds.PlanarConfiguration=0
 frames=[]
 for f in range(12):
  data=bytearray()
  for y in range(64):
   for x in range(64):
    v=230 if (x-10-f*3)**2+(y-32)**2<110 else 20
    data.extend([v,25,240-v] if color else [v])
  if jpeg:
   out=io.BytesIO();Image.frombytes('RGB',(64,64),bytes(data)).save(out,format='JPEG',quality=95);frames.append(out.getvalue())
  else:frames.append(bytes(data))
 ds.PixelData=encapsulate(frames) if jpeg else b''.join(frames)
 if jpeg:ds.file_meta.TransferSyntaxUID=JPEGBaseline8Bit;ds['PixelData'].is_undefined_length=True;ds.PhotometricInterpretation='YBR_FULL_422'
 ds.save_as(path,enforce_file_format=True)
print('Created three synthetic 12-frame US files')
