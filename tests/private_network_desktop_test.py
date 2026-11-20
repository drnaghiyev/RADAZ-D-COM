"""Desktop authorization at the local archive boundary, using a synthetic installation."""
import hashlib
import hmac
import http.client
import json
import os
import secrets
import sys
import tempfile
import threading
import unittest
from contextlib import ExitStack
from http.server import ThreadingHTTPServer
from pathlib import Path
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'bridge'))
import radaz_archive


class DesktopIdentityTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.contexts = ExitStack()
        self.addCleanup(self.contexts.close)
        self.root = Path(temporary.name) / 'Programs' / 'RADAZ'
        self.runtime = self.root / 'versions' / radaz_archive.APP_VERSION
        self.runtime.mkdir(parents=True)
        self.token = secrets.token_hex(32)
        (self.root / 'control-token').write_text(self.token + '\n', encoding='utf-8-sig')
        self.set_active(radaz_archive.APP_VERSION)
        self.contexts.enter_context(patch.dict(os.environ, {
            'RADAZ_INSTALL_ROOT':'', 'RADAZ_DESKTOP_TOKEN':'', 'LOCALAPPDATA':temporary.name,
        }))
        self.contexts.enter_context(patch.object(radaz_archive, '__file__', str(self.runtime / 'bridge/radaz_archive.py')))

    def set_active(self, version):
        (self.root / 'active.json').write_text(json.dumps({'version':version}))

    def test_installed_orphan_accepts_only_own_active_installation(self):
        self.assertEqual(radaz_archive.private_network_token(), self.token)
        self.set_active('other')
        self.assertEqual(radaz_archive.private_network_token(), '')
        self.set_active(radaz_archive.APP_VERSION)
        with patch.dict(os.environ, {'RADAZ_INSTALL_ROOT':str(self.root.parent)}):
            self.assertEqual(radaz_archive.private_network_token(), '')
        with patch.object(radaz_archive, '__file__', str(self.root / 'source/bridge/radaz_archive.py')):
            self.assertEqual(radaz_archive.private_network_token(), '')
        (self.root / 'control-token').write_text('invalid')
        self.assertEqual(radaz_archive.private_network_token(), '')

    @unittest.skipUnless(sys.platform == 'win32', 'Windows desktop receiver')
    def test_managed_and_orphan_receiver_authorize_the_same_desktop(self):
        archive = Mock(root=self.runtime)
        self.contexts.enter_context(patch.object(radaz_archive, 'ProductService'))
        self.contexts.enter_context(patch.object(radaz_archive, 'AiService'))
        network = self.contexts.enter_context(patch('private_network_client.NetworkClient')).return_value
        network.action.return_value = {'configured':False}
        server = ThreadingHTTPServer(('127.0.0.1',0), radaz_archive.handler_for(archive, Mock()))
        self.addCleanup(server.server_close)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(server.shutdown)
        proof = hmac.new(self.token.encode(), b'private-network-v1', hashlib.sha256).hexdigest()

        def state(signature=None):
            client = http.client.HTTPConnection(*server.server_address, timeout=4)
            try:
                headers = {'Content-Type':'application/json', 'Origin':'http://localhost:5173'}
                if signature is not None:
                    headers['X-RADAZ-Network'] = signature
                client.request('POST','/private-network/state','{}',headers)
                reply = client.getresponse()
                return reply.status, json.loads(reply.read())
            finally:
                client.close()

        self.assertEqual(state(proof), (200, {'configured':False}))
        with patch.dict(os.environ, {'RADAZ_DESKTOP_TOKEN':self.token+'\r\n'}):
            self.assertEqual(state(proof), (200, {'configured':False}))
        status, error = state()
        self.assertEqual((status, error['code']), (403, 'NETWORK_DESKTOP_REQUIRED'))
        status, error = state('0'*64)
        self.assertEqual((status, error['code']), (403, 'NETWORK_DESKTOP_IDENTITY'))
        self.assertEqual(network.action.call_count, 2)


if __name__ == '__main__':
    unittest.main()
