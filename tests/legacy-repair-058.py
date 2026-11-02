"""Repair an installed 0.2.47 with the real Setup and verified pending launcher."""
import os,json,socket,subprocess,tempfile,shutil,hashlib,time
from pathlib import Path
from urllib.request import urlopen
ROOT=Path(__file__).resolve().parents[1]
base=ROOT/'outputs/legacy-047-test-payload'
version='0.2.58'
tmp=Path(tempfile.mkdtemp(prefix='radaz-repair-058-')).resolve()
install=tmp/'installed RADAZ';data=tmp/'synthetic-archive';data.mkdir()
ps=Path(os.environ['SystemRoot'])/'System32/WindowsPowerShell/v1.0/powershell.exe'
def port():
 with socket.socket() as s:s.bind(('127.0.0.1',0));return s.getsockname()[1]
web,worker,archive=port(),port(),port()
env={**os.environ,'RADAZ_PORT':str(web),'RADAZ_WORKER_PORT':str(worker),'RADAZ_ARCHIVE_PORT':str(archive),'RADAZ_ARCHIVE_DATA':str(data)}
def run(args,ok=True):
 result=subprocess.run(list(map(str,args)),env=env,capture_output=True,creationflags=0x08000000,timeout=240)
 if ok:assert result.returncode==0,result.stdout.decode(errors='replace')+result.stderr.decode(errors='replace')
 return result
try:
 old=install/'versions/0.2.47';old.mkdir(parents=True)
 manifest=json.loads((base/'SHA256SUMS.json').read_text())
 for name in [*manifest,'SHA256SUMS.json']:
  dest=old/name;dest.parent.mkdir(parents=True,exist_ok=True);os.link(base/name,dest)
 (install/'active.json').write_text(json.dumps({'version':'0.2.47'}))
 for name in ['license.json','report.txt','dicom-marker.dcm','config.json']:(data/name).write_bytes(b'synthetic-preserve-'+name.encode())
 (data/'config.json').write_text(json.dumps({'aeTitle':'RADAZ_TEST','port':port(),'enabled':False}))
 preserved={p:hashlib.sha256(p.read_bytes()).hexdigest() for p in data.iterdir()}
 run([ROOT/f'outputs/releases/RADAZ-Setup-v{version}.exe','/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART','/NoRegistry=1','/NoShortcuts=1','/NoStartup=1',f'/DIR={install}'])
 assert json.loads((install/'active.json').read_text())['version']=='0.2.47'
 assert json.loads((install/'pending.json').read_text())['version']==version
 candidate=install/'versions'/version
 file=candidate/'public/product.json';original=file.read_bytes();file.write_bytes(original+b' ')
 rejected=run([ps,'-NoProfile','-ExecutionPolicy','Bypass','-File',install/'launcher.ps1','-NoBrowser'],False)
 assert rejected.returncode!=0,'Tampered pending files must not execute'
 assert json.loads((install/'active.json').read_text())['version']=='0.2.47'
 file.write_bytes(original)
 print('PASS Setup preserves active 0.2.47; corrupted pending package rejected',flush=True)
 run([ps,'-NoProfile','-ExecutionPolicy','Bypass','-File',install/'launcher.ps1','-NoBrowser'])
 with urlopen(f'http://127.0.0.1:{web}/radaz-runtime.json',timeout=10) as r:runtime=json.load(r)
 with urlopen(f'http://127.0.0.1:{web}/radaz-health.json',timeout=10) as r:health=json.load(r)
 assert runtime['version']==version and health['ready'] and runtime['buildId']==health['buildId']
 assert json.loads((install/'active.json').read_text())['version']==version
 for p,digest in preserved.items():assert hashlib.sha256(p.read_bytes()).hexdigest()==digest
 print('PASS real Windows Setup + root shortcut 0.2.47 -> 0.2.58; exact build healthy; user markers preserved',flush=True)
finally:
 candidate=install/'versions'/version
 if candidate.exists():
  run([candidate/'runtime/python/python.exe',candidate/'bridge/radaz_desktop.py','uninstall','--install-root',install],False)
 logs=ROOT/'outputs/legacy-repair-058-logs'
 if (install/'logs').exists():shutil.copytree(install/'logs',logs,dirs_exist_ok=True)
 # Kill only this isolated installation's remaining processes, never the user's app.
 literal=str(tmp).replace("'","''")
 assert tmp.parent==Path(tempfile.gettempdir()).resolve() and tmp.name.startswith('radaz-repair-058-')
 run([ps,'-NoProfile','-Command',f"Get-CimInstance Win32_Process | Where-Object {{ $_.ProcessId -ne $PID -and $_.CommandLine -like '*{literal}*' }} | ForEach-Object {{ Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }}"],False)
 time.sleep(1);shutil.rmtree(tmp)
