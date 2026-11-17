"""Exercise the real DIMSE and HTTP protocols with isolated synthetic data."""
import io
import json
import socket
import sys
import tempfile
import unittest
from pathlib import Path
from threading import Thread
from urllib.request import urlopen, Request
from urllib.error import HTTPError
from http.server import ThreadingHTTPServer
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'bridge'))
from radaz_archive import Archive, handler_for
from radaz_product import ProductService
from pydicom import dcmread
from pydicom.dataset import Dataset, FileMetaDataset
from pydicom.uid import ExplicitVRLittleEndian, generate_uid
from pynetdicom import AE
from pynetdicom.sop_class import ComputedRadiographyImageStorage, Verification


def free_port():
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        return sock.getsockname()[1]


def image():
    ds = Dataset()
    ds.SOPClassUID = ComputedRadiographyImageStorage
    ds.SOPInstanceUID = generate_uid(); ds.StudyInstanceUID = generate_uid(); ds.SeriesInstanceUID = generate_uid()
    ds.PatientName = 'RADAZ^SYNTHETIC'; ds.PatientID = 'TEST'; ds.Modality = 'CR'
    ds.Rows = 2; ds.Columns = 3; ds.SamplesPerPixel = 1; ds.PhotometricInterpretation = 'MONOCHROME1'
    ds.BitsAllocated = 16; ds.BitsStored = 12; ds.HighBit = 11; ds.PixelRepresentation = 0
    ds.PixelData = bytes([0,0,1,0,2,0,0,4,255,7,255,15])
    ds.file_meta = FileMetaDataset(); ds.file_meta.TransferSyntaxUID = ExplicitVRLittleEndian
    return ds


class ReceiverTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.archive = Archive(self.root, bind='127.0.0.1')
        self.port = free_port()
        self.archive.configure({'aeTitle':'RADAZ_TEST','port':self.port,'enabled':True})
        self.ds = image()
        product = ProductService(self.root, device='A'*64, trial_root=self.root/'trial')
        with patch('radaz_archive.ProductService', return_value=product):
            self.http = ThreadingHTTPServer(('127.0.0.1',0),handler_for(self.archive))
        self.thread = Thread(target=self.http.serve_forever, daemon=True); self.thread.start()
        self.url = f'http://127.0.0.1:{self.http.server_port}'

    def tearDown(self):
        self.http.shutdown(); self.http.server_close(); self.thread.join()
        self.archive.stop(); self.temp.cleanup()

    def association(self, called='RADAZ_TEST'):
        ae = AE(ae_title='RADAZ_TEST_SCU')
        ae.add_requested_context(ComputedRadiographyImageStorage, ExplicitVRLittleEndian)
        ae.add_requested_context(Verification)
        return ae.associate('127.0.0.1', self.port, ae_title=called)

    def test_http_only_companion_preserves_receiver_settings_and_does_not_listen(self):
        before = (self.root / 'config.json').read_bytes()
        with patch('radaz_archive.AE') as ae, patch.object(Archive, 'cleanup_deleted') as cleanup:
            companion = Archive(self.root, bind='127.0.0.1', http_only=True)
            companion.start()
            with self.assertRaisesRegex(ValueError, 'əsas RADAZ'):
                companion.configure({'aeTitle':'CHANGE','port':free_port(),'enabled':False})
            companion.stop()
            ae.assert_not_called()
            cleanup.assert_not_called()
        self.assertEqual((self.root / 'config.json').read_bytes(), before)
        self.assertTrue(self.archive.status()['running'])

    def test_desktop_shutdown_rejects_browser_and_defers_active_association(self):
        with patch.dict('os.environ', {'RADAZ_DESKTOP_TOKEN':'synthetic-secret'}):
            for headers in ({},{'X-RADAZ-Desktop':'wrong'},{'X-RADAZ-Desktop':'synthetic-secret','Origin':'http://localhost:5173'}):
                with self.assertRaises(HTTPError) as caught: urlopen(Request(self.url+'/_desktop/stop', data=b'{}', headers=headers))
                self.assertEqual(caught.exception.code,403)
            assoc=self.association()
            with self.assertRaises(HTTPError) as caught:
                urlopen(Request(self.url+'/_desktop/stop',data=b'{}',headers={'X-RADAZ-Desktop':'synthetic-secret'}))
            self.assertEqual(caught.exception.code,409)
            self.assertEqual(assoc.send_c_store(self.ds).Status,0)
            assoc.release()
            with urlopen(Request(self.url+'/_desktop/stop',data=b'{}',headers={'X-RADAZ-Desktop':'synthetic-secret'})) as response:
                self.assertTrue(json.load(response)['stopping'])
            self.thread.join(timeout=5)
            self.assertFalse(self.thread.is_alive())
            self.assertEqual(self.archive.status()['instanceCount'],1)

    def test_echo_store_duplicate_restart_pixels_and_http(self):
        assoc = self.association(); self.assertTrue(assoc.is_established)
        self.assertEqual(assoc.send_c_echo().Status, 0)
        self.assertEqual(assoc.send_c_store(self.ds).Status, 0)
        self.assertEqual(assoc.send_c_store(self.ds).Status, 0)
        assoc.release()
        self.assertEqual(self.archive.status()['instanceCount'], 1)
        self.archive.stop()
        self.archive = Archive(self.root, bind='127.0.0.1'); self.archive.start()
        self.assertEqual(self.archive.config['port'],self.port)
        studies = self.archive.studies(); self.assertEqual(len(studies), 1)
        self.assertEqual(studies[0]['imageCount'], 1)
        with urlopen(self.url + '/file/' + str(self.ds.SOPInstanceUID)) as response:
            payload = response.read()
            saved = dcmread(io.BytesIO(payload))
        self.assertEqual(saved.PixelData, self.ds.PixelData)
        self.assertEqual(saved.file_meta.TransferSyntaxUID, ExplicitVRLittleEndian)
        with urlopen(self.url + '/instances?study=' + str(self.ds.StudyInstanceUID)) as response:
            instance = json.load(response)[0]
            self.assertEqual(instance['size'], len(payload))
            self.assertEqual(instance['series'], str(self.ds.SeriesInstanceUID))
        with urlopen(self.url + '/studies') as response:
            self.assertEqual(json.load(response)[0]['storage'], 'disk')

    def test_wrong_called_ae_rejected(self):
        assoc = self.association('NOT_RADAZ'); self.assertFalse(assoc.is_established)

    def test_standard_port_104_echo_and_cr_store(self):
        # Fixed-port modalities can use 104; do not disturb another local listener.
        try:
            self.archive.configure({'aeTitle': 'RADAZ_TEST', 'port': 104, 'enabled': True})
        except OSError as error:
            self.skipTest(f'Port 104 is not available on this test host: {error}')
        self.port = 104
        assoc = self.association(); self.assertTrue(assoc.is_established)
        self.assertEqual(assoc.send_c_echo().Status, 0)
        self.assertEqual(assoc.send_c_store(self.ds).Status, 0)
        assoc.release()
        self.assertEqual(self.archive.status()['instanceCount'], 1)
        with urlopen(self.url + '/studies') as response:
            self.assertEqual(json.load(response)[0]['modality'], 'CR')

    def test_receiver_port_validation(self):
        for port in (104, 1024, 11113, 65535):
            self.assertEqual(Archive.validate({'aeTitle': 'RADAZ_TEST', 'port': port})['port'], port)
        for port in (0, 80, 443, 1023, 5173, 8765, 8766, 65536):
            with self.subTest(port=port), self.assertRaises(ValueError):
                Archive.validate({'aeTitle': 'RADAZ_TEST', 'port': port})

    def test_cd_import_then_cstore_same_dataset(self):
        stream=io.BytesIO(); self.ds.save_as(stream,enforce_file_format=True)
        self.archive.store(stream.getvalue(), self.ds)
        assoc=self.association()
        self.assertEqual(assoc.send_c_store(self.ds).Status,0)
        assoc.release()
        self.assertEqual(self.archive.status()['instanceCount'],1)

    def test_retransmission_with_changed_nonclinical_metadata_is_accepted(self):
        stream=io.BytesIO(); self.ds.save_as(stream,enforce_file_format=True)
        original=stream.getvalue()
        self.archive.store(original,self.ds)
        retransmitted=self.ds.copy()
        retransmitted.InstanceCreationTime='235959'
        retransmitted.add_new((0x0011,0x1010),'LO','UPDATED PRIVATE TAG')
        assoc=self.association()
        self.assertEqual(assoc.send_c_store(retransmitted).Status,0)
        assoc.release()
        self.assertEqual(self.archive.status()['instanceCount'],1)
        with urlopen(self.url+'/file/'+str(self.ds.SOPInstanceUID)) as response:
            self.assertEqual(response.read(),original)

    def test_retransmission_with_changed_geometry_is_rejected(self):
        stream=io.BytesIO(); self.ds.save_as(stream,enforce_file_format=True)
        self.archive.store(stream.getvalue(),self.ds)
        retransmitted=self.ds.copy()
        retransmitted.ImagePositionPatient=[1,2,3]
        assoc=self.association()
        self.assertEqual(assoc.send_c_store(retransmitted).Status,0xA900)
        assoc.release()
        self.assertEqual(self.archive.status()['instanceCount'],1)

    def test_storage_failure_never_acknowledges_success(self):
        def fail(*_): raise OSError('simulated full disk')
        self.archive.store = fail
        assoc = self.association()
        self.assertEqual(assoc.send_c_store(self.ds).Status,0xA700)
        assoc.release(); self.assertEqual(self.archive.status()['instanceCount'],0)

    def test_uid_collision_preserves_original(self):
        assoc = self.association(); self.assertEqual(assoc.send_c_store(self.ds).Status,0)
        self.ds.PixelData = bytes(12)
        self.assertEqual(assoc.send_c_store(self.ds).Status,0xA900)
        assoc.release(); self.assertEqual(self.archive.status()['instanceCount'],1)

    def test_failed_reconfiguration_restores_listener(self):
        with socket.socket() as occupied:
            occupied.bind(('127.0.0.1',0)); occupied.listen()
            with self.assertRaises(OSError):
                self.archive.configure({'aeTitle':'NEW_AE','port':occupied.getsockname()[1],'enabled':True})
        assoc=self.association(); self.assertTrue(assoc.is_established); assoc.release()
        self.assertEqual(self.archive.config['aeTitle'],'RADAZ_TEST')

    def test_http_import_and_untrusted_origin(self):
        stream=io.BytesIO(); self.ds.save_as(stream,enforce_file_format=True)
        request=Request(self.url+'/import',stream.getvalue(),headers={'Content-Type':'application/dicom'})
        with urlopen(request) as response: self.assertEqual(response.status,200)
        self.assertEqual(self.archive.status()['instanceCount'],1)
        with self.assertRaises(HTTPError) as error:
            urlopen(Request(self.url+'/status',headers={'Origin':'https://untrusted.example'}))
        self.assertEqual(error.exception.code,403)

    def save_image(self, ds):
        stream = io.BytesIO(); ds.save_as(stream, enforce_file_format=True)
        self.archive.store(stream.getvalue(), ds)

    def test_bulk_delete_removes_only_selected_files_and_survives_restart(self):
        other = image()
        self.save_image(self.ds); self.save_image(other)
        with self.archive.connect() as db:
            keep = self.root / db.execute('SELECT path FROM instances WHERE sop=?', (other.SOPInstanceUID,)).fetchone()[0]
            removed = self.root / db.execute('SELECT path FROM instances WHERE sop=?', (self.ds.SOPInstanceUID,)).fetchone()[0]
            db.execute('INSERT INTO opened VALUES (?,1)', (self.ds.StudyInstanceUID,))
        data = json.dumps({'studies': [self.ds.StudyInstanceUID]}).encode()
        with urlopen(Request(self.url + '/studies/delete', data, headers={'Content-Type': 'application/json'})) as response:
            result = json.load(response)
        self.assertEqual(result['deleted'], 1)
        self.assertGreater(result['freedBytes'], 0)
        self.assertEqual(result['pendingBytes'], 0)
        self.assertFalse(removed.exists()); self.assertTrue(keep.exists())
        self.assertEqual([s['uid'] for s in Archive(self.root).studies()], [other.StudyInstanceUID])
        with self.archive.connect() as db:
            self.assertEqual(db.execute('SELECT COUNT(*) FROM opened').fetchone()[0], 0)
        self.assertEqual(self.archive.delete_studies([self.ds.StudyInstanceUID])['deleted'], 0)

    def test_delete_rejects_invalid_batch_origin_and_path_without_removing_data(self):
        self.save_image(self.ds)
        for payload in ([], '1.2.3', [self.ds.StudyInstanceUID, '../escape']):
            with self.assertRaises(ValueError): self.archive.delete_studies(payload)
        data = json.dumps({'studies': [self.ds.StudyInstanceUID]}).encode()
        with self.assertRaises(HTTPError) as error:
            urlopen(Request(self.url + '/studies/delete', data, headers={'Content-Type': 'application/json', 'Origin': 'https://untrusted.example'}))
        self.assertEqual(error.exception.code, 403)
        with self.archive.connect() as db:
            db.execute("UPDATE instances SET path='../outside.dcm'")
        with self.assertRaises(ValueError): self.archive.delete_studies([self.ds.StudyInstanceUID])
        self.assertEqual(self.archive.status()['instanceCount'], 1)

    def test_locked_file_cleanup_retries_after_restart(self):
        self.save_image(self.ds)
        with patch.object(Path, 'unlink', side_effect=PermissionError('locked')):
            result = self.archive.delete_studies([self.ds.StudyInstanceUID])
        self.assertGreater(result['pendingBytes'], 0)
        self.assertEqual(result['freedBytes'], 0)
        self.assertEqual(self.archive.studies(), [])
        self.assertEqual(len(list((self.root / 'instances').rglob('*.dcm'))), 1)
        Archive(self.root)
        self.assertEqual(list((self.root / 'instances').rglob('*.dcm')), [])

    def test_failed_delete_transaction_keeps_files_and_index(self):
        self.save_image(self.ds)
        with self.archive.connect() as db:
            db.execute("CREATE TRIGGER fail_delete BEFORE DELETE ON instances BEGIN SELECT RAISE(ABORT, 'simulated'); END")
        with self.assertRaises(Exception): self.archive.delete_studies([self.ds.StudyInstanceUID])
        self.assertEqual(self.archive.status()['instanceCount'], 1)
        self.assertEqual(len(list((self.root / 'instances').rglob('*.dcm'))), 1)


if __name__ == '__main__':
    unittest.main(verbosity=2)
