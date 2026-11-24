"""Clinic-to-device invitations and delivery through separate Windows profiles."""
import secrets
import sys
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'bridge'))
from private_network_authority import make_server
from private_network_internet import InternetAuthority
from private_network_client import NetworkClient, RemoteError
from radaz_archive import Archive
from removable_media_test import write_image


class InternetTests(unittest.TestCase):
    def test_two_doctors_and_an_independent_clinic(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder)
            hub=InternetAuthority(root/'coordinator.sqlite')
            with make_server(hub,'127.0.0.1',0) as server:
                worker=threading.Thread(target=server.serve_forever,daemon=True)
                worker.start()
                try:
                    with patch('private_network_client.INTERNET_URL','http://127.0.0.1:'+str(server.server_port)),patch.object(NetworkClient,'start'):
                        self.check_clinics(root)
                finally:
                    server.shutdown()
                    worker.join()

    def check_clinics(self,root):
        def enroll(name):
            host=NetworkClient(Archive(root/name/'archive',http_only=True),root/name/'private')
            session=host.action('settings_set',{'password':secrets.token_urlsafe(24)})['session']
            host.action('enroll_pc',{'_profile':'internet','name':name},session)
            self.assertFalse(host.local_state()['configured'])
            client=host.internet_profile()
            return client
        sender,other,first,second=[enroll(n) for n in ['Clinic-A','Clinic-B','Doctor-A','Doctor-B']]
        clinic=sender.rpc('open_clinic',{'name':'QA A'})['clinic']
        foreign=other.rpc('open_clinic',{'name':'QA B'})['clinic']
        self.assertEqual(sender.rpc('open_clinic',{'name':'QA A'})['clinic'],clinic)
        for target in [first,second]:
            data={'clinic':clinic,'name':target.archive.root.parent.name,'target':'RD-'+target.local_state()['deviceId']}
            with self.assertRaises(RemoteError):other.rpc('invite_pc',data)
            invite=sender.rpc('invite_pc',data)['id']
            self.assertEqual(invite,sender.rpc('invite_pc',data)['id'])
            with self.assertRaises(RemoteError):other.rpc('answer_invite',{'id':invite,'accept':True})
            self.assertFalse(target.rpc('state',{})['clinics'])
            self.assertEqual(target.operational_state({})['inviteNotice'],invite)
            target.rpc('answer_invite',{'id':invite,'accept':True})
            self.assertEqual(target.rpc('state',{'clinic':clinic})['membership']['permissions'],['receive','download'])
            with self.assertRaises(RemoteError):target.rpc('answer_invite',{'id':invite,'accept':True})
        with self.assertRaises(RemoteError):sender.rpc('state',{'clinic':foreign})
        pending=other.rpc('invite_pc',{'clinic':foreign,'target':first.local_state()['deviceId'],'name':'Doctor A'})['id']
        other.rpc('cancel_invite',{'clinic':foreign,'id':pending})
        with self.assertRaises(RemoteError):first.rpc('answer_invite',{'id':pending,'accept':True})
        members=sender.operational_state({'clinic':clinic})['members']
        recipients=[m['id'] for m in members if 'receive' in m['permissions']]
        self.assertEqual(len(recipients),2)
        file=root/'synthetic.dcm'
        ds=write_image(file,1)
        raw=file.read_bytes()
        sender.archive.store(raw,ds)
        study=str(ds.StudyInstanceUID)
        sender.send({'clinic':clinic,'study':study,'mode':'many','recipients':recipients})
        sender.tick()
        for receiver in [first,second]:
            inbox=receiver.rpc('state',{})['deliveries']
            self.assertEqual(len(inbox),1)
            receiver.rpc('accept',{'delivery':inbox[0]['id']})
        sender.tick()
        for receiver in [first,second]:
            receiver.tick()
            self.assertTrue(receiver.received(study))
            self.assertEqual(receiver.archive.instances(study)[0]['uid'],str(ds.SOPInstanceUID))
            self.assertEqual(next((receiver.archive.root/'instances').rglob('*.dcm')).read_bytes(),raw)
        self.assertFalse(other.rpc('state',{})['deliveries'])
        self.assertEqual([d['state'] for d in sender.rpc('state',{})['sent']],['complete','complete'])
