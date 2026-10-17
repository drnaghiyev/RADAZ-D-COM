"""Small recovery tool for an already downloaded, immutable desktop release."""
import hashlib
import json
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

root = Path(__file__).resolve().parents[1]
output = root/'outputs/releases/RADAZ-Updater-Repair-0.2.40.zip'
output.parent.mkdir(parents=True, exist_ok=True)
names = ['REPAIR-UPDATE.cmd', 'bridge/radaz_desktop.py', 'scripts/desktop-processes.ps1',
         'scripts/repair-desktop-update.ps1', 'docs/update-recovery.md']
manifest = {}
with ZipFile(output, 'w', ZIP_DEFLATED) as archive:
    for name in names:
        raw = (root/name).read_bytes()
        archive.writestr(name, raw)
        manifest[name] = hashlib.sha256(raw).hexdigest()
    archive.writestr('SHA256SUMS.json', json.dumps(manifest, indent=2))
output.with_suffix('.zip.sha256').write_text(hashlib.sha256(output.read_bytes()).hexdigest()+'  '+output.name+'\n')
print(f'{output} ({output.stat().st_size} bytes)')
