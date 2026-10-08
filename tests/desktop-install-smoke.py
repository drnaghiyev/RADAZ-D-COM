"""Exercise the offline package without Node/Python/pnpm on PATH or real patient data."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import tempfile
import time
from zipfile import ZipFile
from urllib.request import Request, urlopen

ROOT=Path(__file__).resolve().parents[1]
STAGE=ROOT/'outputs/desktop-stage'
VERSION=json.loads((STAGE/'public/product.json').read_text())['version']
SYSTEM=Path(os.environ['SystemRoot'])/'System32'
PS=SYSTEM/'WindowsPowerShell/v1.0/powershell.exe'

def port():
    with socket.socket() as sock:
        sock.bind(('127.0.0.1',0));return sock.getsockname()[1]

def run(args):
    result=subprocess.run(list(map(str,args)),env=env,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,creationflags=0x08000000,timeout=150)
    assert result.returncode==0,result.stdout.decode('utf-8',errors='replace')
    return result.stdout.decode('utf-8',errors='replace')

def ps(script,*args): return run([PS,'-NoProfile','-ExecutionPolicy','Bypass','-File',script,*args])
def get(path):
    with urlopen(base+path,timeout=5) as response:return json.load(response)

def stop_test_watchers():
    if os.environ.get('RADAZ_TEST_GATEWAY_UPDATER') != '1':return
    # Force the real HTTP apply path to create its own updater. Only processes
    # in this disposable installation are eligible; never touch the user's app.
    literal=str(install.resolve()).replace("'","''")
    assert install.resolve().parent==temporary
    command=f"Get-CimInstance Win32_Process | Where-Object {{ $_.Name -eq 'python.exe' -and $_.ExecutablePath -and $_.ExecutablePath.StartsWith('{literal}\\') -and $_.CommandLine -match 'radaz_desktop\\.py\"?\\s+watch(?:\\s|$)' }} | ForEach-Object {{ Stop-Process -Id $_.ProcessId -Force }}"
    run([PS,'-NoProfile','-Command',command])
def variant(value, broken=False, broken_asset=False):
    source=install/'versions'/VERSION; destination=install/'versions'/value; destination.mkdir()
    manifest=json.loads((source/'SHA256SUMS.json').read_text())
    for name in manifest:
        file=destination/name;file.parent.mkdir(parents=True,exist_ok=True);os.link(source/name,file)
    for name in ('public/product.json','desktop.json','dist/server/radaz-build.json'):
        file=destination/name;value_json=json.loads(file.read_text());file.unlink()
        if name.endswith('radaz-build.json'):value_json['product']['version']=value;value_json['buildId']=hashlib.sha256(value.encode()).hexdigest()
        else:value_json['version']=value
        file.write_text(json.dumps(value_json))
    if broken:
        file=destination/'scripts/start-release.mjs';file.unlink();file.write_text("throw new Error('Synthetic startup failure');")
    if broken_asset:
        build=json.loads((destination/'dist/server/radaz-build.json').read_text())
        asset=next(url for url in build['assets'] if url.endswith('.js'))
        name='dist/client'+asset
        (destination/name).unlink();del manifest[name]
    manifest={name:hashlib.sha256((destination/name).read_bytes()).hexdigest() for name in manifest}
    (destination/'SHA256SUMS.json').write_text(json.dumps(manifest))
    (install/'pending.json').write_text(json.dumps({'version':value}))

temporary=Path(tempfile.mkdtemp(prefix='radaz-desktop-test-')).resolve()
install=temporary/'installed RADAZ'; data=temporary/'synthetic-archive';data.mkdir()
web,worker,archive,dicom=port(),port(),port(),port()
(data/'config.json').write_text(json.dumps({'aeTitle':'RADAZ_TEST','port':dicom,'enabled':True}))
env=dict(os.environ,PATH=str(SYSTEM)+';'+str(PS.parent),RADAZ_PORT=str(web),RADAZ_WORKER_PORT=str(worker),RADAZ_ARCHIVE_PORT=str(archive),RADAZ_ARCHIVE_DATA=str(data),HTTPS_PROXY='http://127.0.0.1:9',NO_PROXY='localhost,127.0.0.1')
base=f'http://127.0.0.1:{web}'
try:
    baseline=STAGE
    if os.environ.get('RADAZ_TEST_BASE_PACKAGE'):
        baseline=temporary/'baseline-package'
        with ZipFile(os.environ['RADAZ_TEST_BASE_PACKAGE']) as package: package.extractall(baseline)
    base_version=json.loads((baseline/'public/product.json').read_text())['version']
    if os.environ.get('GITHUB_ACTIONS')=='true' or os.environ.get('RADAZ_TEST_SETUP')=='1':
        run([ROOT/f'outputs/releases/RADAZ-{VERSION}-Setup.exe','/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART','/SP-','/NoShortcuts=1','/NoStartup=1',f'/DIR={install}'])
    else:
        run([baseline/'runtime/python/python.exe',baseline/'bridge/radaz_desktop.py','install','--install-root',install,'--no-shortcuts'])
    folder=install/'versions'/base_version
    assert not (folder/'node_modules').exists()
    assert run([folder/'runtime/node/node.exe','--version']).strip()=='v24.21.0'
    run([folder/'runtime/python/python.exe','-c','import ssl,sqlite3;from PIL import Image;import radaz_pacs_bridge'])
    run([folder/'runtime/ffmpeg/ffmpeg.exe','-version'])
    shortcuts=temporary/'shortcuts';shortcuts.mkdir()
    ps(folder/'scripts/desktop-shortcuts.ps1','-InstallRoot',install,'-ShortcutDirectory',shortcuts)
    assert (shortcuts/'RADAZ.lnk').is_file()
    ps(install/'launcher.ps1','-NoBrowser')
    first=get('/radaz-runtime.json');assert first['version']==base_version
    for route in ('/','/archive','/pacs','/mpr','/3d'):
        with urlopen(base+route,timeout=10) as response:assert response.status==200
    assert get('/radaz-installation.json')['managed'] is True
    # The real gateway wakes the bundled updater. The network is deliberately
    # unavailable in this smoke test, so it must report failure, never success.
    (install/'update-state.json').write_text(json.dumps({'state':'current','message':'Synthetic idle state'}))
    with urlopen(Request(base+'/radaz-update',data=b'{}',headers={'Origin':base,'Content-Type':'application/json'}),timeout=5) as response:
        assert response.status==202
    for _ in range(50):
        if get('/radaz-installation.json')['state']=='error':break
        time.sleep(.2)
    assert get('/radaz-installation.json')['state']=='error'
    assert not (install/'update-request.json').exists()
    assert get('/local-archive-api/status')['running'] is True
    assert get('/local-archive-api/status')['databasePath']==str(data/'archive.sqlite3')
    assert get('/local-archive-api/removable/status') == {'sessions': []}
    with urlopen(base+'/dicom-codecs/libjpegturbowasm_decode.wasm',timeout=10) as response:
        assert response.status == 200 and response.read(4) == b'\x00asm'
    run([folder/'runtime/python/python.exe','-c',f"import radaz_pacs_bridge;from pynetdicom import AE;from pynetdicom.sop_class import Verification;a=AE();a.add_requested_context(Verification);s=a.associate('127.0.0.1',{dicom},ae_title='RADAZ_TEST');assert s.is_established;assert s.send_c_echo().Status==0;s.release()"])
    fixture=f"""import radaz_pacs_bridge
