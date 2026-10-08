import base64
import io
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from urllib.error import HTTPError

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'bridge'))
from radaz_ai import AiService, AiError


@unittest.skipUnless(os.name == 'nt', 'Windows DPAPI credential storage')
class AiTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='radaz-ai-test-')
        self.root = Path(self.temp.name)
        self.key = 'sk-' + 'synthetic-test-' * 4
        self.requests = []
        self.response = {'status': 'completed', 'output': [{'type':'reasoning'}, {'type':'message','content':[{'type':'output_text','text':'Sınaq layihəsi'}]}]}
        def opener(req, **kwargs):
            self.requests.append(req)
            return io.BytesIO(json.dumps(self.response).encode())
        self.service = AiService(self.root, opener)

    def tearDown(self):
        self.temp.cleanup()

    def save(self):
        return self.service.save({'key': self.key, 'model': 'gpt-4.1'})

    def test_encrypted_persistence_no_echo_no_ambient_key(self):
        with patch.dict(os.environ, {'OPENAI_API_KEY': self.key}):
            self.assertFalse(self.service.status()['configured'])
            with self.assertRaises(AiError): self.service.test()
        status = self.save()
        self.assertNotIn(self.key, json.dumps(status))
        self.assertNotIn(self.key.encode(), self.service.path.read_bytes())
        self.assertEqual(AiService(self.root).status(), status)
        self.assertEqual(self.service.save({'model':'gpt-4.1-mini'})['model'], 'gpt-4.1-mini')
        self.assertEqual(self.service._read()['key'], self.key)
        self.assertEqual(self.requests, [], 'Saving does not contact OpenAI')
        with self.assertRaises(AiError): self.service.save({'key':'bad-key'})
        self.assertTrue(self.service.status()['configured'])
        self.assertFalse(self.service.save({'clear':True})['configured'])

    def test_report_payload_no_storage_fixed_host_and_all_images(self):
        self.save()
        jpeg = 'data:image/jpeg;base64,' + base64.b64encode(b'\xff\xd8\xffsynthetic').decode()
        result = self.service.report({'instruction':'Test', 'images':[{'label':f'Image {i}', 'data':jpeg} for i in range(8)]})
        self.assertEqual(result['text'], 'Sınaq layihəsi')
        request = self.requests[0]
        self.assertEqual(request.full_url, 'https://api.openai.com/v1/responses')
        self.assertEqual(request.headers['Authorization'], 'Bearer ' + self.key)
        body = json.loads(request.data)
        self.assertFalse(body['store'])
        self.assertEqual(len([c for c in body['input'][0]['content'] if c['type']=='input_image']), 8)
        with self.assertRaises(AiError): self.service.report({'instruction':'Test','images':[{'data':'https://example.org/x'}]})

    def test_errors_do_not_echo_secrets_or_partial_text(self):
        self.save()
        for status in ['incomplete', 'failed']:
            self.response['status'] = status
            with self.assertRaises(AiError): self.service.report({'instruction':'Test'})
        def fail(req, **kwargs):
            raise HTTPError(req.full_url, 401, self.key, {'x-request-id':'req_test'}, io.BytesIO(self.key.encode()))
        self.service.opener = fail
        with self.assertRaises(AiError) as caught: self.service.test()
        self.assertNotIn(self.key, str(caught.exception))
        self.assertEqual(caught.exception.request_id, 'req_test')

    def test_corrupt_record_can_be_replaced(self):
        self.service.path.write_bytes(b'corrupt ciphertext')
        with self.assertRaises(AiError): self.service.status()
        self.assertTrue(self.save()['configured'])


if __name__ == '__main__': unittest.main()
