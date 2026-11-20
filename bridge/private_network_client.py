"""Windows workstation for private, resumable RADAZ study delivery."""
import base64
import contextlib
import hashlib
import io
import json
import os
import re
import shutil
import sqlite3
import struct
import subprocess
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from pathlib import Path

import pydicom
from radaz_trial import protect

MAX_DICOM = 512 * 1024 * 1024
MAX_JSON = 24 * 1024 * 1024
RUN_HIDDEN = getattr(subprocess, 'CREATE_NO_WINDOW', 0)


class RemoteError(ValueError):
    def __init__(self, status, message):
        self.status = status
        super().__init__(message)


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def endpoint(url):
    parts = urllib.parse.urlsplit(str(url).strip())
    if not parts.hostname or parts.username or parts.password or parts.query or parts.fragment:
        raise ValueError('Əlaqələndirmə ünvanı düzgün deyil.')
    if parts.scheme != 'https' and not (parts.scheme == 'http' and parts.hostname in ('127.0.0.1', '::1')):
        raise ValueError('İnternet bağlantısı üçün HTTPS tələb olunur.')
    return parts.geturl().rstrip('/')


def crypto(operation, *, key=None, context='', data=b''):
    root = Path(__file__).resolve().parent.parent
    node = root / 'runtime' / 'node' / 'node.exe'
    if not node.is_file():
        node = shutil.which('node')
    if not node:
        raise ValueError('Node runtime tapılmadı.')
    header = json.dumps({'operation':operation, 'key':key, 'context':context}).encode()
    result = subprocess.run([str(node), str(root / 'bridge/private_network_crypto.mjs')],
                            input=header + b'\n' + data, capture_output=True,
                            timeout=180, creationflags=RUN_HIDDEN)
    if result.returncode:
        raise ValueError('DICOM şifrələnməsi və ya bütövlük yoxlaması alınmadı.')
    return result.stdout


def safe_id(value):
    if not isinstance(value, str) or not re.fullmatch(r'[a-zA-Z0-9_-]{1,128}', value):
        raise ValueError('Göndəriş identifikatoru düzgün deyil.')
    return value


