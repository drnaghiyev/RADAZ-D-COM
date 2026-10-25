"""Optional Authenticode signing with a certificate in the Windows user store.

No certificate/password/private key is copied into the source or artifacts.
Configured signing errors are fatal; absent configuration is explicitly unsigned.
"""
import os
import re
import shutil
import subprocess
from pathlib import Path
from urllib.parse import urlsplit


def sign_artifact(file, env=None, run=subprocess.run):
    env = os.environ if env is None else env
    thumbprint = env.get('RADAZ_SIGN_CERT_SHA1', '').strip()
    if not thumbprint:
        print('Authenticode skipped: no signing certificate configured; Windows warnings may remain.')
        return False
    if not re.fullmatch(r'[a-fA-F0-9]{40}', thumbprint):
        raise ValueError('RADAZ_SIGN_CERT_SHA1 must identify a certificate in CurrentUser/My')
    timestamp = env.get('RADAZ_SIGN_TIMESTAMP_URL', '')
    parsed = urlsplit(timestamp)
    if parsed.scheme != 'https' or not parsed.hostname or parsed.username or parsed.password:
        raise ValueError('Configure an HTTPS RFC3161 RADAZ_SIGN_TIMESTAMP_URL')
    tool = env.get('RADAZ_SIGNTOOL') or shutil.which('signtool.exe')
    if not tool or not Path(tool).is_file():
        raise ValueError('Configured signing requires Windows SDK signtool.exe')
    file = Path(file).resolve(strict=True)
    for arguments in (
        ['sign', '/sha1', thumbprint, '/s', 'My', '/fd', 'SHA256', '/tr', timestamp, '/td', 'SHA256', str(file)],
        ['verify', '/pa', '/all', str(file)],
    ):
        result = run([str(tool), *arguments], capture_output=True, creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
        if result.returncode:
            raise RuntimeError('Authenticode signing/verification failed; artifact must not be published')
    return True
