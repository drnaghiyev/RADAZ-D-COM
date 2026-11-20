"""Private Network coordinator: tenant metadata in SQLite, encrypted relay in bounded RAM."""
import argparse
import contextlib
import hashlib
import hmac
import ipaddress
import json
from pathlib import Path
import re
import secrets
import sqlite3
import ssl
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlsplit

ROLES = {'admin', 'coordinator', 'radiologist', 'operator', 'viewer'}
RIGHTS = {'send', 'receive', 'download', 'forward', 'manage_schedule', 'view_status'}
ROLE_RIGHTS = {
    'admin': {'manage_schedule','view_status'},
    'coordinator': RIGHTS,
    'radiologist': {'send','receive','download','forward'},
    'operator': {'send','view_status'},
    'viewer': {'receive','download'},
}
MAX_BLOB = 160 * 1024 * 1024
MAX_CACHE = 384 * 1024 * 1024
MAX_JSON = 4 * 1024 * 1024
LEASE = 300

class Fault(Exception):
    def __init__(self, code, message):
        self.code = code
        super().__init__(message)

def require(condition, code=403, message='İcazə yoxdur'):
    if not condition:
        raise Fault(code, message)

def string(value, maximum=128):
    require(isinstance(value,str) and 0 < len(value.strip()) <= maximum and all(ord(c)>=32 for c in value),400,'Yanlış mətn')
    return value.strip()

def identifier(value):
    value=string(value)
    require(re.fullmatch(r'[A-Za-z0-9_.@+\-]+',value),400,'Yanlış identifikator')
    return value

def uid(value):
    require(isinstance(value,str) and len(value)<=64 and re.fullmatch(r'[0-9]+(?:\.[0-9]+)+',value),400,'Yanlış DICOM UID')
    return value

def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()

def new_id():
    return secrets.token_hex(16)

def unpack(row):
    return dict(row) if row else None

SCHEMA = """
CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,name TEXT NOT NULL,super INTEGER NOT NULL DEFAULT 0,active INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS clinics(id TEXT PRIMARY KEY,name TEXT NOT NULL,policy TEXT NOT NULL DEFAULT '{}');
CREATE TABLE IF NOT EXISTS members(clinic TEXT NOT NULL,user TEXT NOT NULL,role TEXT NOT NULL,permissions TEXT NOT NULL,active INTEGER NOT NULL,PRIMARY KEY(clinic,user));
CREATE TABLE IF NOT EXISTS devices(id TEXT PRIMARY KEY,user TEXT NOT NULL,name TEXT NOT NULL,token TEXT UNIQUE NOT NULL,publicKey TEXT NOT NULL,active INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS approvals(clinic TEXT NOT NULL,device TEXT NOT NULL,active INTEGER NOT NULL,PRIMARY KEY(clinic,device));
CREATE TABLE IF NOT EXISTS invites(hash TEXT PRIMARY KEY,user TEXT NOT NULL,clinic TEXT NOT NULL,expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS transfers(id TEXT PRIMARY KEY,clinic TEXT NOT NULL,study TEXT NOT NULL,sender TEXT NOT NULL,source TEXT NOT NULL,requestId TEXT NOT NULL,files TEXT NOT NULL,created INTEGER NOT NULL,UNIQUE(source,requestId));
CREATE TABLE IF NOT EXISTS deliveries(id TEXT PRIMARY KEY,transferId TEXT NOT NULL,recipient TEXT NOT NULL,kind TEXT NOT NULL,state TEXT NOT NULL,device TEXT NOT NULL DEFAULT '',UNIQUE(transferId,recipient));
CREATE TABLE IF NOT EXISTS forwards(transferId TEXT PRIMARY KEY,original TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS receipts(delivery TEXT NOT NULL,sha TEXT NOT NULL,PRIMARY KEY(delivery,sha));
CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY,time INTEGER NOT NULL,clinic TEXT NOT NULL,actor TEXT NOT NULL,action TEXT NOT NULL,detail TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS recipient_list ON deliveries(recipient,transferId);
CREATE INDEX IF NOT EXISTS clinic_transfers ON transfers(clinic,created);
"""

