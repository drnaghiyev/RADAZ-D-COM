"""Disposable optical drive simulator for browser tests; never shipped in releases."""
import argparse
import io
import json
import sys
from pathlib import Path
from threading import Event
from http.server import ThreadingHTTPServer
from urllib.parse import urlsplit

from removable_media_test import write_image
from radaz_archive import Archive, handler_for
from radaz_removable import RemovableMedia
from pydicom import dcmread
from pydicom.encaps import encapsulate
from pydicom.uid import JPEGBaseline8Bit
from PIL import Image

parser = argparse.ArgumentParser()
parser.add_argument('--root', type=Path, required=True)
args = parser.parse_args()
disc = args.root/'disc'
for i in range(1, 701): write_image(disc/f'CT/I{i:04}', i, raw=i == 1)
ds = write_image(disc/'JPEG_NO_EXTENSION', 701)
ds.SeriesInstanceUID = '2.25.105'; ds.SeriesDescription = 'JPEG compressed CD'
ds.BitsAllocated = ds.BitsStored = 8; ds.HighBit = 7; ds.WindowCenter = 128; ds.WindowWidth = 256
image = Image.frombytes('L', (32, 32), bytes(x % 256 for x in range(1024)))
buffer = io.BytesIO(); image.save(buffer, format='JPEG', quality=95)
ds.PixelData = encapsulate([buffer.getvalue()]); ds['PixelData'].is_undefined_length = True
ds.file_meta.TransferSyntaxUID = JPEGBaseline8Bit; ds.save_as(disc/'JPEG_NO_EXTENSION', enforce_file_format=True)
(disc/'README.txt').write_text('Unrelated text file' * 100)
present = {}; released = Event(); copying = Event(); copying.set()
media = RemovableMedia(lambda: dict(present), interval=.05, cache_parent=args.root)
open_file = media.open_file

def gated_file(sid, fid):
    item = next((i for i in media.entries(sid)['items'] if i['id'] == fid), None)
    # Pause early in the transfer to test interaction before the 700 images finish.
    if item and item['instance'] == 20:
        released.wait(60)
    return open_file(sid, fid)

media.open_file = gated_file
archive = Archive(args.root/'archive', bind='127.0.0.1')
Base = handler_for(archive, media)
persist = media.persist
def gated_persist(path):
    if int(path.stat().st_size) and archive.status()['instanceCount'] >= 33:
        copying.wait(120)
    persist(path)
media.persist = gated_persist

class Handler(Base):
    def do_GET(self):
        if self.path == '/file/2.25.101.20': released.wait(60)
        if self.path == '/_test/cache':
            self.respond({'files': len(list(media.cache_root.rglob('*.dcm')))}); return
        if self.path == '/_test/large':
            ds = dcmread(disc/'CT/I0002')
            ds.Rows = ds.Columns = 2048
            ds.PixelData = b'\x00\x01' * (2048 * 2048)
            buffer = io.BytesIO(); ds.save_as(buffer, enforce_file_format=True)
            data = buffer.getvalue()
            self.send_response(200); self.send_header('Content-Type', 'application/dicom')
            self.send_header('Content-Length', str(len(data))); self.end_headers(); self.wfile.write(data); return
        return super().do_GET()

    def permitted(self):
        origin = urlsplit(self.headers.get('Origin', ''))
        return super().permitted() or (origin.scheme == 'http' and origin.hostname == '127.0.0.1')

    def do_POST(self):
        if self.path == '/_test/pause-copy':
            copying.clear(); self.respond({'ok': True}); return
        if self.path == '/_test/resume-copy':
            copying.set(); self.respond({'ok': True}); return
        if self.path == '/_test/window-study':
            for i in range(1, 4):
                ds = dcmread(disc/'CT/I0002'); ds.InstanceNumber = i; ds.ImagePositionPatient = [0,0,i]
                ds.PatientName = 'WINDOW^TEST'; ds.PatientID = 'WINDOW-TEST'
                ds.Modality = 'CR'; ds.SOPClassUID = '1.2.840.10008.5.1.4.1.1.1'
                ds.StudyInstanceUID = '2.25.301'; ds.SeriesInstanceUID = '2.25.302'
                ds.SOPInstanceUID = f'2.25.303.{i}'; ds.SeriesDescription = 'Window isolation'
                ds.WindowCenter = 100 * i; ds.WindowWidth = 400 * i
                buffer = io.BytesIO(); ds.save_as(buffer, enforce_file_format=True)
                archive.store(buffer.getvalue(), ds)
            self.respond({'ok': True}); return
        if self.path == '/_test/window-modalities':
            for group, modality in enumerate(('CT', 'MR', 'DX'), 1):
                for series in (1, 2):
                    for i in range(1, 13):
                        ds = dcmread(disc/'CT/I0002'); ds.InstanceNumber = i; ds.ImagePositionPatient = [0,0,i]
                        ds.PatientName = f'WINDOW^{modality}'; ds.PatientID = f'WINDOW-{modality}'
                        ds.Modality = modality; ds.SOPClassUID = {'CT':'1.2.840.10008.5.1.4.1.1.2','MR':'1.2.840.10008.5.1.4.1.1.4','DX':'1.2.840.10008.5.1.4.1.1.1.1'}[modality]
                        ds.StudyInstanceUID = f'2.25.40{group}'; ds.SeriesInstanceUID = f'2.25.40{group}.{series}'
                        ds.FrameOfReferenceUID = f'2.25.41{group}'
                        ds.SOPInstanceUID = f'2.25.40{group}.{series}.{i}'; ds.SeriesDescription = f'{modality} window {series}'
                        ds.WindowCenter = 100 * i; ds.WindowWidth = 400 * i
                        buffer = io.BytesIO(); ds.save_as(buffer, enforce_file_format=True)
                        archive.store(buffer.getvalue(), ds)
            self.respond({'ok': True}); return
        if self.path == '/_test/insert':
            released.clear(); present[str(disc)] = ('synthetic', 'Synthetic 700 CT'); self.respond({'ok': True}); return
        if self.path == '/_test/eject':
            present.clear(); media.poll(); released.set(); self.respond({'ok': True}); return
        if self.path == '/_test/resume':
            released.set(); self.respond({'ok': True}); return
        if self.path == '/_test/archive':
            for i in range(1, 4):
                ds = dcmread(disc/'CT/I0002')
                ds.PatientName = f'TEST^PATIENT^{i}'; ds.PatientID = f'TEST-{i}'
                ds.StudyInstanceUID = f'2.25.200.{i}'; ds.SeriesInstanceUID = f'2.25.201.{i}'
                ds.SOPInstanceUID = f'2.25.202.{i}'; ds.SeriesDescription = f'Archive test {i}'
                buffer = io.BytesIO(); ds.save_as(buffer, enforce_file_format=True)
                archive.store(buffer.getvalue(), ds)
            self.respond({'ok': True}); return
        return super().do_POST()

http = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
print(json.dumps({'port': http.server_port}), flush=True)
try: http.serve_forever()
finally: released.set(); copying.set(); media.close(); archive.stop(); http.server_close()
