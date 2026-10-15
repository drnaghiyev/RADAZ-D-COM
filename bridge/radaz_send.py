"""Study delivery to RADAZBRIDGE. Only C-STORE acknowledgements count as delivered.

Disk studies and DIMSE retrieves are streamed one instance at a time. Originals
are never changed. A cancelled/failed transfer may already have delivered files.
"""
from __future__ import annotations

import io
import json
import re
import time
from pathlib import Path
from threading import RLock, Thread
from uuid import uuid4

from radaz_pacs_bridge import BridgeError, connection, echo, get_images, move_images, RETRIEVE_LOCK
from pydicom import dcmread
from pydicom.dataset import Dataset, FileMetaDataset
from pydicom.uid import ExplicitVRLittleEndian, ImplicitVRLittleEndian, ExplicitVRBigEndian


def valid_uid(value):
    value = str(value or '')
    if len(value) > 64 or not re.fullmatch(r'[0-9]+(?:\.[0-9]+)+', value):
        raise ValueError('DICOM UID düzgün deyil')
    return value


def target_settings(payload):
    if not isinstance(payload, dict):
        raise ValueError('RADAZBRIDGE ünvanı düzgün deyil')
    target = {key: str(payload.get(key, '')).strip() for key in ('host', 'port', 'aeTitle', 'callingAe')}
    try:
        connection(target)
    except BridgeError as exc:
        raise ValueError(str(exc)) from None
    return target


def read_dataset(data):
    ds = dcmread(io.BytesIO(data), force=True)
    for name in ('StudyInstanceUID', 'SeriesInstanceUID', 'SOPClassUID', 'SOPInstanceUID'):
        valid_uid(getattr(ds, name, ''))
    # Older CR exports can be bare datasets. Preserve their detected encoding.
    if not getattr(ds.file_meta, 'TransferSyntaxUID', None):
        implicit, little = ds.original_encoding
        if implicit is None or little is None:
            raise ValueError('DICOM transfer syntax müəyyən edilmədi')
        ds.file_meta = FileMetaDataset()
        ds.file_meta.TransferSyntaxUID = ImplicitVRLittleEndian if implicit else ExplicitVRLittleEndian if little else ExplicitVRBigEndian
    return ds


def store_dataset(target, ds):
    ae, host, port, called = connection(target)
    # Propose the original syntax explicitly, including compressed pixel data.
    ae.add_requested_context(ds.SOPClassUID, ds.file_meta.TransferSyntaxUID)
    ae.dimse_timeout = 120
    ae.network_timeout = 120
    association = ae.associate(host, port, ae_title=called)
    if not association.is_established:
        raise ValueError('RADAZBRIDGE bağlantısı alınmadı. IP, port, AE Title və Bridge-də bu kompüterin IP / Calling AE icazəsini yoxlayın.')
    try:
        status = association.send_c_store(ds)
        if not status or not hasattr(status, 'Status'):
            raise ValueError('RADAZBRIDGE qəbul təsdiqi vermədi. Son faylın qəbul vəziyyəti qeyri-müəyyəndir.')
        code = int(status.Status)
        if code not in (0, 0xB000, 0xB006, 0xB007):
            raise ValueError(f'RADAZBRIDGE faylı qəbul etmədi: C-STORE 0x{code:04X}')
        return code
    except (AttributeError, RuntimeError) as exc:
        raise ValueError('RADAZBRIDGE bu DICOM növünü / transfer syntax-ı qəbul etmədi') from exc
    finally:
        if association.is_established:
            association.release()


