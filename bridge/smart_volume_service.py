"""Loopback-only MedSAM2 research service. Pixels stay on this computer."""
import sys, os, json, struct, uuid, threading, time, hashlib, asyncio
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'bridge'))
MODULE = Path(os.environ.get('RADAZ_SMART_VOLUME_ROOT', str(ROOT / '.local-research')))
sys.path.insert(0, str(MODULE / 'medsam-deps'))
sys.path.insert(0, str(ROOT / 'vendor/medsam2'))
sys.path.insert(0, str(MODULE / 'MedSAM2'))
import numpy as np
from fastapi import FastAPI, Request, HTTPException
from fastapi.responses import Response
from smart_volume_medsam import MedSAM2Adapter
from smart_volume_prompts import contour_prompts, infer_multiplanar

TOKEN = os.environ.get('RADAZ_SMART_VOLUME_TOKEN')
if not TOKEN:
    token_file = MODULE / 'medsam-token'
    TOKEN = token_file.read_text().strip() if token_file.exists() else None
app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
adapter = None

def load_adapter():
    global adapter
    if adapter is not None: return adapter
    checkpoint = MODULE / 'MedSAM2_latest.pt'
    with checkpoint.open('rb') as stream:
        digest = hashlib.file_digest(stream, 'sha256').hexdigest()
    if digest != 'c92743b99f00d078bf32a3afcc38aaa9faf1c1692dffe3eaa7a90938c1991060':
        raise RuntimeError('MedSAM2 checkpoint integrity check failed')
    import torch
    torch.set_num_threads(min(4, os.cpu_count() or 1))
    adapter = MedSAM2Adapter(checkpoint, 'configs/sam2.1_hiera_t512.yaml', research_use=True,
                            device='cuda' if torch.cuda.is_available() else 'cpu')
    return adapter
jobs = {}
lock = threading.Lock()

@app.middleware('http')
async def authenticate(request: Request, call_next):
    if not TOKEN or request.headers.get('x-radaz-local-token') != TOKEN:
        return Response(status_code=403)
    return await call_next(request)

@app.get('/health')
def health():
    return {'provider':'medsam2', 'checkpoint':'MedSAM2_latest.pt', 'local':True, 'researchOnly':True}

def infer(job, voxels, mask, spec):
    try:
        load_adapter()
        axis = spec['axis']
        # Browser X-fastest flat storage -> numpy Z,Y,X. Track along selected axis.
        data = np.moveaxis(voxels, 2-axis, 0)
        labels = np.moveaxis(mask, 2-axis, 0)
        points = {int(spec['slices'][0]): spec['point']} if 'point' in spec else {}
        prompts = {} if points else {int(i): labels[int(i)] == spec['label'] for i in spec['slices']}
        def progress(value): job['progress'] = min(.99, max(job['progress'], float(value)))
        if spec.get('contours'):
            groups = contour_prompts(spec['contours'], spec['dimensions'])
            prediction = infer_multiplanar(adapter, voxels, groups, spec['lower'], spec['upper'], job['cancel'], progress)
        else:
            output = adapter.infer(data, prompts, lower=spec['lower'], upper=spec['upper'], cancel=job['cancel'], progress=progress, points=points)
            prediction = np.moveaxis(output['mask'], 0, 2-axis)
        if job['cancel'].is_set(): raise InterruptedError('Cancelled')
        job['result'] = np.ascontiguousarray(prediction).tobytes()
        job.update(status='needs-review', progress=1)
    except InterruptedError:
        job.update(status='cancelled')
    except Exception as error:
        job.update(status='error', error=str(error))
    finally:
        job['seconds'] = round(time.monotonic()-job['started'], 2)
        lock.release()

@app.post('/jobs')
async def create(request: Request):
    if not lock.acquire(blocking=False): raise HTTPException(409, 'Model is busy')
    handed_off = False
    try:
        body = await asyncio.wait_for(request.body(), timeout=120)
        if len(body)<4: raise ValueError('Missing header')
        size = struct.unpack('<I',body[:4])[0]
        if not 0<size<=65536: raise ValueError('Invalid header')
        spec = json.loads(body[4:4+size])
        dims = spec['dimensions']
        if len(dims)!=3 or any(type(n)!=int or n<=0 for n in dims): raise ValueError('Invalid dimensions')
        count = int(np.prod(dims))
        if len(body)!=4+size+count*5: raise ValueError('Volume payload size mismatch')
        if spec['axis'] not in (0,1,2) or not 1<=spec['label']<=255: raise ValueError('Invalid prompt')
        slices = spec['slices']
        if not slices or any(type(i)!=int or not 0<=i<dims[spec['axis']] for i in slices): raise ValueError('Invalid slices')
        if spec.get('contours'): contour_prompts(spec['contours'], dims)
        shape = tuple(reversed(dims))
        voxels = np.frombuffer(body, dtype='<f4', count=count, offset=4+size).reshape(shape)
        mask = np.frombuffer(body, dtype='u1', count=count, offset=4+size+4*count).reshape(shape)
        jobs.clear()  # At most one completed result retained in RAM; no patient files.
        identity = str(uuid.uuid4())
        job = dict(status='running', progress=0, cancel=threading.Event(), started=time.monotonic())
        jobs[identity] = job
        threading.Thread(target=infer,args=(job,voxels,mask,spec),daemon=True).start()
        handed_off = True
        return {'id':identity}
    except Exception as error:
        raise HTTPException(400,str(error))
    finally:
        # asyncio cancellation inherits BaseException, not Exception.
        if not handed_off:
            lock.release()

def lookup(identity):
    if identity not in jobs: raise HTTPException(404,'Job expired')
    return jobs[identity]

@app.get('/jobs/{identity}')
def status(identity: str):
    job=lookup(identity)
    return {key:job[key] for key in ('status','progress','error','seconds') if key in job}

@app.delete('/jobs/{identity}')
def cancel(identity: str):
    job=lookup(identity); job['cancel'].set(); job.pop('result',None)
    return {'cancelled':True}

@app.get('/jobs/{identity}/mask')
def result(identity: str):
    job=lookup(identity)
    if job['status']!='needs-review' or 'result' not in job: raise HTTPException(409,'No candidate mask')
    return Response(job['result'],media_type='application/octet-stream')

if __name__=='__main__':
    import uvicorn, socket
    if not TOKEN: raise RuntimeError('Local authentication token required')
    sock = socket.socket(); sock.bind(('127.0.0.1', int(os.environ.get('RADAZ_SMART_VOLUME_PORT','5325')))); sock.listen(128)
    print('RADAZ_SMART_PORT:' + str(sock.getsockname()[1]), flush=True)
    uvicorn.Server(uvicorn.Config(app, access_log=False, log_level='warning')).run(sockets=[sock])
