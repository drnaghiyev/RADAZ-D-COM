"""Per-user desktop installation and staged GitHub updates. Never touches clinical data."""
from __future__ import annotations
import argparse
import contextlib
import hashlib
import json
import os
import re
import secrets
import shutil
import subprocess
import sys
import time
from pathlib import Path, PurePosixPath
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit, urlunsplit, parse_qsl, urlencode
from zipfile import ZipFile

REPOSITORY = 'drnaghiyev/RADAZ-D-COM'
UPDATE_REPOSITORY = 'drnaghiyev/RADAZ-D-COM'
SOURCE = Path(__file__).resolve().parent.parent
NO_WINDOW = 0x08000000 if os.name == 'nt' else 0
MAX_PACKAGE = 512 * 1024 * 1024

class ArchiveBusy(RuntimeError):
    pass

class OperationBusy(RuntimeError):
    pass

def version(value):
    if not isinstance(value, str) or not re.fullmatch(r'(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)', value):
        raise ValueError('Invalid RADAZ version')
    return tuple(map(int, value.split('.')))

def read_json(file):
    return json.loads(Path(file).read_text(encoding='utf-8-sig'))

def atomic_json(file, value):
    file = Path(file)
    temporary = file.with_name(file.name + '.' + secrets.token_hex(6) + '.tmp')
    try:
        temporary.write_text(json.dumps(value, ensure_ascii=False), encoding='utf-8')
        # Windows readers and virus scanners can briefly deny rename/delete.
        # Preserve the old complete JSON until the atomic replacement succeeds.
        for attempt in range(10):
            try:
                os.replace(temporary, file)
                break
            except PermissionError:
                if attempt == 9:
                    raise
                time.sleep(min(.025 * 2 ** attempt, .25))
    finally:
        temporary.unlink(missing_ok=True)

def version_dir(root, value):
    version(value)
    if (root / 'versions').resolve().parent != root.resolve():
        raise ValueError('Versions folder is outside this installation')
    result = root / 'versions' / value
    # Do not follow user-created junctions outside the application installation.
    if result.resolve().parent != (root / 'versions').resolve():
        raise ValueError('Version folder is outside this installation')
    return result

def file_name(name):
    path = PurePosixPath(name)
    if not name or '\\' in name or ':' in name or path.is_absolute() or str(path) != name:
        raise ValueError('Invalid package path')
    for part in path.parts:
        if part in ('.', '..') or part.endswith(('.', ' ')) or re.fullmatch(r'(?i)(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?', part):
            raise ValueError('Unsafe package path')
    return path

def validate_files(names, manifest, read, expected):
    if len(names) != len(set(x.casefold() for x in names)) or set(names) != set(manifest) | {'SHA256SUMS.json'}:
        raise ValueError('Package manifest does not cover every file exactly once')
    for name in names:
        file_name(name)
    for name, digest in manifest.items():
        if not isinstance(digest, str) or not re.fullmatch('[a-f0-9]{64}', digest) or hashlib.sha256(read(name)).hexdigest() != digest:
            raise ValueError('Package file verification failed: ' + name)
    product = json.loads(read('public/product.json'))
    if product['name'] != 'RADAZ' or product['version'] != expected or not product['licenseRequired'] or product['repository'] != REPOSITORY:
        raise ValueError('Package product identity mismatch')
    if json.loads(read('desktop.json')) != {'schema': 1, 'version': expected, 'architecture': 'x64'}:
        raise ValueError('Unsupported desktop package')
    if json.loads(read('dist/server/radaz-build.json'))['product']['version'] != expected:
        raise ValueError('Build version mismatch')
    for name in ['runtime/node/node.exe', 'runtime/python/python.exe', 'dist/runtime/web-server.mjs', 'bridge/radaz_desktop.py', 'installer/launcher.ps1']:
        if name not in manifest:
            raise ValueError('Desktop runtime missing: ' + name)

def validate_directory(directory, expected):
    manifest = read_json(directory / 'SHA256SUMS.json')
    # Runtime caches generated after first launch are not package inputs.
    validate_files(list(manifest) + ['SHA256SUMS.json'], manifest, lambda name: (directory / name).read_bytes(), expected)

