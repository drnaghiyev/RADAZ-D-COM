"""Build an offline Windows x64 package and per-user Setup.exe from pinned inputs."""
import concurrent.futures
import hashlib
import json
import os
import shutil
import subprocess
from pathlib import Path
from urllib.request import Request, urlopen
from zipfile import ZipFile, ZIP_DEFLATED

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'outputs/releases'
CACHE = ROOT / 'outputs/desktop-downloads'
STAGE = ROOT / 'outputs/desktop-stage'
LOCK = json.loads((ROOT / 'scripts/desktop-runtime-lock.json').read_text())

def fetch(item):
    file = CACHE / item['url'].rsplit('/', 1)[-1]
    if not file.exists() or hashlib.sha256(file.read_bytes()).hexdigest() != item['sha256']:
        temporary = file.with_suffix(file.suffix + '.part')
        with urlopen(Request(item['url'], headers={'User-Agent':'RADAZ-desktop-build'}), timeout=60) as response, temporary.open('wb') as stream:
            shutil.copyfileobj(response, stream)
        if hashlib.sha256(temporary.read_bytes()).hexdigest() != item['sha256']:
            raise ValueError('Runtime checksum mismatch: ' + file.name)
        os.replace(temporary, file)
    return file

def checksum(file):
    file.with_suffix(file.suffix + '.sha256').write_text(f'{hashlib.sha256(file.read_bytes()).hexdigest()}  {file.name}\n', encoding='ascii')

def main():
    if json.loads((ROOT / 'public/product.json').read_text(encoding='utf-8-sig')).get('channel') == 'local-anatomy':
        raise SystemExit('Private Anatomy AI development must not be packaged as a public Setup.')
    version = json.loads((ROOT / 'public/product.json').read_text(encoding='utf-8-sig'))['version']
    CACHE.mkdir(parents=True, exist_ok=True)
    with concurrent.futures.ThreadPoolExecutor(max_workers=5) as pool:
        inputs = dict(zip(LOCK, pool.map(fetch, LOCK.values())))
    if STAGE.exists():
        assert STAGE.resolve() == (ROOT / 'outputs/desktop-stage').resolve() and STAGE.resolve().parent == (ROOT / 'outputs').resolve()
        shutil.rmtree(STAGE)
    STAGE.mkdir()
    with ZipFile(OUT / f'RADAZ-{version}-Windows-preview.zip') as source:
        source.extractall(STAGE)
    node = STAGE / 'runtime/node'; node.mkdir(parents=True)
    with ZipFile(inputs['node']) as package:
        for suffix in ('node.exe', 'LICENSE'):
            name = next(n for n in package.namelist() if n.count('/') == 1 and n.endswith('/' + suffix))
            (node / suffix).write_bytes(package.read(name))
    python = STAGE / 'runtime/python'; python.mkdir()
    with ZipFile(inputs['python']) as package: package.extractall(python)
    pth = next(python.glob('python*._pth'))
    pth.write_text('python313.zip\n.\nLib/site-packages\n../../bridge\nimport site\n')
    with ZipFile(inputs['pillow']) as package: package.extractall(python / 'Lib/site-packages')
    ffmpeg = STAGE / 'runtime/ffmpeg'; ffmpeg.mkdir()
    with ZipFile(inputs['ffmpeg']) as package:
        exe = next(n for n in package.namelist() if n.endswith('.exe'))
        (ffmpeg / 'ffmpeg.exe').write_bytes(package.read(exe))
        for name in package.namelist():
            if 'license' in name.lower() or 'copying' in name.lower():
                (ffmpeg / Path(name).name).write_bytes(package.read(name))
    electron = STAGE / 'runtime/electron'; electron.mkdir()
    with ZipFile(inputs['electron']) as package: package.extractall(electron)
    (electron / 'electron.exe').rename(electron / 'RADAZ.exe')
    shell = electron / 'resources/app'; shell.mkdir(parents=True)
    for name in ('main.cjs', 'package.json'):
        shutil.copy2(ROOT / 'desktop' / name, shell / name)
    # The native shell selects its bootstrap runtime from this version on first launch.
    shell_package = json.loads((shell / 'package.json').read_text(encoding='utf-8'))
    shell_package['version'] = version
    (shell / 'package.json').write_text(json.dumps(shell_package, indent=2), encoding='utf-8')
    (STAGE / 'runtime/sources.json').write_text(json.dumps({k:v for k,v in LOCK.items() if k != 'inno'}, indent=2))
    (STAGE / 'desktop.json').write_text(json.dumps({'schema':1,'version':version,'architecture':'x64'}))
    # Render the existing vector logo, then encode a multi-resolution Windows icon.
    render = "import{createRequire}from'node:module';const r=createRequire(import.meta.resolve('wrangler'));const m=createRequire(r.resolve('miniflare'));const sharp=m('sharp');await sharp('public/radaz-logo.svg').resize(256,256).png().toFile('outputs/radaz-icon.png');"
    subprocess.run(['node','--input-type=module','-e',render], cwd=ROOT, check=True)
    from PIL import Image
    Image.open(ROOT / 'outputs/radaz-icon.png').save(STAGE / 'public/radaz.ico', sizes=[(16,16),(32,32),(48,48),(64,64),(128,128),(256,256)])
    manifest = {file.relative_to(STAGE).as_posix():hashlib.sha256(file.read_bytes()).hexdigest()
                for file in sorted(STAGE.rglob('*')) if file.is_file() and file.name != 'SHA256SUMS.json'}
    (STAGE / 'SHA256SUMS.json').write_text(json.dumps(manifest, indent=2))
    archive = OUT / f'RADAZ-{version}-Windows-x64.zip'
    with ZipFile(archive, 'w', ZIP_DEFLATED, compresslevel=6) as package:
        for name in [*manifest, 'SHA256SUMS.json']: package.write(STAGE / name, name)
    checksum(archive)
    compiler = ROOT / 'outputs/inno/ISCC.exe'
    if not compiler.exists():
        subprocess.run([str(inputs['inno']), '/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART','/SP-','/CURRENTUSER','/NOICONS','/TASKS=',f'/DIR={compiler.parent}'], check=True, creationflags=0x08000000)
    compiled = subprocess.run([str(compiler), f'/DProductVersion={version}', str(ROOT / 'installer/radaz.iss')],
                              cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, creationflags=0x08000000)
    if compiled.returncode:
        raise RuntimeError(compiled.stdout.decode('utf-8', errors='replace')[-5000:])
    installer = OUT / f'RADAZ-{version}-Setup.exe'; checksum(installer)
    print(f'Offline package: {archive.stat().st_size/1024**2:.1f} MiB; {len(manifest)} verified files; Setup: {installer.name}', flush=True)

if __name__ == '__main__': main()
