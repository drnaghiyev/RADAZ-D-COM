"""Native preview tests use anonymous DICOM and exact LPS coordinate assertions."""
import json
from pathlib import Path
import sqlite3
import sys
import tempfile
import unittest
import numpy as np
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'bridge'))
from native_volume_data import VolumeData, load_handoff, load_dicom, archive_paths, ensure_volume_memory, NativeMemoryError


class NativeVolumeTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name)
    def tearDown(self):self.temp.cleanup()
    def write_handoff(self,**changes):
        meta={'dimensions':[3,4,2],'spacing':[.5,.8,2.5],'origin':[20,30,40],
              'direction':[0,1,0,-1,0,0,0,0,1],'dtype':'float32','data':'input.bin'}
        meta.update(changes);(self.root/'meta.json').write_text(json.dumps(meta));np.arange(24,dtype='<f4').tofile(self.root/'input.bin')
        return self.root/'meta.json'
    def test_handoff_keeps_orientation_and_physical_spacing(self):
        data=load_handoff(self.write_handoff());self.assertEqual(data.values.shape,(2,4,3));self.assertEqual(data.values[1,3,2],23)
        np.testing.assert_allclose(np.asarray(data.origin)+data.direction@(np.array([2,3,1])*data.spacing),[17.6,31,42.5])
    def test_handoff_rejects_external_path(self):
        with self.assertRaisesRegex(ValueError,'beside'):load_handoff(self.write_handoff(data='../input.bin'))
    def test_handoff_rejects_truncation(self):
        path=self.write_handoff();(self.root/'input.bin').write_bytes(b'bad')
        with self.assertRaisesRegex(ValueError,'size'):load_handoff(path)
    def test_handoff_rejects_non_orthogonal_direction(self):
        with self.assertRaisesRegex(ValueError,'orientation'):load_handoff(self.write_handoff(direction=[1,1,0,0,1,0,0,0,1]))
    def test_archive_query_read_only_and_selected_series(self):
        with sqlite3.connect(self.root/'archive.sqlite3') as db:
            db.execute('create table instances(series text,path text)');db.execute("insert into instances values('1.2.3','one.dcm')");db.execute("insert into instances values('1.2.4','two.dcm')")
        before=(self.root/'archive.sqlite3').read_bytes()
        self.assertEqual(archive_paths(self.root,'1.2.3'),[self.root/'one.dcm']);self.assertEqual(before,(self.root/'archive.sqlite3').read_bytes())
        with self.assertRaises(ValueError):archive_paths(self.root,"' OR 1=1 --")
    def dicom(self,z,slope=2,intercept=-1000):
        from pydicom.dataset import FileDataset,FileMetaDataset
        from pydicom.uid import ExplicitVRLittleEndian,CTImageStorage,generate_uid
        file=self.root/f'{z}.dcm';meta=FileMetaDataset();meta.TransferSyntaxUID=ExplicitVRLittleEndian;meta.MediaStorageSOPClassUID=CTImageStorage;meta.MediaStorageSOPInstanceUID=generate_uid()
        ds=FileDataset(str(file),{},file_meta=meta,preamble=b'\0'*128);ds.SOPClassUID=CTImageStorage;ds.SOPInstanceUID=meta.MediaStorageSOPInstanceUID
        ds.Modality='CT';ds.SeriesInstanceUID='1.2.3';ds.FrameOfReferenceUID='1.2.4';ds.Rows=4;ds.Columns=3;ds.PixelSpacing=[.8,.5]
        ds.ImageOrientationPatient=[0,1,0,-1,0,0];ds.ImagePositionPatient=[20,30,float(z)];ds.RescaleSlope=slope;ds.RescaleIntercept=intercept
        ds.SamplesPerPixel=1;ds.PhotometricInterpretation='MONOCHROME2';ds.BitsAllocated=16;ds.BitsStored=16;ds.HighBit=15;ds.PixelRepresentation=1
        ds.PixelData=(np.arange(12,dtype='<i2')+int(z)).tobytes();ds.save_as(file,enforce_file_format=True);return file
    def test_dicom_sort_calibration_and_spacing(self):
        files=[self.dicom(5),self.dicom(0),self.dicom(2.5)];data=load_dicom(files)
        self.assertEqual(data.values.shape,(3,4,3));self.assertEqual(data.spacing,(.5,.8,2.5));self.assertEqual(data.values[0,0,0],-1000);self.assertEqual(data.values[2,0,0],-990)
        np.testing.assert_allclose(data.direction,[[0,-1,0],[1,0,0],[0,0,1]])
    def test_irregular_series_rejected_not_stretched(self):
        with self.assertRaisesRegex(ValueError,'irregular'):load_dicom([self.dicom(0),self.dicom(2),self.dicom(5)])
    def test_duplicate_slice_rejected(self):
        a=self.dicom(0);b=self.dicom(2)
        with self.assertRaisesRegex(ValueError,'Duplicate'):load_dicom([a,a,b])
    def test_memory_budget_tracks_available_ram_not_file_count(self):
        dims=(512,512,442)
        with self.assertRaisesRegex(NativeMemoryError,'native_memory:'):ensure_volume_memory(dims,available=1024**3)
        self.assertGreater(ensure_volume_memory(dims,available=8*1024**3),512*512*442*4)
        self.assertGreater(ensure_volume_memory((512,512,4000),available=64*1024**3),0)
    def test_vtk_exact_direction_and_oblique_crop(self):
        from native_volume_render import NativeVolumeScene
        from vtkmodules.vtkRenderingCore import vtkRenderWindow
        data=load_handoff(self.write_handoff());window=vtkRenderWindow();scene=NativeVolumeScene(window,data)
        point=[0.,0.,0.];scene.image.TransformIndexToPhysicalPoint([2,3,1],point)
        np.testing.assert_allclose(point,[17.6,31,42.5]);scene.set_crop([.25,.75,0,1,0,1])
        planes=scene.mapper.GetClippingPlanes();self.assertEqual(planes.GetNumberOfItems(),6)
        np.testing.assert_allclose(planes.GetItem(0).GetNormal(),[0,1,0]);scene.close()


if __name__=='__main__':unittest.main()
