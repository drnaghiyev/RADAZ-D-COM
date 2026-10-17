"""Real Windows locks/processes: retiring a legacy Watch that parented the new one."""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('desktop', ROOT/'bridge/radaz_desktop.py')
desktop = importlib.util.module_from_spec(spec); spec.loader.exec_module(desktop)

@unittest.skipUnless(os.name=='nt', 'Windows process ownership regression')
class WatchProcessOwnership(unittest.TestCase):
    def test_new_watch_retires_ancestor_only_after_launch_lock_is_released(self):
        with tempfile.TemporaryDirectory(prefix='radaz-watch-lock-') as temporary:
            # Hosted Windows runners expose TEMP through RUNNER~1 (8.3).
            # Match the real CLI, which resolves install-root before use.
            root=Path(temporary).resolve()
            old=root/'versions/0.2.37/bridge/radaz_desktop.py'
            new=root/'versions/0.2.40/bridge/radaz_desktop.py'
            old.parent.mkdir(parents=True);new.parent.mkdir(parents=True)
            prelude=f"import sys,time,subprocess,os,json\nfrom pathlib import Path\nsys.path.insert(0,{str(ROOT/'bridge')!r})\nimport radaz_desktop as desktop\nroot=Path({str(root)!r})\n"
            # Import the real controller without shadowing it with this fixture's
            # same-named executable script.
            prelude=prelude.replace('import radaz_desktop as desktop',f"import importlib.util\nspec=importlib.util.spec_from_file_location('controller',{str(ROOT/'bridge/radaz_desktop.py')!r})\ndesktop=importlib.util.module_from_spec(spec);spec.loader.exec_module(desktop)")
            new.write_text(prelude+"\nwith desktop.lock(root,'launch',20):\n desktop.runtime_processes(root,'RetireWatch','0.2.40')\nwith desktop.lock(root,'update'):\n (root/'new-ready.json').write_text(json.dumps({'pid':os.getpid()}))\n while True:time.sleep(1)\n")
            old.write_text(prelude+f"\nwith desktop.lock(root,'update'):\n with desktop.lock(root,'launch'):\n  log=(root/'child.log').open('wb')\n  child=subprocess.Popen([sys.executable,{str(new)!r},'watch','--install-root',str(root)],creationflags=0x08000000,stdout=log,stderr=log)\n  (root/'child.json').write_text(json.dumps({{'pid':child.pid}}))\n  time.sleep(2)\n  assert not (root/'new-ready.json').exists()\n (root/'released').write_text('launch transaction completed')\n while True:time.sleep(1)\n")
            with (root/'test.log').open('wb') as log:
                parent=subprocess.Popen([sys.executable,str(old),'watch','--install-root',str(root)],stdout=log,stderr=log,creationflags=0x08000000)
                child=None
                try:
                    until=time.monotonic()+35
                    while time.monotonic()<until and not (root/'new-ready.json').exists():time.sleep(.2)
                    diagnostic='\n'.join(p.read_text(errors='replace') for p in root.glob('*.log'))
                    self.assertTrue((root/'new-ready.json').exists(),diagnostic)
                    child=json.loads((root/'child.json').read_text())['pid']
                    parent.wait(timeout=5)
                    self.assertNotEqual(parent.returncode,0,'Old Watch should have been retired, not exit naturally')
                    self.assertTrue((root/'released').exists())
                    self.assertEqual(json.loads((root/'new-ready.json').read_text())['pid'],child)
                    with self.assertRaises(desktop.OperationBusy):
                        with desktop.lock(root,'update'):pass
                finally:
                    if child is None and (root/'child.json').exists():child=json.loads((root/'child.json').read_text())['pid']
                    # These exact children were created by this fixture. Never
                    # terminate a whole process tree or a workstation service.
                    if child:subprocess.run(['taskkill.exe','/PID',str(child),'/F'],capture_output=True,creationflags=0x08000000)
                    if parent.poll() is None:parent.terminate()
                    parent.wait(timeout=5)

if __name__=='__main__':unittest.main()