@contextlib.contextmanager
def lock(root, name, wait=0):
    file = (root / (name + '.lock')).open('a+b')
    file.seek(0); file.write(b'0'); file.flush()
    acquired = False
    try:
        import msvcrt
        until = time.monotonic() + wait
        while True:
            try:
                file.seek(0); msvcrt.locking(file.fileno(), msvcrt.LK_NBLCK, 1); acquired = True; break
            except OSError:
                if time.monotonic() >= until: raise OperationBusy('RADAZ operation already running') from None
                time.sleep(.3)
        yield
    finally:
        if acquired:
            file.seek(0); msvcrt.locking(file.fileno(), msvcrt.LK_UNLCK, 1)
        file.close()

def state(root, status, message, target=None, progress=None, diagnostic=None):
    atomic_json(root / 'update-state.json', {'state': status, 'message': message, 'version': target,
        'checkedAt': int(time.time()), 'progress': progress, 'diagnostic': diagnostic})

def failure(root, error, phase, target=None):
    detail = {'phase': phase, 'type': type(error).__name__, 'message': str(error),
              'version': target, 'at': int(time.time() * 1000)}
    # Preserve startup's specific resource/HTTP/port error instead of only the
    # launcher's exit code. This file is removed before each fresh launch attempt.
    startup = root / f'startup-error-{target}.json'
    if target and phase in ('startup-health', 'rollback') and startup.exists():
        try: detail['startup'] = read_json(startup)
        except (ValueError, OSError): pass
    logs = root / 'logs'; logs.mkdir(exist_ok=True)
    with (logs / 'update-errors.jsonl').open('a', encoding='utf-8') as log:
        log.write(json.dumps(detail, ensure_ascii=False) + '\n')
    print('[RADAZ update] ' + json.dumps(detail, ensure_ascii=True), flush=True)
    return detail

def get_json(url, timeout=15):
    with urlopen(Request(url, headers={'User-Agent': 'RADAZ-desktop-updater', 'Accept': 'application/vnd.github+json'}), timeout=timeout) as response:
        return json.load(response)


def get_latest_release(repo=UPDATE_REPOSITORY):
    if not re.fullmatch(r'[\w.-]+/[\w.-]+', repo): raise ValueError('Invalid update repository')
    # Public release assets do not consume GitHub's unauthenticated REST quota
    # shared by all workstations behind the same hospital/router address.
    try:
        return get_json(f'https://github.com/{repo}/releases/latest/download/radaz-update.json?check={int(time.time())//60}')
    except (HTTPError, URLError, TimeoutError, ValueError):
        # Existing releases predate the static feed; API remains a compatible fallback.
        return get_json(f'https://api.github.com/repos/{repo}/releases/latest')


def open_release_download(url):
    """Retry transient GitHub/CDN failures without reusing a cached error URL."""
    for attempt in range(3):
        download_url = url
        if attempt:
            parts = urlsplit(url)
            query = parse_qsl(parts.query, keep_blank_values=True)
            query.append(('radaz_retry', str(time.time_ns())))
            download_url = urlunsplit(parts._replace(query=urlencode(query)))
        request = Request(download_url, headers={'User-Agent': 'RADAZ-desktop-updater', 'Cache-Control': 'no-cache'})
        try:
            return urlopen(request, timeout=30)
        except HTTPError as error:
            if error.code not in (500, 502, 503, 504) or attempt == 2:
                raise
        except (URLError, TimeoutError):
            if attempt == 2:
                raise
        time.sleep(.5 * (attempt + 1))

def select_asset(release, current):
    if release.get('draft') or release.get('prerelease'):
        raise ValueError('Only published stable-channel releases can update RADAZ')
    target = release['tag_name'].removeprefix('v')
    if version(target) <= version(current): return None
    name = f'RADAZ-{target}-Windows-x64.zip'
    matches = [a for a in release['assets'] if a['name'] == name and a['state'] == 'uploaded']
    if len(matches) != 1: raise ValueError('Complete desktop update is not available')
    asset = matches[0]
    if asset['browser_download_url'] != f'https://github.com/{UPDATE_REPOSITORY}/releases/download/v{target}/{name}':
        raise ValueError('Unexpected update download location')
    if not isinstance(asset.get('digest'), str) or not re.fullmatch(r'sha256:[a-f0-9]{64}', asset['digest']) or not isinstance(asset.get('size'), int) or not 0 < asset['size'] <= MAX_PACKAGE:
        raise ValueError('Update has no valid SHA-256 digest or size')
    return target, asset

