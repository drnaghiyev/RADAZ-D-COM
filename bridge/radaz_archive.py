"""Persistent RADAZ archive: SQLite index, immutable DICOM files, C-STORE/C-ECHO SCP.

The HTTP control API binds only to loopback; the local viewer proxies it on LAN.
Never acknowledge a C-STORE until both the file and database are durable.
"""
from __future__ import annotations

import argparse
import hashlib
import hmac
import io
import json
import os
import re
import socket
import sqlite3
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import RLock, Thread
from urllib.parse import urlsplit, parse_qs
from uuid import uuid4
from contextlib import contextmanager

import radaz_pacs_bridge  # Bootstraps the bundled, pinned DICOM wheels offline.
import pydicom
from pynetdicom import AE, AllStoragePresentationContexts, ALL_TRANSFER_SYNTAXES, evt
from pynetdicom.sop_class import Verification
from radaz_output import OutputService, print_film, test_printer, PRINT_LOCK, BURN_LOCK
from radaz_product import ProductService
from radaz_ai import AiService, AiError

MAX_FILE = 512 * 1024 * 1024
APP_VERSION = json.loads((Path(__file__).resolve().parent.parent / 'public/product.json').read_text(encoding='utf-8-sig'))['version']


def addresses():
    return sorted({entry[4][0] for entry in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET)
                   if not entry[4][0].startswith('127.')})


def uid(value):
    text = str(value or '')
    if len(text) > 64 or not re.fullmatch(r'[0-9]+(?:\.[0-9]+)*', text):
        raise ValueError('DICOM UID düzgün deyil')
    return text


def metadata(ds):
    get = lambda key: str(getattr(ds, key, '') or '').replace('^', ' ')
    return {
        'uid': uid(get('StudyInstanceUID')), 'seriesUID': uid(get('SeriesInstanceUID')),
        'sopUID': uid(get('SOPInstanceUID')), 'sopClass': uid(get('SOPClassUID')),
        'patient': get('PatientName') or 'Naməlum pasiyent', 'patientId': get('PatientID'),
        'birth': get('PatientBirthDate'), 'date': get('StudyDate'), 'time': get('StudyTime'),
        'description': get('StudyDescription'), 'accession': get('AccessionNumber'),
        'referring': get('ReferringPhysicianName'), 'modality': get('Modality'),
        'seriesDescription': get('SeriesDescription'), 'number': get('SeriesNumber'),
        'instanceNumber': int(getattr(ds, 'InstanceNumber', 0) or 0), 'protocol': get('ProtocolName'),
    }


