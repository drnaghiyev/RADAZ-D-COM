"""Clinic isolation, delivery authorization, relay expiry, integrity and restart tests."""
import hashlib
import sys
import tempfile
import time
import unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'bridge'))
from private_network_authority import Authority, Fault

class PrivateNetworkAuthorityTest(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.path=Path(self.tmp.name)/'coord.sqlite'
        self.net=Authority(self.path)
        self.key='-----BEGIN PUBLIC KEY-----\ndGVzdA==\n-----END PUBLIC KEY-----'
        self.root=self.register(self.net.bootstrap('super','Super')['invite'])
        self.c=self.call(self.root,'create_clinic',name='Clinic A',admin='alice',adminName='Alice')['id']
        self.admin=self.register(self.call(self.root,'invite',clinic=self.c,user='alice')['invite'])
        self.operator=self.user('sender','operator',['send'])
        self.reader=self.user('reader','radiologist',['receive','download','forward'])
        self.outsider=self.user('other','radiologist',['receive','download'])
        self.file={'uid':'2.25.123.2','sha256':hashlib.sha256(b'x').hexdigest(),'size':1}
        self.payload={'clinic':self.c,'study':'2.25.123','mode':'one','recipients':['reader'],'files':[self.file],'requestId':'job-001'}

    def tearDown(self):self.tmp.cleanup()

    def register(self,invite):return self.net.rpc('register',{'invite':invite,'publicKey':self.key,'name':'Laptop'})['token']
    def call(self,token,operation,**p):return self.net.rpc(operation,p,token)
    def user(self,user,role,permissions):
        self.call(self.admin,'member',clinic=self.c,user=user,name=user,role=role,permissions=permissions)
        return self.register(self.call(self.admin,'invite',clinic=self.c,user=user)['invite'])
    def start(self):
        obj=self.call(self.operator,'send',**self.payload)
        delivery=obj['deliveries'][0]['id']
        self.call(self.reader,'accept',delivery=delivery)
        return delivery

    def test_tenant_admins_and_default_denial(self):
        other=self.call(self.root,'create_clinic',name='Clinic B',admin='bob',adminName='Bob')['id']
        bob=self.register(self.call(self.root,'invite',clinic=other,user='bob')['invite'])
        with self.assertRaises(Fault):self.call(self.operator,'state',clinic=other)
        with self.assertRaises(Fault):self.call(bob,'member',clinic=self.c,user='reader',role='radiologist',permissions=['receive'])
        with self.assertRaises(Fault):self.call(self.root,'send',**self.payload)
        with self.assertRaises(Fault):self.call(self.admin,'send',**self.payload)
        with self.assertRaises(Fault):self.call(self.admin,'member',clinic=self.c,user='second_admin',role='admin',permissions=[])
        self.start()
        self.assertFalse(self.call(self.outsider,'state',clinic=self.c)['deliveries'])
        self.assertFalse(self.call(self.root,'state',clinic=self.c)['deliveries'])
        self.assertFalse(self.call(self.admin,'state',clinic=self.c)['deliveries'])
        self.assertTrue(self.call(self.admin,'state',clinic=self.c)['statuses'])
        self.assertTrue(self.call(self.root,'state',clinic=self.c)['history'])
        token=self.call(self.root,'invite',clinic=other,user='bob')['invite']
        self.register(token)
        with self.assertRaises(Fault):self.register(token)

    def test_strong_device_binding_and_revocation(self):
        d=self.start()
        second=self.register(self.call(self.admin,'invite',clinic=self.c,user='reader')['invite'])
        with self.assertRaises(Fault):self.call(second,'accept',delivery=d)
        with self.assertRaises(Fault):self.call(second,'ack',delivery=d,sha256=self.file['sha256'])
        with self.assertRaises(Fault):self.call(self.outsider,'accept',delivery=d)
        with self.assertRaises(Fault):self.call(self.reader,'control',delivery=d,action='pause')
        self.call(self.admin,'device',clinic=self.c,device=self.call(self.reader,'state')['device']['id'],active=False)
        with self.assertRaises(Fault):self.call(self.reader,'ack',delivery=d,sha256=self.file['sha256'])
        self.assertFalse(self.call(self.reader,'state')['deliveries'])
        with self.assertRaises(Fault):self.net.blob(self.operator,d,self.file['sha256'],b'fake')

    def test_delegated_schedule_preserves_admin_routing_policy(self):
        coord=self.user('coordinator','coordinator',['manage_schedule'])
        rules=[{'enabled':True,'recipients':['reader']}]
        self.call(self.admin,'policy',clinic=self.c,policy={'autoEnabled':True,'rules':rules,'fallback':['other']})
        self.call(coord,'policy',clinic=self.c,policy={'shifts':[{'recipients':['reader']}]})
        for change in ({'rules':[]},{'autoEnabled':False},{'fallback':[]},{'timezone':'UTC'}):
            with self.assertRaises(Fault):
                self.call(coord,'policy',clinic=self.c,policy=change)
        state=self.call(coord,'state',clinic=self.c)
        self.assertIn('reader',[m['id'] for m in state['members']])
        self.assertEqual(state['policy']['rules'],rules)
        self.assertEqual(state['policy']['shifts'],[{'recipients':['reader']}])

    def test_automatic_recipients_only_include_radiologists(self):
        self.user('viewer','viewer',['receive'])
        self.user('coord','coordinator',['receive','download'])
        people=['reader','viewer','coord']
        self.call(self.admin,'policy',clinic=self.c,policy={'autoEnabled':True,
                  'shifts':[{'recipients':people}],'rules':[{'enabled':True,'recipients':people}]})
        for mode,expected in [('all',{'other','reader'}),('duty',{'reader'}),('auto',{'reader'}),('one',{'viewer'})]:
            sent=self.call(self.operator,'send',**dict(self.payload,mode=mode,recipients=['viewer'],requestId=mode))
            self.assertEqual({row['recipient'] for row in sent['deliveries']},expected)

    def test_restart_resume_offline_idempotence_and_forward(self):
        d=self.start()
        self.assertEqual(self.call(self.operator,'send',**self.payload)['deliveries'][0]['id'],d)
        sha=self.file['sha256']
        ciphertext=b'PDN1'+(256).to_bytes(2,'big')+bytes(256+28)+b'x'
        self.net.blob(self.operator,d,sha,ciphertext)
        self.assertEqual(self.net.blob(self.reader,d,sha),ciphertext)
        with self.assertRaises(Fault):self.net.blob(self.outsider,d,sha)
        self.call(self.operator,'control',delivery=d,action='pause')
        with self.assertRaises(Fault):self.net.blob(self.reader,d,sha)
        self.call(self.operator,'control',delivery=d,action='resume')
        self.net=Authority(self.path)
        self.assertFalse(self.call(self.reader,'state')['deliveries'][0]['uploaded'])
        self.assertEqual(self.call(self.reader,'state')['deliveries'][0]['state'],'accepted')
        self.net.blob(self.operator,d,sha,ciphertext)
        self.net.blobs[(d,sha)]=(time.monotonic()-1,ciphertext)
        with self.assertRaises(Fault):self.net.blob(self.reader,d,sha)
        self.net.blob(self.operator,d,sha,ciphertext)
        self.assertEqual(self.call(self.reader,'ack',delivery=d,sha256=sha)['state'],'complete')
        self.assertEqual(self.call(self.reader,'ack',delivery=d,sha256=sha)['done'],1)
        self.assertFalse(self.net.blobs)
        forward=self.call(self.reader,'send',**dict(self.payload,forwardOf=d,requestId='job-002',recipients=['other']))
        self.call(self.outsider,'accept',delivery=forward['deliveries'][0]['id'])
        self.assertEqual(self.call(self.reader,'state')['sent'][0]['transfer'],forward['id'])
        with self.assertRaises(Fault):self.call(self.reader,'send',**dict(self.payload,requestId='job-003',recipients=['other']))

    def test_coordinator_reassignment_does_not_grant_pixel_access(self):
        coord=self.user('coordinator','coordinator',['forward','view_status','receive','download'])
        delivery=self.call(self.operator,'send',**self.payload)['deliveries'][0]['id']
        with self.assertRaises(Fault):self.call(coord,'reassign',delivery=delivery,recipient='coordinator')
        with self.assertRaises(Fault):self.call(self.admin,'reassign',delivery=delivery,recipient='other')
        self.call(coord,'reassign',delivery=delivery,recipient='other')
        self.assertFalse(self.call(coord,'state')['deliveries'])
        with self.assertRaises(Fault):self.call(self.reader,'accept',delivery=delivery)
        self.call(self.outsider,'accept',delivery=delivery)
        with self.assertRaises(Fault):self.call(coord,'reassign',delivery=delivery,recipient='reader')

    def test_direct_authorization_target_and_object_binding(self):
        d=self.start()
        sha=self.file['sha256']
        self.net.rpc('peer_offer',{'port':10244,'host':'10.1.2.3'},self.reader,peer_host='127.0.0.1')
        sender=self.call(self.operator,'peer_check',delivery=d,sha256=sha)
        receiver=self.call(self.reader,'peer_check',delivery=d,sha256=sha)
        self.assertEqual((sender['peerHost'],sender['peerPort']),('127.0.0.1',10244))
        self.assertEqual(sender['peerProof'],receiver['peerProof'])
        self.assertEqual(sender['size'],self.file['size'])
        with self.assertRaises(Fault):self.call(self.outsider,'peer_check',delivery=d,sha256=sha)
        with self.assertRaises(Fault):self.call(self.reader,'peer_check',delivery=d,sha256='1'*64)
        self.call(self.operator,'control',delivery=d,action='cancel')
        with self.assertRaises(Fault):self.call(self.reader,'peer_check',delivery=d,sha256=sha)

    def test_multiclinic_link_does_not_confer_admin_or_receive_elsewhere(self):
        c=self.call(self.root,'create_clinic',name='Clinic B',admin='bob',adminName='Bob')['id']
        b=self.register(self.call(self.root,'invite',clinic=c,user='bob')['invite'])
        self.call(b,'member',clinic=c,user='reader',role='operator',permissions=['send'])
        inv=self.call(b,'invite',clinic=c,user='reader')['invite']
        self.call(self.reader,'link_clinic',invite=inv)
        self.assertEqual({x['id'] for x in self.call(self.reader,'state')['clinics']},{self.c,c})
        with self.assertRaises(Fault):self.call(self.reader,'link_clinic',invite=inv)
        with self.assertRaises(Fault):self.call(self.reader,'send',**dict(self.payload,clinic=c))
        self.assertEqual(self.call(self.reader,'state',clinic=c)['membership']['permissions'],['send'])

    def test_view_permission_never_authorizes_offline_import_and_frames_are_exclusive(self):
        token=self.user('viewer','viewer',['receive'])
        obj=self.call(self.operator,'send',**dict(self.payload,recipients=['viewer']))
        delivery=obj['deliveries'][0]['id']
        sha=self.file['sha256']
        with self.assertRaises(Fault):self.call(token,'accept',delivery=delivery)
        self.call(token,'accept',delivery=delivery,viewOnly=True)
        with self.assertRaises(Fault):self.call(token,'accept',delivery=delivery)
        with self.assertRaises(Fault):self.call(token,'peer_check',delivery=delivery,sha256=sha)
        self.call(token,'preview_frame',delivery=delivery,sha256=sha,frame=0)
        self.assertEqual(self.call(self.operator,'state')['sent'][0]['previewFrames'],{sha:0})
        preview=b'PDN1'+(256).to_bytes(2,'big')+bytes(256+28)+b'jpeg-frame'
        self.net.blob(self.operator,delivery,sha,preview,frame=0)
        self.assertEqual(self.net.blob(token,delivery,sha),preview)
        self.call(token,'preview_frame',delivery=delivery,sha256=sha,frame=1)
        with self.assertRaises(Fault):self.net.blob(token,delivery,sha)
        with self.assertRaises(Fault):self.net.blob(self.operator,delivery,sha,preview,frame=0)
        self.net.blob(self.operator,delivery,sha,preview,frame=1)
        with self.assertRaises(Fault):self.call(token,'ack',delivery=delivery,sha256=sha)

    def test_local_coordinator_is_opt_in_and_port_cannot_be_replaced(self):
        import threading
        import socket
        import urllib.request
        import json
        from private_network_local import restore,setup,stop
        class Client:
            lock=threading.RLock()
            def __init__(client):
                client.root=Path(self.tmp.name)/'local'
                client.cfg={}
            def device(client):return {'publicKey':self.key}
            def save(client,p):client.cfg.update(p)
            def settings(client):return dict(client.cfg)
            def local_state(client):return dict(client.cfg)
            def start(client):pass
        client=Client()
        restore(client)
        self.assertFalse(client.root.exists())
        try:
            setup(client,{'user':'admin','name':'Local owner'})
            self.assertTrue(client.cfg['localCoordinator'])
            self.assertEqual(json.load(urllib.request.urlopen(client.cfg['url']+'/health'))['service'],'private-network')
            db=Authority(client.root/'coordinator'/'metadata.sqlite3')
            self.assertTrue(db.rpc('state',{},client.cfg['token'])['superAdmin'])
            stop(client)
            with socket.socket() as replacement:
                replacement.bind(('127.0.0.1',client.cfg['localPort']))
                replacement.listen()
                with self.assertRaises(ValueError):restore(client)
            restore(client)
            self.assertTrue(json.load(urllib.request.urlopen(client.cfg['url']+'/health'))['ok'])
        finally:stop(client)

if __name__=='__main__':unittest.main()
