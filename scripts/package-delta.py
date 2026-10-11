"""Build a file-level update from two verified desktop packages; no binary patching."""
import argparse
import hashlib
import json
import re
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from urllib.request import Request, urlopen


def build_delta(previous, current, output):
    with ZipFile(previous) as old, ZipFile(current) as new:
        before = json.loads(old.read('SHA256SUMS.json'))
        after = json.loads(new.read('SHA256SUMS.json'))
        base = json.loads(old.read('desktop.json'))['version']
        target = json.loads(new.read('desktop.json'))['version']
        for value in (base, target):
            if not re.fullmatch(r'\d+\.\d+\.\d+', value): raise ValueError('Invalid version')
        changed = [name for name, digest in after.items() if before.get(name) != digest]
        for package, manifest in ((old, before), (new, after)):
            if set(package.namelist()) != set(manifest) | {'SHA256SUMS.json'}:
                raise ValueError('Incomplete source package')
            for name, digest in manifest.items():
                if hashlib.sha256(package.read(name)).hexdigest() != digest:
                    raise ValueError('Source checksum mismatch: ' + name)
        output.mkdir(parents=True, exist_ok=True)
        patch = output / f'RADAZ-{target}-from-{base}-x64.patch.zip'
        with ZipFile(patch, 'w', ZIP_DEFLATED, compresslevel=6) as archive:
            archive.writestr('delta.json', json.dumps({'schema': 1, 'baseVersion': base, 'version': target}))
            archive.writestr('SHA256SUMS.json', new.read('SHA256SUMS.json'))
            for name in changed: archive.writestr(name, new.read(name))
        patch.with_suffix('.zip.sha256').write_text(hashlib.sha256(patch.read_bytes()).hexdigest()+'  '+patch.name+'\n', encoding='ascii')
        print(f'{patch.name}: {len(changed)}/{len(after)} files, {patch.stat().st_size/1024**2:.1f} MiB')
        return patch


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('previous', type=Path, nargs='?')
    parser.add_argument('current', type=Path)
    parser.add_argument('--previous-release', action='store_true')
    parser.add_argument('--output', type=Path, default=Path('outputs/releases'))
    args = parser.parse_args()
    if args.previous_release:
        repo='drnaghiyev/RADAZ-D-COM'
        with urlopen(Request(f'https://github.com/{repo}/releases/latest/download/radaz-update.json',headers={'User-Agent':'RADAZ-delta-builder'}),timeout=60) as response:
            release=json.loads(response.read(1024*1024))
        base=release['tag_name'].removeprefix('v')
        if not re.fullmatch(r'\d+\.\d+\.\d+',base): raise ValueError('Invalid prior release')
        name=f'RADAZ-{base}-Windows-x64.zip'
        asset=next(a for a in release['assets'] if a['name']==name)
        url=f'https://github.com/{repo}/releases/download/v{base}/{name}'
        if asset['browser_download_url']!=url or not re.fullmatch('sha256:[a-f0-9]{64}',asset['digest']) or not 0<asset['size']<=512*1024**2:
            raise ValueError('Invalid prior package')
        args.previous=Path('outputs/delta-base')/name;args.previous.parent.mkdir(parents=True,exist_ok=True)
        if not args.previous.exists() or hashlib.sha256(args.previous.read_bytes()).hexdigest()!=asset['digest'][7:]:
            with urlopen(Request(url,headers={'User-Agent':'RADAZ-delta-builder'}),timeout=120) as src,args.previous.open('wb') as dst:
                size=0
                while block:=src.read(1024*1024):
                    size+=len(block)
                    if size>asset['size']:raise ValueError('Prior package too large')
                    dst.write(block)
        if args.previous.stat().st_size!=asset['size'] or hashlib.sha256(args.previous.read_bytes()).hexdigest()!=asset['digest'][7:]:raise ValueError('Prior package checksum mismatch')
    if args.previous is None:parser.error('A previous package or --previous-release is required')
    build_delta(args.previous, args.current, args.output)
