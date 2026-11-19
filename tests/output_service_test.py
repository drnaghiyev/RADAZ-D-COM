"""Real DIMSE print protocol, DICOMDIR media and local encoder integration."""
import base64
import copy
import io
import json
import sys
import tempfile
import unittest
from pathlib import Path
from zipfile import ZipFile
from unittest.mock import patch

sys.path.insert(0,str(Path(__file__).resolve().parents[1] / 'bridge'))
import radaz_pacs_bridge
from radaz_output import OutputService, print_film, printer_config, test_printer, safe_zip, powershell
from pydicom import dcmread
from pydicom.dataset import Dataset
from pydicom.fileset import FileSet
from pydicom.uid import generate_uid
from pynetdicom import AE, evt
from pynetdicom.sop_class import BasicGrayscalePrintManagementMeta as META, BasicFilmSession, BasicFilmBox, BasicGrayscaleImageBox
from archive_receiver_test import image


class PrintTests(unittest.TestCase):
    def setUp(self):
        self.actions=[]; self.pixels=[]; self.reject=False; self.session=None; self.box=None
        def nget(event):
            result=Dataset(); result.PrinterStatus='NORMAL'; result.PrinterStatusInfo='NORMAL'; return 0,result
        def ncreate(event):
            attributes=event.attribute_list
            if str(event.request.AffectedSOPClassUID)==str(BasicFilmSession):
                self.session=event.request.AffectedSOPInstanceUID
                self.assertEqual(attributes.NumberOfCopies,'2')
                return 0,Dataset() # No SOPClassUID/InstanceUID in attribute list is valid.
            self.assertEqual(attributes.ReferencedFilmSessionSequence[0].ReferencedSOPInstanceUID,self.session)
            self.box=event.request.AffectedSOPInstanceUID
            reference=Dataset(); reference.ReferencedSOPClassUID=BasicGrayscaleImageBox;reference.ReferencedSOPInstanceUID=generate_uid()
            result=Dataset();result.ReferencedImageBoxSequence=[reference];return 0,result
        def nset(event):
            attrs=event.modification_list
            self.assertTrue(hasattr(attrs,'BasicGrayscaleImageSequence'))
            self.assertFalse(hasattr(attrs,'ReferencedImageBoxSequence'))
            self.pixels.append(attrs.BasicGrayscaleImageSequence[0].PixelData)
            return (0xC605 if self.reject else 0),None
        def naction(event):
            self.assertEqual(event.request.RequestedSOPInstanceUID,self.box)
            self.actions.append(event.request.ActionTypeID);return 0,None
        ae=AE(ae_title='TEST_PRINTER');ae.add_supported_context(META)
        self.server=ae.start_server(('127.0.0.1',0),block=False,evt_handlers=[(evt.EVT_N_GET,nget),(evt.EVT_N_CREATE,ncreate),(evt.EVT_N_SET,nset),(evt.EVT_N_ACTION,naction),(evt.EVT_N_DELETE,lambda _:0)])
        self.payload={'host':'127.0.0.1','port':self.server.server_address[1],'aeTitle':'TEST_PRINTER','callingAe':'RADAZ_TEST','copies':2,'layout':'1,1','images':[{'rows':2,'columns':2,'pixels':base64.b64encode(bytes([0,64,128,255])).decode()}]}
    def tearDown(self): self.server.shutdown();self.server.server_close()
    def test_real_print_session_image_box_action_and_exact_raster(self):
        result=print_film(self.payload);self.assertIn('qəbul',result['message']);self.assertEqual(self.pixels,[bytes([0,64,128,255])]);self.assertEqual(self.actions,[1])
    def test_status_test_never_creates_or_prints_a_film(self):
        test_printer(self.payload);self.assertIsNone(self.session);self.assertEqual(self.actions,[])
    def test_rejected_image_never_sends_print_action(self):
        self.reject=True
        with self.assertRaisesRegex(ValueError,'C605'):print_film(self.payload)
        self.assertEqual(self.actions,[])
    def test_bad_raster_rejected_before_association(self):
        self.payload['images'][0]['rows']=3
        with self.assertRaises(ValueError):print_film(self.payload)
        self.assertIsNone(self.session)


class MediaTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name);self.output=OutputService(self.root)
    def tearDown(self):self.temp.cleanup()
    def package(self):
        ds=image();ds.StudyDate='20260930';ds.StudyTime='120000';ds.StudyID='1';ds.SeriesNumber=1;ds.InstanceNumber=1
        original=io.BytesIO();ds.save_as(original,enforce_file_format=True)
        blob=io.BytesIO()
        with ZipFile(blob,'w') as zip:
            zip.writestr('DICOM/IMG000001.dcm',original.getvalue());zip.writestr('START.html','<!doctype html><title>Offline viewer</title>')
            zip.writestr('PREVIEWS/IMG000001.jpg',b'\xff\xd8\xff\xd9')
            zip.writestr('HU/IMG000001.js','window.__RADAZ_HU={};')
            zip.writestr('LITE/viewer.js','/* shared Viewer */')
            zip.writestr('LITE/viewer.css','body{margin:0}')
            zip.writestr('DATA/IMG000001_F000001.js','window.RADAZ_LITE_PACKET={};')
        return blob.getvalue(),ds
    def test_dicomdir_round_trip_and_source_pixels(self):
        data,original=self.package();job=self.output.prepare(data)
        self.assertEqual(job['count'],1)
        root=self.output.job_path(job['id'])/'disc';fileset=FileSet(root/'DICOMDIR')
        self.assertEqual(len(fileset),1);loaded=next(iter(fileset)).load()
        self.assertEqual(loaded.PixelData,original.PixelData);self.assertEqual(loaded.SOPInstanceUID,original.SOPInstanceUID)
        self.assertTrue((root/'START.html').exists())
        self.assertEqual((root/'PREVIEWS'/'IMG000001.jpg').read_bytes(),b'\xff\xd8\xff\xd9')
        for name in ['HU/IMG000001.js','LITE/viewer.js','LITE/viewer.css','DATA/IMG000001_F000001.js']:self.assertTrue((root/name).is_file(),name)
        self.assertIn('shellexecute=START.html',(root/'AUTORUN.INF').read_text(encoding='ascii'))
        with ZipFile(io.BytesIO(self.output.zip_package(job['id']))) as zip:self.assertIn('DICOMDIR',zip.namelist())
    def test_measurement_secondary_capture_is_separate_from_original_dicom(self):
        data,original=self.package()
        source=io.BytesIO(data); archive=io.BytesIO()
        measured=copy.deepcopy(original)
        measured.SOPClassUID='1.2.840.10008.5.1.4.1.1.7'
        measured.SOPInstanceUID=generate_uid()
        measured.SeriesInstanceUID=generate_uid()
        measured.SeriesDescription='RADAZ Measured Images'
        measured.Modality='OT';measured.ImageType=['DERIVED','SECONDARY']
        measured.ConversionType='WSD';measured.BurnedInAnnotation='YES'
        measured.file_meta.MediaStorageSOPClassUID=measured.SOPClassUID
        measured.file_meta.MediaStorageSOPInstanceUID=measured.SOPInstanceUID
        saved=io.BytesIO();measured.save_as(saved,enforce_file_format=True)
        with ZipFile(source) as old,ZipFile(archive,'w') as new:
            for name in old.namelist():new.writestr(name,old.read(name))
            new.writestr('MEASUREMENTS/IMG000001.dcm',saved.getvalue())
        job=self.output.prepare(archive.getvalue());root=self.output.job_path(job['id'])/'disc'
        self.assertEqual(job['count'],2)
        self.assertIn('Secondary Capture',(root/'README.txt').read_text(encoding='utf-8'))
        instances=[record.load() for record in FileSet(root/'DICOMDIR')]
        source_image=next(ds for ds in instances if ds.SOPInstanceUID==original.SOPInstanceUID)
        measured_image=next(ds for ds in instances if ds.SOPInstanceUID==measured.SOPInstanceUID)
        self.assertEqual(source_image.PixelData,original.PixelData)
        self.assertEqual(measured_image.BurnedInAnnotation,'YES')
    def test_zip_path_traversal_is_rejected(self):
        data=io.BytesIO()
        with ZipFile(data,'w') as zip:zip.writestr('../outside.txt','no')
        with self.assertRaises(ValueError):safe_zip(data.getvalue())
        self.assertFalse((self.root.parent/'outside.txt').exists())
    def test_media_manifest_accepts_noncanonical_root(self):
        alias = self.root / 'alias'
        alias.mkdir()
        output = OutputService(alias / '..')
        data, original = self.package()
        job = output.prepare(data)
        media = output.job_path(job['id']) / 'disc'
        manifest = json.loads((media / 'MANIFEST.json').read_text(encoding='utf-8'))
        self.assertEqual(len(manifest['files']), 1)
        target = media / manifest['files'][0]
        self.assertTrue(target.is_file())
        self.assertEqual(dcmread(target).PixelData, original.PixelData)
    def test_missing_study_id_only_gets_a_directory_catalog_id(self):
        file=Path(__file__).resolve().parent/'fixtures'/'demo'/'abdomen-1.dcm'
        source=dcmread(file);buffer=io.BytesIO()
        with ZipFile(buffer,'w') as archive:archive.writestr('DICOM/IMG000001.dcm',file.read_bytes())
        job=self.output.prepare(buffer.getvalue());root=self.output.job_path(job['id'])/'disc'
        saved=next(iter(FileSet(root/'DICOMDIR'))).load()
        self.assertEqual(saved.get('StudyID'),source.get('StudyID'));self.assertEqual(saved.PixelData,source.PixelData)
        directory=dcmread(root/'DICOMDIR');study=next(record for record in directory.DirectoryRecordSequence if record.DirectoryRecordType=='STUDY')
        self.assertTrue(study.StudyID)
    def test_read_only_drive_never_runs_a_burn(self):
        data,_=self.package();job=self.output.prepare(data)
        with patch.object(self.output,'devices',return_value={'drives':[{'id':'readonly','canWrite':False}]}),patch('radaz_output.powershell') as shell:
            with self.assertRaisesRegex(ValueError,'dəstəkləmir'):self.output.start(job['id'],'burn','readonly')
            shell.assert_not_called()
    def test_nonblank_media_is_never_erased_or_written(self):
        data,_=self.package();job=self.output.prepare(data)
        with patch.object(self.output,'devices',return_value={'drives':[{'id':'writer','canWrite':True,'mediaSupported':True,'blank':False}]}),patch('radaz_output.powershell') as shell:
            with self.assertRaisesRegex(ValueError,'boş'):self.output.start(job['id'],'burn','writer')
            shell.assert_not_called()
    def test_settings_persist_and_validate(self):
        config=printer_config({'host':'192.168.1.50','port':'104','aeTitle':'PRINT'},False)
        self.output.save_settings(config);self.assertEqual(OutputService(self.root).settings(),config)
        with self.assertRaises(ValueError):self.output.save_settings({'aeTitle':'BAD\\AE'})
        self.assertEqual(self.output.settings(),config)
    def test_iso_contains_dicomdir(self):
        data,_=self.package();job=self.output.prepare(data);path=self.output.job_path(job['id']);destination=path/'test.iso'
        result=powershell('-Mode','Iso','-Source',path/'disc','-Destination',destination,'-ProgressPath',path/'progress.json')
        self.assertIn('hazırdır',result['message'])
        content=destination.read_bytes();self.assertEqual(content[32769:32774],b'CD001');self.assertIn(b'DICOMDIR',content);self.assertIn(b'AUTORUN.INF',content)
        progress=json.loads((path/'progress.json').read_text());self.assertEqual(progress['done'],len(content));self.assertEqual(progress['total'],len(content))
    def test_async_prepare_reports_ready_and_preserves_offline_runtime(self):
        import time
        data,_=self.package();job=self.output.prepare_async(data);self.assertEqual(job['state'],'preparing')
        deadline=time.monotonic()+10
        while time.monotonic()<deadline:
            status=self.output.status(job['id'])
            if status['state'] in {'ready','error'}:break
            time.sleep(.02)
        self.assertEqual(status['state'],'ready',status)
        self.assertEqual(status['progress']['done'],status['count'])
    def test_streamed_media_validates_paths_and_finishes_without_browser_zip(self):
        import time
        data,original=self.package();job=self.output.begin_media()
        with self.assertRaises(ValueError):self.output.receive_media(job['id'],'../archive.sqlite3',b'bad')
        with ZipFile(io.BytesIO(data)) as archive:
            for entry in archive.infolist():
                if entry.filename.startswith(('PREVIEWS/','HU/')):continue
                self.output.receive_media(job['id'],entry.filename,archive.read(entry))
        with self.assertRaises(FileExistsError):self.output.receive_media(job['id'],'LITE/viewer.js',b'overwrite')
        self.output.finalize_media(job['id']);deadline=time.monotonic()+10
        while time.monotonic()<deadline:
            status=self.output.status(job['id'])
            if status['state'] in {'ready','error'}:break
            time.sleep(.02)
        self.assertEqual(status['state'],'ready',status)
        root=self.output.job_path(job['id'])/'disc';self.assertTrue((root/'LITE/viewer.js').is_file());self.assertFalse((root.parent/'staging').exists())
        self.assertEqual(next(iter(FileSet(root/'DICOMDIR'))).load().PixelData,original.PixelData)
    def test_mp4_and_wmv_contain_all_frames(self):
        from PIL import Image
        for fmt in ('mp4','wmv'):
            buffer=io.BytesIO()
            with ZipFile(buffer,'w') as zip:
                zip.writestr('video.json',json.dumps({'format':fmt,'fps':5}))
                for i in range(3):
                    png=io.BytesIO();Image.new('RGB',(20+i*2,18),(i*90,40,180)).save(png,format='PNG');zip.writestr(f'FRAME{i:06}.png',png.getvalue())
            encoded,mime=self.output.video(buffer.getvalue());self.assertGreater(len(encoded),100)
            target=self.root/f'test.{fmt}';target.write_bytes(encoded)
            import subprocess
            result=subprocess.run(['ffprobe','-v','error','-select_streams','v:0','-count_frames','-show_entries','stream=nb_read_frames,width,height','-of','json',str(target)],capture_output=True,check=True)
            stream=json.loads(result.stdout)['streams'][0];self.assertEqual(int(stream['nb_read_frames']),3);self.assertEqual(stream['width'],1920);self.assertEqual(stream['height'],1080)


if __name__=='__main__':unittest.main()
