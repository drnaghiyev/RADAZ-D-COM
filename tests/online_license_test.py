import base64
import json
import os
import subprocess
import sys
import tempfile
import time
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'bridge'))
from radaz_online_license import OnlineLicense, LicenseRejected, verify_receipt, digest, NoRedirect
from radaz_product import ProductService


class OnlineLicenses(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        cls.root = Path(cls.temp.name)
        cls.private = cls.root / 'signing.pem'
        cls.public = cls.root / 'public.json'
        script = "const c=require('node:crypto'),f=require('node:fs'),k=c.generateKeyPairSync('ed25519');f.writeFileSync(process.argv[1],k.privateKey.export({type:'pkcs8',format:'pem'}));f.writeFileSync(process.argv[2],JSON.stringify(k.publicKey.export({format:'jwk'})));"
        subprocess.run(['node', '-e', script, str(cls.private), str(cls.public)], check=True)
        cls.jwk = json.loads(cls.public.read_text())
        cls.key = 'RZ-' + 'A' * 43
        cls.device = 'B' * 64

    @classmethod
    def tearDownClass(cls):
        cls.temp.cleanup()

    def sign(self, install, **overrides):
        now = int(time.time())
        iso = lambda t: datetime.fromtimestamp(t, timezone.utc).isoformat().replace('+00:00', 'Z')
        claims = {'v': 1, 'product': 'RADAZ', 'license_id': 'license-fixture', 'device_id': 'device-fixture',
                  'device_hash': digest(self.device), 'install_hash': digest(install), 'key_hash': digest(self.key),
                  'plan': '1', 'issued_at': iso(now), 'valid_until': iso(now + 900), 'expires_at': iso(now + 86400)}
        claims.update(overrides)
        script = "const c=require('node:crypto'),f=require('node:fs');let d='';process.stdin.on('data',x=>d+=x);process.stdin.on('end',()=>{const p=Buffer.from(d).toString('base64url');process.stdout.write(p+'.'+c.sign(null,Buffer.from(p),f.readFileSync(process.argv[1])).toString('base64url'));});"
        return subprocess.check_output(['node', '-e', script, str(self.private)], input=json.dumps(claims).encode()).decode()

    def client(self, root):
        return OnlineLicense(root, self.device, self.public)

    def test_signed_receipt_binds_key_device_and_installation(self):
        install = 'f' * 32
        token = self.sign(install)
        self.assertEqual(verify_receipt(token, self.jwk, self.device, install, self.key, time.time())['plan'], '1')
        for device, iid, key in [('C' * 64, install, self.key), (self.device, 'e' * 32, self.key), (self.device, install, 'RZ-' + 'D' * 43)]:
            with self.assertRaises(ValueError):
                verify_receipt(token, self.jwk, device, iid, key, time.time())
        payload, signature = token.split('.')
        forged = base64.urlsafe_b64encode(b'{"product":"RADAZ"}').decode().rstrip('=') + '.' + signature
        with self.assertRaisesRegex(ValueError, 'imza'):
            verify_receipt(forged, self.jwk, self.device, install, self.key)

    def test_expiry_future_time_and_untrusted_public_key(self):
        install = 'f' * 32
        token = self.sign(install)
        for now in [time.time() + 901, time.time() - 601]:
            with self.assertRaises(ValueError):
                verify_receipt(token, self.jwk, self.device, install, self.key, now)
        other = {**self.jwk, 'x': 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'}
        with self.assertRaises(ValueError):
            verify_receipt(token, other, self.device, install, self.key)

    def test_activation_persists_encrypted_secret_and_survives_restart(self):
        with tempfile.TemporaryDirectory() as directory:
            client = self.client(directory)
            install = client.installation()
            token = self.sign(install)
            with patch.object(client, 'request', return_value=token):
                client.activate(self.key)
                self.assertTrue(client.status()['valid'])
            self.assertNotIn(self.key, client.path.read_text())
            restarted = self.client(directory)
            self.assertEqual(restarted.installation(), install)
            with patch.object(restarted, 'request', return_value=token) as request:
                self.assertTrue(restarted.status()['valid'])
                self.assertEqual(request.call_args.args[0], 'validate')
            copied = OnlineLicense(directory, 'C' * 64, self.public)
            self.assertFalse(copied.status()['valid'])

    def test_revocation_has_no_trial_fallback_and_existing_offline_key_survives(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            config = root / 'product.json'
            config.write_text(json.dumps({'licenseRequired': True, 'trialDays': 30}))
            product = ProductService(root, config_path=config, device=self.device, trial_root=root / 'trial')
            product.online.public_path = self.public
            token = self.sign(product.online.installation())
            with patch.object(product.online, 'request', return_value=token):
                self.assertTrue(product.activate(self.key)['valid'])
            product.online.last_attempt = 0
            with patch.object(product.online, 'request', side_effect=LicenseRejected('Lisenziya bloklanıb.')):
                state = product.status()
                self.assertFalse(state['valid'])
                self.assertEqual(state['kind'], 'expired')
                self.assertNotIn(self.key, json.dumps(state))

    def test_network_outage_only_keeps_unexpired_lease_and_blocks_clock_rollback(self):
        with tempfile.TemporaryDirectory() as directory:
            client = self.client(directory)
            with patch.object(client, 'request', return_value=self.sign(client.installation())):
                client.activate(self.key)
            client.last_attempt = 0
            with patch.object(client, 'request', side_effect=ValueError('Network unavailable')):
                self.assertTrue(client.status()['valid'])
                with patch('radaz_online_license.time.time', return_value=time.time() + 1000):
                    self.assertFalse(client.status()['valid'])
                with patch('radaz_online_license.time.time', return_value=time.time() - 1000):
                    self.assertFalse(client.status()['valid'])

    def test_redirect_never_forwards_credentials(self):
        with self.assertRaises(ValueError):
            NoRedirect().redirect_request(None, None, 307, '', {}, 'https://another.example/activate')


if __name__ == '__main__':
    unittest.main()