def stage_package(root, archive, target, digest, size):
    version(target)
    state(root, 'verifying', 'Yeniləmənin bütövlüyü yoxlanılır…', target)
    if archive.stat().st_size != size or hashlib.sha256(archive.read_bytes()).hexdigest() != digest:
        raise ValueError('Downloaded update SHA-256 mismatch')
    destination = version_dir(root, target)
    if destination.exists():
        try: validate_directory(destination, target)
        except (ValueError, OSError):
            if read_json(root / 'active.json')['version'] == target:
                raise ValueError('Cannot replace the active version in place')
            rejected = root / 'versions' / ('.rejected-' + target + '-' + secrets.token_hex(8))
            os.replace(destination, rejected)
            try: stage_package(root, archive, target, digest, size)
            except Exception:
                if not destination.exists(): os.replace(rejected, destination)
                raise
            finally:
                if rejected.exists() and rejected.resolve().parent == (root / 'versions').resolve(): shutil.rmtree(rejected)
            return
    else:
        staging = root / 'versions' / ('.staging-' + secrets.token_hex(10))
        staging.mkdir(parents=True)
        try:
            with ZipFile(archive) as package:
                entries = package.infolist()
                if len(entries) > 10000 or sum(x.file_size for x in entries) > 2 * 1024**3:
                    raise ValueError('Update is too large')
                if any((x.external_attr >> 16) & 0o170000 == 0o120000 for x in entries):
                    raise ValueError('Package links are not allowed')
                manifest = json.loads(package.read('SHA256SUMS.json'))
                validate_files(package.namelist(), manifest, package.read, target)
                for index, entry in enumerate(entries):
                    package.extract(entry, staging)
                    if index % 20 == 0 or index == len(entries)-1:
                        state(root, 'installing', 'Yeni versiya və bütün komponentləri quraşdırılır…', target,
                              {'done': index+1, 'total': len(entries), 'unit': 'fayl'})
            os.replace(staging, destination)
        finally:
            if staging.exists() and staging.resolve().parent == (root / 'versions').resolve():
                shutil.rmtree(staging)
    atomic_json(root / 'pending.json', {'version': target})
    state(root, 'ready', f'RADAZ {target} yeniləməsi uğurla hazırlandı. Tətbiq etmək üçün Proqramı yenidən aç düyməsini basın.', target,
          {'done': 1, 'total': 1, 'unit': 'yeniləmə'})

