"""Verified transport and bounded Windows trust diagnostics for release downloads."""
import functools
import json
import os
import ssl
import subprocess
import time
from pathlib import Path
from urllib.error import URLError
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, HTTPSHandler, build_opener

HOSTS = {'github.com', 'api.github.com', 'radaz.space', 'release-assets.githubusercontent.com',
         'objects.githubusercontent.com', 'github-releases.githubusercontent.com'}


class TLSIssue(URLError):
    def __init__(self, kind, host, code=None):
        super().__init__(kind)
        self.kind, self.host, self.code = kind, host, code


def classify(error):
    detail = error.reason if isinstance(error, URLError) else error
    if not isinstance(detail, ssl.SSLError):
        return None
    code = getattr(detail, 'verify_code', None)
    desc = str(detail).lower()
    if isinstance(code, int):
        code &= 0xffffffff
    if code in (62, 64, 0x800b010f) or 'hostname' in desc or 'name mismatch' in desc:
        return 'hostname'
    if code in (9, 10, 0x800b0101) or 'expired' in desc or 'not yet valid' in desc:
        return 'validity'
    if code in (23, 28, 0x800b010c, 0x800b0111) or 'revoked' in desc or 'distrust' in desc:
        return 'distrust'
    if code in (18, 19, 20, 21, 0x800b0109, 0x800b010a) or any(
        text in desc for text in ('untrusted root', 'self-signed', 'self signed', 'unable to get local issuer')):
        return 'chain'
    return 'certificate' if isinstance(detail, ssl.SSLCertVerificationError) else 'handshake'


class SecureRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        if urlsplit(newurl).scheme != 'https':
            raise ValueError('Update redirect requires HTTPS')
        return super().redirect_request(req, fp, code, msg, headers, newurl)


class VerifiedHandler(HTTPSHandler):
    def https_open(self, request):
        try:
            return super().https_open(request)
        except (URLError, ssl.SSLError) as error:
            kind = classify(error)
            if kind:
                detail = getattr(error, 'reason', error)
                raise TLSIssue(kind, urlsplit(request.full_url).hostname, getattr(detail, 'verify_code', None)) from error
            raise


@functools.lru_cache(maxsize=1)
def opener():
    if os.name == 'nt':
        import truststore
        context = truststore.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
        context.verify_flags |= ssl.VERIFY_CRL_CHECK_CHAIN
    else:
        import certifi
        context = ssl.create_default_context(cafile=certifi.where())
    context.minimum_version = ssl.TLSVersion.TLSv1_2
    return build_opener(SecureRedirect(), VerifiedHandler(context=context))


def open_https(request, timeout=15):
    url = getattr(request, 'full_url', request)
    host = urlsplit(url).hostname
    if urlsplit(url).scheme != 'https' or not host:
        raise ValueError('Update URL requires HTTPS')
    return opener().open(request, timeout=timeout)


def log_issue(root, error):
    try:
        logs = root / 'logs'
        logs.mkdir(parents=True, exist_ok=True)
        with (logs / 'ssl-diagnostics.jsonl').open('a', encoding='utf8') as out:
            json.dump(dict(at=int(time.time()), phase='update', host=error.host if error.host in HOSTS else 'cdn',
                           kind=error.kind, code=error.code), out)
            out.write('\n')
    except OSError:
        pass


def native_check(source, root, host, repair=False):
    if os.name != 'nt' or host not in HOSTS:
        return None
    try:
        args = [str(source / 'runtime/RadazTls.exe'), 'repair' if repair else 'diagnose', host, str(root / 'logs')]
        return subprocess.run(args, timeout=150, creationflags=subprocess.CREATE_NO_WINDOW).returncode
    except (OSError, subprocess.TimeoutExpired):
        return None