class NetworkClient:
    def __init__(self, archive, root=None):
        self.archive = archive
        archive_id = hashlib.sha256(str(archive.root).encode()).hexdigest()[:16]
        self.root = Path(root) if root else Path(os.environ.get('LOCALAPPDATA', Path.home())) / 'RADAZ/PrivateNetwork' / archive_id
        self.lock = threading.RLock()
        self.worker_lock = threading.Lock()
        self.wake = threading.Event()
        self.peer = None
        self.worker = None
        self.last_error = ''
        self.client_path = self.root / 'identity.dpapi'
        self._settings = None

    def settings(self):
        with self.lock:
            if self._settings is None:
                stored = (json.loads(protect(self.client_path.read_bytes(), True))
                          if self.client_path.is_file() else {})
                if not isinstance(stored, dict):
                    raise ValueError('DICOM Network cihaz profili düzgün deyil.')
                self._settings = stored
            return self._settings.copy()

    def save(self, changes):
        with self.lock:
            current = self.settings()
            current.update(changes)
            self.root.mkdir(parents=True, exist_ok=True)
            tmp = self.root / (uuid.uuid4().hex + '.new')
            try:
                tmp.write_bytes(protect(json.dumps(current).encode()))
                os.replace(tmp, self.client_path)
            finally:
                tmp.unlink(missing_ok=True)
            self._settings = current

    def device(self):
        with self.lock:
            cfg = self.settings()
            if not cfg.get('publicKey'):
                keys = json.loads(crypto('keygen'))
                self.save({**keys, 'deviceId': uuid.uuid4().hex})
                cfg = self.settings()
            return {'deviceId':cfg['deviceId'], 'publicKey':cfg['publicKey']}

    @contextlib.contextmanager
    def db(self):
        self.root.mkdir(parents=True, exist_ok=True)
        db = sqlite3.connect(self.root/'queue.sqlite3', timeout=15)
        db.row_factory = sqlite3.Row
        try:
            db.executescript("""
                CREATE TABLE IF NOT EXISTS jobs (
                    id TEXT PRIMARY KEY, clinic TEXT, study TEXT, payload TEXT, state TEXT,
                    remote TEXT DEFAULT '', error TEXT DEFAULT '', created INTEGER);
                CREATE TABLE IF NOT EXISTS imports (study TEXT PRIMARY KEY);
            """)
            with db:
                yield db
        finally:
            db.close()

    def received(self, study):
        with self.db() as db:
            return bool(db.execute('SELECT 1 FROM imports WHERE study=?', (study,)).fetchone())

    def request(self, method, path, data=None, *, url=None, token=None, binary=False):
        cfg = self.settings()
        base = endpoint(url if url is not None else cfg.get('url',''))
        if cfg.get('localCoordinator') and url is None:
            if not cfg.get('enabled'):
                raise ValueError('DICOM Network deaktivdir.')
            from private_network_local import restore
            restore(self)
        auth = cfg.get('token','') if token is None else token
        headers = {'Content-Type':'application/octet-stream' if binary else 'application/json'}
        if auth:
            headers['Authorization'] = 'Bearer ' + auth
        req = urllib.request.Request(base+'/v1/'+path, data=data, method=method, headers=headers)
        try:
            with urllib.request.build_opener(NoRedirect).open(req,timeout=90) as response:
                limit = MAX_DICOM+4096 if binary and method=='GET' else MAX_JSON
                body = response.read(limit+1)
                if len(body)>limit:
                    raise ValueError('Şəbəkə cavabı həddən artıq böyükdür.')
                return body if binary and method=='GET' else json.loads(body or b'{}')
        except urllib.error.HTTPError as error:
            try:
                message = json.loads(error.read(4096)).get('error', 'Sorğu qəbul edilmədi.')
            except (ValueError, AttributeError):
                message = 'Sorğu qəbul edilmədi.'
            raise RemoteError(error.code, str(message)[:512]) from None
        except (TimeoutError, urllib.error.URLError, ConnectionError) as error:
            raise ConnectionError('DICOM Network xidmətinə bağlantı alınmadı.') from error

    def rpc(self, action, payload, **options):
        return self.request('POST',safe_id(action), json.dumps(payload).encode(),**options)

    def configure(self, data):
        with self.lock:
            cfg = self.settings()
            updates = {}
            if 'url' in data:
                url = endpoint(data['url']) if data['url'] else ''
                if cfg.get('token') and url != cfg.get('url'):
                    raise ValueError('Qeydiyyatlı cihazın şəbəkə ünvanı dəyişdirilə bilməz.')
                updates['url'] = url
            if 'enabled' in data:
                if not isinstance(data['enabled'], bool):
                    raise ValueError('Aktivlik dəyəri düzgün deyil.')
                updates['enabled'] = data['enabled']
            if 'syncClinic' in data:
                updates['syncClinic'] = safe_id(data['syncClinic']) if data['syncClinic'] else ''
            if 'clinic' in data:
                updates['clinic'] = safe_id(data['clinic']) if data['clinic'] else ''
            if 'acceptMode' in data:
                if data['acceptMode'] not in ('manual','auto'):
                    raise ValueError('Qəbul rejimi düzgün deyil.')
                updates['acceptMode'] = data['acceptMode']
            if 'clinicModes' in data:
                modes = data['clinicModes']
                if not isinstance(modes,dict) or not all(isinstance(k,str) and v in ('auto','manual') for k,v in modes.items()):
                    raise ValueError('Klinikanın qəbul rejimi düzgün deyil.')
                updates['clinicModes'] = modes.copy()
            self.save(updates)
        if self.peer and not self.settings().get('enabled'):
            self.peer.stop()
            self.peer=None
        if self.settings().get('localCoordinator') and not self.settings().get('enabled'):
            from private_network_local import stop
            stop(self)
        self.start()
        return self.local_state()

    def local_state(self):
        cfg = self.settings()
        public = {k:cfg.get(k) for k in ('url','deviceId','syncClinic','clinic')}
        return {**public,'enabled':bool(cfg.get('enabled')), 'configured':bool(cfg.get('token')),
                'acceptMode':cfg.get('acceptMode','manual'),'clinicModes':cfg.get('clinicModes',{}),
                'online':False,'error':self.last_error}

    def register(self,data):
        with self.lock:
            if self.settings().get('token'):
                raise ValueError('Cihaz artıq şəbəkədə qeydiyyatdan keçib.')
            url = endpoint(data.get('url',''))
            identity = self.device()
            result = self.rpc('register',{'invite':data.get('invite',''),'name':data.get('name',''),
                                         'publicKey':identity['publicKey']},url=url,token='')
            dev = result['device']
            self.save({'enabled':True,'url':url,'deviceId':dev['id'] if isinstance(dev,dict) else dev,
                       'token':result['token']})
        self.start()
        return self.local_state()

    def send(self, data):
        cfg = self.settings()
        if not cfg.get('enabled') or not cfg.get('token'):
            raise ValueError('Əvvəlcə DICOM Network cihazını qoşun.')
        clinic,study = safe_id(data.get('clinic')),data.get('study')
        if not isinstance(study,str) or not re.fullmatch(r'[0-9]+(?:\.[0-9]+)+',study) or len(study)>64:
            raise ValueError('Müayinə UID düzgün deyil.')
        request_id = safe_id(data.get('requestId') or uuid.uuid4().hex)
        ids = data.get('onlyUids')
        if ids is not None:
            ids = set(ids)
        with self.lock, self.db() as db:
            existing = db.execute('SELECT clinic,study,state FROM jobs WHERE id=?',(request_id,)).fetchone()
            if existing:
                if existing['clinic'] != clinic or existing['study'] != study:
                    raise ValueError('Növbə identifikatoru başqa göndərişə aiddir.')
                return {'id':request_id,'state':existing['state']}
            out = self.root/'outbox'/request_id
            out.mkdir(parents=True,exist_ok=True)
            try:
                manifest = []
                if data.get('stageId'):
                    from private_network_dimse import read_stage
                    folder, files = read_stage(self, data['stageId'], clinic, study)
                    sources = [(folder / f['sha256'], f['uid'], f['sha256'], f['size']) for f in files]
                else:
                    with self.archive.connect() as archive_db:
                        rows = archive_db.execute('SELECT sop,digest,size,path FROM instances WHERE study=? ORDER BY sop',(study,))
                        sources = [(self.archive.deletion_path(r['path']), r['sop'], r['digest'], r['size'])
                                   for r in rows if ids is None or r['sop'] in ids]
                for src, uid, digest, size in sources:
                    target = out / digest
                    if not target.exists():
                        try:
                            os.link(src,target)
                        except OSError:
                            shutil.copyfile(src,target)
                    manifest.append({'uid':uid,'sha256':digest,'size':size})
                if not manifest or (ids is not None and ids != {f['uid'] for f in manifest}):
                    raise ValueError('Seçilmiş müayinənin faylları lokal arxivdə yoxdur.')
                payload = {k:data[k] for k in ('mode','recipients','modality','source','aeTitle','device','rule','forwardOf') if k in data}
                payload.update(clinic=clinic,study=study,requestId=request_id,files=manifest)
                db.execute('INSERT INTO jobs(id,clinic,study,payload,state,created) VALUES(?,?,?,?,?,?)',
                           (request_id,clinic,study,json.dumps(payload),'queued',int(time.time())))
            except Exception:
                shutil.rmtree(out,ignore_errors=True)
                raise
        self.wake.set()
        return {'id':request_id,'state':'queued'}

    def state(self, data):
        public = self.local_state()
        remote = {}
        if public['enabled'] and public['configured']:
            try:
                remote = self.rpc('state',{'clinic':data.get('clinic','')})
                public['online'] = True
            except (ConnectionError, ValueError) as error:
                public['error'] = str(error)
        queue = []
        if (self.root/'queue.sqlite3').exists():
            with self.db() as db:
                for row in db.execute('SELECT id,clinic,study,state,error,remote,created FROM jobs ORDER BY created DESC'):
                    if not data.get('clinic') or row['clinic'] == data['clinic']:
                        queue.append(dict(row))
        return {**remote,**public,'clinic':remote.get('clinic',data.get('clinic','')),'queue':queue}

    def action(self, action, data):
        if action=='local_setup':
            from private_network_local import setup
            return setup(self,data)
        if action in ('device','configure','register','state'):
            if action=='device':
                return self.device()
            return getattr(self,action)(data)
        if not self.settings().get('enabled') or not self.settings().get('token'):
            raise ValueError('Private DICOM Network qoşulmayıb.')
        if action=='preview':
            return self.preview(data)
        if action=='send':
            return self.send(data)
        if action=='stage_dimse':
            from private_network_dimse import stage
            return stage(self,data)
        if action=='control' and data.get('job'):
            with self.lock,self.db() as db:
                row=db.execute('SELECT state FROM jobs WHERE id=?',(safe_id(data['job']),)).fetchone()
                if not row or row['state'] not in ('queued','paused','error'):
                    raise ValueError('Göndəriş artıq şəbəkədədir. Çatdırılma əməliyyatından istifadə edin.')
                state={'pause':'paused','resume':'queued','cancel':'cancelled'}.get(data.get('action'))
                if not state:
                    raise ValueError('Növbə əməliyyatı düzgün deyil.')
                db.execute('UPDATE jobs SET state=?,error=? WHERE id=?',(state,'',data['job']))
                if state=='cancelled':
                    self.clean_snapshot(data['job'])
                self.wake.set()
                return {'id':data['job'],'state':state}
        # Only expose coordinator actions, never arbitrary URLs or plaintext blobs.
        if action not in AUTHORITY_ACTIONS:
            raise ValueError('Naməlum DICOM Network əməliyyatı.')
        result = self.rpc('device' if action == 'device-set' else action,data)
        self.wake.set()
        return result

    def clean_snapshot(self,job):
        folder=self.root/'outbox'/safe_id(job)
        if folder.exists():
            shutil.rmtree(folder)

    def dispatch(self):
        with self.db() as db:
            rows=db.execute("SELECT id FROM jobs WHERE state='queued' ORDER BY created").fetchall()
        for row in rows:
            with self.lock,self.db() as db:
                job=db.execute("SELECT * FROM jobs WHERE id=? AND state='queued'",(row['id'],)).fetchone()
                if not job or not self.settings().get('enabled'):
                    continue
                try:
                    result=self.rpc('send',json.loads(job['payload']))
                except RemoteError as error:
                    if error.status in (400,401,403,404,409,422):
                        db.execute("UPDATE jobs SET state='error',error=? WHERE id=?",(str(error),job['id']))
                        continue
                    raise
                db.execute("UPDATE jobs SET state='submitted',remote=?,error='' WHERE id=?",(result['id'],job['id']))

    def transfer(self, item, sending):
        delivery,study=safe_id(item['id']),item['study']
        cfg=self.settings()
        remote_state=item.get('state',item.get('status'))
        if remote_state != 'accepted':
            return
        viewing=bool(item.get('viewOnly'))
        if not sending and viewing:
            return
        if not sending and item.get('device')!=cfg.get('deviceId'):
            return
        received,uploaded=set(item.get('received',[])),set(item.get('uploaded',[]))
        if sending:
            if not item.get('publicKey'):
                return
            with self.db() as db:
                job=db.execute("SELECT id FROM jobs WHERE remote=? AND state='submitted'",(item['transfer'],)).fetchone()
            if not job:
                return
        for f in item['files']:
            sha=f['sha256']
            if not re.fullmatch('[0-9a-f]{64}',sha) or not 0<int(f['size'])<=MAX_DICOM:
                raise ValueError('Göndəriş manifesti düzgün deyil.')
            if sha in received or (sending and sha in uploaded):
                continue
            if viewing and sha not in item.get('previewFrames',{}):
                continue
            if not self.settings().get('enabled'):
                return
            path=f'blob/{delivery}/{sha}'
            aad='|'.join([delivery,item['clinic'],study,f['uid'],sha,item['device']])
            if sending:
                raw=(self.root/'outbox'/safe_id(job['id'])/sha).read_bytes()
                if len(raw)!=f['size'] or hashlib.sha256(raw).hexdigest()!=sha:
                    raise ValueError('Göndərilən fayl bütövlük yoxlamasından keçmədi.')
                if viewing:
                    from private_network_preview import make_preview
                    frame=item['previewFrames'][sha]
                    raw=make_preview(raw,frame)
                    path+=f'?frame={frame}'
                    aad+=f'|preview|{frame}'
                blob=crypto('seal',key=item['publicKey'],context=aad,data=raw)
                if viewing or not self.peer or not self.peer.publish(item,item['device'],sha,blob):
                    self.request('PUT',path,blob,binary=True)
            else:
                blob = self.peer.take(item,sha) if self.peer else None
                if blob is None:
                    if sha not in uploaded:
                        continue
                    blob=self.request('GET',path,binary=True)
                raw=crypto('open',key=cfg['privateKey'],context=aad,data=blob)
                if len(raw)!=f['size'] or hashlib.sha256(raw).hexdigest()!=sha:
                    raise ValueError('Qəbul edilən fayl bütövlük yoxlamasından keçmədi.')
                ds=pydicom.dcmread(io.BytesIO(raw),force=True)
                if str(ds.StudyInstanceUID)!=study or str(ds.SOPInstanceUID)!=f['uid']:
                    raise ValueError('DICOM manifestə uyğun deyil.')
                with self.db() as db:
                    db.execute('INSERT OR IGNORE INTO imports VALUES(?)',(study,))
                self.archive.store(raw,ds)
                self.rpc('ack',{'delivery':delivery,'sha256':sha})

    def preview(self, data):
        delivery=safe_id(data.get('delivery'))
        sha=data.get('sha256','')
        frame=data.get('frame',0)
        if not re.fullmatch(r'[0-9a-f]{64}',sha) or type(frame) is not int or not 0<=frame<1_000_000:
            raise ValueError('Ön baxış parametrləri düzgün deyil.')
        item=self.rpc('preview_frame',{'delivery':delivery,'sha256':sha,'frame':frame})
        if not item.get('viewOnly') or item.get('device')!=self.settings()['deviceId']:
            raise ValueError('Bu cihaz üçün ön baxış icazəsi yoxdur.')
        if sha not in item['uploaded']:
            return {'pending':True}
        file=next(f for f in item['files'] if f['sha256']==sha)
        aad='|'.join([delivery,item['clinic'],item['study'],file['uid'],sha,item['device'],
                      'preview',str(frame)])
        blob=self.request('GET',f'blob/{delivery}/{sha}?frame={frame}',binary=True)
        raw=crypto('open',key=self.settings()['privateKey'],context=aad,data=blob)
        if len(raw)<12 or len(raw)>6*1024*1024 or raw[8:10]!=b'\xff\xd8' or raw[-2:]!=b'\xff\xd9':
            raise ValueError('Ön baxış görüntüsü düzgün deyil.')
        current,total=struct.unpack('>II',raw[:8])
        if current!=frame or total<=current:
            raise ValueError('Ön baxış kadrı uyğun deyil.')
        return {'image':'data:image/jpeg;base64,'+base64.b64encode(raw[8:]).decode(),
                'frame':frame,'frames':total}

    def tick(self):
        cfg=self.settings()
        if not cfg.get('enabled') or not cfg.get('token'):
            return
        faults=[]
        try:
            from private_network_dimse import purge_expired
            from private_network_sync import poll
            purge_expired(self)
            poll(self)
        except Exception as error:
            faults.append(str(error))
        self.dispatch()
        state=self.rpc('state',{})
        if state.get('superAdmin'):
            return
        try:
            from private_network_peer import start
            self.peer = start(self)
            if self.peer:
                self.peer.refresh()
        except Exception as error:
            faults.append(str(error))
        for inbox in state.get('deliveries',[]):
            try:
                mode=cfg.get('clinicModes',{}).get(inbox['clinic'],cfg.get('acceptMode','manual'))
                if mode=='auto' and inbox.get('state') in ('queued','pending','offered','waiting'):
                    self.rpc('accept',{'delivery':inbox['id']})
                else:
                    self.transfer(inbox,False)
            except Exception as error:
                faults.append(str(error))
        sent=state.get('sent',[])
        for delivery in sent:
            try:
                self.transfer(delivery,True)
            except Exception as error:
                faults.append(str(error))
        self.finish_outbox(sent)
        self.last_error='; '.join(dict.fromkeys(faults))[:512]

    def finish_outbox(self, sent):
        groups={}
        for d in sent:
            groups.setdefault(d['transfer'],[]).append(d.get('state',d.get('status')))
        with self.db() as db:
            for job in db.execute("SELECT id,remote FROM jobs WHERE state='submitted'").fetchall():
                states=groups.get(job['remote'],[])
                if states and all(s in ('received','complete','completed','cancelled','declined') for s in states):
                    final='complete' if all(s in ('received','complete','completed') for s in states) else 'closed'
                    self.clean_snapshot(job['id'])
                    db.execute('UPDATE jobs SET state=? WHERE id=?',(final,job['id']))

    def start(self):
        if not self.settings().get('enabled') or not self.settings().get('token'):
            return
        with self.worker_lock:
            if self.worker and self.worker.is_alive():
                self.wake.set()
                return
            def loop():
                while self.settings().get('enabled'):
                    self.wake.clear()
                    try:
                        self.tick()
                    except Exception as error:
                        self.last_error=str(error)[:512]
                    self.wake.wait(8)
            self.worker=threading.Thread(target=loop,name='RADAZ Private DICOM',daemon=True)
            self.worker.start()


AUTHORITY_ACTIONS = {
    'accept', 'control', 'create_clinic', 'member', 'invite', 'policy',
    'device-set', 'block_user', 'block_device', 'link_clinic', 'reassign',
}
