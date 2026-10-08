"""Package only compiled application files and explicitly allowed runtime inputs."""
import hashlib
import json
import re
import zipfile
from pathlib import Path
ROOT=Path(__file__).resolve().parent.parent
config=json.loads((ROOT/'public/product.json').read_text(encoding='utf-8-sig'))
version=config['version']
if not re.fullmatch(r'\d+\.\d+\.\d+',version): raise SystemExit('Version must be X.Y.Z')
if not (ROOT/'dist/server/index.js').is_file():raise SystemExit('Build the application first.')
if (ROOT/'dist/server/wrangler.json').exists():raise SystemExit('Windows packages require a portable Node build, not a Cloudflare build.')
if not (ROOT/'public/license-public.json').is_file():raise SystemExit('Initialize the issuer public key first.')
build=json.loads((ROOT/'dist/server/radaz-build.json').read_text(encoding='utf-8'))
if build['product']['version'] != version or not build['product'].get('licenseRequired'):raise SystemExit('Rebuild this version with licensing enabled before packaging.')
config['licenseRequired']=True
config['trialDays']=30
out=ROOT/'outputs/releases';out.mkdir(parents=True,exist_ok=True)
target=out/f'RADAZ-{version}-Windows-preview.zip'
explicit=['package.json','pnpm-lock.yaml','pnpm-workspace.yaml','README.md','DISTRIBUTION.md','LOKAL-ISTIFADE.md','SETUP-RADAZ.cmd','START-RADAZ.cmd',
 'scripts/start-radaz.ps1','scripts/stop-web-server.ps1','scripts/start-release.mjs','scripts/setup-release.ps1','scripts/start-archive.ps1','scripts/wait-release-browser.ps1','scripts/desktop-shortcuts.ps1','installer/launcher.ps1','bridge/radaz_desktop.py','bridge/radaz_archive.py','bridge/radaz_pacs_bridge.py','bridge/radaz_output.py','bridge/radaz_product.py','bridge/radaz_trial.py','bridge/radaz_commerce.py','bridge/radaz_disc.ps1','bridge/README.md','public/license-public.json']
explicit.extend(['bridge/radaz_removable.py','bridge/radaz_windows.py'])
explicit.append('scripts/release-health.mjs')
files={p:ROOT/p for p in explicit}
for folder in ['dist/client','dist/server','dist/runtime','dist/node_modules','bridge/wheels']:
 for p in (ROOT/folder).rglob('*'):
  if p.is_file() and not p.is_symlink() and p.suffix not in ['.map','.pyc']:
   relative=p.relative_to(ROOT).as_posix()
   if any(part.startswith('.') for part in p.relative_to(ROOT).parts):continue
   files[relative]=p
blocked=re.compile(r'(?:PRIVATE KEY|sk-(?:proj-)?[A-Za-z0-9_-]{30,}|ghp_[A-Za-z0-9]{30,})')
manifest={}
with zipfile.ZipFile(target,'w',zipfile.ZIP_DEFLATED,compresslevel=6) as archive:
 for name,p in sorted(files.items()):
  if not p.is_file():raise SystemExit(f'Missing runtime input: {name}')
  if p.suffix in ['.pem','.sqlite','.sqlite3'] or '/instances/' in name or '.env' in name:raise SystemExit(f'Forbidden file: {name}')
  raw=p.read_bytes()
  if p.suffix in ['.js','.mjs','.json','.ts','.ps1','.cmd','.md'] and blocked.search(raw.decode('utf-8',errors='ignore')):raise SystemExit(f'Possible credential in {name}')
  if name.endswith('product.json'):raw=json.dumps(config,ensure_ascii=False,indent=2).encode()
  if name=='package.json':
   package=json.loads(raw);package.update(name='radaz-dicom',version=version);raw=json.dumps(package,indent=2).encode()
  archive.writestr(name,raw);manifest[name]=hashlib.sha256(raw).hexdigest()
 raw=json.dumps(config,ensure_ascii=False,indent=2).encode();archive.writestr('public/product.json',raw);manifest['public/product.json']=hashlib.sha256(raw).hexdigest()
 archive.writestr('SHA256SUMS.json',json.dumps(manifest,indent=2))
digest=hashlib.sha256(target.read_bytes()).hexdigest()
target.with_suffix('.zip.sha256').write_text(f'{digest}  {target.name}\n',encoding='ascii')
print(f'{target}\n{len(manifest)} files; {target.stat().st_size/1024/1024:.1f} MiB; license required = true')
