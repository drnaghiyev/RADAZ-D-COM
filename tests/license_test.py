import base64
import json
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch
ROOT=Path(__file__).resolve().parent.parent
sys.path.insert(0,str(ROOT/'bridge'))
from radaz_product import ProductService,verify_key

class Licenses(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp=tempfile.TemporaryDirectory();cls.root=Path(cls.temp.name);cls.admin=cls.root/'admin';cls.public=cls.root/'public.json';cls.device='A'*64
        cls.cli('init','--public',str(cls.public))
        cls.license=cls.cli('create','--customer','Synthetic Test','--seats','1','--period','monthly').stdout.strip()
        cls.cli('activate','--license',cls.license,'--device',cls.device,'--out',str(cls.root/'key.txt'))
        cls.key=(cls.root/'key.txt').read_text().strip();cls.pub=json.loads(cls.public.read_text())
    @classmethod
    def tearDownClass(cls): cls.temp.cleanup()
    @classmethod
    def cli(cls,*args,check=True):
        return subprocess.run(['node',str(ROOT/'scripts/license-admin.mjs'),*args,'--dir',str(cls.admin)],capture_output=True,text=True,check=check)

    def test_anatomy_trial_is_explicit_separate_and_never_restarts(self):
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary);config=root/'product.json';config.write_text(json.dumps({'licenseRequired':True,'trialDays':30}))
            service=ProductService(root,config_path=config,public_path=self.public,device=self.device,trial_root=root/'trial')
            service.activate(self.key)
            self.assertEqual(service.anatomy_status()['status'],'inactive')
            self.assertFalse(service.anatomy_trial.path.exists())
            first=service.anatomy_status(start=True)
            self.assertTrue(first['allowed']);self.assertEqual(first['remainingTrialDays'],30)
            self.assertEqual(first['trialExpiresAt']-first['trialStartedAt'],30*86400)
            self.assertEqual(service.anatomy_status(start=True)['trialExpiresAt'],first['trialExpiresAt'])
            self.assertNotEqual(service.trial.path,service.anatomy_trial.path)
            service.anatomy_trial.write(dict(v=1,deviceId=self.device,startedAt=int(time.time())-31*86400,lastSeen=int(time.time())))
            self.assertFalse(service.anatomy_status(start=True)['allowed'])
            self.assertTrue(service.status()['valid'])

    def test_valid_signature(self):
        self.assertEqual(verify_key(self.key,self.pub,self.device)['customer'],'Synthetic Test')
    def signed(self, claims, prefix='RADAZ1'):
        script="const fs=require('fs'),crypto=require('crypto');const data=JSON.parse(fs.readFileSync(0,'utf8'));const payload=process.argv[2]+'.'+Buffer.from(JSON.stringify(data)).toString('base64url');console.log(payload+'.'+crypto.sign('RSA-SHA256',Buffer.from(payload),fs.readFileSync(process.argv[1])).toString('base64url'));"
        return subprocess.check_output(['node','-e',script,str(self.admin/'issuer-private.pem'),prefix],input=json.dumps(claims).encode()).decode().strip()
    def test_module_key_cannot_unlock_base_and_only_grants_its_own_module(self):
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary);config=root/'product.json';config.write_text(json.dumps({'licenseRequired':True,'trialDays':0}))
            service=ProductService(root,config_path=config,public_path=self.public,device=self.device,trial_root=root/'trial')
            claims=verify_key(self.key,self.pub,self.device);claims['moduleId']='future-module'
            result=service.activate(self.signed(claims))
            self.assertFalse(result['valid']);self.assertFalse((service.root/'license.json').exists())
            service.activate(self.key)
            self.assertTrue(service.module_allowed('future-module'));self.assertFalse(service.module_allowed('other-module'))
            saved=json.loads((service.root/'module-licenses.json').read_text());saved['lastSeen']=int(time.time())+1000
            (service.root/'module-licenses.json').write_text(json.dumps(saved));self.assertFalse(service.module_allowed('future-module'))
    def test_signed_policy_trial_duration_and_forgery_rejection(self):
        from radaz_commerce import verify_policy
        from radaz_trial import TrialStore
        claims={'v':1,'product':'RADAZ','revision':int(time.time()*1000),'baseCurrency':'USD','monthlyMinor':1000,'trialDays':45,'modules':[]}
        envelope={'policy':self.signed(claims,'RADAZPOLICY1')};policy=verify_policy(envelope,self.pub)
        self.assertEqual(policy['trialDays'],45)
        pieces=envelope['policy'].split('.');claims['trialDays']=365;pieces[1]=base64.urlsafe_b64encode(json.dumps(claims).encode()).decode().rstrip('=')
        with self.assertRaises(ValueError):verify_policy({'policy':'.'.join(pieces)},self.pub)
        with tempfile.TemporaryDirectory() as temporary:
            trial=TrialStore(self.device,temporary);trial.status(now=1000000,days=30)
            self.assertTrue(trial.status(now=1000000+40*86400,days=45)['valid'])
            self.assertFalse(trial.status(now=1000000+45*86400,days=45)['valid'])
    def test_tamper_rejected(self):
        prefix,payload,sig=self.key.split('.');claims=json.loads(base64.urlsafe_b64decode(payload+'='*(-len(payload)%4)));claims['seats']=999
        tampered=base64.urlsafe_b64encode(json.dumps(claims).encode()).decode().rstrip('=')
        with self.assertRaises(ValueError):verify_key('.'.join((prefix,tampered,sig)),self.pub,self.device)
    def test_device_rejected(self):
        with self.assertRaisesRegex(ValueError,'kompüter'):verify_key(self.key,self.pub,'B'*64)
    def test_expiry(self):
        claims=verify_key(self.key,self.pub,self.device)
        with self.assertRaisesRegex(ValueError,'müddəti'):verify_key(self.key,self.pub,self.device,claims['expiresAt'])
    def test_future_issue(self):
        claims=verify_key(self.key,self.pub,self.device)
        with self.assertRaises(ValueError):verify_key(self.key,self.pub,self.device,claims['issuedAt']-301)
    def test_seats(self):
        result=self.cli('activate','--license',self.license,'--device','B'*64,'--out',str(self.root/'second.txt'),check=False)
        self.assertNotEqual(result.returncode,0);self.assertIn('Seat limit reached',result.stderr);self.assertFalse((self.root/'second.txt').exists())
    def test_reissue_same_seat(self):
        self.cli('activate','--license',self.license,'--device',self.device,'--out',str(self.root/'again.txt'))
        self.assertEqual(verify_key((self.root/'again.txt').read_text().strip(),self.pub,self.device)['licenseId'],self.license)
    def test_renew_preserves_remaining_time(self):
        new_id=self.cli('create','--customer','Renewal Test','--seats','1','--period','monthly').stdout.strip()
        before=next(s for s in json.loads((self.admin/'subscriptions.json').read_text())['subscriptions'] if s['id']==new_id)
        self.cli('renew','--license',new_id)
        after=next(s for s in json.loads((self.admin/'subscriptions.json').read_text())['subscriptions'] if s['id']==new_id)
        self.assertGreaterEqual(after['expiresAt']-before['expiresAt'],28*86400)
        self.assertLessEqual(after['expiresAt']-before['expiresAt'],31*86400)
    def test_activation_persists_and_rollback(self):
        data=self.root/'state';data.mkdir(exist_ok=True);config=self.root/'config.json';config.write_text(json.dumps({'licenseRequired':True}))
        service=ProductService(data,config,self.public,self.device);self.assertFalse(service.allowed());self.assertTrue(service.activate(self.key)['valid'])
        loaded=ProductService(data,config,self.public,self.device);self.assertTrue(loaded.allowed())
        with patch('radaz_product.time.time',return_value=time.time()-1000):self.assertFalse(loaded.allowed())
    def test_invalid_key_not_saved(self):
        data=self.root/'invalid';data.mkdir(exist_ok=True);config=self.root/'config2.json';config.write_text(json.dumps({'licenseRequired':True}))
        service=ProductService(data,config,self.public,self.device)
        with self.assertRaises(ValueError):service.activate('bad')
        self.assertFalse((data/'product/license.json').exists())
    def test_http_guard_and_activation(self):
        from radaz_archive import Archive,handler_for
        from http.server import ThreadingHTTPServer
        from threading import Thread
        from urllib.request import Request,urlopen
        from urllib.error import HTTPError
        data=self.root/'http';data.mkdir(exist_ok=True);config=self.root/'http-config.json';config.write_text(json.dumps({'licenseRequired':True}))
        product=ProductService(data,config,self.public,self.device)
        with patch('radaz_archive.ProductService',return_value=product): server=ThreadingHTTPServer(('127.0.0.1',0),handler_for(Archive(data)))
        thread=Thread(target=server.serve_forever,daemon=True);thread.start();base=f'http://127.0.0.1:{server.server_port}'
        try:
            self.assertFalse(json.load(urlopen(base+'/license'))['valid'])
            self.assertEqual(urlopen(base+'/studies').status,200)
            self.assertEqual(urlopen(base+'/status').status,200)
            self.assertEqual(json.load(urlopen(base+'/billing/catalog'))['monthly'],10)
            request=Request(base+'/print',data=b'{}',headers={'Content-Type':'application/json'})
            with self.assertRaises(HTTPError) as error:urlopen(request)
            self.assertEqual(error.exception.code,402)
            request=Request(base+'/license/activate',data=json.dumps({'key':self.key}).encode(),headers={'Content-Type':'application/json'})
            self.assertTrue(json.load(urlopen(request))['valid'])
            self.assertEqual(urlopen(base+'/studies').status,200)
            claims=verify_key(self.key,self.pub,self.device)
            with patch('radaz_product.time.time',return_value=claims['expiresAt']+1):
                self.assertEqual(urlopen(base+'/studies').status,200)
                request=Request(base+'/video',data=b'empty',headers={'Content-Type':'application/zip'})
                with self.assertRaises(HTTPError) as error:urlopen(request)
                self.assertEqual(error.exception.code,402)
        finally:server.shutdown();server.server_close();thread.join()

    def test_owner_license_is_device_bound_and_not_in_customer_config(self):
        output=self.root/'owner.txt'
        self.cli('owner','--customer','Synthetic Owner','--device',self.device,'--public',str(self.public),'--out',str(output))
        key=output.read_text().strip()
        claims=verify_key(key,self.pub,self.device,int(time.time())+50*365*86400)
        self.assertEqual(claims['entitlement'],'owner')
        with self.assertRaisesRegex(ValueError,'kompüter'):verify_key(key,self.pub,'B'*64)
        data=self.root/'owner-state';data.mkdir(exist_ok=True)
        config=self.root/'owner-config.json';config.write_text(json.dumps({'licenseRequired':True,'trialDays':7}))
        service=ProductService(data,config,self.public,self.device,trial_root=self.root/'owner-trial')
        self.assertEqual(service.activate(key)['kind'],'owner')
        with patch('radaz_product.time.time',return_value=time.time()+8*86400):
            state=service.status();self.assertTrue(state['valid']);self.assertEqual(state['kind'],'owner')
        published=json.loads((ROOT/'public/product.json').read_text())
        self.assertTrue(published['licenseRequired']);self.assertEqual(published['trialDays'],30)
        self.assertNotIn('entitlement',published);self.assertNotIn('deviceId',published)

