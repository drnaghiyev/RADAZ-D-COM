"""Hostinger license client. Only a pinned public key is shipped to the client."""
import base64
import hashlib
import json
import os
import re
import shutil
import socket
import subprocess
import time
import uuid
from datetime import datetime
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import HTTPRedirectHandler, Request, build_opener
from radaz_trial import protect

ROOT = Path(__file__).resolve().parents[1]
ORIGIN = 'https://license.radaz.space'
VERIFY_SCRIPT = """const {createPublicKey,verify}=require('node:crypto');
let raw='';process.stdin.setEncoding('utf8');process.stdin.on('data',c=>raw+=c);
process.stdin.on('end',()=>{try{
 const {token,key}=JSON.parse(raw),parts=token.split('.');
 if(parts.length!==2||!parts.every(p=>/^[A-Za-z0-9_-]+$/.test(p)))throw Error();
 const signature=Buffer.from(parts[1],'base64url');
 if(key.kty!=='OKP'||key.crv!=='Ed25519'||signature.length!==64||
 !verify(null,Buffer.from(parts[0]),createPublicKey({key,format:'jwk'}),signature))throw Error();
 process.stdout.write(Buffer.from(parts[0],'base64url'));
}catch{process.exitCode=1;}});
"""


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        # Never forward the activation secret to another URL.
        raise ValueError('Lisenziya serveri gözlənilməz yönləndirmə qaytardı.')


class LicenseRejected(ValueError):
    pass


def digest(value):
    return hashlib.sha256(value.encode('utf-8')).hexdigest()


def timestamp(value):
    if not isinstance(value, str):
        raise ValueError('Lisenziya tarixi düzgün deyil.')
    parsed = datetime.fromisoformat(value.replace('Z', '+00:00'))
    if parsed.tzinfo is None:
        raise ValueError('Lisenziya saat qurşağı yoxdur.')
    return parsed.timestamp()


def verify_receipt(token, public, device, install, key, now=None):
    if not isinstance(token, str) or len(token) > 12000:
        raise ValueError('Lisenziya cavabı düzgün deyil.')
    bundled = ROOT / 'runtime/node/node.exe'
    node = str(bundled) if bundled.is_file() else shutil.which('node')
    if not node:
        raise ValueError('RADAZ yoxlama modulu tapılmadı. Proqramı yeniləyin.')
    checked = subprocess.run([node, '-e', VERIFY_SCRIPT],
                             input=json.dumps({'token': token, 'key': public}).encode(),
                             stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=10,
                             creationflags=0x08000000 if os.name == 'nt' else 0)
    if checked.returncode:
        raise ValueError('Lisenziya serverinin rəqəmsal imzası təsdiqlənmədi.')
    claims = json.loads(checked.stdout)
    if (not isinstance(claims, dict) or claims.get('v') != 1 or claims.get('product') != 'RADAZ'
            or claims.get('device_hash') != digest(device)
            or claims.get('install_hash') != digest(install)
            or claims.get('key_hash') != digest(key)):
        raise ValueError('Lisenziya bu kompüterə və quraşdırmaya aid deyil.')
    issued, until, expiry = (timestamp(claims.get(k)) for k in ('issued_at', 'valid_until', 'expires_at'))
    if not issued < until <= expiry or until - issued > 901:
        raise ValueError('Lisenziya yoxlama müddəti düzgün deyil.')
    for name in ('license_id', 'device_id'):
        if not isinstance(claims.get(name), str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,200}', claims[name]):
            raise ValueError('Lisenziya məlumatı natamamdır.')
    if now is not None and (issued > now + 300 or until <= now):
        raise ValueError('Lisenziya cavabının müddəti bitib və ya kompüterin tarixi yanlışdır.')
    return claims


