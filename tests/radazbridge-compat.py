"""Optional integration with the separately maintained RADAZBRIDGE receiver.

Run with that project's Python environment. Never starts cloud synchronization.
"""
import argparse
import io
import os
import sys
import tempfile
from pathlib import Path

parser = argparse.ArgumentParser(); parser.add_argument('--bridge-root', type=Path, required=True); args = parser.parse_args()
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'bridge'))
from radaz_send import store_dataset
from bridge_send_test import image, port
sys.path.insert(0, str(args.bridge_root))
from radaz_bridge.receiver import Store, Receiver
from radaz_bridge.security import decrypt_chunks
from pydicom import dcmread

with tempfile.TemporaryDirectory(prefix='radaz-real-bridge-') as temporary:
    key = os.urandom(32); store = Store(Path(temporary) / 'spool', key); destination = port()
    receiver = Receiver({'ae_title':'RADAZBRIDGE','port':destination,'bind_ip':'127.0.0.1','source_ips':['127.0.0.1/32'],'source_ae_titles':['RADAZ']}, store)
    receiver.start()
    try:
        ds = image(); target = dict(host='127.0.0.1',port=str(destination),aeTitle='RADAZBRIDGE',callingAe='RADAZ')
        assert store_dataset(target, ds) == 0
        assert store_dataset(target, ds) == 0
        stats = store.stats(); assert stats['queued'] == 1 and stats['errors'] == 0, stats
        row = store.db.execute('SELECT * FROM objects').fetchone()
        saved = dcmread(io.BytesIO(b''.join(decrypt_chunks(row['path'], key, row['id']))))
        assert saved.SOPInstanceUID == ds.SOPInstanceUID and saved.PixelData == ds.PixelData
        print('PASS: real RADAZBRIDGE receiver, encrypted durable queue, unchanged UID/pixels, duplicate accepted without conflict; cloud sync not started.')
    finally: receiver.stop(); store.close()
