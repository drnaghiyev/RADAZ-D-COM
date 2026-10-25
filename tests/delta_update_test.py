import hashlib
import importlib.util
import io
import json
import os
import struct
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

    def test_verified_activation_keeps_one_rollback_but_removes_older_runtime(self):
        old='0.2.30'
        with ZipFile(self.package(old)) as z:z.extractall(self.root/'versions'/old)
        with ZipFile(self.package('0.2.29')) as z:z.extractall(self.root/'versions/0.2.29')
        desktop.atomic_json(self.root/'active.json',{'version':self.base,'previousVersion':old})
        desktop.atomic_json(self.root/'activation-verified.json',{'version':self.base})
        data=self.root/'user-data';data.mkdir();(data/'archive.txt').write_text('preserve')
        with patch.object(desktop,'runtime_processes',return_value={'versions':[self.base]}):
            self.assertEqual(desktop.cleanup_versions(self.root),['0.2.29'])
        self.assertTrue((self.root/'versions'/old).is_dir())
        self.assertTrue(self.source.is_dir())
        self.assertEqual((data/'archive.txt').read_text(),'preserve')

    def test_retention_recognizes_generated_wheels_but_keeps_user_cache_files(self):
        for old in ['0.2.29','0.2.30']:
            directory=self.root/'versions'/old
            with ZipFile(self.package(old)) as z:z.extractall(directory)
            wheel=directory/'bridge/wheels/pydicom-3.0.2-py3-none-any.whl';wheel.parent.mkdir()
            with ZipFile(wheel,'w') as z:z.writestr('pydicom/module.py',b'pinned package')
            manifest=desktop.read_json(directory/'SHA256SUMS.json')
            manifest[wheel.relative_to(directory).as_posix()]=hashlib.sha256(wheel.read_bytes()).hexdigest()
            desktop.atomic_json(directory/'SHA256SUMS.json',manifest)
            cache=directory/'bridge/.radaz-deps-3.0.4'
            with ZipFile(wheel) as z:z.extractall(cache)
            (cache/'.complete').write_text('pydicom 3.0.2 · pynetdicom 3.0.4',encoding='utf-8')
        (self.root/'versions/0.2.30/bridge/.radaz-deps-3.0.4/user-note.txt').write_text('keep')
        desktop.atomic_json(self.root/'activation-verified.json',{'version':self.base})
        with patch.object(desktop,'runtime_processes',return_value={'versions':[self.base]}):
            self.assertEqual(desktop.cleanup_versions(self.root),['0.2.29'])
        self.assertTrue((self.root/'versions/0.2.30').exists())

    def test_old_controller_activation_requires_matching_runtime_health_archive_and_listener(self):
        desktop.atomic_json(self.source/'dist/server/radaz-build.json',{'buildId':'expected'})
        good=[{'name':'RADAZ','version':self.base,'buildId':'expected','pid':123},
              {'ready':True,'buildId':'expected'},{'version':1,'desktopManaged':True,'appVersion':self.base}]
        marker=self.root/'activation-verified.json'
        for index,field,value in [(0,'buildId','old'),(0,'version','0.2.1'),(0,'pid',999),(1,'ready',False),(2,'appVersion','0.2.1')]:
            responses=[dict(item) for item in good];responses[index][field]=value
            with patch.object(desktop,'get_json',side_effect=responses),patch.object(desktop,'runtime_processes',return_value={'pid':123}):
                with self.assertRaises(RuntimeError):desktop.verify_activation(self.root,self.base)
            self.assertFalse(marker.exists())
        with patch.object(desktop,'get_json',side_effect=good),patch.object(desktop,'runtime_processes',return_value={'pid':123}):
            desktop.verify_activation(self.root,self.base)
        self.assertEqual(desktop.read_json(marker)['version'],self.base)

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

    def file_release(self):
        raw=self.new.read_bytes();entries=[]
        with ZipFile(self.new) as archive:
            manifest=json.loads(archive.read('SHA256SUMS.json'))
            for name,digest in manifest.items():
                info=archive.getinfo(name);n,e=struct.unpack_from('<HH',raw,info.header_offset+26)
                entries.append(dict(path=name,size=info.file_size,sha256=digest,offset=info.header_offset+30+n+e,compressedSize=info.compress_size,compression=info.compress_type))
        name=f'RADAZ-{self.target}-Windows-x64.zip'
        return dict(tag_name='v'+self.target,draft=False,prerelease=False,assets=[dict(name=name,state='uploaded',size=len(raw),digest='sha256:'+hashlib.sha256(raw).hexdigest(),browser_download_url=f'https://github.com/{desktop.UPDATE_REPOSITORY}/releases/download/v{self.target}/{name}')],
                    distribution=dict(version=self.target,fileTransport='zip-ranges-v1',files=entries)),raw

    def test_file_update_skips_releases_and_repairs_missing_and_corrupt_files(self):
        # An installed version need not have a matching delta, and its own
        # manifest may claim a file is healthy when the bytes are actually old.
        (self.source/'runtime/node/node.exe').write_bytes(b'broken')
        (self.source/'installer/launcher.ps1').unlink()
        release,raw=self.file_release();requested=[]
        def response(request,**kwargs):
            start,end=map(int,request.get_header('Range')[6:].split('-'));requested.append((start,end))
            result=io.BytesIO(raw[start:end+1]);result.status=206
            result.headers={'Content-Range':f'bytes {start}-{end}/{len(raw)}'};return result
        with patch.object(desktop,'urlopen',side_effect=response):
            desktop.stage_file_update(self.root,release,self.target,self.base)
        destination=self.root/'versions'/self.target
        desktop.validate_directory(destination,self.target)
        self.assertEqual(desktop.read_json(self.root/'active.json')['version'],self.base)
        self.assertEqual((self.source/'runtime/node/node.exe').read_bytes(),b'broken')
        unchanged=next(e for e in release['distribution']['files'] if e['path']=='runtime/python/python.exe')
        self.assertNotIn((unchanged['offset'],unchanged['offset']+unchanged['compressedSize']-1),requested)
        self.assertFalse((destination/'old-only.txt').exists())
        self.assertEqual(desktop.read_json(self.root/'pending.json')['version'],self.target)
        self.assertEqual(desktop.read_json(self.root/'update-state.json')['diagnostic']['verifiedFiles'],len(release['distribution']['files']))

    def test_file_update_rejects_ignored_range_or_bad_bytes_without_ready_marker(self):
        release,raw=self.file_release()
        for kind in ('full','corrupt'):
            def response(request,**kwargs):
                start,end=map(int,request.get_header('Range')[6:].split('-'))
                result=io.BytesIO(raw if kind=='full' else b'X'*(end-start+1))
                result.status=200 if kind=='full' else 206
                result.headers={'Content-Range':f'bytes {start}-{end}/{len(raw)}'};return result
            with patch.object(desktop,'urlopen',side_effect=response):
                with self.assertRaises((ValueError,desktop.zlib.error)):
                    desktop.stage_file_update(self.root,release,self.target,self.base)
            self.assertFalse((self.root/'pending.json').exists())
            self.assertFalse((self.root/'versions'/self.target).exists())

    def test_file_update_rejects_unsafe_and_overlapping_signed_index(self):
        for change in ('path','offset'):
            release,_=self.file_release();entry=release['distribution']['files'][1]
            entry[change]='../escape' if change=='path' else release['distribution']['files'][0]['offset']
            with patch.object(desktop,'urlopen') as network:
                with self.assertRaises(ValueError):desktop.stage_file_update(self.root,release,self.target,self.base)
                network.assert_not_called()

    def test_file_update_reuses_cdn_redirect_and_honors_rate_limit_delay(self):
        release,raw=self.file_release();requests=[];limited=False
        cdn='https://release-assets.githubusercontent.com/fixture.zip?sig=fixture'
        def response(request,**kwargs):
            nonlocal limited
            requests.append(request.full_url)
            if len(requests)>1 and not limited:
                limited=True
                raise desktop.HTTPError(request.full_url,429,'Rate limited',{'Retry-After':'7'},None)
            start,end=map(int,request.get_header('Range')[6:].split('-'))
            result=io.BytesIO(raw[start:end+1]);result.status=206
            result.headers={'Content-Range':f'bytes {start}-{end}/{len(raw)}'}
            result.geturl=lambda:cdn
            return result
        with patch.object(desktop,'urlopen',side_effect=response),patch.object(desktop.time,'sleep') as sleep:
            desktop.stage_file_update(self.root,release,self.target,self.base)
        self.assertTrue(requests[0].startswith('https://github.com/'))
        self.assertGreater(len(requests),3)
        self.assertTrue(all(url.startswith(cdn+'&radaz_range=') for url in requests[1:]))
        sleep.assert_called_once_with(7)
        desktop.validate_directory(self.root/'versions'/self.target,self.target)

    def test_file_update_refreshes_expired_cdn_url_without_full_download(self):
        release,raw=self.file_release();requests=[]
        def response(request,**kwargs):
            requests.append(request.full_url)
            if len(requests)==2:
                raise desktop.HTTPError(request.full_url,403,'Expired',{},None)
            start,end=map(int,request.get_header('Range')[6:].split('-'))
            result=io.BytesIO(raw[start:end+1]);result.status=206
            result.headers={'Content-Range':f'bytes {start}-{end}/{len(raw)}'}
            result.geturl=lambda:'https://release-assets.githubusercontent.com/fixture.zip?sig=new'
            return result
        with patch.object(desktop,'urlopen',side_effect=response),patch.object(desktop.time,'sleep'):
            desktop.stage_file_update(self.root,release,self.target,self.base)
        self.assertTrue(requests[1].startswith('https://release-assets.githubusercontent.com/'))
        self.assertTrue(requests[2].startswith('https://github.com/'))
        desktop.validate_directory(self.root/'versions'/self.target,self.target)

    def test_file_transport_v2_repairs_missing_file_through_update_controller(self):
        release,raw=self.file_release()
        release['distribution']['fileTransport']='zip-ranges-v2'
        (self.source/'installer/launcher.ps1').unlink()
        def response(request,**kwargs):
            start,end=map(int,request.get_header('Range')[6:].split('-'))
            result=io.BytesIO(raw[start:end+1]);result.status=206
            result.headers={'Content-Range':f'bytes {start}-{end}/{len(raw)}'}
            return result
        with patch.object(desktop,'get_latest_release',return_value=release),patch.object(desktop,'urlopen',side_effect=response):
            desktop.check_update(self.root,approved_version=self.target)
        desktop.validate_directory(self.root/'versions'/self.target,self.target)
        self.assertTrue((self.root/'versions'/self.target/'installer/launcher.ps1').is_file())
        self.assertEqual(desktop.read_json(self.root/'active.json')['version'],self.base)

if __name__=='__main__':unittest.main()
