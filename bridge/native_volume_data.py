"""Read-only source geometry for the optional native preview. Never edits the archive."""
from dataclasses import dataclass
import json
from pathlib import Path
import sqlite3
import os
import numpy as np


class NativeMemoryError(MemoryError):
    pass


def available_memory():
    """Available physical RAM, not installed RAM or an arbitrary voxel cap."""
    if os.name=='nt':
        import ctypes
        class MemoryStatus(ctypes.Structure):
            _fields_=[('length',ctypes.c_ulong),('load',ctypes.c_ulong)]+[(name,ctypes.c_ulonglong) for name in ('totalPhysical','availablePhysical','totalPage','availablePage','totalVirtual','availableVirtual','extendedVirtual')]
        status=MemoryStatus();status.length=ctypes.sizeof(status)
        if not ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(status)):
            raise NativeMemoryError('native_memory: Mövcud RAM miqdarı yoxlanmadı; veb Viewer-də davam edin.')
        return int(status.availablePhysical)
    try:return int(os.sysconf('SC_AVPHYS_PAGES')*os.sysconf('SC_PAGE_SIZE'))
    except (ValueError,AttributeError):raise NativeMemoryError('native_memory: Mövcud RAM miqdarı yoxlanmadı; veb Viewer-də davam edin.')


def ensure_volume_memory(dimensions, available=None):
    # One calibrated array + driver/GPU upload staging + temporary work reserve.
    # This guard is specific to optional native rendering, never archive import.
    dimensions=tuple(int(n) for n in dimensions)
    source_bytes=dimensions[0]*dimensions[1]*dimensions[2]*4
    estimate=source_bytes*3+dimensions[0]*dimensions[1]*8
    available=available_memory() if available is None else available
    if estimate>int(available*.6):
        shape=' × '.join(map(str,dimensions))
        raise NativeMemoryError(f'native_memory: {shape} üçün təxminən {estimate/1048576:.0f} MB iş yaddaşı tələb olunur; hazırda {available/1048576:.0f} MB boş RAM var. Digər 3D pəncərələrini bağlayıb təkrar cəhd edin.')
    return estimate


@dataclass
class VolumeData:
    values: np.ndarray  # Z,Y,X, X is contiguous; calibrated HU for CT
    spacing: tuple
    origin: tuple
    direction: np.ndarray  # columns are X,Y,Z patient LPS basis vectors
    modality: str = 'CT'
    series_uid: str = ''

    def validate(self):
        if self.values.ndim != 3 or min(self.values.shape) < 1:
            raise ValueError('Invalid volume dimensions')
        if len(self.spacing) != 3 or not np.isfinite(self.spacing).all() or min(self.spacing) <= 0:
            raise ValueError('Invalid spacing')
        if len(self.origin) != 3 or not np.isfinite(self.origin).all():
            raise ValueError('Invalid origin')
        if self.direction.shape != (3,3) or not np.isfinite(self.direction).all() or not np.allclose(self.direction.T @ self.direction, np.eye(3), atol=1e-4):
            raise ValueError('Invalid orientation')
        if self.values.dtype not in (np.dtype('int16'), np.dtype('uint16'), np.dtype('float32')):
            raise ValueError('Unsupported scalar type')
        # Validate per slice to avoid a full-size temporary allocation.
        if any(not np.isfinite(section).all() for section in self.values):
            raise ValueError('Non-finite volume pixels')
        return self


def load_handoff(meta_path):
    """Private meta.json + raw voxels; matches Cornerstone's column-major direction."""
    meta_path = Path(meta_path).resolve()
    meta = json.loads(meta_path.read_text(encoding='utf-8'))
    raw_name = meta.get('data', 'input.bin')
    raw_path = (meta_path.parent / raw_name).resolve()
    if raw_path.parent != meta_path.parent:
        raise ValueError('Volume payload must be beside metadata')
    dims = meta['dimensions']
    if len(dims) != 3 or any(type(n) is not int or n < 1 for n in dims):
        raise ValueError('Invalid dimensions')
    dtype = {'float32':'<f4','int16':'<i2','uint16':'<u2'}.get(meta.get('dtype','float32'))
    if not dtype or raw_path.stat().st_size != int(np.prod(dims))*np.dtype(dtype).itemsize:
        raise ValueError('Volume payload size mismatch')
    ensure_volume_memory(dims)
    values = np.memmap(raw_path, dtype=dtype, mode='r', shape=tuple(reversed(dims)))
    return VolumeData(values, tuple(meta['spacing']), tuple(meta['origin']), np.asarray(meta['direction'],float).reshape(3,3).T,
                      meta.get('modality','CT'), meta.get('seriesInstanceUID','')).validate()


