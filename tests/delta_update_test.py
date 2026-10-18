import hashlib
import importlib.util
import io
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from zipfile import ZipFile, ZIP_DEFLATED

ROOT=Path(__file__).resolve().parents[1]
def load(name, file):
    spec=importlib.util.spec_from_file_location(name,ROOT/file)
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module
desktop=load('delta_desktop','bridge/radaz_desktop.py')
builder=load('delta_builder','scripts/package-delta.py')

class DeltaUpdates(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name)
        self.base='0.2.31';self.target='0.2.32'
        self.runtime=os.urandom(200000)
        self.old=self.package(self.base);self.new=self.package(self.target)
        self.source=self.root/'versions'/self.base;self.source.mkdir(parents=True)
        with ZipFile(self.old) as archive:archive.extractall(self.source)
        desktop.atomic_json(self.root/'active.json',{'version':self.base})
        self.delta=builder.build_delta(self.old,self.new,self.root)
    def tearDown(self):self.temp.cleanup()
    def package(self,version):
        files={name:self.runtime for name in ['runtime/node/node.exe','runtime/python/python.exe']}
        files.update({name:b'synthetic runtime' for name in ['dist/runtime/web-server.mjs','bridge/radaz_desktop.py','installer/launcher.ps1']})
        files.update({'public/product.json':json.dumps(dict(name='RADAZ',version=version,licenseRequired=True,repository=desktop.REPOSITORY)).encode(),
            'desktop.json':json.dumps(dict(schema=1,version=version,architecture='x64')).encode(),
            'dist/server/radaz-build.json':json.dumps({'product':{'version':version}}).encode()})
        files['old-only.txt' if version==self.base else 'new-only.txt']=b'content'
        file=self.root/(version+'.zip')
        with ZipFile(file,'w',ZIP_DEFLATED) as archive:
            for name,raw in files.items():archive.writestr(name,raw)
            archive.writestr('SHA256SUMS.json',json.dumps({n:hashlib.sha256(b).hexdigest() for n,b in files.items()}))
        return file
    def stage(self):desktop.stage_delta(self.root,self.delta,self.target,hashlib.sha256(self.delta.read_bytes()).hexdigest(),self.delta.stat().st_size,self.base)
    def test_reuses_verified_files_and_removes_obsolete_files_without_touching_active(self):
        self.assertLess(self.delta.stat().st_size,self.new.stat().st_size/10)
        with ZipFile(self.delta) as archive:self.assertNotIn('runtime/node/node.exe',archive.namelist())
        self.stage();destination=self.root/'versions'/self.target
        desktop.validate_directory(destination,self.target)
        self.assertFalse((destination/'old-only.txt').exists());self.assertTrue((destination/'new-only.txt').exists())
        self.assertTrue((self.source/'old-only.txt').exists())
        self.assertEqual(desktop.read_json(self.root/'active.json')['version'],self.base)
        (destination/'runtime/node/node.exe').write_bytes(b'changed destination')
        self.assertEqual((self.source/'runtime/node/node.exe').read_bytes(),self.runtime)
    def test_corrupt_base_is_not_staged(self):
        (self.source/'runtime/node/node.exe').write_bytes(b'corrupt')
        with self.assertRaises(ValueError):self.stage()
        self.assertFalse((self.root/'pending.json').exists())
        self.assertFalse((self.root/'versions'/self.target).exists())
    def test_select_and_full_fallback_for_corrupt_base(self):
        def asset(file,name):return dict(name=name,state='uploaded',size=file.stat().st_size,digest='sha256:'+hashlib.sha256(file.read_bytes()).hexdigest(),browser_download_url=f'https://github.com/{desktop.UPDATE_REPOSITORY}/releases/download/v{self.target}/{name}')
        full=asset(self.new,f'RADAZ-{self.target}-Windows-x64.zip');delta=asset(self.delta,self.delta.name)
        release=dict(tag_name='v'+self.target,draft=False,prerelease=False,assets=[full,delta])
        self.assertEqual(desktop.select_asset(release,self.base)[1],full)
        self.assertEqual(desktop.select_asset(release,self.base,base_version=self.base)[1]['name'],self.delta.name)
        (self.source/'runtime/node/node.exe').write_bytes(b'corrupt')
        with patch.object(desktop,'get_latest_release',return_value=release),patch.object(desktop,'open_release_download',side_effect=[io.BytesIO(self.delta.read_bytes()),io.BytesIO(self.new.read_bytes())]):
            desktop.check_update(self.root,approved_version=self.target)
        desktop.validate_directory(self.root/'versions'/self.target,self.target)
        self.assertEqual(desktop.read_json(self.root/'active.json')['version'],self.base)
    def test_traversal_and_checksum_failure_leave_no_pending_version(self):
        with ZipFile(self.delta,'a') as archive:archive.writestr('../escape.txt',b'bad')
        with self.assertRaises(ValueError):self.stage()
        self.assertFalse((self.root/'pending.json').exists())
        self.assertFalse((self.root.parent/'escape.txt').exists())

    def test_distribution_metadata_lists_deleted_changed_new_and_unchanged_sizes(self):
        info=json.loads(self.delta.with_suffix('.manifest.json').read_text())
        self.assertEqual(info['deleted'],['old-only.txt'])
        self.assertEqual(info['added'],['new-only.txt'])
        self.assertNotIn('runtime/node/node.exe',info['changed'])
        self.assertEqual(next(f['size'] for f in info['files'] if f['path']=='runtime/node/node.exe'),len(self.runtime))
        self.assertEqual(info['sha256'],hashlib.sha256(self.delta.read_bytes()).hexdigest())

    def test_retention_keeps_rollback_pending_live_runtime_and_unexpected_user_files(self):
        for v in ['0.2.27','0.2.28','0.2.29','0.2.30','0.2.99']:
            with ZipFile(self.package(v)) as z:z.extractall(self.root/'versions'/v)
        (self.root/'versions/0.2.29/user-note.txt').write_text('must remain')
        desktop.atomic_json(self.root/'active.json',{'version':self.base,'previousVersion':'0.2.30'})
        self.stage()
        with patch.object(desktop,'runtime_processes',return_value={'versions':['0.2.28']}):
            self.assertEqual(desktop.cleanup_versions(self.root),['0.2.27'])
        # 0.2.99 has no pending pointer yet: staging publication must not race cleanup.
        for v in ['0.2.28','0.2.29','0.2.30','0.2.99',self.base,self.target]:self.assertTrue((self.root/'versions'/v).is_dir())

    def test_interrupted_download_resumes_at_verified_offset(self):
        raw=b'0123456789abcdef';asset=dict(name='fixture.zip',size=len(raw),digest='sha256:'+hashlib.sha256(raw).hexdigest(),browser_download_url='https://github.com/fixture.zip')
        class Interrupted(io.BytesIO):
            def read(self,n=-1):
                if self.tell():raise OSError('connection lost')
                return super().read(6)
        resumed=io.BytesIO(raw[6:]);resumed.status=206;resumed.headers={'Content-Range':'bytes 6-15/16'}
        with patch.object(desktop,'open_release_download',side_effect=[Interrupted(raw),resumed]) as opened,patch.object(desktop.time,'sleep'):
            file=desktop.download_asset(self.root,asset,self.target)
        self.assertEqual(file.read_bytes(),raw)
        opened.assert_called_with(asset['browser_download_url'],6)

    def test_partial_download_survives_outage_but_corruption_and_wrong_ranges_are_rejected(self):
        raw=b'0123456789abcdef';asset=dict(name='fixture.zip',size=len(raw),digest='sha256:'+hashlib.sha256(raw).hexdigest(),browser_download_url='https://github.com/fixture.zip')
        downloads=self.root/'downloads';downloads.mkdir();partial=downloads/'fixture.zip.part';partial.write_bytes(raw[:6])
        desktop.atomic_json(downloads/'fixture.zip.part.json',asset)
        with patch.object(desktop,'open_release_download',side_effect=OSError('offline')),patch.object(desktop.time,'sleep'):
            with self.assertRaises(OSError):desktop.download_asset(self.root,asset,self.target)
        self.assertEqual(partial.read_bytes(),raw[:6]);self.assertFalse((self.root/'pending.json').exists())
        bad=io.BytesIO(raw[6:]);bad.status=206;bad.headers={'Content-Range':'bytes 5-15/16'}
        with patch.object(desktop,'open_release_download',return_value=bad):
            with self.assertRaises(ValueError):desktop.download_asset(self.root,asset,self.target)
        self.assertFalse(partial.exists())
        with patch.object(desktop,'open_release_download',return_value=io.BytesIO(b'x'*len(raw))):
            with self.assertRaises(ValueError):desktop.download_asset(self.root,asset,self.target)
        self.assertFalse(partial.exists())

    def test_new_release_requires_publisher_signature_before_download(self):
        with self.assertRaisesRegex(ValueError,'signature'):desktop.authenticate_release({'tag_name':'v0.2.41'})

if __name__=='__main__':unittest.main()