class Authority:
    def __init__(self, path):
        self.path=Path(path)
        self.path.parent.mkdir(parents=True,exist_ok=True)
        self.lock=threading.RLock()
        self.blobs={}
        self.offers={}
        self.preview_frames={}
        self.peer_secret=secrets.token_bytes(32)
        with self.transaction() as db:
            db.execute('PRAGMA journal_mode=WAL')
            db.executescript(SCHEMA)
            if 'viewOnly' not in [r[1] for r in db.execute('PRAGMA table_info(deliveries)')]:
                db.execute('ALTER TABLE deliveries ADD COLUMN viewOnly INTEGER NOT NULL DEFAULT 0')
            db.execute('CREATE TABLE IF NOT EXISTS intent(transferId TEXT PRIMARY KEY, sig TEXT NOT NULL)')

    @contextlib.contextmanager
    def transaction(self):
        with self.lock, contextlib.closing(sqlite3.connect(self.path, timeout=10)) as db, db:
            db.row_factory=sqlite3.Row
            yield db

    def audit(self,db,clinic,actor,action,detail=''):
        db.execute('INSERT INTO audit(time,clinic,actor,action,detail) VALUES(?,?,?,?,?)',(int(time.time()),clinic,actor,action,detail))

    def invite(self,db,user,clinic):
        token=secrets.token_urlsafe(32)
        db.execute('DELETE FROM invites WHERE expires<=? OR (clinic=? AND user=?)',(int(time.time()),clinic,user))
        db.execute('INSERT INTO invites VALUES(?,?,?,?)',(digest(token),user,clinic,int(time.time())+900))
        return {'invite':token}

    def bootstrap(self,user,name):
        with self.transaction() as db:
            require(not db.execute('SELECT 1 FROM users LIMIT 1').fetchone(),409,'Şəbəkə artıq yaradılıb')
            db.execute('INSERT INTO users(id,name,super) VALUES(?,?,1)',(identifier(user),string(name)))
            return self.invite(db,user,'')

    def register(self,db,p):
        secret=string(p.get('invite'))
        inv=db.execute('SELECT i.* FROM invites i JOIN users u ON u.id=i.user WHERE i.hash=? AND i.expires>? AND u.active=1',(digest(secret),int(time.time()))).fetchone()
        require(inv,403,'Dəvət etibarsızdır və ya vaxtı keçib')
        if inv['clinic']:
            require(self.member(db,inv['clinic'],inv['user']))
        key=string(p.get('publicKey','').replace('\r','').replace('\n',' '),8192)
        require(key.startswith('-----BEGIN PUBLIC KEY-----') and key.endswith('-----END PUBLIC KEY-----'),400,'Açar etibarsızdır')
        device=new_id()
        token=secrets.token_urlsafe(48)
        db.execute('INSERT INTO devices(id,user,name,token,publicKey) VALUES(?,?,?,?,?)',(device,inv['user'],string(p.get('name')),digest(token),p['publicKey']))
        if inv['clinic']:
            db.execute('INSERT INTO approvals VALUES(?,?,1)',(inv['clinic'],device))
        db.execute('DELETE FROM invites WHERE hash=?',(inv['hash'],))
        self.audit(db,inv['clinic'],inv['user'],'register',device)
        return {'token':token,'user':inv['user'],'device':device}

    def auth(self,db,token):
        row=db.execute('SELECT u.id,u.name,u.super,d.id AS device FROM devices d JOIN users u ON u.id=d.user WHERE d.token=? AND d.active=1 AND u.active=1',(digest(token),)).fetchone()
        require(row,401,'Cihaz qeydiyyatı tələb olunur')
        return row

    def member(self,db,c,user):
        row=db.execute('SELECT m.user AS id,u.name,m.role,m.permissions,m.active FROM members m JOIN users u ON u.id=m.user WHERE m.clinic=? AND m.user=? AND m.active=1 AND u.active=1 AND u.super=0',(c,user)).fetchone()
        if row:
            return dict(dict(row),permissions=json.loads(row['permissions']))

    def approved(self,db,c,device):
        return db.execute('SELECT 1 FROM approvals a JOIN devices d ON d.id=a.device WHERE a.clinic=? AND a.device=? AND a.active=1 AND d.active=1',(c,device)).fetchone()

    def access(self,db,c,a,perm=None):
        m=self.member(db,c,a['id'])
        require(m and self.approved(db,c,a['device']))
        if perm:
            require(perm in m['permissions'])
        return m

    def device_allowed(self,db,clinic,user,device,perm):
        m=self.member(db,clinic,user)
        return m and perm in m['permissions'] and self.approved(db,clinic,device)

    def rpc(self,action,p,token='',peer_host=None):
        require(isinstance(p,dict),400,'Yanlış sorğu')
        with self.transaction() as db:
            if action=='register':
                return self.register(db,p)
            a=self.auth(db,token)
            c=p.get('clinic','')
            if action=='link_clinic':
                inv=db.execute('SELECT * FROM invites WHERE hash=? AND expires>? AND user=?',(digest(string(p.get('invite'))),int(time.time()),a['id'])).fetchone()
                require(inv and inv['clinic'] and self.member(db,inv['clinic'],a['id']))
                db.execute('INSERT OR REPLACE INTO approvals VALUES(?,?,1)',(inv['clinic'],a['device']))
                db.execute('DELETE FROM invites WHERE hash=?',(inv['hash'],))
                self.audit(db,inv['clinic'],a['id'],'link_clinic',a['device'])
                return {'clinic':inv['clinic']}
            if action=='preview_frame':
                d=self.entry(db,p.get('delivery'))
                self.endpoints(db,d)
                require(d['viewOnly'] and d['state']=='accepted' and a['device']==d['device'])
                sha=p.get('sha256')
                require(any(f['sha256']==sha for f in json.loads(d['files'])),404)
                idx=p.get('frame')
                require(type(idx) is int and 0<=idx<=1000000,400)
                k=(d['id'],sha)
                for previous in [key for key in self.preview_frames if key[0]==d['id'] and key!=k]:
                    self.preview_frames.pop(previous,None)
                    self.blobs.pop(previous,None)
                if self.preview_frames.get(k)!=idx:
                    self.blobs.pop(k,None)
                    self.preview_frames[k]=idx
                return dict(self.describe(db,d),frame=idx)
            if action=='peer_offer':
                require(not a['super'] and peer_host,403)
                port=p.get('port')
                require(type(port) is int and 1024<=port<=65535,400,'Yanlış port')
                require(bool(db.execute('SELECT 1 FROM approvals WHERE device=? AND active=1',(a['device'],)).fetchone()))
                self.offers[a['device']]=(time.monotonic()+60,str(ipaddress.ip_address(peer_host)),port)
                return {'ok':True}
            if action=='peer_check':
                d=self.entry(db,p.get('delivery'))
                self.endpoints(db,d)
                require(not d['viewOnly'] and d['state']=='accepted' and d['device'] and a['device'] in (d['device'],d['source']))
                f=next((f for f in json.loads(d['files']) if f['sha256']==p.get('sha256')),None)
                require(f,404)
                proof=hmac.new(self.peer_secret,'|'.join((d['id'],f['sha256'],d['source'],d['device'])).encode(),hashlib.sha256).hexdigest()
                key=db.execute('SELECT publicKey FROM devices WHERE id=?',(d['device'],)).fetchone()[0]
                offer=self.offers.get(d['device'])
                host,port=('',0) if not offer or offer[0]<=time.monotonic() or a['device']!=d['source'] else offer[1:]
                return {'role':'sender' if a['device']==d['source'] else 'recipient','senderDevice':d['source'],'recipientDevice':d['device'],'recipientKey':key,'peerHost':host,'peerPort':port,'peerProof':proof,'size':f['size']}
            if action=='state':
                return self.state(db,c,a)
            if action=='create_clinic':
                require(a['super'])
                c=new_id()
                admin=identifier(p.get('admin'))
                self.ensure_user(db,admin,string(p.get('adminName') or admin))
                db.execute('INSERT INTO clinics(id,name) VALUES(?,?)',(c,string(p.get('name'))))
                db.execute('INSERT INTO members VALUES(?,?,?,?,1)',(c,admin,'admin',json.dumps(['manage_schedule','view_status'])))
                self.audit(db,c,a['id'],action,admin)
                return {'id':c}
            if action in {'member','device','invite','policy','block_user','block_device'}:
                return self.manage(db,a,c,action,p)
            if action=='send':
                return self.send(db,a,c,p)
            if action=='reassign':
                d=self.entry(db,p.get('delivery'))
                m=self.access(db,d['clinic'],a,'forward')
                require(m['role']=='coordinator' and 'view_status' in m['permissions'])
                target=identifier(p.get('recipient'))
                member=self.member(db,d['clinic'],target)
                require(member and 'receive' in member['permissions'] and target!=a['id'])
                require(self.device_allowed(db,d['clinic'],d['sender'],d['source'],self.sender_right(db,d)))
                require(d['state']=='queued' and not d['device'],409,'Yalnız gözləyən göndəriş yönləndirilir')
                conflict=db.execute('SELECT 1 FROM deliveries WHERE transferId=? AND recipient=?',(d['transferId'],target)).fetchone()
                require(not conflict,409,'Həkim artıq seçilib')
                db.execute('UPDATE deliveries SET recipient=? WHERE id=?',(target,d['id']))
                self.audit(db,d['clinic'],a['id'],action,d['id'])
                return {'id':d['id'],'recipient':target,'state':'queued'}
            if action in {'accept','ack','control','transfer','forward'}:
                return self.delivery_action(db,a,action,p)
            raise Fault(404,'Əməliyyat tapılmadı')

    def ensure_user(self,db,user,name):
        db.execute('INSERT OR IGNORE INTO users(id,name) VALUES(?,?)',(user,name))
        require(not db.execute('SELECT super FROM users WHERE id=?',(user,)).fetchone()[0])

    def manage(self,db,a,c,action,p):
        if action in ('block_user','block_device'):
            require(a['super'])
            active=p.get('active')
            require(type(active) is bool,400)
            if action=='block_user':
                target=identifier(p.get('user'))
                require(target!=a['id'] and db.execute('UPDATE users SET active=? WHERE id=? AND super=0',(active,target)).rowcount)
            else:
                target=identifier(p.get('device'))
                require(target!=a['device'] and db.execute('UPDATE devices SET active=? WHERE id=?',(active,target)).rowcount)
            self.audit(db,'',a['id'],action,target)
            return {'ok':True}
        require(db.execute('SELECT 1 FROM clinics WHERE id=?',(c,)).fetchone(),403)
        m=None if a['super'] else self.access(db,c,a)
        if action=='policy':
            require(m and (m['role']=='admin' or 'manage_schedule' in m['permissions']))
            changes=p.get('policy')
            require(isinstance(changes,dict),400)
            defaults={'timezone':'Asia/Baku','shifts':[],'exceptions':[],'fallback':[],'rules':[],'autoEnabled':False}
            require(changes.keys()<=defaults.keys(),400,'Naməlum qayda sahəsi')
            policy=json.loads(db.execute('SELECT policy FROM clinics WHERE id=?',(c,)).fetchone()[0])
            if m['role']!='admin':
                schedule={'shifts','exceptions'}
                # Older Desktop clients sent a full policy even for a schedule edit.
                require(all(changes[k]==policy.get(k,defaults[k]) for k in changes.keys()-schedule))
                changes={k:v for k,v in changes.items() if k in schedule}
            policy.update(changes)
            require(len(json.dumps(policy))<=262144,400)
            db.execute('UPDATE clinics SET policy=? WHERE id=?',(json.dumps(policy),c))
            target=''
        else:
            require(a['super'] or m['role']=='admin')
            if action=='member':
                role=p.get('role')
                target=identifier(p.get('user'))
                old=db.execute('SELECT role FROM members WHERE clinic=? AND user=?',(c,target)).fetchone()
                require(role in ROLES,400)
                require((a['super'] and role=='admin') or (not a['super'] and role!='admin' and (not old or old[0]!='admin')))
                self.ensure_user(db,target,string(p.get('name') or target))
                perms=p.get('permissions',[])
                require(isinstance(perms,list) and all(isinstance(x,str) and x in ROLE_RIGHTS[role] for x in perms),400,'Yanlış icazələr')
                active=p.get('active',True)
                require(type(active) is bool,400)
                db.execute('INSERT OR REPLACE INTO members VALUES(?,?,?,?,?)',(c,target,role,json.dumps(perms),active))
                if not active:db.execute('DELETE FROM invites WHERE clinic=? AND user=?',(c,target))
            elif action=='invite':
                target=identifier(p.get('user'))
                member=self.member(db,c,target)
                require(member and (not a['super'] or member['role']=='admin'))
                require(a['super'] or member['role']!='admin' or target==a['id'])
                self.audit(db,c,a['id'],action,target)
                return self.invite(db,target,c)
            elif action=='device':
                target=identifier(p.get('device'))
                device=db.execute('SELECT user FROM devices WHERE id=?',(target,)).fetchone()
                require(device and self.member(db,c,device[0]))
                active=p.get('active')
                require(type(active) is bool,400)
                db.execute('INSERT OR REPLACE INTO approvals VALUES(?,?,?)',(c,target,active))
        self.audit(db,c,a['id'],action,target)
        return {'ok':True}

    def members(self,db,c):
        return [dict(dict(r),permissions=json.loads(r['permissions'])) for r in db.execute('SELECT m.user AS id,u.name,m.role,m.permissions,(m.active AND u.active) AS active FROM members m JOIN users u ON u.id=m.user WHERE clinic=? AND u.super=0',(c,))]

    def send(self,db,a,c,p):
        forwarded=p.get('forwardOf')
        self.access(db,c,a,'forward' if forwarded else 'send')
        study=uid(p.get('study'))
        files=p.get('files')
        require(isinstance(files,list) and 0<len(files)<=20000,400,'Fayl siyahısı etibarsızdır')
        seen=set()
        for f in files:
            require(isinstance(f,dict) and set(f)=={'uid','sha256','size'} and type(f['size']) is int and 0<f['size']<=MAX_BLOB and isinstance(f['sha256'],str) and re.fullmatch('[0-9a-f]{64}',f['sha256']) and uid(f['uid']) not in seen,400,'Fayl siyahısı etibarsızdır')
            seen.add(f['uid'])
        if forwarded:
            original=self.entry(db,forwarded)
            require(original['clinic']==c and original['recipient']==a['id'] and original['device']==a['device'] and original['state']=='complete' and original['study']==study)
            allowed={tuple(sorted(f.items())) for f in json.loads(original['files'])}
            require(all(tuple(sorted(f.items())) in allowed for f in files))
        key=string(p.get('requestId'))
        sig=digest(json.dumps(p,sort_keys=True,separators=(',',':')))
        old=db.execute('SELECT * FROM transfers WHERE source=? AND requestId=?',(a['device'],key)).fetchone()
        if old:
            old_intent=db.execute('SELECT sig FROM intent WHERE transferId=?',(old['id'],)).fetchone()
            require(not old_intent or old_intent[0]==sig,409,'Göndəriş açarı başqa seçimə aiddir')
            require(old['clinic']==c and old['study']==study and json.loads(old['files'])==files,409,'Göndəriş açarı artıq istifadə edilib')
            return self.send_result(db,old['id'])
        mode=p.get('mode','direct')
        members=self.members(db,c)
        eligible={m['id'] for m in members if m['active'] and 'receive' in m['permissions']}
        if mode in ('all','duty','auto'):
            from private_network_routing import select_recipients
            policy=json.loads(db.execute('SELECT policy FROM clinics WHERE id=?',(c,)).fetchone()[0])
            work=dict(db.execute("SELECT d.recipient,count(*) FROM deliveries d JOIN transfers t ON t.id=d.transferId WHERE t.clinic=? AND d.state NOT IN ('complete','cancelled') GROUP BY d.recipient",(c,)))
            recipients=select_recipients(mode,p,policy,members,work)
        else:
            require(mode in ('one','many','direct','consult'),400,'Yanlış göndəriş rejimi')
            recipients=p.get('recipients',[])
        require(isinstance(recipients,list) and 0<len(recipients)<=1000 and all(isinstance(x,str) and x in eligible for x in recipients),403,'Uyğun qəbul edən yoxdur')
        recipients=list(dict.fromkeys(recipients))
        require(mode!='consult' or len(recipients)==2,400)
        transfer=new_id()
        db.execute('INSERT INTO transfers VALUES(?,?,?,?,?,?,?,?)',(transfer,c,study,a['id'],a['device'],key,json.dumps(files),int(time.time())))
        db.execute('INSERT INTO intent VALUES(?,?)',(transfer,sig))
        for i,r in enumerate(recipients):
            kind=('primary' if i==0 else 'consultant') if mode=='consult' else 'recipient'
            db.execute("INSERT INTO deliveries(id,transferId,recipient,kind,state) VALUES(?,?,?,?,'queued')",(new_id(),transfer,r,kind))
        if forwarded:db.execute('INSERT INTO forwards VALUES(?,?)',(transfer,forwarded))
        self.audit(db,c,a['id'],'forward' if forwarded else 'send',transfer)
        return self.send_result(db,transfer)

    def send_result(self,db,transfer):
        return {'id':transfer,'deliveries':[self.describe(db,self.entry(db,r[0])) for r in db.execute('SELECT id FROM deliveries WHERE transferId=?',(transfer,))]}

    def entry(self,db,delivery):
        d=db.execute('SELECT d.*,t.clinic,t.study,t.sender,t.source,t.files,t.created,t.requestId FROM deliveries d JOIN transfers t ON t.id=d.transferId WHERE d.id=?',(identifier(delivery),)).fetchone()
        require(d,404,'Göndəriş tapılmadı')
        return d

    def prune(self):
        now=time.monotonic()
        for key in list(self.blobs):
            if self.blobs[key][0]<=now:
                del self.blobs[key]

    def describe(self,db,d):
        self.prune()
        files=json.loads(d['files'])
        done=[r[0] for r in db.execute('SELECT sha FROM receipts WHERE delivery=?',(d['id'],))]
        key=db.execute('SELECT publicKey FROM devices WHERE id=?',(d['device'],)).fetchone() if d['device'] else None
        return {**dict(d),'transfer':d['transferId'],'status':d['state'],'files':files,'previewFrames':{sha:i for (delivery,sha),i in self.preview_frames.items() if delivery==d['id']},'received':done,'uploaded':[sha for delivery,sha in self.blobs if delivery==d['id']],'publicKey':key[0] if key else '', 'done':len(done),'total':len(files)}

    def state(self,db,c,a):
        if a['super']:
            clinics=[dict(r) for r in db.execute('SELECT id,name FROM clinics')]
        else:
            clinics=[dict(r) for r in db.execute('SELECT c.id,c.name FROM clinics c JOIN members m ON m.clinic=c.id JOIN approvals a ON a.clinic=c.id WHERE m.user=? AND a.device=? AND m.active=1 AND a.active=1',(a['id'],a['device']))]
        allowed={r['id'] for r in clinics}
        if c:require(c in allowed)
        out={'user':{'id':a['id'],'name':a['name']},'device':{'id':a['device']},'superAdmin':bool(a['super']),'clinics':clinics,'clinic':c,'members':[],'devices':[],'membership':None,'sent':[],'deliveries':[],'history':[],'policy':{},'statuses':[]}
        if c:
            m=None if a['super'] else self.access(db,c,a)
            out['membership']=m
            members=self.members(db,c)
            if a['super'] or m['role']=='admin' or set(m['permissions']).intersection({'send','forward','manage_schedule'}):
                out['members']=members
            if a['super'] or m['role']=='admin':
                out['devices']=[dict(row) for row in db.execute('SELECT d.id,d.user,d.name,(a.active AND d.active) AS active FROM devices d JOIN approvals a ON a.device=d.id WHERE a.clinic=?',(c,))]
            if m and ('manage_schedule' in m['permissions'] or 'send' in m['permissions']):
                out['policy']=json.loads(db.execute('SELECT policy FROM clinics WHERE id=?',(c,)).fetchone()[0])
            if a['super'] or m['role']=='admin':
                out['history']=[dict(row) for row in db.execute('SELECT time,actor,action,detail FROM audit WHERE clinic=? ORDER BY id DESC LIMIT 250',(c,))]
            if m and 'view_status' in m['permissions']:
                out['statuses']=[dict(row) for row in db.execute('SELECT d.id,d.recipient,d.state,t.sender FROM deliveries d JOIN transfers t ON t.id=d.transferId WHERE t.clinic=? ORDER BY t.created DESC LIMIT 1000',(c,))]
        out['autoEnabled']=bool(out['policy'].get('autoEnabled'))
        if not a['super']:
            for r in db.execute('SELECT d.id,t.clinic,t.source,d.recipient FROM deliveries d JOIN transfers t ON t.id=d.transferId WHERE d.recipient=? OR t.source=? ORDER BY t.created DESC',(a['id'],a['device'])):
                if r['clinic'] not in allowed or c and r['clinic']!=c:continue
                d=self.entry(db,r['id'])
                if r['source']==a['device'] and self.device_allowed(db,r['clinic'],a['id'],a['device'],self.sender_right(db,d)):
                    out['sent'].append(self.describe(db,d))
                if r['recipient']==a['id'] and self.device_allowed(db,r['clinic'],a['id'],a['device'],'receive'):
                    out['deliveries'].append(self.describe(db,d))
        return out

    def sender_right(self,db,d):
        return 'forward' if db.execute('SELECT 1 FROM forwards WHERE transferId=?',(d['transferId'],)).fetchone() else 'send'

    def endpoints(self,db,d,preview=False):
        require(self.device_allowed(db,d['clinic'],d['sender'],d['source'],self.sender_right(db,d)))
        m=self.member(db,d['clinic'],d['recipient'])
        require(m and 'receive' in m['permissions'] and (d['viewOnly'] or preview or 'download' in m['permissions']))
        if d['device']:
            require(self.approved(db,d['clinic'],d['device']))

    def delivery_action(self,db,a,action,p):
        d=self.entry(db,p.get('delivery'))
        self.access(db,d['clinic'],a)
        if action in ('control','transfer'):
            require(a['device']==d['source'])
            command=p.get('action',p.get('command'))
            require(command in ('pause','resume','cancel') and d['state'] not in ('complete','cancelled'),409)
            if command=='resume':
                require(d['state']=='paused',409)
            status={'pause':'paused','resume':'accepted' if d['device'] else 'queued','cancel':'cancelled'}[command]
            if command=='cancel':
                for key in [k for k in self.blobs if k[0]==d['id']]:del self.blobs[key]
        else:
            preview=p.get('viewOnly',False)
            require(type(preview) is bool,400)
            self.endpoints(db,d,preview=action=='accept' and preview)
            require(a['id']==d['recipient'])
            if action=='forward':
                raise Fault(409,'Yönləndirmə təsdiqli lokal nüsxədən hazırlanmalıdır')
            require(d['state'] not in ('paused','cancelled'),409)
            if action=='accept':
                require(not d['device'] or a['device']==d['device'],409,'Başqa cihaz qəbul edib')
                require(not d['device'] or bool(d['viewOnly'])==preview,409,'Qəbul rejimi dəyişdirilə bilməz')
                db.execute('UPDATE deliveries SET device=?,viewOnly=? WHERE id=?',(a['device'],preview,d['id']))
                status='complete' if d['state']=='complete' else 'accepted'
            else:
                require(a['device']==d['device'] and not d['viewOnly'])
                sha=p.get('sha256')
                files=json.loads(d['files'])
                require(any(f['sha256']==sha for f in files),400)
                db.execute('INSERT OR IGNORE INTO receipts VALUES(?,?)',(d['id'],sha))
                self.blobs.pop((d['id'],sha),None)
                done=db.execute('SELECT count(*) FROM receipts WHERE delivery=?',(d['id'],)).fetchone()[0]
                status='complete' if done==len(files) else 'accepted'
        db.execute('UPDATE deliveries SET state=? WHERE id=?',(status,d['id']))
        self.audit(db,d['clinic'],a['id'],action,d['id'])
        return self.describe(db,self.entry(db,d['id']))

    def blob(self,token,delivery,sha,data=None,frame=0):
        with self.transaction() as db:
            a=self.auth(db,token)
            d=self.entry(db,delivery)
            self.endpoints(db,d)
            require(d['state']=='accepted' and d['device'],409,'Qəbul təsdiqlənməyib')
            entry=next((f for f in json.loads(d['files']) if f['sha256']==sha),None)
            require(entry,404)
            self.prune()
            k=(delivery,sha)
            require((not d['viewOnly'] or k in self.preview_frames) and self.preview_frames.get(k,0)==frame,409,'Kadr artıq dəyişib')
            if data is None:
                require(a['device']==d['device'] and a['id']==d['recipient'])
                require(k in self.blobs,404,'Fayl gözlənilir')
                self.audit(db,d['clinic'],a['id'],'preview_read' if d['viewOnly'] else 'relay_read',delivery)
                return self.blobs[k][1]
            require(a['device']==d['source'])
            limit=6*1024*1024 if d['viewOnly'] else entry['size']
            require(0<len(data)<=min(MAX_BLOB+8192,limit+8192),413)
            require(data[:4]==b'PDN1' and len(data)>=34 and (d['viewOnly'] or (len(data)-entry['size'])==34+int.from_bytes(data[4:6],'big')) and 256<=int.from_bytes(data[4:6],'big')<=1024,400,'Şifrəli DICOM paketi tələb olunur')
            if db.execute('SELECT 1 FROM receipts WHERE delivery=? AND sha=?',k).fetchone():
                return {'ok':True}
            used=sum(len(v[1]) for key,v in self.blobs.items() if key!=k)
            require(used+len(data)<=MAX_CACHE,503,'Relay doludur, yenidən cəhd edin')
            self.blobs[k]=(time.monotonic()+LEASE,data)
            self.audit(db,d['clinic'],a['id'],'relay_write',delivery)
            return {'ok':True}