def archive_paths(root, series_uid):
    root = Path(root).resolve()
    # URI read-only connection cannot initialize, change or clean an archive.
    with sqlite3.connect((root/'archive.sqlite3').as_uri()+'?mode=ro', uri=True) as db:
        rows = db.execute('SELECT path FROM instances WHERE series=?', (series_uid,)).fetchall()
    paths = [(root/row[0]).resolve() for row in rows]
    if not paths or any(not p.is_relative_to(root) for p in paths):
        raise ValueError('Series is unavailable or contains an unsafe path')
    return paths


def load_dicom(paths, progress=lambda *_:None):
    import pydicom
    entries = []
    for n, path in enumerate(paths):
        ds = pydicom.dcmread(path, stop_before_pixels=True)
        if int(getattr(ds,'NumberOfFrames',1)) != 1:
            raise ValueError('Enhanced multiframe: use the shared volume handoff')
        if str(getattr(ds,'Modality','')) not in ('CT','MR'):
            continue
        if 'LOCALIZER' in [str(x).upper() for x in getattr(ds,'ImageType',[])]:
            continue
        entries.append((Path(path),ds))
        progress(n+1, len(paths)*2)
    if len(entries)<2: raise ValueError('At least two CT/MR slices are required')
    ref=entries[0][1]
    basis=np.asarray(ref.ImageOrientationPatient,float).reshape(2,3).T
    direction=np.column_stack((basis, np.cross(basis[:,0],basis[:,1])))
    spacing_xy=(float(ref.PixelSpacing[1]),float(ref.PixelSpacing[0]))
    positions=[]
    for path,ds in entries:
        if (str(ds.SeriesInstanceUID)!=str(ref.SeriesInstanceUID) or str(getattr(ds,'FrameOfReferenceUID',''))!=str(getattr(ref,'FrameOfReferenceUID',''))
            or ds.Rows!=ref.Rows or ds.Columns!=ref.Columns or not np.allclose(ds.ImageOrientationPatient,ref.ImageOrientationPatient,atol=1e-4)
            or not np.allclose(ds.PixelSpacing,ref.PixelSpacing,atol=1e-4)):
            raise ValueError('Series contains incompatible geometry')
        pos=np.asarray(ds.ImagePositionPatient,float)
        if not np.isfinite(pos).all(): raise ValueError('Invalid slice position')
        positions.append((float(np.dot(pos,direction[:,2])),pos,path,ds))
    positions.sort(key=lambda item:item[0])
    delta=np.diff([p[0] for p in positions])
    dz=float(np.median(delta))
    if dz<=0 or not np.allclose(delta,dz,rtol=.01,atol=.02):
        raise ValueError('Duplicate or irregular slice spacing; source needs geometry repair')
    origin=positions[0][1]
    for z,(_,pos,_,_) in enumerate(positions):
        if not np.allclose(pos,origin+direction[:,2]*dz*z,atol=.05):
            raise ValueError('Tilted or shifted slices; use the shared resampled volume')
    ensure_volume_memory((int(ref.Columns),int(ref.Rows),len(positions)))
    values=np.empty((len(positions),int(ref.Rows),int(ref.Columns)),dtype=np.float32)
    for z,(_,_,path,ds) in enumerate(positions):
        pixels=pydicom.dcmread(path).pixel_array
        if pixels.ndim!=2: raise ValueError('Only monochrome CT/MR is supported')
        np.multiply(pixels,float(getattr(ds,'RescaleSlope',1)),out=values[z],casting='unsafe')
        values[z]+=float(getattr(ds,'RescaleIntercept',0))
        progress(len(paths)+z+1,len(paths)+len(positions))
    return VolumeData(values,(*spacing_xy,dz),tuple(origin),direction,str(ref.Modality),str(ref.SeriesInstanceUID)).validate()


def synthetic_volume(size=128, slices=None):
    """Anonymous calibrated phantom with an outer bone shell and soft interior."""
    z,y,x=np.ogrid[-1:1:complex(slices or size),-1:1:complex(size),-1:1:complex(size)]
    r=x*x+y*y+z*z
    values=np.full(r.shape,-1000,dtype=np.float32)
    values[r<.6]=60
    values[(r<.65)&(r>.52)]=800
    values[((x-.25)**2+(y+.15)**2+z*z)<.05]=250
    return VolumeData(values,(.7,.7,.7),(0.,0.,0.),np.eye(3)).validate()
