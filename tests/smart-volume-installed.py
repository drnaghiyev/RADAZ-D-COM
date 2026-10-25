"""Real CPU model smoke test against the separately installed Windows runtime."""
import json, os, secrets, struct, subprocess, sys, time, urllib.request
from pathlib import Path

root=Path(__file__).resolve().parents[1]
module=Path(sys.argv[1]).resolve()
token=secrets.token_hex(32)
child=subprocess.Popen([str(module/'python/python.exe'),'-B',str(root/'bridge/smart_volume_service.py')],cwd=root,
    env={**os.environ,'RADAZ_SMART_VOLUME_ROOT':str(module),'RADAZ_SMART_VOLUME_TOKEN':token,'RADAZ_SMART_VOLUME_PORT':'0'},
    stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,creationflags=0x08000000)
try:
    line=child.stdout.readline().strip()
    assert line.startswith('RADAZ_SMART_PORT:'),line
    base='http://127.0.0.1:'+line.split(':')[1]
    def request(path,data=None):
        return urllib.request.urlopen(urllib.request.Request(base+path,data=data,headers={'x-radaz-local-token':token,'Content-Type':'application/octet-stream'}),timeout=30)
    for _ in range(50):
        try:
            with request('/health') as r: assert json.load(r)['local'] is True
            break
        except OSError: time.sleep(.1)
    else: raise RuntimeError('Service failed to bind')
    width,height,depth=32,32,3
    values=[];labels=[]
    for z in range(depth):
        for y in range(height):
            for x in range(width):
                inside=(x-16)**2+(y-16)**2<49
                values.append(180. if inside else 20.)
                labels.append(int(inside and z==1))
    header=json.dumps({'dimensions':[width,height,depth],'axis':2,'slices':[1],'label':1,'lower':0,'upper':200}).encode()
    body=struct.pack('<I',len(header))+header+struct.pack('<'+'f'*len(values),*values)+bytes(labels)
    with request('/jobs',body) as r: identity=json.load(r)['id']
    deadline=time.monotonic()+300
    while time.monotonic()<deadline:
        with request('/jobs/'+identity) as r: status=json.load(r)
        if status['status']!='running':break
        time.sleep(1)
    assert status['status']=='needs-review',status
    with request('/jobs/'+identity+'/mask') as r: mask=r.read()
    assert len(mask)==len(labels) and any(mask)
    assert mask[width*height:width*height*2]==bytes(labels[width*height:width*height*2])
    print('PASS real installed MedSAM2 CPU inference, authenticated local service, prompt preserved, review required; seconds='+str(status['seconds']))
finally:
    child.terminate()
    try:child.wait(timeout=15)
    except subprocess.TimeoutExpired:child.kill();child.wait()
