"""Optical media sessions with disposable staging and optional durable archive import.

Only the Windows drive enumerator can introduce roots. HTTP callers receive opaque
session/file IDs, never a filesystem path. Eject cancels copying and removes the cache.
"""
import ctypes
import os
import re
import shutil
import tempfile
import time
import uuid
import warnings
from pathlib import Path
from threading import Event, RLock, Thread

import pydicom

UID = re.compile(r'\d+(?:\.\d+)+\Z')
MAX_FILE = 256 * 1024 * 1024
CACHE_MARKER = b'RADAZ disposable CD cache v1\n'


def cache_lock(stream):
    stream.seek(0)
    if os.name == 'nt':
        import msvcrt
        msvcrt.locking(stream.fileno(), msvcrt.LK_NBLCK, 1)
    else:
        import fcntl
        fcntl.flock(stream, fcntl.LOCK_EX | fcntl.LOCK_NB)


def remove_abandoned_caches(parent, current):
    # A process lock protects caches owned by another running RADAZ service.
    # On crash/update Windows releases it; the next service removes old copies.
    for folder in parent.glob('radaz-cd-cache-*'):
        if folder == current or folder.is_symlink() or folder.resolve().parent != parent:
            continue
        marker = folder / '.owner'
        if marker.is_symlink(): continue
        try:
            with marker.open('r+b') as lease:
                if lease.read() != CACHE_MARKER: continue
                cache_lock(lease)
            shutil.rmtree(folder)
        except OSError:
            pass


def optical_drives():
    if os.name != 'nt':
        return {}
    kernel = ctypes.windll.kernel32
    # Empty drives must never open Windows' "insert a disc" dialog.
    previous = ctypes.c_ulong()
    kernel.SetThreadErrorMode(0x0001 | 0x8000, ctypes.byref(previous))
    try:
        mask = kernel.GetLogicalDrives()
        found = {}
        for index in range(26):
            if not mask & (1 << index):
                continue
            root = f'{chr(65 + index)}:\\'
            if kernel.GetDriveTypeW(ctypes.c_wchar_p(root)) != 5:
                continue
            label = ctypes.create_unicode_buffer(261)
            serial = ctypes.c_ulong()
            if kernel.GetVolumeInformationW(ctypes.c_wchar_p(root), label, 261,
                    ctypes.byref(serial), None, None, None, 0):
                found[root] = (str(serial.value), label.value or 'CD/DVD')
        return found
    finally:
        kernel.SetThreadErrorMode(previous.value, None)


def inside(root, path):
    resolved = path.resolve()
    if not resolved.is_relative_to(root.resolve()) or path.is_symlink():
        raise ValueError('Media path escapes disc')
    return resolved


def walk_files(root):
    for folder, dirs, files in os.walk(root, followlinks=False):
        dirs[:] = sorted(d for d in dirs if not (Path(folder) / d).is_symlink())
        for name in sorted(files):
            path = Path(folder) / name
            try:
                yield inside(root, path)
            except (ValueError, OSError):
                continue


def dicomdir_files(root, directory):
    with warnings.catch_warnings():
        warnings.simplefilter('ignore')
        ds = pydicom.dcmread(directory)
    seen = set()
    for record in getattr(ds, 'DirectoryRecordSequence', []):
        reference = getattr(record, 'ReferencedFileID', None)
        if not reference:
            continue
        parts = str(reference).replace('/', '\\').split('\\') if isinstance(reference, str) else list(reference)
        if any(not p or p in ('.', '..') or ':' in p or '/' in p or '\\' in p for p in parts):
            continue
        path = directory.parent
        try:
            for part in parts:
                path = next((p for p in path.iterdir() if p.name.casefold() == str(part).casefold()), path / str(part))
            path = inside(root, path)
            if path.is_file() and path not in seen:
                seen.add(path)
                yield path
        except (OSError, ValueError):
            continue


