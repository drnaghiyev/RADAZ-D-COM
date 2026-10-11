"""Thirty-day local trial; preserve the original start across upgrades."""
import base64
import ctypes
import json
import math
import os
import time
import uuid
from pathlib import Path

TRIAL_SECONDS = 30 * 86400

def protect(raw, decrypt=False):
    if os.name != 'nt':
        return raw
    from ctypes import wintypes
    class Blob(ctypes.Structure):
        _fields_ = [('size', wintypes.DWORD), ('data', ctypes.POINTER(ctypes.c_ubyte))]
    buffer = ctypes.create_string_buffer(raw)
    source = Blob(len(raw), ctypes.cast(buffer, ctypes.POINTER(ctypes.c_ubyte)))
    target = Blob()
    crypt = ctypes.WinDLL('crypt32', use_last_error=True)
    kernel = ctypes.WinDLL('kernel32', use_last_error=True)
    kernel.LocalFree.argtypes = [ctypes.c_void_p]
    kernel.LocalFree.restype = ctypes.c_void_p
    if decrypt:
        ok = crypt.CryptUnprotectData(ctypes.byref(source), None, None, None, None, 1, ctypes.byref(target))
    else:
        ok = crypt.CryptProtectData(ctypes.byref(source), None, None, None, None, 1, ctypes.byref(target))
    if not ok:
        raise ValueError('Demo məlumatının qorunması və ya oxunması alınmadı.')
    try:
        return ctypes.string_at(target.data, target.size)
    finally:
        kernel.LocalFree(target.data)

class TrialStore:
    def __init__(self, device, root=None, namespace=None):
        self.device = device
        # An explicit root isolates tests and never touches the user's registry.
        self.registry = os.name == 'nt' and root is None
        self.root = Path(root) if root else Path(os.environ.get('LOCALAPPDATA', str(Path.home()/'.local/share'))) / 'RADAZ' / 'Licensing'
        if namespace not in (None, 'anatomy_ai'): raise ValueError('Invalid trial namespace')
        if namespace: self.root = self.root / namespace
        self.path = self.root / (device + '.trial')
        self.reg_path = 'Software\\RADAZ\\Licensing\\' + device + ('\\' + namespace if namespace else '')

    def decode(self, raw):
        record = json.loads(protect(base64.b64decode(raw, validate=True), decrypt=True))
        if not isinstance(record, dict) or record.get('v') != 1 or record.get('deviceId') != self.device:
            raise ValueError('Demo qeydi bu kompüterə aid deyil.')
        if any(type(record.get(k)) is not int or record[k] < 0 for k in ('startedAt', 'lastSeen')) or record['lastSeen'] < record['startedAt']:
            raise ValueError('Demo tarixi düzgün deyil.')
        return record

    def read_registry(self):
        if not self.registry:
            return None
        import winreg
        try:
            with winreg.OpenKey(winreg.HKEY_CURRENT_USER, self.reg_path) as key:
                return winreg.QueryValueEx(key, 'Trial')[0]
        except FileNotFoundError:
            return None

    def write(self, record):
        raw = base64.b64encode(protect(json.dumps(record).encode())).decode('ascii')
        self.root.mkdir(parents=True, exist_ok=True)
        temp = self.path.with_suffix('.' + uuid.uuid4().hex + '.tmp')
        try:
            with temp.open('w', encoding='ascii') as stream:
                stream.write(raw); stream.flush(); os.fsync(stream.fileno())
            os.replace(temp, self.path)
        finally:
            temp.unlink(missing_ok=True)
        if self.registry:
            import winreg
            with winreg.CreateKey(winreg.HKEY_CURRENT_USER, self.reg_path) as key:
                winreg.SetValueEx(key, 'Trial', 0, winreg.REG_SZ, raw)

    def status(self, now=None, days=30):
        if type(days) is not int or not 0 <= days <= 365: raise ValueError('Demo müddəti düzgün deyil.')
        now = int(time.time()) if now is None else int(now)
        try:
            file_raw = self.path.read_text(encoding='ascii') if self.path.exists() else None
            registry_raw = self.read_registry()
            records = [self.decode(raw) for raw in (file_raw, registry_raw) if raw is not None]
            started = min(r['startedAt'] for r in records) if records else now
            last_seen = max(r['lastSeen'] for r in records) if records else now
            if started > now + 300 or last_seen > now + 300:
                raise ValueError('Kompüterin tarixi geriyə dəyişib. Demo üçün tarixi düzəldin.')
            record = dict(v=1, deviceId=self.device, startedAt=started, lastSeen=max(now, last_seen))
            if not file_raw or (self.registry and not registry_raw) or now-last_seen >= 60 or any(r['startedAt'] != started or r['lastSeen'] != last_seen for r in records):
                self.write(record)
            expires = started + days * 86400
            remaining = max(0, expires - now)
            return dict(valid=remaining > 0, startedAt=started, expiresAt=expires,
                        durationDays=days,
                        daysRemaining=math.ceil(remaining/86400),
                        message=f'{days} günlük pulsuz demo aktivdir.' if remaining else 'Pulsuz demo bitib. Davam etmək üçün lisenziyanı aktivləşdirin.')
        except (ValueError, OSError, TypeError, KeyError) as error:
            return dict(valid=False, daysRemaining=0, message=str(error) if isinstance(error, ValueError) else 'Demo məlumatı oxunmadı. Satıcı ilə əlaqə saxlayın.')