class Sender:
    def __init__(self, archive):
        self.archive = archive
        self.jobs = {}
        self.lock = RLock()
        self.settings_path = archive.root / 'radazbridge-settings.json'

    def settings(self):
        try:
            return target_settings(json.loads(self.settings_path.read_text('utf-8')))
        except (OSError, ValueError):
            return {'host': '127.0.0.1', 'port': '11112', 'aeTitle': 'RADAZBRIDGE', 'callingAe': 'RADAZ'}

    def save_settings(self, payload):
        target = target_settings(payload)
        with self.lock:
            temporary = self.settings_path.with_suffix('.tmp')
            temporary.write_text(json.dumps(target), encoding='utf-8')
            temporary.replace(self.settings_path)
        return target

    def busy(self):
        with self.lock:
            for job in self.jobs.values():
                if job['state'] == 'receiving' and time.monotonic() - job['seen'] > 600 and not job['writing']:
                    job.update(state='failed', error='Göndəriş pəncərəsi ilə əlaqə kəsildi.')
            return any(job['state'] in ('running', 'receiving') for job in self.jobs.values())

    def status(self, job_id):
        with self.lock:
            job = self.jobs.get(job_id)
            if not job:
                raise ValueError('Göndəriş tapılmadı; xidmət yenidən başlamış ola bilər. Avtomatik təkrar göndəriş edilmədi.')
            job['seen'] = time.monotonic()
            return {key: job[key] for key in ('id', 'state', 'sent', 'warnings', 'total', 'error', 'cancelled')}

    def start(self, payload):
        target = self.save_settings(payload.get('target'))
        study = valid_uid(payload.get('studyUID'))
        source = payload.get('source')
        if source not in ('disk', 'dimse', 'upload'):
            raise ValueError('Göndəriş mənbəyi düzgün deyil')
        total = int(payload.get('expected') or 0)
        if not 0 <= total <= 1000000:
            raise ValueError('Görüntü sayı düzgün deyil')
        source_config = payload.get('pacs') or {}
        if source == 'dimse':
            try:
                connection(source_config)
            except BridgeError as exc:
                raise ValueError(str(exc)) from None
            if (str(source_config.get('host')), str(source_config.get('port')), str(source_config.get('aeTitle'))) == (target['host'], target['port'], target['aeTitle']):
                raise ValueError('PACS mənbəyi və RADAZBRIDGE ünvanı eyni ola bilməz')
        entries = self.archive.instances(study) if source == 'disk' else []
        if source == 'disk':
            if not entries or len(entries) < total:
                raise ValueError('Disk arxivində müayinə tam deyil və ya fayllar tapılmadı')
            total = len(entries)
        with self.lock:
            now = time.monotonic()
            # An abandoned browser upload must not hold the desktop updater forever.
            for job in self.jobs.values():
                if job['state'] == 'receiving' and now - job['seen'] > 600 and not job['writing']:
                    job.update(state='failed', error='Göndəriş pəncərəsi ilə əlaqə kəsildi; əvvəl qəbul edilmiş fayllar saxlanılır.')
            self.jobs = {key: job for key, job in self.jobs.items() if job['state'] in ('running', 'receiving') or now - job['seen'] < 1800}
            if self.busy():
                raise ValueError('Başqa RADAZBRIDGE göndərişi davam edir; həmin pəncərədə tamamlayın və ya dayandırın')
            job_id = uuid4().hex
            job = dict(id=job_id, source=source, state='receiving' if source == 'upload' else 'running', sent=0,
                       warnings=0, total=total, error='', cancelled=False, study=study, target=target,
                       uids=set(), seen=now, writing=False)
            self.jobs[job_id] = job
            if source != 'upload':
                Thread(target=self.run, args=(job, source, source_config, entries), daemon=True).start()
        return self.status(job_id)

    def deliver(self, job, ds):
        with self.lock:
            if job['cancelled']:
                raise ValueError('Göndəriş dayandırıldı')
            if str(ds.StudyInstanceUID) != job['study']:
                raise ValueError('DICOM faylı seçilmiş müayinəyə aid deyil')
            sop = valid_uid(ds.SOPInstanceUID)
            if sop in job['uids']:
                return
            if job['writing']:
                raise ValueError('Fayl göndərişi artıq davam edir')
            job['writing'] = True
        try:
            code = store_dataset(job['target'], ds)
            with self.lock:
                job['uids'].add(sop)
                job['sent'] += 1
                job['warnings'] += int(code != 0)
        finally:
            with self.lock:
                job['writing'] = False
                job['seen'] = time.monotonic()
                if job['cancelled'] and job['state'] == 'receiving':
                    job['state'] = 'cancelled'

    def finish(self, job_id, from_worker=False):
        with self.lock:
            job = self.jobs[job_id]
            if job['source'] != 'upload' and not from_worker:
                raise ValueError('Göndəriş mənbəyi hələ tamamlanmayıb')
            if job['writing']:
                raise ValueError('Faylın qəbul təsdiqi hələ gözlənilir')
            if job['state'] not in ('receiving', 'running'):
                return self.status(job_id)
            if job['cancelled']:
                job['state'] = 'cancelled'
            elif not job['sent'] or job['sent'] < job['total']:
                job.update(state='failed', error='Müayinə tam göndərilmədi; qəbul edilən faylların sayı gözləniləndən azdır.')
            else:
                job['state'] = 'warning' if job['warnings'] else 'completed'
            return self.status(job_id)

    def upload(self, job_id, data):
        with self.lock:
            job = self.jobs[job_id]
            if job['state'] != 'receiving':
                raise ValueError('Göndəriş artıq aktiv deyil')
        try:
            self.deliver(job, read_dataset(data))
        except Exception:
            with self.lock:
                job.update(state='failed', error='Fayl göndərişi alınmadı; əvvəl qəbul edilmiş fayllar RADAZBRIDGE-də saxlanılır.')
            raise
        return self.status(job_id)

    def cancel(self, job_id):
        with self.lock:
            job = self.jobs[job_id]
            if job['state'] in ('running', 'receiving'):
                job['cancelled'] = True
                if job['state'] == 'receiving' and not job['writing']:
                    job['state'] = 'cancelled'
        return self.status(job_id)

    def run(self, job, source, config, entries):
        try:
            if source == 'disk':
                for entry in entries:
                    with self.archive.connect() as db:
                        row = db.execute('SELECT path FROM instances WHERE sop=? AND study=?', (entry['uid'], job['study'])).fetchone()
                    if not row:
                        raise ValueError('Müayinənin faylı arxivdə tapılmadı')
                    self.deliver(job, read_dataset((self.archive.root / row['path']).read_bytes()))
            else:
                if not RETRIEVE_LOCK.acquire(blocking=False):
                    raise ValueError('Başqa PACS köçürməsi davam edir')
                try:
                    collector = ForwardCollector(self, job)
                    identifier = Dataset()
                    identifier.QueryRetrieveLevel = 'STUDY'
                    identifier.StudyInstanceUID = job['study']
                    if not get_images(config, identifier, collector):
                        if collector.failure:
                            raise ValueError(collector.failure)
                        move_images(config, identifier, collector)
                    if collector.failure:
                        raise ValueError(collector.failure)
                finally:
                    RETRIEVE_LOCK.release()
            self.finish(job['id'], from_worker=True)
        except Exception as exc:
            with self.lock:
                job.update(state='cancelled' if job['cancelled'] else 'failed',
                           error=str(exc) if isinstance(exc, (ValueError, BridgeError)) else 'Göndəriş alınmadı. Şəbəkəni və mənbə fayllarını yoxlayın.')


class ForwardCollector:
    timeout = 150  # Allow the destination to acknowledge its durable C-STORE.

    def __init__(self, sender, job):
        self.sender, self.job = sender, job
        self.files = {}
        self.failure = ''

    def store(self, event):
        try:
            if self.job['cancelled']:
                event.assoc.abort()
                raise ValueError('Göndəriş dayandırıldı')
            ds = event.dataset
            ds.file_meta = event.file_meta
            self.sender.deliver(self.job, ds)
            self.files[str(ds.SOPInstanceUID)] = True
            return 0
        except Exception as exc:
            self.failure = str(exc) if isinstance(exc, ValueError) else 'PACS faylı RADAZBRIDGE-ə ötürülmədi'
            return 0xA700