def check_update(root, approved_version=None):
    active = read_json(root / 'active.json')['version']
    pending = None
    if (root / 'pending.json').exists():
        candidate = read_json(root / 'pending.json')['version']
        if version(candidate) > version(active): pending = candidate
    state(root, 'checking', 'Yeniləmələr arxa planda yoxlanılır.')
    try:
        choice = select_asset(get_latest_release(), pending or active)
    except Exception:
        if not pending: raise
        state(root, 'ready', f'RADAZ {pending} hazırdır. Daha yeni buraxılış yoxlanmadı; hazırlanmış yeniləmə saxlanıldı.', pending)
        return
    if choice is None:
        if pending:
            state(root, 'ready', f'RADAZ {pending} hazırdır. Tətbiq etmək üçün RADAZ-ı yenidən başladın.', pending)
            return
        state(root, 'current', 'Ən yeni versiya quraşdırılıb.'); return
    target, asset = choice
    failed = read_json(root / 'failed-update.json') if (root / 'failed-update.json').exists() else {}
    # Discovery never downloads. Approval is single-use and tied to the version shown.
    if approved_version != target:
        retry = failed.get('version') == target
        message = (f'RADAZ {target} əvvəlki cəhddə açılmadı. Yenidən yoxlayıb hazırlamaq üçün Yenilə düyməsini basın.' if retry
                   else f'RADAZ {target} — yeni versiya mövcuddur. Avtomatik yükləmək üçün Yenilə düyməsini basın.')
        state(root, 'available', message, target, diagnostic=failed.get('diagnostic') if retry else None)
        return
    state(root, 'downloading', f'RADAZ {target} arxa planda yüklənir. Proqramdan istifadə edə bilərsiniz.', target)
    downloads = root / 'downloads'; downloads.mkdir(exist_ok=True)
    temporary = downloads / (target + '.zip.part')
    try:
        with open_release_download(asset['browser_download_url']) as response, temporary.open('wb') as stream:
            total = 0; last_progress = 0
            while block := response.read(1024 * 1024):
                total += len(block)
                if total > asset['size']: raise ValueError('Unexpected download size')
                stream.write(block)
                if time.monotonic() - last_progress >= .2 or total == asset['size']:
                    state(root, 'downloading', f'RADAZ {target} yüklənir…', target,
                          {'done': total, 'total': asset['size'], 'unit': 'bayt'})
                    last_progress = time.monotonic()
        stage_package(root, temporary, target, asset['digest'][7:], asset['size'])
    finally:
        temporary.unlink(missing_ok=True)

def environment(root):
    env = dict(os.environ, RADAZ_INSTALL_ROOT=str(root), RADAZ_DESKTOP_TOKEN=(root / 'control-token').read_text())
    return env

def run_hidden(args, root):
    logs = root / 'logs'; logs.mkdir(exist_ok=True)
    with (logs / 'desktop.log').open('ab', buffering=0) as log:
        return subprocess.Popen(args, cwd=root, env=environment(root), stdin=subprocess.DEVNULL, stdout=log, stderr=log, creationflags=NO_WINDOW)

def powershell(script, *args):
    system = Path(os.environ.get('SystemRoot', 'C:/Windows')) / 'System32/WindowsPowerShell/v1.0/powershell.exe'
    return [str(system), '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', str(script), *map(str, args)]

def app_browser():
    """Use the default Chromium profile, preserving existing localhost storage."""
    import winreg
    preferred = 'msedge.exe'
    try:
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, r'Software\Microsoft\Windows\Shell\Associations\UrlAssociations\http\UserChoice') as key:
            if 'Chrome' in winreg.QueryValueEx(key, 'ProgId')[0]: preferred = 'chrome.exe'
    except OSError: pass
    for name in dict.fromkeys((preferred, 'msedge.exe', 'chrome.exe')):
        for hive in (winreg.HKEY_CURRENT_USER, winreg.HKEY_LOCAL_MACHINE):
            for view in (winreg.KEY_WOW64_64KEY, winreg.KEY_WOW64_32KEY):
                try:
                    with winreg.OpenKey(hive, r'Software\Microsoft\Windows\CurrentVersion\App Paths' + '\\' + name, 0, winreg.KEY_READ | view) as key:
                        candidate = Path(winreg.QueryValueEx(key, '')[0].strip('"'))
                        if candidate.is_file(): return candidate
                except OSError: pass
        suffix = ('Microsoft/Edge/Application/' if name == 'msedge.exe' else 'Google/Chrome/Application/') + name
        for variable in ('PROGRAMFILES(X86)', 'PROGRAMFILES', 'LOCALAPPDATA'):
            if os.environ.get(variable):
                candidate = Path(os.environ[variable]) / suffix
                if candidate.is_file(): return candidate
    raise RuntimeError('RADAZ tətbiq pəncərəsi üçün Microsoft Edge və ya Google Chrome tapılmadı.')

def open_app(root, build):
    port = int(os.environ.get('RADAZ_PORT', '5173'))
    if not 0 < port < 65536: raise ValueError('Invalid RADAZ port')
    from urllib.parse import quote
    command = [str(app_browser()), f'--app=http://localhost:{port}/?radaz-build={quote(build, safe="")}', '--no-first-run']
    # No alternate user-data directory: existing IndexedDB and user settings stay accessible.
    return run_hidden(command, root)

