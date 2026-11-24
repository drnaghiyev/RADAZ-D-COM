"""Synthetic two-workstation delivery through the real coordinator and archive APIs."""
import hashlib
import json
import secrets
import sys
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'bridge'))
from removable_media_test import write_image
from radaz_archive import Archive
from private_network_authority import Authority, make_server
from private_network_client import NetworkClient, RemoteError, crypto, endpoint


class DeliveryTests(unittest.TestCase):
    def test_online_studies_share_sender_and_relay_capacity(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder)
            client=NetworkClient(Archive(root/'archive',http_only=True),root/'network')
            client._settings=dict(enabled=True,token='synthetic-only',internet=True)
            def prepare(identifier,total):
                out=client.root/'outbox'/identifier
                out.mkdir(parents=True)
                files=[]
                for i in range(total):
                    raw=f'{identifier}/{i}'.encode()
                    sha=hashlib.sha256(raw).hexdigest()
                    (out/sha).write_bytes(raw)
                    files.append(dict(uid='1.2.'+str(i+1),size=len(raw),sha256=sha))
                with client.db() as db:
                    db.execute("INSERT INTO jobs(id,remote,state) VALUES(?,?,'submitted')",(identifier,identifier))
                return dict(id=identifier,transfer=identifier,state='accepted',publicKey='fixture-key',clinic='test',
                            study='2.25.1',device='receiver',files=files,total=total,done=0,received=[],uploaded=[])
            large,small=prepare('large',25),prepare('small',2)
            uploads=[]
            def put(method,path,blob,binary):
                _,delivery,sha=path.split('/')
                uploads.append(delivery)
                (large if delivery=='large' else small)['uploaded'].append(sha)
            with patch.object(client,'rpc',return_value={'sent':[large,small]}),patch.object(client,'request',side_effect=put),patch('private_network_client.crypto',return_value=b'fixture'):
                client.tick()
                self.assertEqual(uploads,['small']*2+['large']*4)
                client.tick();client.tick()
                self.assertEqual(uploads.count('large'),8)
                large['received'].append(large['uploaded'].pop(0));large['done']=1
                client.tick()
                self.assertEqual(uploads.count('large'),9)

    def test_outbox_resume_receipts_and_encrypted_archive_import(self):
        with tempfile.TemporaryDirectory(prefix='radaz-private-network-') as folder:
            root = Path(folder)
            hub = Authority(root/'hub.sqlite')
            server = make_server(hub,'127.0.0.1',0)
            thread = threading.Thread(target=server.serve_forever,daemon=True)
            thread.start()
            self.addCleanup(server.server_close)
            self.addCleanup(server.shutdown)
            url='http://127.0.0.1:'+str(server.server_address[1])
            # Poll deterministically; asynchronous workers run the same methods.
            with patch.object(NetworkClient,'start'):
                def enroll(name, invite):
                    client=NetworkClient(Archive(root/name/'archive',http_only=True),root/name/'network')
                    client.register({'url':url,'invite':invite,'name':name})
                    return client
                admin=enroll('owner',hub.bootstrap('owner','Test network owner')['invite'])
                clinic=admin.rpc('create_clinic',{'name':'Clinical QA','admin':'manager'})['id']
                manager=enroll('manager',admin.rpc('invite',{'clinic':clinic,'user':'manager'})['invite'])
                session=manager.action('settings_set',{'password':secrets.token_urlsafe(24)})['session']
                person={'clinic':clinic,'user':'test-staff','name':'Test Staff','role':'operator','permissions':['send']}
                manager.action('member',dict(person,mode='create'),session)
                with self.assertRaises(RemoteError):
                    manager.action('member',dict(person,mode='create'),session)
                manager.action('member',dict(person,mode='edit',name='Updated Staff'),session)
                self.assertIn('Updated Staff',[m['name'] for m in manager.state({'clinic':clinic})['members']])
                manager.action('remove_member',{'clinic':clinic,'user':'test-staff'},session)
                with patch.object(manager,'rpc',side_effect=RemoteError(404,'Əməliyyat tapılmadı')) as old_server:
                    with self.assertRaisesRegex(ValueError,'0.2.92'):
                        manager.action('member',dict(person,mode='edit'),session)
                    self.assertEqual(old_server.call_args.args[0],'edit_member')
                def add(user,role,perm):
                    manager.rpc('member',{'clinic':clinic,'role':role,'user':user,'permissions':perm})
                    return enroll(user,manager.rpc('invite',{'clinic':clinic,'user':user})['invite'])
                sender=add('sender','operator',['send'])
                receiver=add('reader','radiologist',['receive','download'])
                viewer=add('view-only','viewer',['receive'])
                originals={}
                for i in (1,2):
                    file=root/f'fixture-{i}.dcm'
                    ds=write_image(file,i)
                    raw=file.read_bytes()
                    originals[hashlib.sha256(raw).hexdigest()]=raw
                    sender.archive.store(raw,ds)
                study=str(ds.StudyInstanceUID)
                selection={'clinic':clinic,'study':study,'mode':'one','recipients':['reader'],'requestId':'selected-reader'}
                send_rpc=sender.rpc
                def lose_reply(action,data):
                    send_rpc(action,data)
                    raise ConnectionError('Synthetic dropped server reply')
                with patch.object(sender,'rpc',side_effect=lose_reply):
                    self.assertEqual(sender.send(selection)['state'],'queued')
                submission=sender.send(selection)
                self.assertEqual(submission['state'],'submitted')
                self.assertEqual(sender.send(selection)['remote'],submission['remote'])
                with self.assertRaises(ValueError):
                    sender.send({**selection,'recipients':['view-only']})
                viewjob=sender.send({'clinic':clinic,'study':study,'mode':'direct','recipients':['view-only']})
                # Restart before receipt. The immutable snapshot survives removal of the input.
                sender=NetworkClient(sender.archive,sender.root)
                self.assertIn(submission['id'],[job['id'] for job in sender.state({'clinic':clinic})['queue']])
                self.assertEqual(sender.archive.delete_studies([study])['deleted'],1)
                sender.dispatch()
                inbox=receiver.rpc('state',{})['deliveries']
                self.assertEqual(len(inbox),1)
                self.assertEqual(inbox[0]['state'],'queued')
                received=receiver.rpc('accept',{'delivery':inbox[0]['id']})
                deliveries=sender.rpc('state',{})['sent']
                delivery=next(d for d in deliveries if d['recipient']=='reader')
                sender.transfer(delivery,True)
                self.assertEqual(len(hub.blobs),2)
                for packet in hub.blobs.values():
                    self.assertNotIn(b'RADAZ^MEDIA^TEST',packet[1])
                self.assertFalse(receiver.archive.studies())
                first,second=received['files']
                sha=first['sha256']
                incoming=receiver.rpc('state',{})['deliveries'][0]
                receiver.transfer({**incoming,'files':[first]},False)
                self.assertTrue(receiver.received(study))
                self.assertEqual(len(receiver.archive.instances(study)),1)
                # Resume after coordinator loses temporary relay cache. Only missing SHA is uploaded.
                hub.blobs.clear()
                sender.transfer(next(d for d in sender.rpc('state',{})['sent'] if d['recipient']=='reader'),True)
                self.assertEqual(set(hub.blobs),{(delivery['id'],second['sha256'])})
                receiver=NetworkClient(receiver.archive,receiver.root)
                receiver.transfer(receiver.rpc('state',{})['deliveries'][0],False)
                sent=sender.rpc('state',{})['sent']
                self.assertTrue(any(d['recipient']=='reader' and d['state']=='complete' for d in sent))
                sender.finish_outbox(sent)
                self.assertFalse((sender.root/'outbox'/submission['id']).exists())
                self.assertEqual({hashlib.sha256(p.read_bytes()).hexdigest() for p in
                                  (receiver.archive.root/'instances').rglob('*.dcm')},set(originals))
                with self.assertRaises(RemoteError):
                    admin.rpc('accept',{'delivery':delivery['id']})
                view=viewer.rpc('state',{})['deliveries'][0]
                vd=view['id']
                with self.assertRaises(RemoteError):
                    viewer.rpc('accept',{'delivery':vd})
                viewer.rpc('accept',{'delivery':vd,'viewOnly':True})
                params={'delivery':vd,'sha256':view['files'][0]['sha256'],'frame':0}
                self.assertTrue(viewer.preview(params)['pending'])
                current=next(d for d in sender.rpc('state',{})['sent'] if d['id']==vd)
                sender.transfer(current,True)
                raster=viewer.preview(params)
                self.assertEqual(raster['frames'],1)
                self.assertTrue(raster['image'].startswith('data:image/jpeg;base64,/9j/'))
                viewer.transfer(viewer.rpc('state',{})['deliveries'][0],False)
                self.assertEqual(viewer.archive.studies(),[])
                # The normal device ticks prefer a reachable authenticated peer.
                # An already archived object has the same digest after the second delivery.
                p=root/'fixture-1.dcm'
                ds=write_image(p,1)
                sender.archive.store(p.read_bytes(),ds)
                peerjob=sender.send({'clinic':clinic,'study':study,'mode':'direct','recipients':['reader']})
                receiver.configure({'clinicModes':{clinic:'auto'}})
                try:
                    sender.tick()
                    receiver.tick()
                    sender.tick()
                    self.assertEqual(len(receiver.peer.pending),1)
                    receiver.tick()
                    sender.tick()
                    jobs=sender.state({'clinic':clinic})['queue']
                    self.assertEqual(next(j['state'] for j in jobs if j['id']==peerjob['id']),'complete')
                    self.assertEqual(len(receiver.archive.instances(study)),2)
                finally:
                    receiver.configure({'enabled':False})
                    sender.configure({'enabled':False})
                with self.assertRaises(ValueError):
                    sender.send({'study':study,'clinic':clinic})
                self.assertFalse(NetworkClient(sender.archive,sender.root).settings()['enabled'])

    def test_crypto_rejects_different_context_and_bad_ciphertext(self):
        keys=json.loads(crypto('keygen'))
        raw=b'012345'
        packet=crypto('seal',key=keys['publicKey'],context='clinic/device/instance',data=raw)
        self.assertEqual(crypto('open',key=keys['privateKey'],context='clinic/device/instance',data=packet),raw)
        for context,data in [('foreign',packet),('clinic/device/instance',packet[:-1]+bytes([packet[-1]^1]))]:
            with self.assertRaises(ValueError):
                crypto('open',key=keys['privateKey'],context=context,data=data)
        for bad in ('http://other.test','https://user:pass@clinic.example','https://clinic.example#fragment'):
            with self.assertRaises(ValueError):endpoint(bad)

if __name__=='__main__':unittest.main()
