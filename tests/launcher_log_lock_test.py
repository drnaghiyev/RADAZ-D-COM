"""Windows launcher concurrency regression; uses a temporary synthetic install."""
import ctypes
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest


@unittest.skipUnless(os.name == 'nt', 'Windows launcher')
class LauncherLogTest(unittest.TestCase):
    def test_locked_legacy_log_and_simultaneous_launches(self):
        with tempfile.TemporaryDirectory(prefix='radaz-log-test-') as tmp:
            root = Path(tmp)
            version = root / 'versions/99.0.1'
            (version / 'bridge').mkdir(parents=True)
            (version / 'runtime').mkdir()
            (root / 'logs').mkdir()
            (root / 'active.json').write_text(json.dumps({'version': '99.0.1'}))
            shutil.copyfile(Path(__file__).resolve().parents[1] / 'installer/launcher.ps1', root / 'launcher.ps1')
            (version / 'bridge/radaz_desktop.py').write_text(
                'import os,time\nprint("synthetic launch",os.getpid(),flush=True)\ntime.sleep(1)\n')
            junction = version / 'runtime/python'
            subprocess.run(['powershell.exe', '-NoProfile', '-Command',
                f"New-Item -ItemType Junction -Path '{junction}' -Target '{Path(sys.executable).parent}' | Out-Null"], check=True)
            kernel = ctypes.WinDLL('kernel32', use_last_error=True)
            kernel.CreateFileW.argtypes = [ctypes.c_wchar_p, ctypes.c_ulong, ctypes.c_ulong, ctypes.c_void_p, ctypes.c_ulong, ctypes.c_ulong, ctypes.c_void_p]
            kernel.CreateFileW.restype = ctypes.c_void_p
            kernel.CloseHandle.argtypes = [ctypes.c_void_p]
            handle = kernel.CreateFileW(str(root / 'logs/launcher.log'), 0x40000000, 0, None, 4, 0x80, None)
            self.assertNotEqual(handle, ctypes.c_void_p(-1).value)
            children = []
            try:
                args = ['powershell.exe', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', str(root / 'launcher.ps1'), '-NoBrowser']
                children = [subprocess.Popen(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE, creationflags=0x08000000) for _ in range(3)]
                for child in children:
                    out, err = child.communicate(timeout=25)
                    self.assertEqual(child.returncode, 0, (out, err))
                logs = list((root / 'logs').glob('launcher-*.log'))
                self.assertEqual(len(logs), 3)
                for log in logs:
                    self.assertIn('synthetic launch', log.read_text(encoding='utf-16'))
            finally:
                for child in children:
                    if child.poll() is None:
                        child.kill()
                        child.wait()
                kernel.CloseHandle(handle)
                # Remove only the junction, never traverse the Python installation.
                os.rmdir(junction)


if __name__ == '__main__':
    unittest.main()
