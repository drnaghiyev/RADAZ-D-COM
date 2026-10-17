"""Windows regression: immutable 0.2.37 -> 0.2.39 using the repaired controller.

An abandoned, suspended 0.2.37 PowerShell startup and a live legacy Watch are
deliberately present. No installed workstation services or patient files change.
"""
import ctypes
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import sys
import tempfile
import time
from urllib.request import Request, urlopen
from zipfile import ZipFile

ROOT = Path(__file__).resolve().parents[1]
PS = Path(os.environ['SystemRoot']) / 'System32/WindowsPowerShell/v1.0/powershell.exe'
spec = importlib.util.spec_from_file_location('desktop', ROOT/'bridge/radaz_desktop.py')
desktop = importlib.util.module_from_spec(spec); spec.loader.exec_module(desktop)
temporary = Path(tempfile.mkdtemp(prefix='radaz-watch-migration-')).resolve()
install = temporary/'installed RADAZ'; install.mkdir()
data = temporary/'archive'; data.mkdir()
def port():
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0)); return sock.getsockname()[1]
web, worker, archive, dicom = port(), port(), port(), port()
env = dict(os.environ, RADAZ_PORT=str(web), RADAZ_WORKER_PORT=str(worker),
           RADAZ_ARCHIVE_PORT=str(archive), RADAZ_ARCHIVE_DATA=str(data),
           HTTPS_PROXY='http://127.0.0.1:9', NO_PROXY='localhost,127.0.0.1', PYTHONUTF8='1')
base = f'http://127.0.0.1:{web}'
def run(args, timeout=180):
    result = subprocess.run(list(map(str, args)), env=env, capture_output=True, creationflags=0x08000000, timeout=timeout)
    assert result.returncode == 0, (result.stdout+result.stderr).decode('utf-8', errors='replace')
    return result.stdout.decode('utf-8', errors='replace')
def get(path):
    with urlopen(base+path, timeout=5) as response: return json.load(response)
def processes():
    result = run([PS, '-NoProfile', '-Command', 'Get-CimInstance Win32_Process | Select-Object ProcessId,Name,ExecutablePath,CommandLine | ConvertTo-Json -Compress'])
    return [p for p in json.loads(result) if str(install) in (p.get('CommandLine') or '')]
def watchers():
    return [p for p in processes() if p['Name']=='python.exe' and 'radaz_desktop.py' in p['CommandLine'] and ' watch ' in p['CommandLine']]
def wait_version(value, timeout=90):
    until = time.monotonic()+timeout
    while time.monotonic()<until:
        try:
            result=get('/radaz-runtime.json')
            if result.get('version')==value and get('/radaz-health.json')['ready']: return result
        except (OSError, ValueError): pass
        time.sleep(.4)
    raise AssertionError('Runtime did not become healthy: '+value)

