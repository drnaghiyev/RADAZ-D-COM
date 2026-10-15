"""Actual DICOM stores and study-level C-GET with disposable synthetic datasets."""
import io
import json
import socket
import sys
import tempfile
import time
import unittest
from pathlib import Path
from threading import Thread, Event
from http.server import ThreadingHTTPServer
from urllib.request import Request, urlopen
from urllib.error import HTTPError
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'bridge'))
from radaz_archive import Archive, handler_for
from radaz_send import Sender, read_dataset
from radaz_product import ProductService
from pydicom.dataset import Dataset, FileMetaDataset
from pydicom.uid import ExplicitVRLittleEndian, JPEGBaseline8Bit, generate_uid
from pydicom.encaps import encapsulate
from pynetdicom import AE, evt
from pynetdicom.sop_class import CTImageStorage, Verification, StudyRootQueryRetrieveInformationModelGet, StudyRootQueryRetrieveInformationModelMove


def port():
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        return sock.getsockname()[1]


def image(study=None, series=None):
    ds = Dataset()
    ds.StudyInstanceUID = study or generate_uid()
    ds.SeriesInstanceUID = series or generate_uid()
    ds.SOPInstanceUID = generate_uid(); ds.SOPClassUID = CTImageStorage
    ds.PatientName = 'SYNTHETIC^BRIDGE'; ds.PatientID = 'SYNTHETIC'; ds.Modality = 'CT'
    ds.Rows = 2; ds.Columns = 2; ds.SamplesPerPixel = 1
    ds.PhotometricInterpretation = 'MONOCHROME2'; ds.BitsAllocated = 16
    ds.BitsStored = 16; ds.HighBit = 15; ds.PixelRepresentation = 0
    ds.PixelData = b'\x01\x00\x02\x00\x03\x00\x04\x00'
    ds.file_meta = FileMetaDataset(); ds.file_meta.TransferSyntaxUID = ExplicitVRLittleEndian
    return ds


def encoded(ds):
    stream = io.BytesIO(); ds.save_as(stream, enforce_file_format=True); return stream.getvalue()


class SendTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.archive = Archive(Path(self.temp.name), bind='127.0.0.1')
        self.sender = Sender(self.archive); self.received = []; self.store_status = 0
        self.destination = port()
        ae = AE(ae_title='RADAZBRIDGE'); ae.require_called_aet = True; ae.require_calling_aet = ['RADAZ']
        ae.add_supported_context(Verification)
        ae.add_supported_context(CTImageStorage, [ExplicitVRLittleEndian, JPEGBaseline8Bit])
        def store(event):
            self.received.append((str(event.dataset.SOPInstanceUID), bytes(event.dataset.PixelData), str(event.file_meta.TransferSyntaxUID)))
            return self.store_status
        self.scp = ae.start_server(('127.0.0.1', self.destination), block=False, evt_handlers=[(evt.EVT_C_STORE, store)])
        self.target = dict(host='127.0.0.1', port=str(self.destination), aeTitle='RADAZBRIDGE', callingAe='RADAZ')

    def tearDown(self):
        self.scp.shutdown(); self.archive.stop(); self.temp.cleanup()

    def wait(self, job):
        for _ in range(300):
            result = self.sender.status(job['id'])
            if result['state'] not in ('running', 'receiving'): return result
            time.sleep(.02)
        self.fail('Transfer did not finish')

    def test_disk_complete_study_preserves_pixels_uid_and_source(self):
        first = image(); images = [first, image(first.StudyInstanceUID), image(first.StudyInstanceUID)]
        for ds in images: self.archive.store(encoded(ds), ds)
        job = self.sender.start(dict(target=self.target, source='disk', studyUID=str(first.StudyInstanceUID), expected=3))
        result = self.wait(job)
        self.assertEqual((result['state'], result['sent']), ('completed', 3))
        self.assertEqual({v[0] for v in self.received}, {str(ds.SOPInstanceUID) for ds in images})
        self.assertTrue(all(v[1] == first.PixelData for v in self.received))
        self.assertEqual(len(self.archive.instances(str(first.StudyInstanceUID))), 3)
        self.assertEqual(Sender(self.archive).settings(), self.target)

    def test_upload_wrong_study_duplicate_missing_and_cancel(self):
        ds = image()
        job = self.sender.start(dict(target=self.target, source='upload', studyUID=str(ds.StudyInstanceUID), expected=2))
        self.sender.upload(job['id'], encoded(ds)); self.sender.upload(job['id'], encoded(ds))
        self.assertEqual(len(self.received), 1)
        self.assertEqual(self.sender.finish(job['id'])['state'], 'failed')
        job = self.sender.start(dict(target=self.target, source='upload', studyUID=str(ds.StudyInstanceUID), expected=1))
        with self.assertRaisesRegex(ValueError, 'aid deyil'): self.sender.upload(job['id'], encoded(image()))
        self.assertEqual(self.sender.status(job['id'])['sent'], 0)
        job = self.sender.start(dict(target=self.target, source='upload', studyUID=str(ds.StudyInstanceUID), expected=1))
        self.sender.cancel(job['id'])
        with self.assertRaises(ValueError): self.sender.upload(job['id'], encoded(ds))
        self.assertFalse(self.sender.busy())

    def test_receiver_reject_and_warning_are_not_clean_success(self):
        ds = image()
        for code, state in [(0xA700, 'failed'), (0xB000, 'warning')]:
            self.store_status = code
            job = self.sender.start(dict(target=self.target, source='upload', studyUID=str(ds.StudyInstanceUID), expected=1))
            if code == 0xA700:
                with self.assertRaisesRegex(ValueError, '0xA700'): self.sender.upload(job['id'], encoded(ds))
            else:
                self.sender.upload(job['id'], encoded(ds)); self.sender.finish(job['id'])
            result = self.sender.status(job['id'])
            self.assertEqual(result['state'], state)
            self.assertEqual(result['sent'], int(code == 0xB000))

    def test_raw_and_compressed_are_sent_without_pixel_conversion(self):
        ds = image()
        raw = encoded(ds)[132:]
        self.assertEqual(read_dataset(raw).PixelData, ds.PixelData)
        ds.file_meta.TransferSyntaxUID = JPEGBaseline8Bit
        ds.PixelData = encapsulate([b'\xff\xd8synthetic-compressed-payload\xff\xd9']); ds['PixelData'].is_undefined_length = True
        job = self.sender.start(dict(target=self.target, source='upload', studyUID=str(ds.StudyInstanceUID), expected=1))
        self.sender.upload(job['id'], encoded(ds))
        self.assertEqual(self.sender.finish(job['id'])['state'], 'completed')
        self.assertEqual(self.received[-1][1:], (ds.PixelData, str(JPEGBaseline8Bit)))

    def test_dimse_forwards_all_series_without_browser_800_limit(self):
        first = image(); images = [first, image(first.StudyInstanceUID), image(first.StudyInstanceUID)]
        ae = AE(ae_title='SOURCE'); ae.add_supported_context(StudyRootQueryRetrieveInformationModelGet)
        ae.add_supported_context(CTImageStorage, ExplicitVRLittleEndian, scu_role=True, scp_role=True)
        def get(event):
            self.assertEqual(event.identifier.QueryRetrieveLevel, 'STUDY')
            self.assertEqual(str(event.identifier.StudyInstanceUID), str(first.StudyInstanceUID))
            yield len(images)
            for ds in images: yield 0xFF00, ds
        source_port = port()
        scp = ae.start_server(('127.0.0.1', source_port), block=False, evt_handlers=[(evt.EVT_C_GET, get)])
        try:
            with patch('radaz_pacs_bridge.MAX_IMAGES', 1):
                job = self.sender.start(dict(target=self.target, source='dimse', studyUID=str(first.StudyInstanceUID), expected=3,
                    pacs=dict(host='127.0.0.1', port=source_port, aeTitle='SOURCE', callingAe='RADAZ', listenerPort=port())))
                result = self.wait(job)
            self.assertEqual((result['state'], result['sent']), ('completed', 3), result)
            self.assertEqual(len(self.received), 3)
        finally: scp.shutdown()

    def test_http_binary_upload_origin_and_lifecycle(self):
        product = ProductService(self.archive.root, device='B'*64, trial_root=self.archive.root/'trial')
        with patch('radaz_archive.ProductService', return_value=product):
            http = ThreadingHTTPServer(('127.0.0.1', 0), handler_for(self.archive))
        thread = Thread(target=http.serve_forever, daemon=True); thread.start()
        base = f'http://127.0.0.1:{http.server_port}'
        def post(path, data, kind='application/json', origin='http://localhost:5173'):
            return json.load(urlopen(Request(base+path, data=data if isinstance(data, bytes) else json.dumps(data).encode(),
                headers={'Content-Type': kind, 'Origin': origin})))
        try:
            ds = image()
            with self.assertRaises(HTTPError) as error: post('/bridge/test', self.target, origin='https://other.example')
            self.assertEqual(error.exception.code, 403)
            job = post('/bridge/start', dict(target=self.target, source='upload', studyUID=str(ds.StudyInstanceUID), expected=1))
            with patch.dict('os.environ', {'RADAZ_DESKTOP_TOKEN': 'test-stop'}):
                with self.assertRaises(HTTPError) as error:
                    urlopen(Request(base+'/_desktop/stop', data=b'{}', headers={'X-RADAZ-Desktop':'test-stop'}))
                self.assertEqual(error.exception.code, 409)
            post('/bridge/file?id='+job['id'], encoded(ds), 'application/dicom')
            self.assertEqual(post('/bridge/finish', {'id':job['id']})['state'], 'completed')
        finally: http.shutdown(); http.server_close(); thread.join()

    def test_c_move_fallback_forwards_complete_study(self):
        ds = image(); listener = port()
        ae = AE(ae_title='SOURCE'); ae.add_supported_context(StudyRootQueryRetrieveInformationModelMove)
        ae.add_requested_context(CTImageStorage, ExplicitVRLittleEndian)
        def move(event):
            self.assertEqual(event.move_destination, 'RADAZ')
            yield '127.0.0.1', listener
            yield 1
            yield 0xFF00, ds
        source_port = port(); scp = ae.start_server(('127.0.0.1',source_port),block=False,evt_handlers=[(evt.EVT_C_MOVE,move)])
        try:
            job = self.sender.start(dict(target=self.target,source='dimse',studyUID=str(ds.StudyInstanceUID),expected=1,
                pacs=dict(host='127.0.0.1',port=source_port,aeTitle='SOURCE',callingAe='RADAZ',listenerPort=listener)))
            result = self.wait(job)
            self.assertEqual((result['state'], result['sent']), ('completed',1), result)
        finally: scp.shutdown()

    def test_cancel_waits_for_ack_and_prevents_next_instance(self):
        ds = image(); other = image(ds.StudyInstanceUID)
        for item in (ds,other): self.archive.store(encoded(item),item)
        started = Event(); release = Event()
        from radaz_send import store_dataset
        def gated(target, dataset):
            started.set(); release.wait(5); return store_dataset(target,dataset)
        with patch('radaz_send.store_dataset', side_effect=gated):
            job = self.sender.start(dict(target=self.target,source='disk',studyUID=str(ds.StudyInstanceUID),expected=2))
            self.assertTrue(started.wait(3))
            with self.assertRaises(ValueError): self.sender.finish(job['id'])
            self.sender.cancel(job['id']); self.assertTrue(self.sender.busy())
            release.set(); result = self.wait(job)
        self.assertEqual((result['state'],result['sent']),('cancelled',1))
        self.assertEqual(len(self.received),1)


if __name__ == '__main__': unittest.main()