class Archive:
    def __init__(self, root: Path, bind='0.0.0.0'):
        self.root = root.resolve()
        self.root.mkdir(parents=True, exist_ok=True)
        (self.root / 'instances').mkdir(exist_ok=True)
        self.lock = RLock()
        self.bind = bind
        self.server = None
        self.error = ''
        self.config = {'aeTitle': 'RADAZ_ARCHIVE', 'port': 11113, 'enabled': True}
        config_file = self.root / 'config.json'
        if config_file.exists():
            self.config = self.validate(json.loads(config_file.read_text(encoding='utf-8')))
        with self.connect() as db:
            db.execute('PRAGMA journal_mode=WAL')
            db.execute('''CREATE TABLE IF NOT EXISTS instances (
                sop TEXT PRIMARY KEY, study TEXT NOT NULL, series TEXT NOT NULL,
                path TEXT NOT NULL, digest TEXT NOT NULL, size INTEGER NOT NULL,
                added INTEGER NOT NULL, metadata TEXT NOT NULL)''')
            db.execute('CREATE INDEX IF NOT EXISTS study_index ON instances(study)')
            db.execute('CREATE TABLE IF NOT EXISTS opened (study TEXT PRIMARY KEY, stamp INTEGER NOT NULL)')
            db.execute('CREATE TABLE IF NOT EXISTS pending_delete (path TEXT PRIMARY KEY, size INTEGER NOT NULL)')
        self.cleanup_deleted()

    @contextmanager
    def connect(self):
        db = sqlite3.connect(self.root / 'archive.sqlite3', timeout=30)
        db.row_factory = sqlite3.Row
        db.execute('PRAGMA synchronous=FULL')
        try:
            with db:
                yield db
        finally:
            db.close()

    @staticmethod
    def validate(config):
        title = str(config.get('aeTitle', '')).strip()
        if not 1 <= len(title) <= 16 or not title.isascii() or re.search(r'[\\\x00-\x1f\x7f]', title):
            raise ValueError('AE Title 1–16 ASCII simvol olmalıdır')
        port = int(config.get('port', 0))
        if not (port == 104 or 1024 <= port <= 65535) or port in (5173, 8765, 8766):
            raise ValueError('DICOM portu 104 və ya 1024–65535 arası, HTTP portlarından fərqli olmalıdır')
        if not isinstance(config.get('enabled', True), bool):
            raise ValueError('enabled boolean olmalıdır')
        return {'aeTitle': title, 'port': port, 'enabled': config.get('enabled', True)}

    def start(self):
        if not self.config['enabled']:
            return
        ae = AE(ae_title=self.config['aeTitle'])
        ae.require_called_aet = True
        ae.maximum_associations = 8
        ae.acse_timeout = 15
        ae.dimse_timeout = 60
        ae.network_timeout = 60
        ae.add_supported_context(Verification)
        for context in AllStoragePresentationContexts:
            ae.add_supported_context(context.abstract_syntax, ALL_TRANSFER_SYNTAXES)
        self.server = ae.start_server((self.bind, self.config['port']), block=False,
                                      evt_handlers=[(evt.EVT_C_STORE, self.receive)])
        self.error = ''

    def stop(self):
        if self.server:
            self.server.shutdown()
            self.server.server_close()
            self.server = None

    def configure(self, payload):
        config = self.validate(payload)
        with self.lock:
            old = self.config.copy()
            self.stop()
            try:
                self.config = config
                self.start()
                temporary = self.root / 'config.json.tmp'
                with temporary.open('w', encoding='utf-8') as stream:
                    json.dump(config, stream); stream.flush(); os.fsync(stream.fileno())
                os.replace(temporary, self.root / 'config.json')
            except Exception:
                self.stop()
                self.config = old
                self.start()
                raise

    def store(self, data: bytes, ds):
        if len(data) > MAX_FILE:
            raise ValueError('DICOM faylı 512 MB limitini keçir')
        item = metadata(ds)
        digest = hashlib.sha256(data).hexdigest()
        with self.lock, self.connect() as db:
            old = db.execute('SELECT digest, path FROM instances WHERE sop=?', (item['sopUID'],)).fetchone()
            if old:
                if not (self.root / old['path']).is_file():
                    raise OSError('Arxiv faylı diskdə yoxdur')
                if old['digest'] != digest:
                    # A CD's raw dataset and the same C-STORE dataset have different
                    # Part 10 headers. Compare DICOM elements, not wrapper bytes.
                    previous = pydicom.dcmread(self.root / old['path'], force=True)
                    if previous != ds:
                        raise ValueError('Eyni SOP Instance UID ilə fərqli fayl artıq mövcuddur')
                return False
            relative = f'instances/{digest[:2]}/{digest}.dcm'
            destination = self.root / relative
            destination.parent.mkdir(exist_ok=True)
            temporary = destination.with_suffix(f'.{uuid4().hex}.tmp')
            try:
                with temporary.open('xb') as stream:
                    stream.write(data); stream.flush(); os.fsync(stream.fileno())
                os.replace(temporary, destination)
                db.execute('INSERT INTO instances VALUES (?,?,?,?,?,?,?,?)', (
                    item['sopUID'], item['uid'], item['seriesUID'], relative, digest,
                    len(data), int(time.time() * 1000), json.dumps(item, ensure_ascii=False)))
                db.commit()
            finally:
                temporary.unlink(missing_ok=True)
        return True

    def receive(self, event):
        try:
            ds = event.dataset
            if str(ds.SOPInstanceUID) != str(event.request.AffectedSOPInstanceUID) or str(ds.SOPClassUID) != str(event.request.AffectedSOPClassUID):
                return 0xA900
            self.store(event.encoded_dataset(), ds)
            return 0x0000
        except ValueError as error:
            self.error = str(error)
            return 0xA900
        except Exception:
            self.error = 'DICOM diskə yazılmadı; boş yeri və qovluq icazəsini yoxlayın'
            return 0xA700

    def studies(self):
        with self.connect() as db:
            rows = db.execute('SELECT study,series,size,added,metadata FROM instances ORDER BY added').fetchall()
            opened = dict(db.execute('SELECT study,stamp FROM opened').fetchall())
        studies = {}
        for row in rows:
            item = json.loads(row['metadata'])
            study = studies.setdefault(row['study'], {key: item[key] for key in (
                'uid','date','time','patient','patientId','birth','modality','description','accession','referring')})
            study.setdefault('series', {})
            study.setdefault('imageCount', 0); study.setdefault('size', 0)
            study.setdefault('addedAt', row['added']); study['openedAt'] = opened.get(row['study'])
            study['storage'] = 'disk'
            series = study['series'].setdefault(row['series'], {
                'uid': row['series'], 'number': item['number'], 'modality': item['modality'],
                'description': item['seriesDescription'] or 'Adsız seriya', 'protocol': item['protocol'],
                'imageCount': 0, 'addedAt': row['added'],
            })
            series['imageCount'] += 1; study['imageCount'] += 1; study['size'] += row['size']
        for study in studies.values():
            study['series'] = list(study['series'].values())
            study['modality'] = '/'.join(sorted({series['modality'] for series in study['series']}))
        return sorted(studies.values(), key=lambda s: (s['date'], s['addedAt']), reverse=True)

    def instances(self, study):
        with self.connect() as db:
            rows = db.execute('SELECT sop,metadata FROM instances WHERE study=?', (uid(study),)).fetchall()
        return sorted([{'uid': row['sop'], 'series': json.loads(row['metadata'])['seriesUID'],
                        'number': json.loads(row['metadata'])['instanceNumber']} for row in rows],
                      key=lambda item: (item['series'], item['number']))

    def deletion_path(self, relative):
        # Only our content-addressed instance files may be removed, even if the DB is damaged.
        if not re.fullmatch(r'instances/[0-9a-f]{2}/[0-9a-f]{64}\.dcm', relative):
            raise ValueError('Arxiv faylının yolu düzgün deyil')
        path = (self.root / relative).resolve()
        path.relative_to(self.root / 'instances')
        return path

    def cleanup_deleted(self):
        freed = 0
        with self.lock, self.connect() as db:
            for row in db.execute('SELECT path,size FROM pending_delete').fetchall():
                # A later C-STORE may have restored an identical file after a crash.
                if not db.execute('SELECT 1 FROM instances WHERE path=?', (row['path'],)).fetchone():
                    try:
                        self.deletion_path(row['path']).unlink(missing_ok=True)
                        freed += row['size']
                    except (OSError, ValueError):
                        continue
                db.execute('DELETE FROM pending_delete WHERE path=?', (row['path'],))
            pending = db.execute('SELECT COALESCE(SUM(size),0) FROM pending_delete').fetchone()[0]
        return {'freedBytes': freed, 'pendingBytes': pending}

    def delete_studies(self, studies):
        if not isinstance(studies, list) or not 1 <= len(studies) <= 500:
            raise ValueError('1–500 müayinə seçin')
        studies = list(dict.fromkeys(uid(study) for study in studies))
        placeholders = ','.join('?' for _ in studies)
        with self.lock:
            with self.connect() as db:
                rows = db.execute(f'SELECT study,path,size FROM instances WHERE study IN ({placeholders})', studies).fetchall()
                for row in rows:
                    self.deletion_path(row['path'])
                # Commit the removal intent before unlinking: interruption cannot leave
                # live DB records pointing at files we have already deleted.
                db.executemany('INSERT OR IGNORE INTO pending_delete VALUES (?,?)', [(r['path'], r['size']) for r in rows])
                db.execute(f'DELETE FROM instances WHERE study IN ({placeholders})', studies)
                db.execute(f'DELETE FROM opened WHERE study IN ({placeholders})', studies)
            return {'deleted': len({row['study'] for row in rows}), **self.cleanup_deleted()}

    def status(self):
        with self.connect() as db:
            total = db.execute('SELECT COUNT(*), COALESCE(SUM(size),0) FROM instances').fetchone()
        return {**self.config, 'running': self.server is not None, 'error': self.error,
                'addresses': addresses(), 'databasePath': str(self.root / 'archive.sqlite3'),
                'storagePath': str(self.root / 'instances'), 'instanceCount': total[0], 'size': total[1], 'version': 1,
                'capabilities': ['delete-studies'], 'appVersion': APP_VERSION,
                'desktopManaged': bool(os.environ.get('RADAZ_DESKTOP_TOKEN'))}


