"""Copy the authorized legacy history. Never deletes source releases or replaces published assets."""
import hashlib
import json
import os
import re
import subprocess
import time
from pathlib import Path
from urllib.parse import quote
from urllib.request import Request, urlopen
from urllib.error import HTTPError

OLD = 'cesur9872-droid/RADAZ-Releases'
NEW = 'drnaghiyev/RADAZ-D-COM'


def api(repo, path, method='GET', payload=None, file=None, missing=False):
    headers = {'Authorization': 'Bearer ' + os.environ['GH_TOKEN'],
               'Accept': 'application/vnd.github+json', 'User-Agent': 'RADAZ-history-migration'}
    body = None
    if file:
        body = file.read_bytes(); headers['Content-Type'] = 'application/octet-stream'
    elif payload is not None:
        body = json.dumps(payload).encode(); headers['Content-Type'] = 'application/json'
    host = 'uploads.github.com' if file else 'api.github.com'
    for attempt in range(5):
        try:
            with urlopen(Request(f'https://{host}/repos/{repo}' + path, data=body, headers=headers, method=method), timeout=600) as response:
                raw = response.read(); return json.loads(raw) if raw else None
        except HTTPError as error:
            if missing and error.code == 404: return None
            if error.code in (403, 429) and attempt < 4:
                time.sleep(max(30, min(120, int(error.headers.get('Retry-After', '60'))))); continue
            raise RuntimeError(f'{method} {repo}{path}: HTTP {error.code}') from None


def digest(file):
    return 'sha256:' + hashlib.sha256(file.read_bytes()).hexdigest()


def source_commit(version):
    for commit in subprocess.check_output(['git', 'rev-list', 'HEAD', '--', 'public/product.json'], text=True).splitlines():
        data = json.loads(subprocess.check_output(['git', 'show', commit + ':public/product.json'], text=True))
        if data.get('version') == version: return commit
    raise RuntimeError('Historical source commit not found: ' + version)


def main():
    if os.environ.get('GITHUB_REPOSITORY') != NEW: raise RuntimeError('Unexpected target repository')
    patch = int(os.environ['RELEASE_PATCH'])
    if not 10 <= patch <= 26: raise ValueError('Only the authorized legacy releases may be copied')
    version = f'0.2.{patch}'; tag = 'v' + version
    source = api(OLD, '/releases/tags/' + tag)
    assert source['tag_name'] == tag and not source['draft'] and not source['prerelease']
    folder = Path('outputs/history') / tag; folder.mkdir(parents=True, exist_ok=True)
    files = []
    for asset in source['assets']:
        name = asset['name']
        assert re.fullmatch(r'[\w.-]+', name) and name != '..'
        expected = f'https://github.com/{OLD}/releases/download/{tag}/{name}'
        assert asset['browser_download_url'] == expected and asset['state'] == 'uploaded'
        target = folder / name
        with urlopen(Request(expected + '?migration=' + str(time.time_ns()), headers={'User-Agent':'RADAZ-history-migration'}), timeout=180) as response, target.open('wb') as stream:
            while chunk := response.read(1024 * 1024): stream.write(chunk)
        assert target.stat().st_size == asset['size'] and digest(target) == asset['digest'], name
        files.append(target)
    for sums in folder.glob('*.sha256'):
        expected, name = sums.read_text().split()
        assert digest(folder/name) == 'sha256:' + expected
    manifest = folder / 'radaz-update.json'
    if manifest.exists():
        data = json.loads(manifest.read_text())
        for asset in data['assets']: asset['browser_download_url'] = asset['browser_download_url'].replace(OLD, NEW)
        if 'html_url' in data: data['html_url'] = data['html_url'].replace(OLD, NEW)
        manifest.write_bytes(json.dumps(data, indent=2).encode('utf-8'))
    release = api(NEW, '/releases/tags/' + tag, missing=True)
    if not release:
        release = next((r for r in api(NEW, '/releases?per_page=100') if r['tag_name'] == tag), None)
    if not release:
        release = api(NEW, '/releases', 'POST', {'tag_name': tag, 'target_commitish': source_commit(version),
            'name': source['name'], 'body': source['body'].replace(OLD, NEW), 'draft': True, 'prerelease': False})
    assets = {a['name']: a for a in release['assets']}
    for file in files:
        asset = assets.get(file.name)
        if asset:
            if asset['state'] == 'uploaded' and asset['digest'] == digest(file) and asset['size'] == file.stat().st_size: continue
            # An interrupted upload can leave a zero-byte starter on our draft.
            if not release['draft'] or asset['state'] == 'uploaded': raise RuntimeError('Existing immutable asset differs: ' + file.name)
            api(NEW, f'/releases/assets/{asset["id"]}', 'DELETE')
        if not release['draft']: raise RuntimeError('Published release is incomplete')
        result = api(NEW, f'/releases/{release["id"]}/assets?name=' + quote(file.name), 'POST', file=file)
        assert result['digest'] == digest(file) and result['size'] == file.stat().st_size
    target = api(NEW, f'/releases/{release["id"]}')
    assets = {a['name']: a for a in target['assets']}
    assert set(assets) == {f.name for f in files}
    for file in files: assert assets[file.name]['digest'] == digest(file) and assets[file.name]['size'] == file.stat().st_size
    if target['draft']: api(NEW, f'/releases/{release["id"]}', 'PATCH', {'draft':False, 'make_latest':'false'})
    print(tag + ': verified and published in ' + NEW)


if __name__ == '__main__': main()
