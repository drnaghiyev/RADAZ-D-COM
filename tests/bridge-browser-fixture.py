"""Temporary archive, DICOMweb/DIMSE PACS and receiving SCP for UI verification."""
import argparse
import json
import time
from urllib.parse import urlsplit, parse_qs
from http.server import ThreadingHTTPServer
from pathlib import Path
from threading import Event
from bridge_send_test import Archive, handler_for, AE, evt, CTImageStorage, Verification, StudyRootQueryRetrieveInformationModelGet, ExplicitVRLittleEndian, image, encoded, port

parser = argparse.ArgumentParser(); parser.add_argument('--root', type=Path, required=True); args = parser.parse_args()
archive = Archive(args.root, bind='127.0.0.1')
first = image(); images = [first, image(first.StudyInstanceUID), image(first.StudyInstanceUID)]
for i, ds in enumerate(images):
    ds.StudyDate = time.strftime('%Y%m%d'); ds.InstanceNumber = i + 1
    archive.store(encoded(ds), ds)
other = image(); other.PatientName = 'OTHER^BRIDGE'; other.StudyDate = first.StudyDate
archive.store(encoded(other), other)
received = []; rejected = False; warned = False
release_store = Event(); release_store.set(); hold_after = None
ae = AE(ae_title='RADAZBRIDGE'); ae.require_called_aet = True; ae.require_calling_aet = ['RADAZ']
ae.add_supported_context(Verification); ae.add_supported_context(CTImageStorage, ExplicitVRLittleEndian)
def store(event):
    if hold_after is not None and len(received) >= hold_after:
        release_store.wait(30)
    time.sleep(.7)  # Observe intermediate acknowledgement progress in the UI.
    if rejected: return 0xA700
    received.append(str(event.dataset.SOPInstanceUID)); return 0xB006 if warned else 0
destination = port(); receiver = ae.start_server(('127.0.0.1',destination), block=False, evt_handlers=[(evt.EVT_C_STORE,store)])
source_ae = AE(ae_title='SOURCE'); source_ae.add_supported_context(StudyRootQueryRetrieveInformationModelGet)
source_ae.add_supported_context(CTImageStorage, ExplicitVRLittleEndian, scu_role=True, scp_role=True)
def get(event):
    yield len(images)
    for ds in images: yield 0xFF00, ds
source_port = port(); source = source_ae.start_server(('127.0.0.1', source_port),block=False,evt_handlers=[(evt.EVT_C_GET,get)])
Base = handler_for(archive)
def field(v): return {'vr':'UI','Value':[v]}
class Handler(Base):
    def end_headers(self):
        self.send_header('Access-Control-Allow-Origin','*')
        self.send_header('Access-Control-Allow-Headers','Authorization,Content-Type')
        super().end_headers()
    def do_OPTIONS(self): self.send_response(204); self.end_headers()
    def permitted(self):
        return not self.headers.get('Origin') or urlsplit(self.headers['Origin']).hostname in ('localhost','127.0.0.1')
    def do_GET(self):
        parsed=urlsplit(self.path); p=parsed.path
        if p=='/_test/received': self.respond({'received':received}); return
        if p=='/test-pacs/studies':
            self.respond([{'0020000D':field(str(first.StudyInstanceUID)),'00100010':{'vr':'PN','Value':[{'Alphabetic':'SYNTHETIC^BRIDGE'}]},'00080020':field(first.StudyDate),'00080061':field('CT'),'00201206':field(3),'00201208':field(3)}]); return
        if p.endswith('/series'):
            self.respond([{'0020000E':field(str(ds.SeriesInstanceUID)),'00080060':field('CT'),'00201209':field(1)} for ds in images]); return
        if p.endswith('/instances'):
            self.respond([{'00080018':field(str(ds.SOPInstanceUID)),'0020000E':field(str(ds.SeriesInstanceUID))} for ds in images]); return
        if '/instances/' in p:
            ds=next(d for d in images if str(d.SOPInstanceUID)==p.split('/')[-1]); self.binary(encoded(ds),'application/dicom','synthetic.dcm'); return
        return super().do_GET()
    def do_POST(self):
        global rejected, warned, hold_after
        if self.path=='/_test/reject': rejected=True; self.respond({'ok':True}); return
        if self.path=='/_test/warn': rejected=False; warned=True; self.respond({'ok':True}); return
        if self.path=='/_test/reset': rejected=False; warned=False; self.respond({'ok':True}); return
        if self.path=='/_test/hold': hold_after=len(received)+1; release_store.clear(); self.respond({'ok':True}); return
        if self.path=='/_test/release': release_store.set(); hold_after=None; self.respond({'ok':True}); return
        return super().do_POST()
http=ThreadingHTTPServer(('127.0.0.1',0),Handler)
print(json.dumps({'port':http.server_port,'destination':destination,'source':source_port,'study':str(first.StudyInstanceUID)}),flush=True)
try: http.serve_forever()
finally: receiver.shutdown(); source.shutdown(); archive.stop(); http.server_close()
