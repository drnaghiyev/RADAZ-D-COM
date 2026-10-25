"""Deterministic extraction policy; never used against an installed runtime.

Keep all native codecs, graphics fallbacks, DLLs and license notices. RADAZ's
supported UI languages are AZ/RU/EN; Chromium uses English fallback for AZ.
"""
from pathlib import PurePosixPath


def include_electron_member(name):
    path = PurePosixPath(name)
    if path.is_absolute() or '..' in path.parts or '\\' in name:
        raise ValueError('Unsafe Electron archive member')
    if name == 'resources/default_app.asar':
        return False
    if path.parent.as_posix() == 'locales' and path.suffix == '.pak':
        return path.name in {'az.pak', 'en-US.pak', 'en-GB.pak', 'ru.pak'}
    return True
