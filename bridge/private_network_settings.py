"""Password verification for this Windows user's local DICOM Network settings."""
import contextlib
import hashlib
import hmac
import os
from pathlib import Path
import secrets
import sqlite3
import threading
import time


SESSION_SECONDS = 15 * 60
ITERATIONS = 600_000


class SettingsError(ValueError):
    def __init__(self, status, code, message):
        super().__init__(message)
        self.status = status
        self.code = code


def locked():
    return SettingsError(401, 'SETTINGS_LOCKED', 'DICOM Network ayarlarını açmaq üçün şifrəni daxil edin.')


def password_bytes(value, *, creating=False):
    if not isinstance(value, str) or not value or len(value) > 1024:
        raise SettingsError(400, 'SETTINGS_PASSWORD_FORMAT', 'Şifrə düzgün deyil.')
    try:
        raw = value.encode('utf-8')
    except UnicodeEncodeError:
        raise SettingsError(400, 'SETTINGS_PASSWORD_FORMAT', 'Şifrə düzgün deyil.') from None
    if len(raw) > 1024 or (creating and (len(value) < 8 or not value.strip())):
        raise SettingsError(400, 'SETTINGS_PASSWORD_FORMAT', 'Yeni şifrə ən azı 8 simvol və ən çox 1024 bayt olmalıdır.')
    return raw


class SettingsLock:
    def __init__(self, database):
        self.database = Path(database)
        self.sessions = {}
        self.lock = threading.RLock()

    @classmethod
    def for_install(cls, install_root=None):
        if install_root is None:
            application = Path(__file__).resolve().parent.parent
            install_root = os.environ.get('RADAZ_INSTALL_ROOT')
            if not install_root:
                install_root = application.parent.parent if application.parent.name.lower() == 'versions' else application
        install_id = hashlib.sha256(os.path.normcase(str(Path(install_root).resolve())).encode('utf-8')).hexdigest()
        folder = Path(os.environ.get('LOCALAPPDATA', Path.home())) / 'RADAZ' / 'PrivateNetworkSettings' / install_id
        return cls(folder / 'password.sqlite3')

    @contextlib.contextmanager
    def connect(self):
        self.database.parent.mkdir(parents=True, exist_ok=True)
        with contextlib.closing(sqlite3.connect(self.database, timeout=8)) as db, db:
            db.row_factory = sqlite3.Row
            db.execute('''CREATE TABLE IF NOT EXISTS credential(
                id INTEGER PRIMARY KEY CHECK(id=1), salt BLOB NOT NULL, verifier BLOB NOT NULL,
                iterations INTEGER NOT NULL, generation BLOB NOT NULL, failures INTEGER NOT NULL,
                blocked_until REAL NOT NULL)''')
            yield db

    def session_left(self, token, generation):
        with self.lock:
            session = self.sessions.get(token) if isinstance(token,str) and len(token) == 43 else None
            if session:
                remaining = session[1] - time.monotonic()
                if session[0] == generation and remaining > 0:
                    return max(1, int(remaining))
                self.sessions.pop(token, None)
        return 0

    def status(self, token=''):
        generation = None
        if self.database.exists():
            with self.connect() as db:
                row = db.execute('SELECT generation FROM credential WHERE id=1').fetchone()
                if row:
                    generation = row['generation']
        left = self.session_left(token, generation)
        return {'passwordSet':generation is not None, 'unlocked':bool(left), 'expiresIn':left}

    def require(self, token):
        if not self.status(token)['unlocked']:
            raise locked()

    def issue(self, generation):
        token = secrets.token_urlsafe(32)
        with self.lock:
            now = time.monotonic()
            self.sessions = {key:value for key,value in self.sessions.items() if value[1] > now}
            if len(self.sessions) >= 64:
                del self.sessions[next(iter(self.sessions))]
            self.sessions[token] = (generation, now + SESSION_SECONDS)
        return {'passwordSet':True, 'unlocked':True, 'session':token, 'expiresIn':SESSION_SECONDS}

    def verify(self, db, row, password):
        now = time.time()
        if row['blocked_until'] > now:
            raise SettingsError(429, 'SETTINGS_RATE_LIMIT', 'Şifrə bir neçə dəfə səhv daxil edilib. Bir qədər sonra yenidən cəhd edin.')
        candidate = hashlib.pbkdf2_hmac('sha256', password, row['salt'], row['iterations'])
        if not hmac.compare_digest(candidate, row['verifier']):
            failures = min(12, row['failures'] + 1)
            delay = min(300, 5 * 2 ** (failures - 5)) if failures >= 5 else 0
            db.execute('UPDATE credential SET failures=?,blocked_until=? WHERE id=1',(failures,now+delay))
            db.commit()  # Persist throttling when returning an authentication error.
            raise SettingsError(403, 'SETTINGS_PASSWORD_INVALID', 'Şifrə düzgün deyil.')

    def action(self, action, data, token=''):
        if action == 'settings_status':
            return self.status(token)
        if action == 'settings_lock':
            with self.lock:
                self.sessions.pop(token, None)
            return self.status()
        if action not in ('settings_set','settings_unlock','settings_change'):
            raise SettingsError(404,'SETTINGS_ACTION_UNKNOWN','Şifrə əməliyyatı tapılmadı.')
        new_password = None
        if action in ('settings_set','settings_change'):
            field = 'password' if action == 'settings_set' else 'newPassword'
            new_password = password_bytes(data.get(field), creating=True)
        with self.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            row = db.execute('SELECT * FROM credential WHERE id=1').fetchone()
            if action == 'settings_set':
                if row:
                    raise SettingsError(409,'SETTINGS_PASSWORD_EXISTS','Bu quraşdırma üçün artıq şifrə təyin edilib.')
            else:
                if not row or (action == 'settings_change' and not self.session_left(token, row['generation'])):
                    raise locked()
                field = 'currentPassword' if action == 'settings_change' else 'password'
                self.verify(db, row, password_bytes(data.get(field)))
            if new_password is None:
                generation = row['generation']
                db.execute('UPDATE credential SET failures=0,blocked_until=0 WHERE id=1')
            else:
                generation = secrets.token_bytes(32)
                salt = secrets.token_bytes(32)
                verifier = hashlib.pbkdf2_hmac('sha256', new_password, salt, ITERATIONS)
                db.execute('INSERT OR REPLACE INTO credential VALUES(1,?,?,?,?,0,0)',(salt,verifier,ITERATIONS,generation))
        return self.issue(generation)