def handler_for(archive, removable=None):
    from radaz_removable import RemovableMedia
    removable = removable or RemovableMedia()
    def persist_media(path):
        data = path.read_bytes()
        ds = pydicom.dcmread(io.BytesIO(data), force=True)
        archive.store(data, ds)
    removable.persist = persist_media
    output = OutputService(archive.root)
    product = ProductService(archive.root)
    ai = AiService(product.root)
    lifecycle = {'posts': 0, 'stopping': False}
    lifecycle_lock = RLock()
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_):
            pass  # Do not put patient identifiers or UIDs into HTTP logs.

        def permitted(self):
            origin = self.headers.get('Origin')
            if not origin:
                return True
            parsed = urlsplit(origin)
            return parsed.scheme == 'http' and parsed.hostname in ['localhost','127.0.0.1','::1',*addresses()] and parsed.port == 5173

        def respond(self, result, status=200):
            body = json.dumps(result, ensure_ascii=False).encode('utf-8')
            self.send_response(status); self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Cache-Control', 'no-store'); self.send_header('Content-Length', str(len(body)))
            self.send_header('X-Content-Type-Options', 'nosniff'); self.end_headers(); self.wfile.write(body)

        def binary(self, body, content_type, filename):
            self.send_response(200); self.send_header('Content-Type', content_type)
            self.send_header('Content-Disposition', f'attachment; filename="{filename}"')
            self.send_header('Content-Length',str(len(body))); self.send_header('Cache-Control','no-store')
            self.send_header('X-Content-Type-Options','nosniff'); self.end_headers(); self.wfile.write(body)

        def do_GET(self):
            if not self.permitted():
                self.respond({'error': 'Origin icazəli deyil'}, 403); return
            parsed = urlsplit(self.path)
            try:
                if parsed.path == '/ai/settings':
                    self.respond(ai.status()); return
                if parsed.path == '/removable/status':
                    self.respond(removable.snapshot()); return
                if parsed.path == '/removable/entries':
                    query = parse_qs(parsed.query)
                    self.respond(removable.entries(query.get('session', [''])[0], query.get('after', ['0'])[0])); return
                if parsed.path.startswith('/removable/file/'):
                    parts = parsed.path.split('/')
                    if len(parts) != 5:
                        raise ValueError('Invalid media file')
                    stream, size = removable.open_file(parts[3], parts[4])
                    with stream:
                        self.send_response(200); self.send_header('Content-Type', 'application/dicom')
                        self.send_header('Content-Length', str(size)); self.send_header('Cache-Control', 'no-store')
                        self.send_header('X-Content-Type-Options', 'nosniff'); self.end_headers()
                        while chunk := stream.read(1024 * 1024):
                            self.wfile.write(chunk)
                    return
                if parsed.path == '/license':
                    self.respond(product.status()); return
                if parsed.path == '/billing/catalog':
                    self.respond(product.billing_catalog()); return
                if parsed.path == '/billing/order':
                    self.respond(product.order_status(parse_qs(parsed.query).get('id',[''])[0])); return
                if parsed.path == '/updates':
                    self.respond(product.updates(parse_qs(parsed.query).get('force') == ['1'])); return
                if parsed.path == '/printer-settings' and not product.allowed():
                    self.respond({'error': 'Lisenziya aktiv deyil'}, 402); return
                if parsed.path == '/status':
                    self.respond(archive.status())
                elif parsed.path == '/studies':
                    self.respond(archive.studies())
                elif parsed.path == '/output-devices':
                    self.respond(output.devices())
                elif parsed.path == '/printer-settings':
                    self.respond(output.settings())
                elif parsed.path == '/media/status':
                    self.respond(output.status(parse_qs(parsed.query).get('job',[''])[0]))
                elif parsed.path in ('/media/iso','/media/zip'):
                    job = parse_qs(parsed.query).get('job',[''])[0]
                    if parsed.path == '/media/zip':
                        self.binary(output.zip_package(job),'application/zip','RADAZ-CD.zip')
                    else:
                        file = output.job_path(job) / 'RADAZ.iso'
                        if not output.status(job).get('iso') or not file.is_file(): raise ValueError('ISO hələ hazır deyil')
                        self.binary(file.read_bytes(),'application/x-iso9660-image','RADAZ.iso')
                elif parsed.path == '/instances':
                    self.respond(archive.instances(parse_qs(parsed.query).get('study', [''])[0]))
                elif parsed.path.startswith('/file/'):
                    sop = uid(parsed.path.removeprefix('/file/'))
                    with archive.connect() as db:
                        row = db.execute('SELECT path,size FROM instances WHERE sop=?', (sop,)).fetchone()
                    if not row:
                        self.respond({'error':'Fayl tapılmadı'}, 404); return
                    with (archive.root / row['path']).open('rb') as stream:
                        self.send_response(200); self.send_header('Content-Type','application/dicom')
                        self.send_header('Content-Length', str(row['size'])); self.send_header('Cache-Control','no-store'); self.end_headers()
                        while chunk := stream.read(1024 * 1024):
                            self.wfile.write(chunk)
                else:
                    self.respond({'error':'Ünvan tapılmadı'},404)
            except FileNotFoundError:
                self.respond({'error': 'CD/DVD çıxarılıb və ya sessiya bitib'}, 410)
            except ValueError as error:
                self.respond({'error':str(error)},400)
            except (OSError, sqlite3.Error):
                self.respond({'error':'Lokal arxiv oxuna bilmədi'},500)
            except Exception as error:
                self.respond({'error':str(error)},500)

        def do_POST(self):
            if self.path == '/_desktop/stop':
                token = os.environ.get('RADAZ_DESKTOP_TOKEN', '')
                if self.headers.get('Origin') or self.client_address[0] != '127.0.0.1' or not token or not hmac.compare_digest(self.headers.get('X-RADAZ-Desktop', ''), token):
                    self.respond({'error': 'Desktop control unavailable'}, 403); return
                with lifecycle_lock:
                    if lifecycle['posts'] or PRINT_LOCK.locked() or BURN_LOCK.locked() or (archive.server and archive.server.active_associations):
                        self.respond({'error': 'Archive is busy'}, 409); return
                    lifecycle['stopping'] = True
                previous = archive.server
                archive.stop()
                # Close the listening socket, then let any association accepted during
                # the shutdown race finish. Never terminate an in-flight C-STORE.
                until = time.monotonic() + 10
                while previous and previous.active_associations and time.monotonic() < until:
                    time.sleep(.1)
                if previous and previous.active_associations:
                    archive.start()
                    with lifecycle_lock: lifecycle['stopping'] = False
                    self.respond({'error': 'Archive is busy'}, 409); return
                self.respond({'stopping': True})
                Thread(target=self.server.shutdown, daemon=True).start()
                return
            with lifecycle_lock:
                if lifecycle['stopping']:
                    self.respond({'error': 'Archive is restarting'}, 503); return
                lifecycle['posts'] += 1
            try:
                self.post_request()
            finally:
                with lifecycle_lock: lifecycle['posts'] -= 1

        def post_request(self):
            if not self.permitted():
                self.respond({'error':'Origin icazəli deyil'},403); return
            try:
                length = int(self.headers.get('Content-Length','0'))
                limit = MAX_FILE if self.path in ('/import','/media/prepare','/video') else 192 * 1024 * 1024 if self.path == '/print' else 17 * 1024 * 1024 if self.path == '/ai/report' else 65536 if self.path == '/studies/delete' else 8192
                if not 0 < length <= limit:
                    self.respond({'error':'Sorğu ölçüsü düzgün deyil'},413); return
                data = self.rfile.read(length)
                if self.path.startswith('/ai/'):
                    origin = urlsplit(self.headers.get('Origin', ''))
                    if self.client_address[0] not in ('127.0.0.1', '::1') or origin.scheme != 'http' or origin.hostname not in ('localhost', '127.0.0.1', '::1'):
                        self.respond({'error': 'AI yalnız bu kompüterdəki RADAZ-dan istifadə olunur.'}, 403); return
                    if self.headers.get_content_type() != 'application/json':
                        self.respond({'error': 'JSON tələb olunur'}, 415); return
                    payload = json.loads(data)
                    if not isinstance(payload, dict): raise AiError('Sorğu düzgün deyil.')
                    if self.path == '/ai/settings': self.respond(ai.save(payload))
                    elif not product.allowed(): self.respond({'error': 'Lisenziya aktiv deyil'}, 402)
                    elif self.path == '/ai/test': self.respond(ai.test())
                    elif self.path == '/ai/report': self.respond(ai.report(payload))
                    else: self.respond({'error': 'Ünvan tapılmadı'}, 404)
                    return
                if self.path in ('/window/minimize', '/window/maximize', '/window/register', '/window/register-records', '/window/focus-records'):
                    if self.client_address[0] not in ('127.0.0.1', '::1'):
                        self.respond({'minimized': False}); return
                    if self.headers.get_content_type() != 'application/json':
                        self.respond({'error': 'JSON tələb olunur'}, 415); return
                    from radaz_windows import minimize_records, maximize_viewer, register_viewer, register_records, focus_records
                    action = {'/window/maximize': maximize_viewer, '/window/register': register_viewer, '/window/minimize': minimize_records,
                              '/window/register-records': register_records, '/window/focus-records': focus_records}[self.path]
                    self.respond(action(json.loads(data).get('token'))); return
                if self.path in ('/removable/watch', '/removable/close'):
                    if self.headers.get_content_type() != 'application/json':
                        self.respond({'error': 'JSON tələb olunur'}, 415); return
                    client = json.loads(data).get('client')
                    if self.path == '/removable/watch':
                        self.respond(removable.watch(client))
                    else:
                        removable.unwatch(client); self.respond({'ok': True})
                    return
                if self.path == '/billing/checkout':
                    if self.headers.get_content_type() != 'application/json':
                        self.respond({'error':'JSON tələb olunur'},415); return
                    request=json.loads(data)
                    self.respond(product.checkout(request.get('months'),request.get('currency','AZN'),request.get('moduleId'))); return
                if self.path == '/license/activate':
                    if self.headers.get_content_type() != 'application/json':
                        self.respond({'error':'JSON tələb olunur'},415); return
                    self.respond(product.activate(json.loads(data).get('key'))); return
                if self.path in ('/printer-settings','/printer-test','/print','/video') and not product.allowed():
                    self.respond({'error':'Lisenziya aktiv deyil'},402); return
                if self.path == '/import':
                    if self.headers.get_content_type() != 'application/dicom':
                        self.respond({'error':'DICOM content type tələb olunur'},415); return
                    ds = pydicom.dcmread(io.BytesIO(data), force=True)
                    archive.store(data, ds)
                    self.respond({'ok':True})
                elif self.path == '/studies/delete':
                    if self.headers.get_content_type() != 'application/json':
                        self.respond({'error':'JSON tələb olunur'},415); return
                    self.respond(archive.delete_studies(json.loads(data)['studies']))
                elif self.path == '/settings':
                    if self.headers.get_content_type() != 'application/json':
                        self.respond({'error':'JSON tələb olunur'},415); return
                    archive.configure(json.loads(data)); self.respond(archive.status())
                elif self.path in ('/printer-settings','/printer-test','/print','/media/start'):
                    if self.headers.get_content_type() != 'application/json':
                        self.respond({'error':'JSON tələb olunur'},415); return
                    payload = json.loads(data)
                    if self.path == '/printer-settings': self.respond(output.save_settings(payload))
                    elif self.path == '/printer-test': self.respond(test_printer(payload))
                    elif self.path == '/print': self.respond(print_film(payload))
                    else: self.respond(output.start(payload['job'],payload['mode'],payload.get('recorder','')))
                elif self.path in ('/media/prepare','/video'):
                    if self.headers.get_content_type() != 'application/zip':
                        self.respond({'error':'ZIP tələb olunur'},415); return
                    if self.path == '/media/prepare': self.respond(output.prepare(data))
                    else:
                        video, mime = output.video(data)
                        self.binary(video,mime,'RADAZ.mp4' if mime == 'video/mp4' else 'RADAZ.wmv')
                elif self.path == '/opened':
                    if self.headers.get_content_type() != 'application/json':
                        self.respond({'error':'JSON tələb olunur'},415); return
                    with archive.connect() as db:
                        db.execute('INSERT OR REPLACE INTO opened VALUES (?,?)', (uid(json.loads(data)['study']),int(time.time()*1000)))
                    self.respond({'ok':True})
                else:
                    self.respond({'error':'Ünvan tapılmadı'},404)
            except AiError as error:
                self.respond({'error': str(error), 'requestId': error.request_id}, error.status)
            except (ValueError, KeyError, AttributeError) as error:
                self.respond({'error':str(error)},400)
            except Exception:
                self.respond({'error':'Əməliyyat alınmadı. Portu, diski və qovluq icazəsini yoxlayın.'},500)

    return Handler


def main():
    parser = argparse.ArgumentParser()
    # Documents is stable across packaged-app and ordinary desktop launchers.
    # AppData can be silently redirected into the launcher's package cache.
    parser.add_argument('--data-dir', type=Path, default=Path.home() / 'Documents' / 'RADAZ-Archive')
    parser.add_argument('--http-port', type=int, default=8766)
    args = parser.parse_args()
    archive = Archive(args.data_dir)
    from radaz_removable import RemovableMedia
    removable = RemovableMedia()
    http = ThreadingHTTPServer(('127.0.0.1',args.http_port),handler_for(archive, removable))
    try:
        try:
            archive.start()
        except OSError:
            archive.error = 'DICOM portu məşğuldur; arxiv ayarlarında başqa port seçin'
        http.serve_forever()
    finally:
        removable.close(); archive.stop(); http.server_close()


if __name__ == '__main__':
    main()
