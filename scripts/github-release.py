"""Publish verified Windows packages; published versions are never overwritten."""
import argparse
import hashlib
import json
import os
import re
import time
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import quote
from urllib.request import Request, urlopen
from zipfile import ZipFile

ROOT = Path(__file__).resolve().parents[1]


def version_parts(version):
    if not re.fullmatch(r'(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)', version):
        raise ValueError('Release version must be X.Y.Z')
    return tuple(map(int, version.split('.')))


def config(root=ROOT):
    product = json.loads((root / 'public/product.json').read_text(encoding='utf-8-sig'))
    version_parts(product['version'])
    product['updateRepository'] = product.get('updateRepository') or product['repository']
    if not all(re.fullmatch(r'[\w.-]+/[\w.-]+', product[field]) for field in ('repository','updateRepository')):
        raise ValueError('Invalid release repository')
    if os.environ.get('GITHUB_REPOSITORY', product['repository']) != product['repository']:
        raise ValueError('Workflow repository must match the application source repository')
    return product


class GitHub:
    def __init__(self, repo, token=None):
        self.repo, self.token = repo, token

    def request(self, path, method='GET', payload=None, missing=False, upload=None):
        # All credential-bearing requests stay on the two fixed GitHub API hosts.
        base = 'https://uploads.github.com' if upload else 'https://api.github.com'
        headers = {'Accept': 'application/vnd.github+json', 'User-Agent': 'RADAZ-release-publisher'}
        if self.token:
            headers['Authorization'] = f'Bearer {self.token}'
        data = None
        if upload:
            data = upload.read_bytes()
            headers['Content-Type'] = {'.zip':'application/zip','.exe':'application/octet-stream'}.get(upload.suffix, 'text/plain')
        elif payload is not None:
            data = json.dumps(payload).encode()
            headers['Content-Type'] = 'application/json'
        request = Request(f'{base}/repos/{self.repo}{path}', data=data, method=method, headers=headers)
        try:
            with urlopen(request, timeout=900 if upload else 120) as response:
                return json.load(response)
        except HTTPError as error:
            if missing and error.code == 404:
                # A draft may have no tag yet and be absent from the tag endpoint.
                if self.token and path.startswith('/releases/tags/'):
                    tag = path.rsplit('/', 1)[-1]
                    return next((r for r in self.request('/releases?per_page=100') if r['tag_name'] == tag), None)
                return None
            raise RuntimeError(f'GitHub {method} {path}: HTTP {error.code}') from None


def release_plan(api, version):
    release = api.request(f'/releases/tags/v{version}', missing=True)
    if release and not release['draft']:
        names = {asset['name'] for asset in release['assets'] if asset['state'] == 'uploaded'}
        expected = f'RADAZ-{version}-Windows-preview.zip'
        required = {expected, expected + '.sha256'}
        if version_parts(version) >= (0,2,8):
            for name in (f'RADAZ-{version}-Windows-x64.zip', f'RADAZ-{version}-Setup.exe'):
                required.update((name,name+'.sha256'))
        if release['prerelease'] or not required <= names:
            raise ValueError('Existing published version is incomplete; inspect it before publishing another version')
        return False
    latest = api.request('/releases/latest', missing=True)
    if latest and version_parts(latest['tag_name'].removeprefix('v')) >= version_parts(version):
        raise ValueError('New version must be greater than the latest published version')
    return True


def validate_package(root, version):
    archive = root / f'outputs/releases/RADAZ-{version}-Windows-preview.zip'
    checksum = archive.with_suffix('.zip.sha256')
    digest = hashlib.sha256(archive.read_bytes()).hexdigest()
    if checksum.read_text().split() != [digest, archive.name]:
        raise ValueError('Package SHA-256 mismatch')
    with ZipFile(archive) as package:
        names = package.namelist()
        manifest = json.loads(package.read('SHA256SUMS.json'))
        if len(names) != len(set(names)) or set(names) != set(manifest) | {'SHA256SUMS.json'}:
            raise ValueError('Package manifest must cover every file exactly once')
        for name, expected in manifest.items():
            if hashlib.sha256(package.read(name)).hexdigest() != expected:
                raise ValueError(f'Package manifest mismatch: {name}')
        product = json.loads(package.read('public/product.json'))
        if product['version'] != version or not product.get('licenseRequired'):
            raise ValueError('Package version/license configuration mismatch')
        if json.loads(package.read('package.json'))['version'] != version:
            raise ValueError('Package runtime version mismatch')
    files = [archive,checksum]
    if version_parts(version) >= (0,2,8):
        for name in (f'RADAZ-{version}-Windows-x64.zip',f'RADAZ-{version}-Setup.exe'):
            file=root/'outputs/releases'/name
            sums=file.with_suffix(file.suffix+'.sha256')
            if sums.read_text().split() != [hashlib.sha256(file.read_bytes()).hexdigest(),file.name]:
                raise ValueError('Desktop artifact SHA-256 mismatch')
            files.extend((file,sums))
            if file.suffix == '.zip':
                import sys
                sys.path.insert(0,str(root/'bridge'))
                from radaz_desktop import validate_files
                with ZipFile(file) as package:
                    validate_files(package.namelist(),json.loads(package.read('SHA256SUMS.json')),package.read,version)
                    shell = 'runtime/electron/resources/app/package.json'
                    if shell in package.namelist() and json.loads(package.read(shell))['version'] != version:
                        raise ValueError('Native shell bootstrap version mismatch')
            elif file.read_bytes()[:2] != b'MZ':
                raise ValueError('Setup executable missing')
    for patch in sorted((root/'outputs/releases').glob(f'RADAZ-{version}-from-*-x64.patch.zip')):
        sums=patch.with_suffix('.zip.sha256')
        if sums.read_text().split()!=[hashlib.sha256(patch.read_bytes()).hexdigest(),patch.name]:raise ValueError('Delta checksum mismatch')
        with ZipFile(patch) as delta,ZipFile(root/f'outputs/releases/RADAZ-{version}-Windows-x64.zip') as full:
            meta=json.loads(delta.read('delta.json'));base=meta['baseVersion'];version_parts(base)
            if meta!=dict(schema=1,baseVersion=base,version=version) or patch.name!=f'RADAZ-{version}-from-{base}-x64.patch.zip':raise ValueError('Delta identity mismatch')
            manifest=json.loads(delta.read('SHA256SUMS.json'))
            if manifest!=json.loads(full.read('SHA256SUMS.json')):raise ValueError('Delta target mismatch')
            for name in set(delta.namelist())-{'delta.json','SHA256SUMS.json'}:
                if name not in manifest or hashlib.sha256(delta.read(name)).hexdigest()!=manifest[name]:raise ValueError('Delta file mismatch')
        files.extend((patch,sums))
    return tuple(files)