def make_server(authority,host,port,cert=None,key=None):
    if not (cert and key):
        require(ipaddress.ip_address(host).is_loopback and not cert and not key,400,'HTTPS sertifikatı tələb olunur')
    class Handler(BaseHTTPRequestHandler):
        server_version='RADAZNetwork'
        def log_message(self,*args):
            pass
        def respond(self,status,body):
            binary=isinstance(body,bytes)
            if not binary:body=json.dumps(body,ensure_ascii=False).encode()
            self.send_response(status)
            self.send_header('Content-Type','application/octet-stream' if binary else 'application/json; charset=utf-8')
            self.send_header('Cache-Control','no-store')
            self.send_header('X-Content-Type-Options','nosniff')
            self.send_header('Content-Length',str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        def dispatch(self):
            try:
                self.connection.settimeout(30)
                require(not self.headers.get('Origin'),403,'Brauzer sorğusu qəbul edilmir')
                require(not self.headers.get('Transfer-Encoding'),400)
                path=urlsplit(self.path).path
                header=self.headers.get('Authorization','')
                token=header[7:] if header.startswith('Bearer ') else ''
                if self.command=='GET' and path=='/health':
                    return self.respond(200,{'service':'private-network','ok':True})
                length=int(self.headers.get('Content-Length','0'))
                blob=re.fullmatch(r'/v1/blob/([0-9a-f]{32})/([0-9a-f]{64})',path)
                if blob:
                    frame=int(parse_qs(urlsplit(self.path).query).get('frame',['0'])[0])
                    require(self.command in ('GET','PUT'),405)
                    require(0<=length<=MAX_BLOB+8192,413)
                    if self.command=='PUT':
                        # Reject unapproved senders and nonmanifest files before reserving memory.
                        with authority.transaction() as db:
                            a=authority.auth(db,token)
                            d=authority.entry(db,blob[1])
                            authority.endpoints(db,d)
                            require(a['device']==d['source'] and d['state']=='accepted')
                            f=next((i for i in json.loads(d['files']) if i['sha256']==blob[2]),None)
                            limit=6*1024*1024 if d['viewOnly'] else f['size'] if f else 0
                            require(f and 0<length<=limit+8192,413)
                        require(self.server.upload_slots.acquire(blocking=False),503,'Relay məşğuldur')
                        try:
                            data=self.rfile.read(length)
                            require(len(data)==length,400)
                            result=authority.blob(token,*blob.groups(),data=data,frame=frame)
                        finally:
                            self.server.upload_slots.release()
                    else:
                        result=authority.blob(token,*blob.groups(),frame=frame)
                else:
                    name=re.fullmatch(r'/v1/([a-z_]+)',path)
                    require(self.command=='POST' and name,404,'Əməliyyat tapılmadı')
                    require(0<length<=MAX_JSON,413)
                    require(self.headers.get_content_type()=='application/json',415)
                    peer_ip=self.client_address[0]
                    if ipaddress.ip_address(peer_ip).is_loopback and not ipaddress.ip_address(host).is_loopback:
                        peer_ip=None
                    result=authority.rpc(name[1],json.loads(self.rfile.read(length)),token,peer_ip)
                self.respond(200,result)
            except Fault as e:self.respond(e.code,{'error':str(e)})
            except (ValueError,TypeError,KeyError,AttributeError):self.respond(400,{'error':'Sorğu etibarsızdır'})
            except (BrokenPipeError,ConnectionResetError,TimeoutError):pass
            except Exception:self.respond(500,{'error':'Şəbəkə xidməti əməliyyatı tamamlaya bilmədi'})
        do_GET=do_POST=do_PUT=dispatch
    class RelayServer(ThreadingHTTPServer):
        def service_actions(self):
            with authority.lock:
                authority.prune()
    server=RelayServer((host,port),Handler)
    server.upload_slots=threading.BoundedSemaphore(2)
    if cert and key:
        context=ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        context.minimum_version=ssl.TLSVersion.TLSv1_2
        context.load_cert_chain(cert,key)
        server.socket=context.wrap_socket(server.socket,server_side=True)
    return server

if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--db',type=Path,required=True)
    modes=parser.add_subparsers(dest='action',required=True)
    init=modes.add_parser('init')
    init.add_argument('--user',required=True)
    init.add_argument('--name',required=True)
    serve=modes.add_parser('serve')
    serve.add_argument('--bind',default='127.0.0.1')
    serve.add_argument('--port',type=int,default=0)
    serve.add_argument('--cert')
    serve.add_argument('--key')
    args=parser.parse_args()
    authority=Authority(args.db)
    if args.action=='init':
        print(json.dumps(authority.bootstrap(args.user,args.name)))
    else:
        with make_server(authority,args.bind,args.port,args.cert,args.key) as server:
            print(json.dumps({'port':server.server_address[1]}),flush=True)
            server.serve_forever()