def image_metadata(path):
    size = path.stat().st_size
    if not 128 <= size <= MAX_FILE:
        return None
    with warnings.catch_warnings():
        warnings.simplefilter('ignore')
        # Inspect without decoding pixels. Raw/no-preamble DICOM is supported.
        ds = pydicom.dcmread(path, force=True, defer_size=1024)
    def text(key):
        return str(getattr(ds, key, '')).strip()
    if any(not UID.fullmatch(text(key)) or len(text(key)) > 64 for key in
           ('SOPClassUID', 'SOPInstanceUID', 'StudyInstanceUID', 'SeriesInstanceUID')):
        return None
    rows, columns = int(getattr(ds, 'Rows', 0)), int(getattr(ds, 'Columns', 0))
    bits, samples = int(getattr(ds, 'BitsAllocated', 0)), int(getattr(ds, 'SamplesPerPixel', 0))
    if not rows or not columns or not samples or bits not in (1, 8, 16, 32, 64) or 'PixelData' not in ds:
        return None
    # Only small metadata travels during discovery; pixels are served from local copies.
    tags = {}
    for tag in (0x00080016, 0x00080018, 0x00080020, 0x00080060, 0x00080080, 0x00081030, 0x0008103e, 0x00181030, 0x00180024, 0x00185101,
                0x00100010, 0x00100020, 0x00100030, 0x00180015, 0x00180050, 0x00180088,
                0x0020000d, 0x0020000e, 0x00200011, 0x00200013, 0x00200032, 0x00200037, 0x00200052,
                0x00280002, 0x00280004, 0x00280010, 0x00280011, 0x00280030, 0x00280100, 0x00280101,
                0x00280102, 0x00280103, 0x00281050, 0x00281051, 0x00281052, 0x00281053, 0x00281055):
        element = ds.get(tag)
        if element is not None:
            value = element.value
            tags[f'x{tag:08x}'] = '\\'.join(str(v) for v in value) if element.VM > 1 else str(value)
    tags['x00020010'] = str(getattr(ds.file_meta, 'TransferSyntaxUID', '1.2.840.10008.1.2'))
    return {'tags': tags, 'studyId': text('StudyInstanceUID'), 'seriesUID': text('SeriesInstanceUID'),
            'sopUID': text('SOPInstanceUID'), 'name': text('SeriesDescription') or 'Adsız seriya',
            'modality': text('Modality') or 'DICOM', 'patient': text('PatientName').replace('^', ' ') or 'Naməlum pasiyent',
            'patientId': text('PatientID') or '—', 'birth': text('PatientBirthDate'),
            'date': text('StudyDate'), 'number': text('SeriesNumber') or '—',
            'instance': int(getattr(ds, 'InstanceNumber', 0) or 0), 'size': size,
            'decodedBytes': rows * columns * 4}