try:
    expected = {'0.2.37':'d0ddc1c178ffa4b11701be935616ee315f33e8eed301677fc2fc095064b611d8',
                '0.2.39':'724905091a4fc64f39a2948df1f5db411efc2188b78b566003fdf8822a025dab'}
    for version in expected:
        package = ROOT/f'outputs/delta-base/RADAZ-{version}-Windows-x64.zip'
        if not package.exists() and '--download' in sys.argv:
            package.parent.mkdir(parents=True, exist_ok=True)
            with desktop.open_release_download(f'https://github.com/drnaghiyev/RADAZ-D-COM/releases/download/v{version}/{package.name}') as response, package.open('wb') as stream:
                shutil.copyfileobj(response, stream)
        assert hashlib.sha256(package.read_bytes()).hexdigest()==expected[version]
        destination = install/'versions'/version
        with ZipFile(package) as zipped: zipped.extractall(destination)
        desktop.validate_directory(destination, version)
    old = install/'versions/0.2.37'; new = install/'versions/0.2.39'
    (data/'config.json').write_text(json.dumps({'aeTitle':'MIGRATION_TEST','port':dicom,'enabled':True}))
    run([old/'runtime/python/python.exe', old/'bridge/radaz_desktop.py','initialize','--install-root',install,'--no-shortcuts'])
    run([PS,'-NoProfile','-ExecutionPolicy','Bypass','-File',install/'launcher.ps1','-NoBrowser'])
    runtime = wait_version('0.2.37')
    assert runtime['buildId']=='159e45c31ba26a9f3b8beb7afeb4f3db8d99e1e0e6f13a75b37261d0b6afb6fa'
    assert any('versions\\0.2.37\\' in p['CommandLine'] for p in watchers())
    fixture = f"""import radaz_pacs_bridge
from pydicom import Dataset
from pydicom.uid import ExplicitVRLittleEndian, SecondaryCaptureImageStorage
from pynetdicom import AE
ds=Dataset();ds.SOPClassUID=SecondaryCaptureImageStorage;ds.SOPInstanceUID='1.2.826.0.1.3680043.10.543.2401.1'
ds.StudyInstanceUID='1.2.826.0.1.3680043.10.543.2401';ds.SeriesInstanceUID='1.2.826.0.1.3680043.10.543.2401.2'
ds.PatientName='SYNTHETIC^MIGRATION';ds.PatientID='MIGRATION_TEST';ds.Modality='OT';ds.StudyDate='20261018'
ds.Rows=2;ds.Columns=2;ds.SamplesPerPixel=1;ds.PhotometricInterpretation='MONOCHROME2';ds.BitsAllocated=8;ds.BitsStored=8;ds.HighBit=7;ds.PixelRepresentation=0;ds.PixelData=bytes([0,64,128,255])
ds.file_meta=Dataset();ds.file_meta.TransferSyntaxUID=ExplicitVRLittleEndian
a=AE();a.add_requested_context(SecondaryCaptureImageStorage,ExplicitVRLittleEndian)
s=a.associate('127.0.0.1',{dicom},ae_title='MIGRATION_TEST');assert s.is_established;assert s.send_c_store(ds).Status==0;s.release()
"""
    run([old/'runtime/python/python.exe','-c',fixture])
    product = data/'product'; product.mkdir(exist_ok=True)
    (product/'license.json').write_bytes(b'{"synthetic":"opaque-license"}')
    (product/'openai-key.dpapi').write_bytes(b'synthetic-encrypted-credential')
    (data/'user-settings.json').write_bytes(b'{"language":"az","units":"mm"}')
    files = [*(data/'instances').rglob('*.dcm'),data/'config.json',data/'user-settings.json',product/'license.json',product/'openai-key.dpapi']
    assert len(files)==5
    preserved = {p:hashlib.sha256(p.read_bytes()).hexdigest() for p in files}
    # The obsolete PowerShell was created by an earlier recovery attempt but
    # has not yet run. A launch.lock alone cannot revoke an already spawned child.
    stale = subprocess.Popen([str(PS),'-NoProfile','-ExecutionPolicy','Bypass','-File',str(old/'scripts/start-radaz.ps1'),'-NoBrowser'],
        env={**env,'RADAZ_INSTALL_ROOT':str(install),'RADAZ_DESKTOP_TOKEN':(install/'control-token').read_text()},
        creationflags=0x08000004, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    desktop.atomic_json(install/'pending.json', {'version':'0.2.39'})
    if '--reproduce-legacy' in sys.argv:
        run([old/'runtime/python/python.exe',old/'bridge/radaz_desktop.py','launch','--install-root',install,'--no-browser'])
        wait_version('0.2.39')
        assert stale.poll() is None
        # The old transaction has committed but has not revoked its obsolete
        # PowerShell child. Let that real, unmodified 0.2.37 launcher run now.
        resume = ctypes.windll.ntdll.NtResumeProcess
        resume.argtypes = [ctypes.c_void_p]; resume.restype = ctypes.c_long
        assert resume(int(stale._handle))==0
        for _ in range(120):
            try:
                observed=get('/radaz-runtime.json')
                if observed.get('buildId')==runtime['buildId']: break
            except (OSError,ValueError): pass
            time.sleep(.5)
        assert observed['buildId']==runtime['buildId'], observed
        assert json.loads((install/'active.json').read_text())['version']=='0.2.39'
        print('REPRODUCED: active=0.2.39, listener build=0.2.37 after obsolete startup resumed; old Watch accepted it', flush=True)
        # Repair also handles a committed pointer whose listener was replaced.
        run([PS,'-NoProfile','-ExecutionPolicy','Bypass','-File',ROOT/'scripts/repair-desktop-update.ps1','-InstallRoot',install])
    else:
        print('Starting exact 0.2.37 -> 0.2.39 with old Watch and an abandoned startup alive', flush=True)
        run([PS,'-NoProfile','-ExecutionPolicy','Bypass','-File',ROOT/'scripts/repair-desktop-update.ps1','-InstallRoot',install])
    assert stale.poll() is not None, 'Obsolete launcher survived activation'
    runtime = wait_version('0.2.39')
    assert runtime['buildId']=='c54f9af987cbf591e1a03352503d74ff34db76ee5c77b65368fe7970d1ac0727'
    for _ in range(30):
        current = watchers()
        if len(current)==1 and 'versions\\0.2.39\\' in current[0]['CommandLine']: break
        time.sleep(.5)
    assert len(current)==1 and 'versions\\0.2.39\\' in current[0]['CommandLine'], current
    assert get('/local-archive-api/status')['appVersion']=='0.2.39'
    assert json.loads((install/'active.json').read_text())=={'version':'0.2.39','previousVersion':'0.2.37'}
    for file,digest in preserved.items(): assert hashlib.sha256(file.read_bytes()).hexdigest()==digest
    assert len(get('/local-archive-api/studies'))==1
    # A same-build endpoint on a different install is not accepted: the owner
    # verifier must reject the exact healthy port if the requested folder differs.
    rejected = subprocess.run([str(PS),'-NoProfile','-File',str(ROOT/'scripts/desktop-processes.ps1'),'-Action','Owner','-InstallRoot',str(temporary/'unrelated'),'-Version','0.2.39','-Port',str(web)],capture_output=True)
    assert rejected.returncode != 0
    # Immutable manifests still match after activation; no workaround has
    # patched build identifiers or the published package contents.
    for version in expected: desktop.validate_directory(install/'versions'/version,version)
    summary = {'passed':True,'from':'0.2.37','to':'0.2.39','buildId':runtime['buildId'],
               'legacyWatchRunningAtStart':True,'staleLauncherStopped':True,'newWatchVersion':'0.2.39',
               'preservedFiles':len(files),'dicomStudies':1,'port':web,'foreignOwnerRejected':True}
    output=ROOT/'outputs/watch-migration';output.mkdir(exist_ok=True)
    (output/'result.json').write_text(json.dumps(summary,indent=2))
    print(json.dumps(summary), flush=True)
finally:
    output=ROOT/'outputs/watch-migration';output.mkdir(exist_ok=True)
    if (install/'logs').exists(): shutil.copytree(install/'logs',output/'logs',dirs_exist_ok=True)
    literal=str(temporary).replace("'","''")
    subprocess.run([str(PS),'-NoProfile','-Command',f"Get-CimInstance Win32_Process | Where-Object {{ $_.ProcessId -ne $PID -and $_.CommandLine -like '*{literal}*' }} | ForEach-Object {{ Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }}"],capture_output=True)
    time.sleep(1)
    assert temporary.parent==Path(tempfile.gettempdir()).resolve() and temporary.name.startswith('radaz-watch-migration-')
    shutil.rmtree(temporary)
