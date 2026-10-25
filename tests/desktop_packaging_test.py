import importlib.util
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
from desktop_payload import include_electron_member
from windows_signing import sign_artifact


class PackagingTests(unittest.TestCase):
    def test_payload_keeps_clinical_runtime_codecs_not_default_app(self):
        for name in ['locales/ru.pak', 'locales/en-US.pak', 'locales/az.pak',
                     'ffmpeg.dll', 'vk_swiftshader.dll', 'LICENSES.chromium.html', 'electron.exe']:
            self.assertTrue(include_electron_member(name))
        for name in ['locales/ja.pak', 'resources/default_app.asar']:
            self.assertFalse(include_electron_member(name))
        with self.assertRaises(ValueError): include_electron_member('../outside.exe')

    def test_unsigned_requires_no_certificate_and_never_calls_tool(self):
        runner = Mock()
        self.assertFalse(sign_artifact('unused.exe', env={}, run=runner))
        runner.assert_not_called()

    def test_sign_verify_and_fail_closed(self):
        with tempfile.TemporaryDirectory() as folder:
            tool = Path(folder, 'signtool.exe'); tool.touch()
            exe = Path(folder, 'setup.exe'); exe.touch()
            env = {'RADAZ_SIGN_CERT_SHA1': 'a'*40, 'RADAZ_SIGN_TIMESTAMP_URL': 'https://timestamp.example', 'RADAZ_SIGNTOOL': str(tool)}
            runner = Mock(return_value=SimpleNamespace(returncode=0))
            self.assertTrue(sign_artifact(exe, env, runner))
            self.assertEqual(runner.call_count, 2)
            self.assertEqual(runner.call_args_list[1].args[0][1:4], ['verify', '/pa', '/all'])
            runner.return_value.returncode = 1
            with self.assertRaises(RuntimeError): sign_artifact(exe, env, runner)
            env['RADAZ_SIGN_TIMESTAMP_URL'] = 'http://insecure.example'
            with self.assertRaises(ValueError): sign_artifact(exe, env, runner)

    def test_audit_counts_hardlinks_once_and_never_changes_contents(self):
        import os
        spec = importlib.util.spec_from_file_location('audit', ROOT / 'scripts/audit-desktop-storage.py')
        audit = importlib.util.module_from_spec(spec); spec.loader.exec_module(audit)
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder); (root/'a').write_bytes(b'clinical-data')
            os.link(root/'a', root/'b')
            result = audit.audit(root, True)
            self.assertEqual(result['logicalBytes'], 26)
            self.assertEqual(result['uniqueFileBytes'], 13)
            self.assertEqual(len(result['duplicates']), 1)
            self.assertEqual((root/'a').read_bytes(), b'clinical-data')


if __name__ == '__main__': unittest.main()
