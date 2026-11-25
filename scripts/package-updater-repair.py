"""Deliver the immutable 0.2.40 offline recovery tool for interrupted 0.2.39 updates."""
import argparse
import hashlib
import io
import subprocess
import sys
import tempfile
from pathlib import Path
from zipfile import ZipFile

ROOT = Path(__file__).resolve().parents[1]
ARCHIVE = ROOT / 'ops/legacy-update/RADAZ-Updater-Repair-0.2.40.zip'
# SHA-256 of the original recovery asset published with RADAZ v0.2.40.
DIGEST = '3830e8e1bea01ff3bd41d93c01436eee6c93b90326ccb6e8dc8f393cb9c57bfe'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--repair', type=Path, metavar='INSTALL_ROOT')
    args = parser.parse_args()
    package = ARCHIVE.read_bytes()
    if hashlib.sha256(package).hexdigest() != DIGEST:
        raise ValueError('Legacy recovery package failed verification')
    if args.repair is None:
        output = ROOT / 'outputs/releases' / ARCHIVE.name
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_bytes(package)
        output.with_suffix('.zip.sha256').write_text(f'{DIGEST}  {output.name}\n', encoding='ascii')
        print(f'{output} ({len(package)} bytes)')
        return
    with tempfile.TemporaryDirectory(prefix='radaz-039-repair-') as directory:
        with ZipFile(io.BytesIO(package)) as source:
            source.extractall(directory)
        controller = Path(directory) / 'bridge/radaz_desktop.py'
        subprocess.run([sys.executable, str(controller), 'repair', '--install-root',
                        str(args.repair.resolve()), '--target-version', '0.2.39'], check=True)


if __name__ == '__main__':
    main()