def open_version(root, target):
    folder = version_dir(root, target)
    identity = read_json(folder / 'dist/server/radaz-build.json')
    build = identity['buildId']
    port = int(os.environ.get('RADAZ_PORT', '5173'))
    base = f'http://127.0.0.1:{port}'
    def healthy():
        served = get_json(base + '/radaz-runtime.json', 2)
        receiver = get_json(f'http://127.0.0.1:{os.environ.get("RADAZ_ARCHIVE_PORT", "8766")}/status', 2)
        if served.get('buildId') != build:
            raise RuntimeError(f'Runtime build mismatch: expected {build}; received {served.get("buildId")}')
        if receiver.get('version') != 1:
            raise RuntimeError('Archive status protocol mismatch')
        if receiver.get('desktopManaged') and receiver.get('appVersion') != target:
            raise RuntimeError(f'Archive version mismatch: expected {target}; received {receiver.get("appVersion")}')
        if identity.get('healthProtocol') == 1:
            try: health = get_json(base + '/radaz-health.json', 3)
            except HTTPError as error:
                detail = error.read().decode('utf-8', errors='replace')[:3000]
                raise RuntimeError(f'Client health HTTP {error.code}: {detail}') from error
            if not health.get('ready') or health.get('buildId') != build:
                raise RuntimeError('Client resources not healthy for build ' + build)
        with urlopen(base + '/', timeout=3) as response:
            return response.status == 200
    try:
        if healthy(): return build
    except Exception: pass
    (root / f'startup-error-{target}.json').unlink(missing_ok=True)
    child = run_hidden(powershell(folder / 'scripts/start-radaz.ps1', '-NoBrowser'), root)
    until = time.monotonic() + 120
    last_error = 'No health response'
    while time.monotonic() < until:
        if child.poll() == 17: raise ArchiveBusy('Archive is receiving images; apply the update on a later launch')
        if child.poll() not in (None, 0): raise RuntimeError(f'RADAZ launcher exited ({child.returncode}); last health failure: {last_error}. See logs/desktop.log')
        try:
            if healthy(): return build
        except Exception as error: last_error = f'{type(error).__name__}: {error}'
        time.sleep(.4)
    # Stop only this launcher's gateway, preserving the independently running archive.
    subprocess.run(powershell(folder / 'scripts/stop-web-server.ps1', '-Port', port), creationflags=NO_WINDOW, capture_output=True)
    if child.poll() is None: child.terminate()
    raise RuntimeError('RADAZ startup timed out; last health failure: ' + last_error)

def launch(root, no_browser=False):
    with lock(root, 'launch', 90):
        active = read_json(root / 'active.json')
        current = active['version']; target = current
        if (root / 'pending.json').exists():
            candidate = read_json(root / 'pending.json')['version']
            if version(candidate) > version(current): target = candidate
        phase = 'package-validation'
        try:
            if target != current: state(root, 'activating', f'RADAZ {target} açılışı və resursları yoxlanılır…', target)
            if target != current: validate_directory(version_dir(root, target), target)
            phase = 'startup-health'
            build = open_version(root, target)
            if target != current:
                phase = 'activation-commit'
                atomic_json(root / 'active.json', {'version': target, 'previousVersion': current})
        except ArchiveBusy:
            state(root, 'deferred', 'Arxiv hazırda məşğuldur. Yeniləmə növbəti açılışa saxlanıldı.', target)
            target = current; build = open_version(root, current)
        except Exception as error:
            diagnostic = failure(root, error, phase, target)
            if target == current: raise
            atomic_json(root / 'failed-update.json', {'version': target, 'diagnostic': diagnostic})
            (root / 'pending.json').unlink(missing_ok=True)
            state(root, 'rolling-back', 'Yeni versiya açılmadı. Əvvəlki versiya bərpa edilir…', target, diagnostic=diagnostic)
            target = current
            try: build = open_version(root, current)
            except Exception as rollback_error:
                diagnostic['rollback'] = failure(root, rollback_error, 'rollback', current)
                state(root, 'error', 'Əvvəlki versiyanın faylları qorunur, açılışı təsdiqlənmədi. RADAZ qısayolundan yenidən başladın.', diagnostic=diagnostic)
                raise
            state(root, 'error', 'Yeni versiya açıla bilmədi. Əvvəlki işlək versiya bərpa edildi. Yenilə ilə təkrar cəhd edə bilərsiniz.', diagnostic=diagnostic)
        else:
            if target != current:
                (root / 'pending.json').unlink(missing_ok=True)
                (root / 'failed-update.json').unlink(missing_ok=True)
                state(root, 'current', f'RADAZ {target} avtomatik yeniləndi.')
        folder = version_dir(root, target)
        run_hidden([str(folder / 'runtime/python/python.exe'), str(folder / 'bridge/radaz_desktop.py'), 'watch', '--install-root', str(root)], root)
        if not no_browser:
            open_app(root, build)

