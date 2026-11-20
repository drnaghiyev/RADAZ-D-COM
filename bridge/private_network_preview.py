"""Device-generated display rasters for a recipient granted viewing without archiving."""
import io
import struct

import pydicom
from PIL import Image, ImageOps


def first_float(value):
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError,ValueError):
        return float(value[0])


def make_preview(raw, frame):
    ds = pydicom.dcmread(io.BytesIO(raw),force=True)
    frames = int(getattr(ds, 'NumberOfFrames', 1))
    if not 0 <= frame < frames:
        raise ValueError('Belə kadr yoxdur.')
    width, height = int(ds.Columns), int(ds.Rows)
    if width <= 0 or height <= 0 or width * height > 50_000_000:
        raise ValueError('Ön baxış üçün görüntü ölçüsü uyğun deyil.')
    photometric = str(ds.PhotometricInterpretation)
    syntax = getattr(getattr(ds, 'file_meta', None), 'TransferSyntaxUID', None)
    if syntax and syntax.is_compressed:
        from pydicom.encaps import get_frame
        compressed = get_frame(ds.PixelData,frame,number_of_frames=frames)
        image = Image.open(io.BytesIO(compressed))
        image.load()
        if image.size != (width,height):
            raise ValueError('Ön baxış üçün kadr ölçüsü uyğun deyil.')
    else:
        samples = int(ds.SamplesPerPixel)
        bits = int(ds.BitsAllocated)
        if bits not in (8,16) or (samples != 1 and not (samples==3 and bits==8 and photometric=='RGB')):
            raise ValueError('Bu piksel formatı üçün ön baxış dəstəklənmir.')
        size=width*height*samples*(bits//8)
        data=ds.PixelData[frame*size:(frame+1)*size]
        if len(data)!=size:
            raise ValueError('Kadr natamamdır.')
        if samples==3 and int(getattr(ds,'PlanarConfiguration',0)):
            plane=width*height
            channels=[Image.frombytes('L',(width,height),data[k*plane:(k+1)*plane]) for k in range(3)]
            image=Image.merge('RGB',channels)
        else:
            mode='RGB' if samples==3 else 'L' if bits==8 else 'I;16B' if syntax and not syntax.is_little_endian else 'I;16'
            image=Image.frombytes(mode,(width,height),data)
    if photometric in ('MONOCHROME1','MONOCHROME2'):
        bits=int(ds.BitsStored)
        if not 1 <= bits <= 16:
            raise ValueError('Ön baxış üçün bit dərinliyi uyğun deyil.')
        signed=int(ds.PixelRepresentation)
        mask=(1<<bits)-1
        slope=first_float(getattr(ds,'RescaleSlope',1))
        intercept=first_float(getattr(ds,'RescaleIntercept',0))
        center=first_float(getattr(ds,'WindowCenter',None))
        window=first_float(getattr(ds,'WindowWidth',None))
        shift=int(ds.HighBit)+1-bits
        if not 0 <= shift < 16:
            raise ValueError('Piksel kodlaşdırılması düzgün deyil.')
        if center is None or window is None or window <= 0:
            # Full stored input range for unwindowed images.
            low=-(1<<(bits-1)) if signed else 0
            high=low+mask
            lo,hi=sorted((low*slope+intercept,high*slope+intercept))
        else:
            lo=center-.5-(window-1)/2
            hi=center-.5+(window-1)/2
        if hi<lo:
            hi=lo
        def window_value(i):
            value=(i>>shift)&mask
            if signed and value&(1<<(bits-1)):
                value-=1<<bits
            value=value*slope+intercept
            return 0 if value<=lo else 255 if value>=hi else round(255*(value-lo)/(hi-lo))
        table=[window_value(i) for i in range(65536)]
        image=image.convert('I').point(table,'L')
        if photometric=='MONOCHROME1':
            image=ImageOps.invert(image)
    else:
        image=image.convert('RGB')
    image.thumbnail((1600,1600),Image.Resampling.LANCZOS)
    output=io.BytesIO()
    image.save(output,format='JPEG',quality=85)
    return struct.pack('>II',frame,frames)+output.getvalue()
