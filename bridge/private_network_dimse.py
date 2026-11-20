"""Retrieve a complete PACS study directly into the private sender's staging area."""
import hashlib
import json
import re
import shutil
import socket
import threading
import time
from uuid import uuid4

from pydicom.dataset import Dataset

from radaz_pacs_bridge import BridgeError, RETRIEVE_LOCK, connection, get_images, move_images
from radaz_send import valid_uid

STAGE_LIFETIME = 24 * 60 * 60


def read_stage(client, stage_id, clinic, study):
    if not isinstance(stage_id, str) or not re.fullmatch('[0-9a-f]{32}', stage_id):
        raise ValueError('PACS göndəriş identifikatoru düzgün deyil.')
    folder = client.root / 'pacs-stage' / stage_id
    try:
        manifest = json.loads((folder / 'index.json').read_text(encoding='utf-8'))
    except FileNotFoundError:
        raise ValueError('PACS müayinəsini yenidən seçin.') from None
    if (manifest['clinic'] != clinic or manifest['study'] != study
            or time.time() - manifest['created'] >= STAGE_LIFETIME):
        raise ValueError('PACS göndərişi seçilmiş klinika və müayinə üçün etibarlı deyil.')
    return folder, manifest['files']


def purge_expired(client):
    base = client.root / 'pacs-stage'
    if not base.is_dir():
        return
    with client.lock:
        for folder in base.iterdir():
            if (re.fullmatch('[0-9a-f]{32}', folder.name) and folder.is_dir()
                    and time.time() - folder.stat().st_mtime >= STAGE_LIFETIME):
                shutil.rmtree(folder, ignore_errors=True)


class Collector:
    timeout = 150

    def __init__(self, folder, study, series, peers):
        self.folder = folder
        self.study = study
        self.series = series
        self.peers = peers
        self.move = False
        self.files = {}
        self.lock = threading.Lock()
        self.failure = ''

    def store(self, event):
        try:
            if self.move and str(event.assoc.requestor.address) not in self.peers:
                raise ValueError('C-MOVE göndərən ünvan seçilmiş PACS ilə uyğun gəlmir.')
            ds = event.dataset
            uid = valid_uid(ds.SOPInstanceUID)
            series = valid_uid(ds.SeriesInstanceUID)
            if (str(ds.StudyInstanceUID) != self.study or (self.series and series not in self.series)
                    or uid != str(event.request.AffectedSOPInstanceUID)
                    or valid_uid(ds.SOPClassUID) != str(event.request.AffectedSOPClassUID)):
                raise ValueError('PACS seçilmiş müayinəyə uyğun olmayan DICOM göndərdi.')
            raw = event.encoded_dataset()
            if not 0 < len(raw) <= 512 * 1024 * 1024:
                raise ValueError('DICOM faylının ölçüsü qəbul olunmur.')
            digest = hashlib.sha256(raw).hexdigest()
            item = dict(uid=uid, series=series, sha256=digest, size=len(raw))
            with self.lock:
                if uid in self.files:
                    if self.files[uid] != item:
                        raise ValueError('Eyni SOP UID ilə fərqli DICOM alındı.')
                else:
                    with (self.folder / digest).open('xb') as stream:
                        stream.write(raw)
                    self.files[uid] = item
            return 0
        except (ValueError, AttributeError) as error:
            self.failure = str(error)
            return 0xA900
        except Exception:
            self.failure = 'PACS faylını müvəqqəti saxlamaq mümkün olmadı.'
            return 0xA700


def stage(client, data):
    clinic = data.get('clinic')
    study = valid_uid(data.get('study'))
    if not isinstance(clinic, str) or not clinic:
        raise ValueError('Klinika seçilməyib.')
    state = client.rpc('state', {'clinic': clinic})
    if 'send' not in (state.get('membership') or {}).get('permissions', []):
        raise ValueError('Seçilmiş klinikadan göndərmək üçün icazə yoxdur.')
    pacs = data.get('pacs')
    if not isinstance(pacs, dict):
        raise ValueError('PACS ünvanı düzgün deyil.')
    series = {valid_uid(item['uid']): int(item.get('instanceCount') or 0)
              for item in data.get('series', [])}
    expected = int(data.get('expected') or 0)
    if expected < 0 or any(n < 0 for n in series.values()):
        raise ValueError('PACS görüntü sayı düzgün deyil.')
    if not RETRIEVE_LOCK.acquire(blocking=False):
        raise ValueError('PACS hazırda başqa müayinəni alır.')
    try:
        _, host, port, _ = connection(pacs)
        peers = {row[4][0] for row in socket.getaddrinfo(host.strip('[]'), port, type=socket.SOCK_STREAM)}
        base = client.root / 'pacs-stage'
        base.mkdir(parents=True, exist_ok=True)
        purge_expired(client)
        stage_id = uuid4().hex
        folder = base / stage_id
        folder.mkdir()
        try:
            collector = Collector(folder, study, series, peers)
            query = Dataset()
            query.QueryRetrieveLevel = 'STUDY'
            query.StudyInstanceUID = study
            if not get_images(pacs, query, collector):
                if collector.files or collector.failure:
                    raise ValueError(collector.failure or 'PACS C-GET yarımçıq qaldı.')
                collector.move = True
                move_images(pacs, query, collector)
            if collector.failure:
                raise ValueError(collector.failure)
            files = list(collector.files.values())
            counts = {}
            for item in files:
                counts[item['series']] = counts.get(item['series'], 0) + 1
            if (not files or (expected and len(files) != expected)
                    or (series and set(series) != set(counts))
                    or any(n and counts.get(uid) != n for uid, n in series.items())):
                raise ValueError('PACS müayinəsi tam alınmadı. Göndəriş yaradılmadı.')
            with (folder / 'index.json').open('x', encoding='utf-8') as index:
                json.dump(dict(study=study, clinic=clinic, created=time.time(), files=files), index)
        except Exception:
            shutil.rmtree(folder, ignore_errors=True)
            raise
        return {'stageId': stage_id, 'count': len(files)}
    except (BridgeError, OSError) as error:
        raise ValueError(str(error)) from None
    finally:
        RETRIEVE_LOCK.release()
