"""Two genuine RADAZ coordinators bound only to loopback, each using disposable synthetic records."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import threading
import hashlib
import io
import ssl
from unittest.mock import patch

root = Path(__file__).resolve().parents[1]
source, jdk, jar = map(Path, sys.argv[1:4])
sys.dont_write_bytecode = True
sys.path.insert(0, str(source / 'bridge'))
from private_network_authority import Authority, make_server
from private_network_internet import InternetAuthority

def checked(*arguments):
    subprocess.run(arguments, check=True, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)

with tempfile.TemporaryDirectory(dir=root / 'build' / 'qa', prefix='clinic-') as work:
    work = Path(work)
    cert, key = work / 'localhost.pem', work / 'localhost.key'
    openssl = shutil.which('openssl') or (Path(os.environ['ProgramFiles']) / 'Git/usr/bin/openssl.exe')
    checked(openssl, 'req','-x509','-newkey','rsa:2048','-nodes','-keyout',key,'-out',cert,'-days','2',
            '-subj','/CN=localhost','-addext','subjectAltName=IP:127.0.0.1,DNS:localhost')
    trust = work / 'fixture-trust.p12'
    checked(jdk/'bin/keytool','-importcert','-noprompt','-alias','fixture','-file',cert,'-keystore',trust,'-storepass','fixture-only')
    classes = work / 'classes'
    classes.mkdir()
    src = root / 'src/space/radaz/viewer/tablet'
    checked(jdk/'bin/javac','-encoding','UTF-8','-cp',jar,'-d',classes,src/'ClinicNetwork.java',src/'ClinicHttps.java',src/'TabletInbox.java',root/'tests/ClinicProbe.java',root/'tests/InboxFairness.java')
    checked(jdk/'bin/java','-cp',str(classes)+os.pathsep+str(jar),'space.radaz.viewer.tablet.InboxFairness',str(work))
    internet = InternetAuthority(work / 'internet.db')
    private = Authority(work / 'private.db')
    owner = private.bootstrap('synthetic-admin','Synthetic administrator')
    owner_token = private.rpc('register',dict(invite=owner['invite'],name='Synthetic workstation',publicKey='-----BEGIN PUBLIC KEY-----\nfixture\n-----END PUBLIC KEY-----'))['token']
    admin = 'synthetic-doctor'
    first,second = [private.rpc('create_clinic',dict(name=label,admin=admin,adminName='Synthetic clinician'),owner_token)['id'] for label in ['Private Alpha','Private Beta']]
    invitations = [private.rpc('invite',dict(clinic=c,user=admin),owner_token)['invite'] for c in [first,second]]
    with make_server(internet,'127.0.0.1',0,str(cert),str(key)) as public_server, make_server(private,'127.0.0.1',0,str(cert),str(key)) as private_server:
        for server in (public_server,private_server):
            threading.Thread(target=server.serve_forever,daemon=True).start()
        public_url,private_url = ['https://127.0.0.1:'+str(s.server_address[1]) for s in (public_server,private_server)]
        print(json.dumps(dict(privateUrl=private_url,invites=invitations)), flush=True)
        try:
            from private_network_client import NetworkClient
            from radaz_archive import Archive
            import pydicom
            sender=NetworkClient(Archive(work/'archive',http_only=True),work/'network')
            tls=ssl.create_default_context(cafile=str(cert))
            with subprocess.Popen([jdk/'bin/java','-Dfile.encoding=UTF-8','-Djavax.net.ssl.trustStore='+str(trust),'-Djavax.net.ssl.trustStorePassword=fixture-only',
                    '-cp',str(classes)+os.pathsep+str(jar),'space.radaz.viewer.tablet.ClinicProbe',public_url,private_url,str(work)],
                    stdin=subprocess.PIPE,stdout=subprocess.PIPE,text=True,encoding='utf-8') as probe, patch('ssl._create_default_https_context',lambda:tls):
                def java(req):
                    probe.stdin.write(json.dumps(req)+'\n');probe.stdin.flush()
                    return json.loads(probe.stdout.readline())
                for line in sys.stdin:
                    req=json.loads(line)
                    try:
                        if req['action']=='fixture_send':
                            cfg=java(dict(req,client='Clinic Alpha',action='fixture_sender'))['data']
                            cfg.update(url=public_url,internet=True);sender.save(cfg)
                            clinic=next(c['id'] for c in sender.rpc('state',{})['clinics'] if c['name']=='Clinic Alpha')
                            doctor=next(m['id'] for m in sender.rpc('state',{'clinic':clinic})['members'] if m['role']=='radiologist')
                            hashes=[]
                            study='1.2.826.0.1.3680043.10.993.713'
                            for i,path in enumerate(sorted((root/'build/qa/ct').glob('*.dcm')),1):
                                ds=pydicom.dcmread(path);ds.StudyInstanceUID=study;ds.SeriesInstanceUID=study+'.1'
                                ds.SOPInstanceUID=study+'.1.'+str(i);ds.file_meta.MediaStorageSOPInstanceUID=ds.SOPInstanceUID
                                ds.PatientName='RADAZ^DELIVERY^QA'
                                buffer=io.BytesIO();ds.save_as(buffer);raw=buffer.getvalue()
                                sender.archive.store(raw,ds);hashes.append(hashlib.sha256(raw).hexdigest())
                            assert len(hashes)==12
                            selection=dict(requestId='auto-delivery-test',mode='one',clinic=clinic,study=study,recipients=[doctor])
                            job=sender.send(selection);assert job['state']=='submitted'
                            sender.send(selection)
                            reply={'data':dict(hashes=sorted(hashes),study=study)}
                        elif req['action']=='fixture_progress':
                            sent=sender.rpc('state',{})['sent']
                            assert len(sent)==1 and sent[0]['recipient']==doctor
                            reply={'data':dict(state=sent[0]['state'],done=sent[0]['done'],total=sent[0]['total'])}
                        else:reply=java(req)
                    except Exception as exc:
                        reply={'error':str(exc)}
                    print(json.dumps(reply),flush=True)
                if sender.client_path.exists():sender.save({'enabled':False})
                sender.wake.set()
                if sender.worker:sender.worker.join(12)
                probe.stdin.close()
        finally:
            public_server.shutdown()
            private_server.shutdown()
