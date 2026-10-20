"""Build a file-level update from two verified desktop packages; no binary patching."""
import argparse
import hashlib
import json
import re
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from urllib.request import Request, urlopen


def build_delta(previous, current, output):
    with ZipFile(previous) as old:
        before=json.loads(old.read('SHA256SUMS.json'))
        base=json.loads(old.read('desktop.json'))['version']
        if set(old.namelist()) != set(before) | {'SHA256SUMS.json'}:raise ValueError('Incomplete source package')
        for name,digest in before.items():
            if hashlib.sha256(old.read(name)).hexdigest()!=digest:raise ValueError('Source checksum mismatch: '+name)
    return build_delta_manifest(base,before,current,output)


def build_delta_manifest(base, before, current, output):
    with ZipFile(current) as new:
        after = json.loads(new.read('SHA256SUMS.json'))
        target = json.loads(new.read('desktop.json'))['version']
        for value in (base, target):
            if not re.fullmatch(r'\d+\.\d+\.\d+', value): raise ValueError('Invalid version')
        changed = [name for name, digest in after.items() if before.get(name) != digest]
        for package, manifest in ((new, after),):
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
        details={'schema':1,'version':target,'baseVersion':base,'minimumSupportedVersion':base,
                 'url':f'https://github.com/drnaghiyev/RADAZ-D-COM/releases/download/v{target}/{patch.name}',
                 'size':patch.stat().st_size,'sha256':hashlib.sha256(patch.read_bytes()).hexdigest(),
                 'added':sorted(set(after)-set(before)),'changed':sorted(name for name in changed if name in before),
                 'deleted':sorted(set(before)-set(after)),
                 'files':[{'path':name,'size':new.getinfo(name).file_size,'sha256':digest} for name,digest in sorted(after.items())]}
        # Keep delta.json schema 1 byte-for-byte compatible with deployed updaters.
        # The separately signed release feed carries the richer distribution metadata.
        metadata=patch.with_suffix('.manifest.json')
        metadata.write_text(json.dumps(details,indent=2),encoding='utf-8')
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
            release=json.load(response)
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

    # Deployed 0.2.40-43 controllers understand only a direct base->target delta.
    # Publish cumulative deltas so skipping releases never omits their changes.
    if args.previous_release:
        for patch_number in range(40,int(base.split('.')[-1])):
            compatibility=f'0.2.{patch_number}'
            with urlopen(Request(f'https://github.com/{repo}/releases/download/v{compatibility}/radaz-update.json',headers={'User-Agent':'RADAZ-delta-builder'}),timeout=60) as response:
                prior=json.load(response)
            if prior['tag_name']!='v'+compatibility:raise ValueError('Wrong compatibility release')
            entries=prior.get('distribution',{}).get('files')
            if entries:
                import importlib.util
                spec=importlib.util.spec_from_file_location('compat_desktop',Path(__file__).resolve().parents[1]/'bridge/radaz_desktop.py')
                desktop=importlib.util.module_from_spec(spec);spec.loader.exec_module(desktop)
                desktop.authenticate_release(prior)
                build_delta_manifest(compatibility,{f['path']:f['sha256'] for f in entries},args.current,args.output)
            else:
                name=f'RADAZ-{compatibility}-Windows-x64.zip'
                asset=next(a for a in prior['assets'] if a['name']==name)
                url=f'https://github.com/{repo}/releases/download/v{compatibility}/{name}'
                if asset['browser_download_url']!=url or not re.fullmatch('sha256:[a-f0-9]{64}',asset['digest']):raise ValueError('Invalid compatibility package')
                file=Path('outputs/delta-base')/name
                if not file.exists() or hashlib.sha256(file.read_bytes()).hexdigest()!=asset['digest'][7:]:
                    with urlopen(Request(url,headers={'User-Agent':'RADAZ-delta-builder'}),timeout=120) as src,file.open('wb') as dst:
                        import shutil
                        shutil.copyfileobj(src,dst)
                if file.stat().st_size!=asset['size'] or hashlib.sha256(file.read_bytes()).hexdigest()!=asset['digest'][7:]:raise ValueError('Compatibility checksum mismatch')
                build_delta(file,args.current,args.output)