from pydicom import Dataset
from pydicom.uid import ExplicitVRLittleEndian, SecondaryCaptureImageStorage
from pynetdicom import AE
ds=Dataset();ds.SOPClassUID=SecondaryCaptureImageStorage;ds.SOPInstanceUID='1.2.826.0.1.3680043.10.543.2401.1'
ds.StudyInstanceUID='1.2.826.0.1.3680043.10.543.2401';ds.SeriesInstanceUID='1.2.826.0.1.3680043.10.543.2401.2'
ds.PatientName='SYNTHETIC^UPDATE';ds.PatientID='UPDATE_TEST';ds.Modality='OT';ds.StudyDate='20261008'
ds.Rows=2;ds.Columns=2;ds.SamplesPerPixel=1;ds.PhotometricInterpretation='MONOCHROME2';ds.BitsAllocated=8;ds.BitsStored=8;ds.HighBit=7;ds.PixelRepresentation=0;ds.PixelData=bytes([0,64,128,255])
ds.file_meta=Dataset();ds.file_meta.TransferSyntaxUID=ExplicitVRLittleEndian
a=AE();a.add_requested_context(SecondaryCaptureImageStorage,ExplicitVRLittleEndian)
s=a.associate('127.0.0.1',{dicom},ae_title='RADAZ_TEST');assert s.is_established;assert s.send_c_store(ds).Status==0;s.release()
"""
    run([folder/'runtime/python/python.exe','-c',fixture])
    assert len(get('/local-archive-api/studies'))==1
    preserved={file:hashlib.sha256(file.read_bytes()).hexdigest() for file in (data/'instances').rglob('*.dcm')}
    assert len(preserved)==1
    preserved[data/'config.json']=hashlib.sha256((data/'config.json').read_bytes()).hexdigest()
    # An opaque synthetic license file stays outside version folders. No real
    # licensing or patient files are read by this isolated test.
    license_file=data/'product/license.json';license_file.parent.mkdir(exist_ok=True)
    license_file.write_text('{"synthetic":"preserve-opaque-license"}')
    preserved[license_file]=hashlib.sha256(license_file.read_bytes()).hexdigest()
    ps(install/'launcher.ps1','-NoBrowser')
    assert get('/radaz-runtime.json')['startedAt']==first['startedAt']
    print('Offline installation, private runtimes, desktop shortcut, five routes, C-ECHO and repeat launch passed',flush=True)
    # Prove that an already-installed older controller can activate the new
    # gateway, whose root stays 503 until all new resources pass health checks.
    if base_version != VERSION:
        package=ROOT/f'outputs/releases/RADAZ-{VERSION}-Windows-x64.zip'
        digest=hashlib.sha256(package.read_bytes()).hexdigest()
        script=f"from pathlib import Path;import radaz_desktop;radaz_desktop.stage_package(Path({str(install)!r}),Path({str(package)!r}),{VERSION!r},{digest!r},{package.stat().st_size})"
        run([folder/'runtime/python/python.exe','-c',script])
        stop_test_watchers()
        with urlopen(Request(base+'/radaz-update',data=json.dumps({'action':'apply','confirmed':True,'version':VERSION}).encode(),headers={'Origin':base,'Content-Type':'application/json'}),timeout=5) as response:assert response.status==202
        for _ in range(180):
            try:
                if get('/radaz-installation.json').get('activationComplete') and get('/radaz-runtime.json')['version']==VERSION:break
            except (OSError,ValueError):pass
            time.sleep(.5)
        assert get('/radaz-runtime.json')['version']==VERSION
        assert get('/radaz-health.json')['ready'] is True
        assert get('/radaz-installation.json')['activeVersion']==VERSION
        folder=install/'versions'/VERSION
        print(f'Actual installed {base_version} controller -> {VERSION} activation passed without Setup',flush=True)
    variant('99.0.1')
    stop_test_watchers()
    with urlopen(Request(base+'/radaz-update',data=json.dumps({'action':'apply','confirmed':True,'version':'99.0.1'}).encode(),headers={'Origin':base,'Content-Type':'application/json'}),timeout=5) as response:
        assert response.status==202
    for _ in range(150):
        try:
            if get('/radaz-runtime.json')['version']=='99.0.1' and json.loads((install/'active.json').read_text())['version']=='99.0.1':break
        except (OSError,ValueError):pass
        time.sleep(.5)
    assert get('/radaz-runtime.json')['version']=='99.0.1'
    assert get('/local-archive-api/status')['appVersion']=='99.0.1'
    assert json.loads((install/'active.json').read_text())['previousVersion']==VERSION
    variant('99.0.2',broken=True);ps(install/'launcher.ps1','-NoBrowser')
    assert get('/radaz-runtime.json')['version']=='99.0.1'
    assert get('/local-archive-api/status')['appVersion']=='99.0.1'
    assert json.loads((install/'active.json').read_text())['version']=='99.0.1'
    assert len(get('/local-archive-api/studies'))==1
    for file,digest in preserved.items():assert hashlib.sha256(file.read_bytes()).hexdigest()==digest,file.name
    detail=json.loads((install/'failed-update.json').read_text())['diagnostic']
    assert detail['phase']=='startup-health'
    assert (install/'logs/update-errors.jsonl').is_file()
    variant('99.0.3',broken_asset=True);ps(install/'launcher.ps1','-NoBrowser')
    assert get('/radaz-runtime.json')['version']=='99.0.1'
    detail=json.loads((install/'failed-update.json').read_text())['diagnostic']
    assert detail['startup']['phase']=='client-files'
    assert 'ENOENT' in detail['startup']['message']
    for file,digest in preserved.items():assert hashlib.sha256(file.read_bytes()).hexdigest()==digest,file.name
    print('Real frontend/backend update and failed-runtime rollback passed; clinical archive stayed separate',flush=True)
finally:
    # Stop only synthetic processes whose executable/script path is inside this temp directory.
    literal=str(temporary).replace("'","''")
    subprocess.run([PS,'-NoProfile','-Command',f"Get-CimInstance Win32_Process | Where-Object {{ $_.ProcessId -ne $PID -and $_.CommandLine -like '*{literal}*' }} | ForEach-Object {{ Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }}"],creationflags=0x08000000,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    time.sleep(1)
    logs=ROOT/'outputs/desktop-test-logs';logs.mkdir(exist_ok=True)
    if (install/'logs').exists():shutil.copytree(install/'logs',logs,dirs_exist_ok=True)
    assert temporary.parent==Path(tempfile.gettempdir()).resolve() and temporary.name.startswith('radaz-desktop-test-')
    shutil.rmtree(temporary)