class Demo(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name)
        self.config=self.root/'product.json';self.config.write_text(json.dumps({'licenseRequired':True,'trialDays':7}))
        self.start=1800000000
    def tearDown(self):self.temp.cleanup()
    def service(self,name='archive',device='A'*64):
        data=self.root/name;data.mkdir(exist_ok=True)
        return ProductService(data,self.config,device=device,trial_root=self.root/'trial')
    def test_first_use_starts_exactly_thirty_days_and_expiry_limits_features(self):
        service=self.service()
        with patch('radaz_product.time.time',return_value=self.start):
            state=service.status();self.assertTrue(state['valid']);self.assertEqual(state['kind'],'trial')
            self.assertEqual(state['trial']['expiresAt'],self.start+30*86400);self.assertEqual(state['trial']['daysRemaining'],30)
        with patch('radaz_product.time.time',return_value=self.start+30*86400-1):self.assertTrue(service.allowed())
        with patch('radaz_product.time.time',return_value=self.start+30*86400):
            state=service.status();self.assertFalse(state['valid']);self.assertEqual(state['trial']['daysRemaining'],0)
    def test_restart_or_different_archive_folder_does_not_reset_trial(self):
        with patch('radaz_product.time.time',return_value=self.start):first=self.service().status()
        with patch('radaz_product.time.time',return_value=self.start+2*86400):
            second=self.service('new-install').status()
        self.assertEqual(first['trial']['expiresAt'],second['trial']['expiresAt']);self.assertEqual(second['trial']['daysRemaining'],28)
    def test_other_computer_gets_its_own_first_use(self):
        with patch('radaz_product.time.time',return_value=self.start):self.service().status()
        with patch('radaz_product.time.time',return_value=self.start+10*86400):
            other=self.service('other','B'*64).status();self.assertTrue(other['valid']);self.assertEqual(other['trial']['daysRemaining'],30)
    def test_old_trial_is_extended_from_original_start_not_upgrade_date(self):
        service=self.service()
        service.trial.write(dict(v=1,deviceId=service.device,startedAt=self.start,lastSeen=self.start+8*86400))
        self.config.write_text(json.dumps({'licenseRequired':True,'trialDays':30}))
        with patch('radaz_product.time.time',return_value=self.start+8*86400):
            state=self.service().status()
        self.assertTrue(state['valid']);self.assertEqual(state['trial']['daysRemaining'],22)
        self.assertEqual(state['trial']['startedAt'],self.start)
    def test_clock_rollback_and_corrupted_record_fail_closed(self):
        service=self.service()
        with patch('radaz_product.time.time',return_value=self.start):service.status()
        with patch('radaz_product.time.time',return_value=self.start-1000):
            state=service.status();self.assertFalse(state['valid']);self.assertIn('tarix',state['message'])
        service.trial.path.write_text('corrupted')
        with patch('radaz_product.time.time',return_value=self.start+1):self.assertFalse(service.allowed())
    def test_trial_record_cannot_be_copied_to_another_device(self):
        first=self.service();second=self.service('other','B'*64)
        with patch('radaz_product.time.time',return_value=self.start):first.status()
        second.trial.path.write_bytes(first.trial.path.read_bytes())
        with patch('radaz_product.time.time',return_value=self.start):self.assertFalse(second.allowed())
    def test_registry_record_restores_missing_file_without_starting_over(self):
        service=self.service()
        with patch('radaz_product.time.time',return_value=self.start):service.status()
        raw=service.trial.path.read_text();service.trial.path.unlink()
        with patch.object(service.trial,'read_registry',return_value=raw),patch('radaz_product.time.time',return_value=self.start+86400):
            state=service.status();self.assertTrue(state['valid']);self.assertEqual(state['trial']['daysRemaining'],29)
        self.assertTrue(service.trial.path.exists())
    def test_http_trial_expiry_keeps_archive_but_blocks_advanced_output(self):
        from radaz_archive import Archive,handler_for
        from http.server import ThreadingHTTPServer
        from threading import Thread
        from urllib.request import urlopen
        from urllib.error import HTTPError
        product=self.service()
        with patch('radaz_archive.ProductService',return_value=product):server=ThreadingHTTPServer(('127.0.0.1',0),handler_for(Archive(self.root/'archive')))
        thread=Thread(target=server.serve_forever,daemon=True);thread.start();base=f'http://127.0.0.1:{server.server_port}'
        try:
            with patch('radaz_product.time.time',return_value=self.start):
                self.assertEqual(json.load(urlopen(base+'/license'))['kind'],'trial')
                self.assertEqual(urlopen(base+'/printer-settings').status,200)
            with patch('radaz_product.time.time',return_value=self.start+30*86400):
                self.assertFalse(json.load(urlopen(base+'/license'))['valid'])
                self.assertEqual(urlopen(base+'/studies').status,200)
                self.assertEqual(urlopen(base+'/status').status,200)
                with self.assertRaises(HTTPError) as error:urlopen(base+'/printer-settings')
                self.assertEqual(error.exception.code,402)
        finally:server.shutdown();server.server_close();thread.join()

if __name__=='__main__':unittest.main()