def initialize(root, shortcuts=True):
    target = read_json(SOURCE / 'public/product.json')['version']
    validate_directory(version_dir(root, target), target)
    current = read_json(root / 'active.json') if (root / 'active.json').exists() else None
    if current and version(current['version']) > version(target): return
    if not (root / 'control-token').exists(): (root / 'control-token').write_text(secrets.token_hex(32))
    if current and current['version'] != target:
        atomic_json(root / 'pending.json', {'version': target})
        state(root, 'ready', f'RADAZ {target} hazırdır. Tətbiq etmək üçün Proqramı yenidən aç düyməsini basın.', target)
    elif not current:
        atomic_json(root / 'active.json', {'version': target})
        state(root, 'current', 'Yeni versiyalar yoxlanılır. Yükləmə yalnız təsdiqinizlə başlayır.')
    shutil.copyfile(SOURCE / 'installer/launcher.ps1', root / 'launcher.ps1')
    shutil.copyfile(SOURCE / 'public/radaz.ico', root / 'radaz.ico')
    if shortcuts:
        result = subprocess.run(powershell(SOURCE / 'scripts/desktop-shortcuts.ps1', '-InstallRoot', root), creationflags=NO_WINDOW)
        if result.returncode: raise RuntimeError('Desktop shortcut creation failed')

def install(root, shortcuts=True):
    target = read_json(SOURCE / 'public/product.json')['version']
    validate_directory(SOURCE, target)
    destination = version_dir(root, target)
    if not destination.exists():
        staging = root / 'versions' / ('.staging-' + secrets.token_hex(8)); staging.mkdir(parents=True)
        try:
            for name in list(read_json(SOURCE / 'SHA256SUMS.json')) + ['SHA256SUMS.json']:
                file = staging / name; file.parent.mkdir(parents=True, exist_ok=True); shutil.copyfile(SOURCE / name, file)
            os.replace(staging, destination)
        finally:
            if staging.exists() and staging.resolve().parent == (root / 'versions').resolve(): shutil.rmtree(staging)
    initialize(root, shortcuts)

def update_error_message(error):
    if isinstance(error, HTTPError):
        if error.code == 404:
            return 'Yenilənmə mənbəyi və ya yayımlanmış buraxılış tapılmadı (404). Yenilənmə ünvanını dəstəklə yoxlayın.'
        if error.code in (403, 429):
            return 'GitHub yenilənmə sorğusunu məhdudlaşdırdı. Bir qədər sonra yenidən yoxlayın.'
    if isinstance(error, (URLError, TimeoutError)):
        return 'Yenilənmə serveri ilə əlaqə qurulmadı. İnternet bağlantısını yoxlayıb yenidən cəhd edin.'
    return 'Yeniləmə yüklənmədi. Mövcud versiya işləyir; növbəti yoxlamada yenidən cəhd ediləcək.'


def consume_update_request(root):
    pending = root / 'update-request.json'
    consumed = root / 'update-request.consumed.json'
    try: os.replace(pending, consumed)
    except FileNotFoundError: return None
    try:
        request = read_json(consumed)
        if request.get('action') == 'download' and request.get('confirmed') is True:
            approved = request.get('version')
            if isinstance(approved, str):
                version(approved)
                return approved
        return None  # Legacy requests and scheduled checks only discover releases.
    finally: consumed.unlink(missing_ok=True)


