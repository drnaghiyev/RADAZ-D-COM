import importlib.util
import gc
from pathlib import Path
import tempfile
import unittest
import numpy as np

root=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('volume',root/'bridge/radaz_anatomy_volume.py')
volume=importlib.util.module_from_spec(spec);spec.loader.exec_module(volume)

class GeometryTests(unittest.TestCase):
    def meta(self):return dict(modality='CT',dimensions=[7,6,5],spacing=[.8,1.7,3.2],origin=[-88,31,-120],direction=[0,1,0,-1,0,0,0,0,1])
    def test_lps_to_ras_and_voxel_order(self):
        meta=self.meta();a=volume.validate_geometry(meta)
        np.testing.assert_allclose(a@np.array([2,3,4,1]),[93.1,-32.6,-107.2,1])
        raw=np.arange(7*6*5,dtype='<f4').reshape(5,6,7)
        with tempfile.TemporaryDirectory() as folder:
            raw.tofile(Path(folder)/'input.bin');image=volume.input_image(Path(folder),meta)
            self.assertEqual(image.shape,(7,6,5));self.assertEqual(image.dataobj[2,3,4],raw[4,3,2])
            del image
            gc.collect()  # Release the Windows memory mapping before temp cleanup.
    def test_refuse_bad_geometry(self):
        for key,value in [('modality','DX'),('dimensions',[0,6,5]),('dimensions',[2048,2048,2048]),('spacing',[0,1,1]),('origin',[float('nan'),0,0]),('direction',[1,0,0,1,0,0,0,0,1])]:
            meta=self.meta();meta[key]=value
            with self.subTest(key=key):
                with self.assertRaises(ValueError):volume.validate_geometry(meta)
    def test_refuse_short_or_nonfinite_pixels(self):
        with tempfile.TemporaryDirectory() as folder:
            file=Path(folder)/'input.bin';file.write_bytes(b'x')
            with self.assertRaises(ValueError):volume.input_image(Path(folder),self.meta())
            np.full(7*6*5,np.nan,dtype='<f4').tofile(file)
            with self.assertRaises(ValueError):volume.input_image(Path(folder),self.meta())

if __name__=='__main__':unittest.main()