class OnlineLicense:
    def __init__(self, root, device, public_path=None):
        self.root = Path(root)
        self.device = device
        self.path = self.root / 'online-license.json'
        self.identity_path = self.root / 'online-installation.json'
        self.public_path = Path(public_path or ROOT / 'public/online-license-public.json')
        self.last_attempt = 0
        self.state = None
        self.stamp = None
        self.message = ''

    @property
    def exists(self):
        return self.path.exists()

    def read_private(self, path):
        envelope = json.loads(path.read_text(encoding='utf-8'))
        raw = protect(base64.b64decode(envelope['protected'], validate=True), decrypt=True)
        return json.loads(raw)

    def write_private(self, path, value):
        envelope = {'schema': 1, 'protected': base64.b64encode(protect(json.dumps(value).encode())).decode('ascii')}
        temp = path.with_suffix('.tmp')
        with temp.open('w', encoding='utf-8') as stream:
            if os.name != 'nt':
                os.chmod(temp, 0o600)
            json.dump(envelope, stream)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temp, path)

    def installation(self):
        if not self.identity_path.exists():
            self.write_private(self.identity_path, {'id': uuid.uuid4().hex})
        value = self.read_private(self.identity_path)['id']
        if not isinstance(value, str) or not re.fullmatch(r'[a-f0-9]{32}', value):
            raise ValueError('Quraşdırma identifikatoru düzgün deyil.')
        return value

    def public(self):
        return json.loads(self.public_path.read_text(encoding='utf-8'))

    def request(self, action, key, install):
        body = {'key': key, 'device_id': self.device, 'install_id': install,
                'device_name': socket.gethostname()[:120]}
        req = Request(ORIGIN + '/v1/' + action, data=json.dumps(body).encode(),
                      headers={'Content-Type': 'application/json', 'Accept': 'application/json',
                               'User-Agent': 'RADAZ-online-license'})
        try:
            with build_opener(NoRedirect()).open(req, timeout=8) as response:
                raw = response.read(16385)
            if len(raw) > 16384:
                raise ValueError('Lisenziya cavabı çox böyükdür.')
            data = json.loads(raw)
            if not isinstance(data, dict) or data.get('algorithm') != 'Ed25519':
                raise ValueError('Lisenziya cavabı düzgün deyil.')
            return data['token']
        except HTTPError as error:
            try:
                detail = json.loads(error.read(16384)).get('detail')
            except (ValueError, OSError):
                detail = None
            message = detail if isinstance(detail, str) else 'Lisenziya serveri sorğunu qəbul etmədi.'
            if error.code in (400, 403, 409):
                raise LicenseRejected(message) from None
            raise ValueError(message) from None
        except (URLError, OSError):
            raise ValueError('Lisenziya serverinə qoşulmaq mümkün olmadı. İnterneti yoxlayın.') from None

    def load(self):
        info = self.path.stat()
        stamp = (info.st_mtime_ns, info.st_size)
        if self.state is not None and self.stamp == stamp:
            return self.state
        state = self.read_private(self.path)
        if not re.fullmatch(r'RZ-[A-Za-z0-9_-]{43}', state.get('key', '')):
            raise ValueError('Saxlanmış lisenziya düzgün deyil.')
        if state.get('install') != self.installation():
            raise ValueError('Lisenziya başqa quraşdırmaya aiddir.')
        state['claims'] = verify_receipt(state['token'], self.public(), self.device, state['install'], state['key'])
        self.state, self.stamp = state, stamp
        return state

    def save(self, state):
        stored = {k: v for k, v in state.items() if k != 'claims'}
        self.write_private(self.path, stored)
        info = self.path.stat()
        self.state, self.stamp = state, (info.st_mtime_ns, info.st_size)

    def activate(self, key):
        if not re.fullmatch(r'RZ-[A-Za-z0-9_-]{43}', key):
            raise ValueError('Saytda yaradılan RZ- lisenziya açarını tam daxil edin.')
        now = time.time()
        if self.exists and self.load().get('lastSeen', 0) > now + 300:
            raise ValueError('Kompüterin tarixini düzəldin.')
        install = self.installation()
        receipt = self.request('activate', key, install)
        claims = verify_receipt(receipt, self.public(), self.device, install, key, now)
        self.save({'key': key, 'install': install, 'token': receipt, 'claims': claims, 'lastSeen': now})
        self.last_attempt, self.message = now, ''

    def status(self):
        now = time.time()
        try:
            state = self.load()
            if state.get('lastSeen', 0) > now + 300 or timestamp(state['claims']['issued_at']) > now + 300:
                raise ValueError('Kompüterin tarixini düzəldin.')
            until = timestamp(state['claims']['valid_until'])
            refresh = self.last_attempt == 0 or now - self.last_attempt >= (60 if until <= now or state.get('rejected') else 300)
            if refresh:
                self.last_attempt = now
                try:
                    receipt = self.request('validate', state['key'], state['install'])
                    claims = verify_receipt(receipt, self.public(), self.device, state['install'], state['key'], now)
                    state.update(token=receipt, claims=claims, lastSeen=now)
                    state.pop('rejected', None)
                    self.save(state)
                    self.message = ''
                except LicenseRejected as error:
                    state['rejected'] = str(error)
                    self.save(state)
                except (ValueError, OSError, KeyError, subprocess.SubprocessError) as error:
                    self.message = str(error) if isinstance(error, ValueError) else 'Lisenziya yoxlaması tamamlanmadı.'
            if state.get('rejected'):
                raise ValueError(state['rejected'])
            claims = state['claims']
            if timestamp(claims['valid_until']) <= now:
                raise ValueError(self.message or 'Lisenziyanı internet üzərindən yenidən yoxlamaq lazımdır.')
            return {'valid': True, 'kind': 'paid', 'online': True, 'message': 'Lisenziya bu kompüterdə aktivləşdirilib.',
                    'claims': {'licenseId': claims['license_id'], 'activationId': claims['device_id'],
                               'deviceId': self.device, 'expiresAt': int(timestamp(claims['expires_at'])),
                               'issuedAt': int(timestamp(claims['issued_at'])), 'plan': claims['plan']}}
        except (ValueError, OSError, KeyError, TypeError, subprocess.SubprocessError) as error:
            # No key, raw response, or credential can enter the public status response.
            return {'valid': False, 'kind': 'expired', 'online': True,
                    'message': str(error) if isinstance(error, ValueError) else 'Lisenziya məlumatı oxunmadı.'}

    def clear(self):
        self.path.unlink(missing_ok=True)
        self.state = self.stamp = None