def apply_update(root):
    """An already verified download can be activated with no GitHub connection."""
    with lock(root, 'apply'):
        request = root / 'apply-request.json'
        consumed = root / 'apply-request.consumed.json'
        try: os.replace(request, consumed)
        except FileNotFoundError: return False
        try:
            apply = read_json(consumed)
            candidate = read_json(root / 'pending.json').get('version') if (root / 'pending.json').exists() else None
            if apply.get('confirmed') is not True or not candidate or apply.get('version') != candidate: return False
            launch(root, no_browser=True)
            return True
        finally: consumed.unlink(missing_ok=True)

def recover_server(root):
    # A failed runtime does not authorize activation of an unrequested staged update.
    with lock(root, 'launch'):
        current = read_json(root / 'active.json')['version']
        return open_version(root, current)

def watch(root):
    handoff = None
    missed_health = 0
    own_version = read_json(SOURCE / 'public/product.json')['version']
    try:
        with lock(root, 'update'):
            while True:
                retry_delay = 15 * 60
                try: apply_update(root)
                except OperationBusy: pass
                try: check_update(root, consume_update_request(root))
                except Exception as error:
                    saved = read_json(root / 'update-state.json')
                    detail = failure(root, error, saved.get('state', 'download'), saved.get('version'))
                    state(root, 'error', update_error_message(error), diagnostic=detail)
                    retry_delay = 60
                # A transient outage must not hide a new version for six hours.
                # Failed downloads lose their consumed approval and only recheck.
                for tick in range(retry_delay):
                    time.sleep(1)
                    if (root/'apply-request.json').exists():
                        try: apply_update(root)
                        except OperationBusy: pass
                    active = read_json(root / 'active.json')['version']
                    if active != own_version:
                        handoff = version_dir(root, active)
                        break
                    if (root / 'update-request.json').exists(): break
                    if tick % 10: continue
                    try:
                        served = get_json(f'http://127.0.0.1:{os.environ.get("RADAZ_PORT", "5173")}/radaz-runtime.json', 3)
                        if served.get('name') != 'RADAZ': raise RuntimeError('Port belongs to another application')
                        missed_health = 0
                    except Exception:
                        missed_health += 1
                        if missed_health < 3: continue
                        try: recover_server(root); missed_health = 0
                        except OperationBusy: pass  # A deliberate restart already owns the launcher.
                        except Exception as error:
                            failure(root, error, 'server-recovery', active)
                            # Keep the watcher alive, but back off repeated startup failures.
                            missed_health = -27
                if handoff: break
    except OperationBusy: return  # An existing background updater owns the lock.
    if handoff:
        run_hidden([str(handoff/'runtime/python/python.exe'),str(handoff/'bridge/radaz_desktop.py'),'watch','--install-root',str(root)],root)

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('command', choices=['initialize', 'install', 'launch', 'watch', 'check', 'apply'])
    parser.add_argument('--install-root', type=Path, default=Path(os.environ.get('LOCALAPPDATA', Path.home())) / 'Programs/RADAZ')
    parser.add_argument('--no-browser', action='store_true')
    parser.add_argument('--no-shortcuts', action='store_true')
    args = parser.parse_args(); root = args.install_root.resolve(); root.mkdir(parents=True, exist_ok=True)
    if args.command in ('initialize', 'install'):
        with lock(root, 'launch', 90):
            (install if args.command == 'install' else initialize)(root, not args.no_shortcuts)
    elif args.command == 'launch': launch(root, args.no_browser)
    elif args.command == 'check':
        with lock(root, 'update'): check_update(root)
    elif args.command == 'apply':
        try: apply_update(root)
        except OperationBusy: pass
        except Exception as error:
            diagnostic = failure(root, error, 'apply')
            state(root, 'error', 'RADAZ açılışı tamamlanmadı. Xəta məlumatı açılış jurnalında saxlanılıb.', diagnostic=diagnostic)
            raise
    else: watch(root)

if __name__ == '__main__': main()
