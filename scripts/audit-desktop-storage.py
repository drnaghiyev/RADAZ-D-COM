"""Read-only file/directory inventory. No cleanup, no archive/database mutations."""
import argparse
import collections
import hashlib
import json
import os
from pathlib import Path


def digest(path):
    value = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            value.update(chunk)
    return value.hexdigest()


def audit(root, duplicates=False):
    root = root.resolve(strict=True)
    directories = collections.Counter()
    files, errors, skipped = [], [], []
    identities = set()
    unique_bytes = 0
    by_size = collections.defaultdict(list)
    for folder, dirs, names in os.walk(root, followlinks=False, onerror=lambda error: errors.append(str(error))):
        for name in dirs[:]:
            path = Path(folder, name)
            if path.is_symlink() or getattr(path.lstat(), 'st_file_attributes', 0) & 1024:
                dirs.remove(name); skipped.append(str(path.relative_to(root)))
        for name in names:
            path = Path(folder, name)
            try:
                stat = path.lstat()
                if path.is_symlink() or getattr(stat, 'st_file_attributes', 0) & 1024:
                    skipped.append(str(path.relative_to(root))); continue
                relative = path.relative_to(root)
                files.append({'path': relative.as_posix(), 'bytes': stat.st_size})
                identity = (stat.st_dev, stat.st_ino)
                if identity not in identities:
                    unique_bytes += stat.st_size; identities.add(identity)
                for length in range(1, len(relative.parts)):
                    directories['/'.join(relative.parts[:length])] += stat.st_size
                if duplicates and stat.st_size: by_size[stat.st_size].append(path)
            except OSError as error: errors.append(str(error))
    groups = []
    for size, paths in by_size.items():
        if len(paths) < 2: continue
        hashes = collections.defaultdict(list)
        for path in paths:
            try: hashes[digest(path)].append(path.relative_to(root).as_posix())
            except OSError as error: errors.append(str(error))
        groups.extend({'sha256': key, 'bytesEach': size, 'paths': names}
                      for key, names in hashes.items() if len(names) > 1)
    return {'root': str(root), 'logicalBytes': sum(f['bytes'] for f in files),
            'uniqueFileBytes': unique_bytes, 'files': files,
            'directories': dict(directories), 'duplicates': groups, 'errors': errors,
            'skippedLinks': skipped, 'note': 'Unique file bytes exclude hard-link repeats, not NTFS allocation/compression.'}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('root', type=Path)
    parser.add_argument('--output', required=True, type=Path)
    parser.add_argument('--duplicates', action='store_true')
    args = parser.parse_args()
    report = audit(args.root, args.duplicates)
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps({key: report[key] for key in ('root', 'logicalBytes', 'uniqueFileBytes', 'errors')}))
