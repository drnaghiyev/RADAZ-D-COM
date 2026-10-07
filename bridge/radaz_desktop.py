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
UPDATE_REPOSITORY = 'cesur9872-droid/RADAZ-Releases'
SOURCE = Path(__file__).resolve().parent.parent
NO_WINDOW = 0x08000000 if os.name == 'nt' else 0
MAX_PACKAGE = 512 * 1024 * 1024

class ArchiveBusy(RuntimeError):
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
                if time.monotonic() >= until: raise RuntimeError('RADAZ operation already running') from None
                time.sleep(.3)
        yield
    finally:
        if acquired:
            file.seek(0); msvcrt.locking(file.fileno(), msvcrt.LK_UNLCK, 1)
        file.close()

def state(root, status, message, target=None, progress=None):
    atomic_json(root / 'update-state.json', {'state': status, 'message': message, 'version': target,
        'checkedAt': int(time.time()), 'progress': progress})

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
        validate_directory(destination, target)
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
    if (root / 'failed-update.json').exists() and read_json(root / 'failed-update.json').get('version') == target:
        state(root, 'error', f'{target} açıla bilmədi. Əvvəlki işlək versiya saxlanılıb.'); return
    # Discovery never downloads. Approval is single-use and tied to the version shown.
    if approved_version != target:
        state(root, 'available', f'RADAZ {target} — yeni versiya mövcuddur. Avtomatik yükləmək üçün Yenilə düyməsini basın.', target)
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

def open_version(root, target):
    folder = version_dir(root, target)
    build = read_json(folder / 'dist/server/radaz-build.json')['buildId']
    port = int(os.environ.get('RADAZ_PORT', '5173'))
    base = f'http://127.0.0.1:{port}'
    def healthy():
        served = get_json(base + '/radaz-runtime.json', 2)
        receiver = get_json(f'http://127.0.0.1:{os.environ.get("RADAZ_ARCHIVE_PORT", "8766")}/status', 2)
        if served.get('buildId') != build or receiver.get('version') != 1:
            return False
        if receiver.get('desktopManaged') and receiver.get('appVersion') != target:
            return False
        with urlopen(base + '/', timeout=3) as response:
            return response.status == 200
    try:
        if healthy(): return build
    except Exception: pass
    child = run_hidden(powershell(folder / 'scripts/start-radaz.ps1', '-NoBrowser'), root)
    until = time.monotonic() + 75
    while time.monotonic() < until:
        if child.poll() == 17: raise ArchiveBusy('Archive is receiving images; apply the update on a later launch')
        if child.poll() not in (None, 0): raise RuntimeError('RADAZ startup failed; see logs/desktop.log')
        try:
            if healthy(): return build
        except Exception: pass
        time.sleep(.4)
    # Stop only this launcher's gateway, preserving the independently running archive.
    subprocess.run(powershell(folder / 'scripts/stop-web-server.ps1', '-Port', port), creationflags=NO_WINDOW, capture_output=True)
    if child.poll() is None: child.terminate()
    raise RuntimeError('RADAZ startup timed out')

def launch(root, no_browser=False):
    with lock(root, 'launch', 90):
        active = read_json(root / 'active.json')
        current = active['version']; target = current
        if (root / 'pending.json').exists():
            candidate = read_json(root / 'pending.json')['version']
            if version(candidate) > version(current): target = candidate
        try:
            if target != current: validate_directory(version_dir(root, target), target)
            build = open_version(root, target)
        except ArchiveBusy:
            state(root, 'deferred', 'Arxiv hazırda məşğuldur. Yeniləmə növbəti açılışa saxlanıldı.', target)
            target = current; build = open_version(root, current)
        except Exception:
            if target == current: raise
            atomic_json(root / 'failed-update.json', {'version': target})
            (root / 'pending.json').unlink(missing_ok=True)
            state(root, 'error', 'Yeni versiya açıla bilmədi. Əvvəlki işlək versiyaya qayıdıldı.')
            target = current; build = open_version(root, current)
        else:
            if target != current:
                atomic_json(root / 'active.json', {'version': target, 'previousVersion': current})
                (root / 'pending.json').unlink(missing_ok=True)
                state(root, 'current', f'RADAZ {target} avtomatik yeniləndi.')
        folder = version_dir(root, target)
        run_hidden([str(folder / 'runtime/python/python.exe'), str(folder / 'bridge/radaz_desktop.py'), 'watch', '--install-root', str(root)], root)
        if not no_browser:
            os.startfile(f'http://localhost:{os.environ.get("RADAZ_PORT", "5173")}/?radaz-build={build}')

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


def watch(root):
    handoff = None
    own_version = read_json(SOURCE / 'public/product.json')['version']
    try:
        with lock(root, 'update'):
            while True:
                retry_delay = 15 * 60
                try: check_update(root, consume_update_request(root))
                except Exception as error:
                    state(root, 'error', update_error_message(error))
                    print(type(error).__name__, ascii(str(error)), flush=True)
                    retry_delay = 60
                # A transient outage must not hide a new version for six hours.
                # Failed downloads lose their consumed approval and only recheck.
                for tick in range(retry_delay):
                    time.sleep(1)
                    apply_path=root/'apply-request.json'
                    if apply_path.exists():
                        apply=read_json(apply_path);apply_path.unlink(missing_ok=True)
                        candidate=read_json(root/'pending.json').get('version') if (root/'pending.json').exists() else None
                        if apply.get('confirmed') is True and candidate and apply.get('version')==candidate:
                            launch(root,no_browser=True)
                    active = read_json(root / 'active.json')['version']
                    if active != own_version:
                        handoff = version_dir(root, active)
                        break
                    if (root / 'update-request.json').exists(): break
                    if tick % 60: continue
                    try: get_json(f'http://127.0.0.1:{os.environ.get("RADAZ_PORT", "5173")}/radaz-runtime.json', 3)
                    except Exception: return
                if handoff: break
    except RuntimeError: return  # An existing background updater owns the lock.
    if handoff:
        run_hidden([str(handoff/'runtime/python/python.exe'),str(handoff/'bridge/radaz_desktop.py'),'watch','--install-root',str(root)],root)

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('command', choices=['initialize', 'install', 'launch', 'watch', 'check'])
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
    else: watch(root)

if __name__ == '__main__': main()