def publish(api, root, version, commit, release_commit=None):
    if not re.fullmatch(r'[a-f0-9]{40}', commit):
        raise ValueError('An exact source commit is required')
    release_commit = release_commit or commit
    if not re.fullmatch(r'[a-f0-9]{40}', release_commit):
        raise ValueError('An exact release repository commit is required')
    files = validate_package(root, version)
    notes = (root / f'releases/{version}.md').read_text(encoding='utf-8')
    notes += f'\n\nBuild source commit: `{commit}`.\n'
    release = api.request(f'/releases/tags/v{version}', missing=True)
    if release and not release['draft']:
        raise ValueError('Refusing to overwrite a published release')
    if release and release['target_commitish'] != release_commit:
        raise ValueError('Existing draft belongs to a different source commit')
    if not release:
        release = api.request('/releases', 'POST', {
            'tag_name': f'v{version}', 'target_commitish': release_commit, 'name': f'RADAZ {version} — Windows',
            'body': notes, 'draft': True, 'prerelease': False,
        })
    # Static discovery works without the REST quota shared by multiple workstations.
    feed = root / 'outputs/releases/radaz-update.json'
    desktop_name = f'RADAZ-{version}-Windows-x64.zip'
    desktop_file = next((file for file in files if file.name == desktop_name), None)
    if desktop_file:
        update_files=[desktop_file,*[file for file in files if file.name.endswith('.patch.zip')]]
        feed.write_text(json.dumps({'schema':1,'tag_name':f'v{version}','draft':False,'prerelease':False,
            'assets':[{'name':file.name,'state':'uploaded','size':file.stat().st_size,
                'digest':'sha256:'+hashlib.sha256(file.read_bytes()).hexdigest(),
                'browser_download_url':f'https://github.com/{api.repo}/releases/download/v{version}/{file.name}'} for file in update_files]},indent=2),encoding='utf-8')
        files = (*files, feed)
    # Publish only after every portable, offline and installer asset is verified.
    for file in files:
        digest = 'sha256:' + hashlib.sha256(file.read_bytes()).hexdigest()
        existing = next((a for a in release['assets'] if a['name'] == file.name), None)
        if existing:
            if existing.get('digest') != digest or existing['state'] != 'uploaded':
                raise ValueError(f'Draft asset differs from this build: {file.name}')
        else:
            asset = api.request(f'/releases/{release["id"]}/assets?name={quote(file.name)}', 'POST', upload=file)
            if asset.get('digest') != digest or asset['state'] != 'uploaded':
                raise ValueError(f'Uploaded asset verification failed: {file.name}')
    return api.request(f'/releases/{release["id"]}', 'PATCH', {
        'draft': False, 'prerelease': False, 'make_latest': 'true', 'body': notes,
    })


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('command', choices=['plan', 'validate', 'publish'])
    args = parser.parse_args()
    product = config()
    version = product['version']
    api = GitHub(product['updateRepository'], os.environ.get('GH_TOKEN'))
    if args.command == 'plan':
        needed = release_plan(api, version)
        output = f'version={version}\npublish={str(needed).lower()}\n'
        if os.environ.get('GITHUB_OUTPUT'):
            with open(os.environ['GITHUB_OUTPUT'], 'a', encoding='utf-8') as stream:
                stream.write(output)
        print(output.strip())
    elif args.command == 'validate':
        files = validate_package(ROOT, version)
        if not (ROOT / f'releases/{version}.md').is_file():
            raise ValueError('Release notes are missing')
        print(f'Verified package manifest, version and SHA-256: {files[0].name}')
    else:
        if not api.token:
            raise ValueError('The publishing job requires GH_TOKEN')
        release_commit = None
        if product['updateRepository'] != product['repository']:
            metadata = api.request('')
            release_commit = api.request('/commits/' + quote(metadata['default_branch'], safe=''))['sha']
        release = publish(api, ROOT, version, os.environ.get('GITHUB_SHA', ''), release_commit)
        public = GitHub(product['updateRepository'])
        for attempt in range(6):
            latest = public.request('/releases/latest', missing=True)
            if latest and latest['tag_name'] == f'v{version}':
                print(f'Published and visible to RADAZ: {release["html_url"]}')
                return
            time.sleep(3)
        raise RuntimeError('Release published but anonymous latest-release verification did not succeed')


if __name__ == '__main__':
    main()
