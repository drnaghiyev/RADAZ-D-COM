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

if __name__=='__main__':unittest.main()