class RemovableMedia:
    def __init__(self, drives=optical_drives, interval=1, lease_seconds=120, cache_parent=None, persist=None):
        self.drives, self.interval, self.lease_seconds = drives, interval, lease_seconds
        self.persist = persist
        self.lock, self.stop = RLock(), Event()
        self.clients, self.sessions = {}, {}
        self.thread = None
        parent = Path(cache_parent or Path(tempfile.gettempdir()) / 'RADAZ-MediaCache').resolve()
        parent.mkdir(parents=True, exist_ok=True)
        self.cache_root = Path(tempfile.mkdtemp(prefix='radaz-cd-cache-', dir=parent)).resolve()
        self.cache_lease = (self.cache_root / '.owner').open('w+b')
        self.cache_lease.write(CACHE_MARKER); self.cache_lease.flush()
        cache_lock(self.cache_lease)
        remove_abandoned_caches(parent, self.cache_root)
        self.retired = set()
        self.workers = []

    def _cleanup(self):
        # Windows may hold a cached file until an in-flight HTTP response finishes.
        # Retry on every poll, including after the final viewer lease has closed.
        for folder in list(self.retired):
            if folder.parent != self.cache_root or not re.fullmatch(r'[a-f0-9]{32}', folder.name):
                raise ValueError('Invalid media cache directory')
            if folder.is_symlink() or folder.resolve() != folder:
                raise ValueError('Media cache path escapes temporary directory')
            try:
                shutil.rmtree(folder)
            except FileNotFoundError:
                pass
            except OSError:
                continue
            self.retired.discard(folder)

    def _retire(self, session):
        session['cancel'].set()
        session['files'].clear()
        session['paths'].clear()
        self.retired.add(session['cache'])

    def watch(self, client):
        if not isinstance(client, str) or not re.fullmatch(r'[a-zA-Z0-9-]{16,80}', client):
            raise ValueError('Invalid media client')
        with self.lock:
            self.clients[client] = time.monotonic()
            if self.thread is None:
                self.thread = Thread(target=self._watch, daemon=True)
                self.thread.start()
        return self.snapshot()

    def unwatch(self, client):
        with self.lock:
            self.clients.pop(client, None)
            if not self.clients:
                self._clear()

    def _clear(self):
        for session in self.sessions.values():
            self._retire(session)
        self.sessions.clear()
        self._cleanup()

    def close(self):
        self.stop.set()
        with self.lock:
            self._clear()
            self.clients.clear()
        if self.thread:
            self.thread.join(timeout=3)
        for worker in self.workers:
            worker.join(timeout=3)
        with self.lock:
            self._cleanup()
            self.cache_lease.close()
            try:
                if not self.retired and not any(worker.is_alive() for worker in self.workers):
                    (self.cache_root / '.owner').unlink(missing_ok=True)
                    self.cache_root.rmdir()
            except OSError: pass

    def _watch(self):
        while not self.stop.is_set():
            try:
                self.poll()
            except OSError:
                pass
            self.stop.wait(self.interval)

    def poll(self):
        with self.lock:
            self._cleanup()
            self.workers = [worker for worker in self.workers if worker.is_alive()]
            now = time.monotonic()
            self.clients = {key: seen for key, seen in self.clients.items() if now - seen < self.lease_seconds}
            if not self.clients:
                self._clear()
                return
        drives = self.drives()
        with self.lock:
            if not self.clients or self.stop.is_set():
                return
            for sid, session in list(self.sessions.items()):
                if drives.get(str(session['root'])) != session['identity']:
                    self._retire(session)
                    del self.sessions[sid]
            self._cleanup()
            existing = {str(s['root']) for s in self.sessions.values()}
            for root, identity in drives.items():
                if root in existing:
                    continue
                sid = uuid.uuid4().hex
                cache = self.cache_root / sid
                cache.mkdir()
                session = {'id': sid, 'root': root, 'identity': identity, 'label': identity[1],
                           'stage': 'scanning', 'scanned': 0, 'files': [], 'paths': {},
                           'cancel': Event(), 'error': '', 'dicomdir': False, 'cache': cache}
                self.sessions[sid] = session
                worker = Thread(target=self._scan, args=(session,), daemon=True)
                self.workers.append(worker)
                worker.start()

    def _copy(self, session, source, fid, expected_size):
        destination = session['cache'] / (fid + '.dcm')
        partial = destination.with_suffix('.part')
        try:
            with source.open('rb') as src, partial.open('xb') as dst:
                copied = 0
                while not session['cancel'].is_set():
                    block = src.read(1024 * 1024)
                    if not block: break
                    copied += len(block)
                    if copied > expected_size: raise ValueError('CD/DVD faylının ölçüsü dəyişdi')
                    dst.write(block)
            if session['cancel'].is_set(): return None
            if copied != expected_size: raise OSError('CD/DVD faylı tam köçürülmədi')
            os.replace(partial, destination)
            return destination
        finally:
            partial.unlink(missing_ok=True)

    def _scan(self, session):
        root = Path(session['root'])
        seen_paths, seen_sops = set(), set()
        def add(path):
            if session['cancel'].is_set():
                return
            if path in seen_paths:
                return
            seen_paths.add(path)
            item = None
            try:
                item = image_metadata(path)
            except Exception:
                pass  # Non-DICOM/corrupt files must not stop the disc scan.
            with self.lock:
                if session['cancel'].is_set():
                    return
                session['scanned'] += 1
                if not item or item['sopUID'] in seen_sops:
                    return
            fid = uuid.uuid4().hex
            # A single sequential copy avoids random optical seeks while scrolling.
            # Publish only complete local files; never fall back to slow disc reads.
            cached = self._copy(session, path, fid, item['size'])
            if cached is None or session['cancel'].is_set(): return
            # Commit each complete image before announcing it. The Viewer can read
            # this durable copy immediately while the next image is still copying.
            if self.persist:
                self.persist(cached)
                item['archived'] = True
            with self.lock:
                if cached is None or session['cancel'].is_set(): return
                seen_sops.add(item['sopUID'])
                session['paths'][fid] = cached
                session['files'].append({'id': fid, **item})
        try:
            # Standard discs place DICOMDIR at their root. Also support nested media sets.
            directories = [p for p in root.iterdir() if p.name.upper() == 'DICOMDIR' and p.is_file()]
            if not directories:
                for path in walk_files(root):
                    if session['cancel'].is_set():
                        return
                    if path.name.upper() == 'DICOMDIR':
                        directories.append(path)
                        break
                    add(path)  # First images are published even during fallback discovery.
            for directory in directories:
                try:
                    references = list(dicomdir_files(root, directory))
                except (OSError, ValueError, AttributeError):
                    continue
                for path in references:
                    if session['cancel'].is_set(): return
                    session['dicomdir'] = True
                    add(path)
            # Also recover unindexed files or broken references; never rely on suffixes.
            for path in walk_files(root):
                if session['cancel'].is_set():
                    return
                if path.name.upper() != 'DICOMDIR':
                    add(path)
            with self.lock:
                if not session['cancel'].is_set():
                    session['stage'] = 'ready'
        except Exception as error:
            with self.lock:
                if not session['cancel'].is_set():
                    session['stage'] = 'error'
                    session['error'] = str(error)
        finally:
            seen_paths.clear()
            seen_sops.clear()
            with self.lock:
                if session['cancel'].is_set(): self._cleanup()

    def snapshot(self):
        with self.lock:
            return {'sessions': [{key: s[key] for key in ('id', 'label', 'stage', 'scanned', 'error', 'dicomdir')} |
                                 {'total': len(s['files'])} for s in self.sessions.values()]}

    def entries(self, sid, after=0):
        with self.lock:
            s = self.sessions.get(sid)
            if not s:
                raise FileNotFoundError('CD/DVD çıxarılıb')
            after = max(0, int(after))
            items = s['files'][after:after + 64]
            return {'items': items, 'next': after + len(items)}

    def open_file(self, sid, fid):
        with self.lock:
            s = self.sessions.get(sid)
            if not s or fid not in s['paths'] or s['cancel'].is_set():
                raise FileNotFoundError('CD/DVD çıxarılıb')
            root, path, identity, cache = s['root'], s['paths'][fid], s['identity'], s['cache']
        if self.drives().get(root) != identity:
            self.poll()
            raise FileNotFoundError('CD/DVD çıxarılıb')
        path = inside(cache, path)
        stream = path.open('rb')
        size = os.fstat(stream.fileno()).st_size
        if size > MAX_FILE:
            stream.close()
            raise ValueError('DICOM faylı çox böyükdür')
        return stream, size
