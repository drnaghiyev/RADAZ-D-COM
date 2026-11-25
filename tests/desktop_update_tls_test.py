import json
import os
import ssl
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from urllib.error import URLError
from urllib.request import Request

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'bridge'))
import radaz_desktop as desktop
import radaz_update_tls as tls


class UpdateTrustTests(unittest.TestCase):
    def test_microsoft_and_openssl_reasons_are_distinct(self):
        for code,kind in [(18,'chain'),(0x800B0109,'chain'),(0x800B010A,'chain'),(0x800B010F,'hostname'),
                          (62,'hostname'),(10,'validity'),(0x800B0101,'validity'),(23,'distrust'),
                          (0x800B010C,'distrust'),(0x800B0111,'distrust'),(42,'certificate')]:
            with self.subTest(code=code):
                e=ssl.SSLCertVerificationError('unverified')
                e.verify_code=code
                self.assertEqual(tls.classify(URLError(e)),kind)
        self.assertIsNone(tls.classify(URLError('DNS temporarily unavailable')))

    def test_http_and_downgrades_refused_before_connect(self):
        with self.assertRaises(ValueError):
            tls.open_https('http://updates.invalid')
        with self.assertRaises(ValueError):
            tls.SecureRedirect().redirect_request(Request('https://updates.invalid/'),None,302,'',{},'http://updates.invalid/download')

    def test_signature_and_certificate_failures_do_not_request_an_elevation(self):
        failure=tls.TLSIssue('chain','github.com',20)
        with patch.object(desktop,'get_json',side_effect=failure), patch.object(tls,'native_check') as native:
            with self.assertRaises(tls.TLSIssue) as raised:
                desktop.get_latest_release()
            self.assertIs(raised.exception,failure)
            native.assert_not_called()
        with patch.object(desktop,'urlopen',side_effect=failure) as open_request:
            with self.assertRaises(tls.TLSIssue):
                desktop.open_release_download('https://github.com/fixture')
            self.assertEqual(open_request.call_count,1)

    def test_logs_exclude_query_and_manual_requests_require_consent(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp)
            with patch.dict(os.environ,{'LOCALAPPDATA':temp}):
                tls.log_issue(root,tls.TLSIssue('chain','cdn.invalid/opaque?token=private',20))
                entry=json.loads((tls.diagnostics_directory(root)/'ssl-diagnostics.jsonl').read_text())
            self.assertEqual(entry['host'],'cdn')
            for consent in (False,True):
                (root/'update-request.json').write_text(json.dumps(dict(action='repair-trust',confirmed=consent)))
                self.assertEqual(desktop.consume_update_request(root),'repair-trust' if consent else None)
            self.assertIsNone(tls.native_check(ROOT,root,'cdn.invalid/injected',True))

    def test_pinned_dependencies_and_no_bulk_root_import(self):
        lock=json.loads((ROOT/'scripts/desktop-runtime-lock.json').read_text())
        for pkg in ('certifi','truststore'):
            self.assertTrue(lock[pkg]['url'].startswith('https://files.pythonhosted.org/'))
            self.assertRegex(lock[pkg]['sha256'],r'^[0-9a-f]{64}$')
        source=(ROOT/'installer/UpdateTrust.cs').read_text()
        self.assertNotIn('-addstore',source.lower())
        self.assertIn('-verifyCTL AuthRoot',source)
        self.assertIn('RemoteCertificateNameMismatch',source)

if __name__=='__main__':
    unittest.main()
