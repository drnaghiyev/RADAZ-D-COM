"""No real releases or clinical data: validate updater failures and atomic activation."""
import hashlib
import importlib.util
import json
import os
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch
from zipfile import ZipFile
from urllib.error import HTTPError, URLError

spec = importlib.util.spec_from_file_location('desktop', Path(__file__).resolve().parents[1] / 'bridge/radaz_desktop.py')
desktop = importlib.util.module_from_spec(spec); spec.loader.exec_module(desktop)

class DesktopUpdates(unittest.TestCase):
    def test_setup_starts_fresh_install_but_only_stages_an_upgrade(self):
        source = self.root / 'package'
        (source / 'public').mkdir(parents=True)
        (source / 'installer').mkdir()
        (source / 'public/radaz.ico').write_bytes(b'synthetic-icon')
        (source / 'installer/launcher.ps1').write_text('# synthetic launcher')
        desktop.atomic_json(source / 'public/product.json', {'version': '0.2.9'})
        (self.root / 'active.json').unlink()
        arguments = ['radaz_desktop.py', 'initialize', '--install-root', str(self.root), '--no-shortcuts', '--start-background']
        with patch.object(desktop, 'SOURCE', source), patch.object(desktop, 'validate_directory'), patch.object(desktop, 'launch') as start, patch('sys.argv', arguments):
            desktop.main()
            start.assert_called_once_with(self.root, no_browser=True)
            self.assertEqual(desktop.read_json(self.root / 'active.json')['version'], '0.2.9')
            self.assertEqual((self.root / 'radaz.ico').read_bytes(), b'synthetic-icon')
            desktop.atomic_json(source / 'public/product.json', {'version': '0.2.10'})
            desktop.main()
            self.assertEqual(start.call_count, 1, 'An upgrade must not restart the running examination')
            self.assertEqual(desktop.read_json(self.root / 'active.json')['version'], '0.2.9')
            self.assertEqual(desktop.read_json(self.root / 'pending.json')['version'], '0.2.10')

    def test_transient_release_error_retries_same_asset_with_fresh_query(self):
        url='https://github.com/drnaghiyev/RADAZ-D-COM/releases/download/v0.2.14/RADAZ-0.2.14-Windows-x64.zip'
        response=object()
        with patch.object(desktop,'urlopen',side_effect=[HTTPError(url,503,'temporary',{},None),response]) as opened,patch.object(desktop.time,'sleep'):
            self.assertIs(desktop.open_release_download(url),response)
        original,retry=[call.args[0].full_url for call in opened.call_args_list]
        self.assertEqual(original,url)
        self.assertTrue(retry.startswith(url+'?radaz_retry='))

    def test_release_retry_is_bounded_and_does_not_retry_denied_requests(self):
        for code,attempts in [(503,3),(403,1),(404,1)]:
            with patch.object(desktop,'urlopen',side_effect=HTTPError('https://github.com',code,'failure',{},None)) as opened,patch.object(desktop.time,'sleep'):
                with self.assertRaises(HTTPError):desktop.open_release_download('https://github.com/asset.zip')
                self.assertEqual(opened.call_count,attempts)

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.root = Path(self.temp.name)
        desktop.atomic_json(self.root / 'active.json', {'version':'0.2.8'})
        self.target = '0.2.9'
        self.files = {
            'public/product.json':json.dumps({'name':'RADAZ','version':self.target,'repository':desktop.REPOSITORY,'licenseRequired':True}).encode(),
            'desktop.json':json.dumps({'schema':1,'version':self.target,'architecture':'x64'}).encode(),
            'dist/server/radaz-build.json':json.dumps({'product':{'version':self.target},'buildId':'synthetic'}).encode(),
            **{name:b'synthetic' for name in ['runtime/node/node.exe','runtime/python/python.exe','dist/runtime/web-server.mjs','bridge/radaz_desktop.py','installer/launcher.ps1']},
        }
        self.archive = self.root / 'test.zip'

    def tearDown(self): self.temp.cleanup()

    def package(self, extras=None):
        files = {**self.files, **(extras or {})}
        with ZipFile(self.archive, 'w') as package:
            for name,data in files.items(): package.writestr(name,data)
            package.writestr('SHA256SUMS.json', json.dumps({name:hashlib.sha256(data).hexdigest() for name,data in files.items()}))
        return hashlib.sha256(self.archive.read_bytes()).hexdigest(), self.archive.stat().st_size

    def stage(self, extras=None):
        digest,size = self.package(extras)
        desktop.stage_package(self.root,self.archive,self.target,digest,size)

    def test_download_stages_without_changing_active_installation(self):
        self.stage()
        self.assertEqual(desktop.read_json(self.root/'active.json')['version'],'0.2.8')
        self.assertEqual(desktop.read_json(self.root/'pending.json')['version'],'0.2.9')
        self.assertEqual(desktop.read_json(self.root/'update-state.json')['state'],'ready')
        desktop.validate_directory(self.root/'versions/0.2.9','0.2.9')

    def release(self):
        digest,size=self.package()
        return {'tag_name':'v'+self.target,'draft':False,'prerelease':False,'assets':[{
            'name':f'RADAZ-{self.target}-Windows-x64.zip','state':'uploaded','size':size,'digest':'sha256:'+digest,
            'browser_download_url':f'https://github.com/{desktop.UPDATE_REPOSITORY}/releases/download/v{self.target}/RADAZ-{self.target}-Windows-x64.zip'}]}

    def test_discovery_and_stale_approval_never_download(self):
        release=self.release()
        with patch.object(desktop,'get_latest_release',return_value=release),patch.object(desktop,'open_release_download') as opened:
            for approved in (None,'0.2.8','0.3.0'):
                desktop.check_update(self.root,approved)
                self.assertEqual(desktop.read_json(self.root/'update-state.json')['state'],'available')
                self.assertFalse((self.root/'pending.json').exists())
            opened.assert_not_called()

    def test_staged_older_release_does_not_hide_latest_and_keeps_old_without_approval(self):
        desktop.atomic_json(self.root/'pending.json',{'version':'0.2.8'})
        desktop.atomic_json(self.root/'active.json',{'version':'0.2.7'})
        release=self.release()
        with patch.object(desktop,'get_latest_release',return_value=release),patch.object(desktop,'open_release_download') as opened:
            desktop.check_update(self.root)
            self.assertEqual(desktop.read_json(self.root/'update-state.json')['version'],self.target)
            self.assertEqual(desktop.read_json(self.root/'update-state.json')['state'],'available')
            self.assertEqual(desktop.read_json(self.root/'pending.json')['version'],'0.2.8')
            opened.assert_not_called()
        with patch.object(desktop,'get_latest_release',side_effect=OSError('offline')):
            desktop.check_update(self.root)
            self.assertEqual(desktop.read_json(self.root/'update-state.json')['state'],'ready')
            self.assertEqual(desktop.read_json(self.root/'update-state.json')['version'],'0.2.8')

    def test_confirmed_version_downloads_and_stages_with_progress(self):
        release=self.release()
        with patch.object(desktop,'get_latest_release',return_value=release),patch.object(desktop,'open_release_download',side_effect=lambda _:self.archive.open('rb')):
            desktop.check_update(self.root,self.target)
        self.assertEqual(desktop.read_json(self.root/'update-state.json')['state'],'ready')
        self.assertEqual(desktop.read_json(self.root/'active.json')['version'],'0.2.8')
        self.assertEqual(desktop.read_json(self.root/'pending.json')['version'],self.target)

    def test_legacy_requests_cannot_approve_and_confirmation_is_consumed_once(self):
        for payload in ({},{'requestedAt':123},{'action':'check'},{'action':'download','version':self.target,'confirmed':False}):
            desktop.atomic_json(self.root/'update-request.json',payload)
            self.assertIsNone(desktop.consume_update_request(self.root))
        desktop.atomic_json(self.root/'update-request.json',{'action':'download','version':self.target,'confirmed':True})
        self.assertEqual(desktop.consume_update_request(self.root),self.target)
        self.assertIsNone(desktop.consume_update_request(self.root))

    def test_static_feed_avoids_api_quota_and_old_releases_fall_back(self):
        release=self.release()
        with patch.object(desktop,'get_json',return_value=release) as request:
            self.assertEqual(desktop.get_latest_release(),release)
            self.assertEqual(request.call_count,1)
            self.assertIn('/releases/latest/download/radaz-update.json',request.call_args.args[0])
        with patch.object(desktop,'get_json',side_effect=[HTTPError('static',404,'missing',{},None),release]) as request:
            self.assertEqual(desktop.get_latest_release(),release)
            self.assertIn('api.github.com',request.call_args.args[0])

    def test_portable_update_error_does_not_stay_cached_for_six_hours(self):
        import sys
        sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'bridge'))
        from radaz_product import ProductService
        config=self.root/'product.json';config.write_text(json.dumps({'version':'0.2.8','updateRepository':desktop.UPDATE_REPOSITORY}))
        service=ProductService(self.root,config_path=config,device='TEST',trial_root=self.root/'trial')
        with patch('radaz_desktop.get_latest_release',side_effect=[URLError('offline'),{'tag_name':'v0.2.15'}]) as request:
            with patch('radaz_product.time.time',return_value=1000):self.assertEqual(service.updates()['state'],'error')
            with patch('radaz_product.time.time',return_value=1010):self.assertEqual(service.updates()['state'],'error')
            with patch('radaz_product.time.time',return_value=1061):self.assertEqual(service.updates()['state'],'available')
            self.assertEqual(request.call_count,2)

    @unittest.skipUnless(os.name == 'nt', 'Windows sharing violation regression')
    def test_progress_survives_a_real_windows_reader_blocking_replace(self):
        import ctypes
        from ctypes import wintypes
        file=self.root/'update-state.json'
        desktop.atomic_json(file, {'state':'downloading','progress':10})
        kernel=ctypes.WinDLL('kernel32',use_last_error=True)
        kernel.CreateFileW.argtypes=[wintypes.LPCWSTR,wintypes.DWORD,wintypes.DWORD,ctypes.c_void_p,wintypes.DWORD,wintypes.DWORD,wintypes.HANDLE]
        kernel.CreateFileW.restype=wintypes.HANDLE
        kernel.CloseHandle.argtypes=[wintypes.HANDLE]
        # Share read/write but deliberately omit FILE_SHARE_DELETE, as a transient reader can.
        handle=kernel.CreateFileW(str(file),0x80000000,3,None,3,0,None)
        self.assertNotEqual(handle,ctypes.c_void_p(-1).value)
        timer=threading.Timer(.12,lambda:kernel.CloseHandle(handle));timer.start()
        try:
            desktop.atomic_json(file, {'state':'downloading','progress':20})
        finally:
            timer.join()
        self.assertEqual(desktop.read_json(file)['progress'],20)
        self.assertEqual(list(self.root.glob('*.tmp')),[])

    def test_permanent_replace_failure_preserves_old_json_and_cleans_temporary(self):
        file=self.root/'update-state.json';desktop.atomic_json(file, {'state':'downloading','progress':10})
        with patch.object(desktop.os,'replace',side_effect=PermissionError('locked')),patch.object(desktop.time,'sleep'),self.assertRaises(PermissionError):
            desktop.atomic_json(file, {'state':'ready'})
        self.assertEqual(desktop.read_json(file),{'state':'downloading','progress':10})
        self.assertEqual(list(self.root.glob('*.tmp')),[])

    def test_staging_reports_real_extraction_progress_and_completion(self):
        updates=[]
        original=desktop.state
        def record(*args, **kwargs):
            original(*args, **kwargs)
            updates.append(desktop.read_json(self.root/'update-state.json'))
        with patch.object(desktop,'state',side_effect=record): self.stage()
        self.assertEqual(updates[0]['state'],'verifying')
        installing=[entry for entry in updates if entry['state']=='installing']
        self.assertTrue(installing)
        self.assertEqual(installing[-1]['progress']['done'],installing[-1]['progress']['total'])
        self.assertEqual(updates[-1]['state'],'ready')
        self.assertEqual(updates[-1]['progress'],{'done':1,'total':1,'unit':'yeniləmə'})

    def test_corrupt_download_preserves_active_and_does_not_stage(self):
        digest,size=self.package()
        with self.assertRaisesRegex(ValueError,'SHA-256'):
            desktop.stage_package(self.root,self.archive,self.target,'0'*64,size)
        self.assertFalse((self.root/'pending.json').exists())
        self.assertEqual(desktop.read_json(self.root/'active.json')['version'],'0.2.8')

    def test_rejects_zip_slip_windows_alias_and_case_collisions(self):
        for name in ('../escape','/absolute','runtime\\escape','runtime/C:stream','runtime/NUL','runtime/node/NODE.exe'):
            with self.subTest(name=name), self.assertRaises(ValueError): self.stage({name:b'bad'})
        self.assertFalse((self.root/'pending.json').exists())

    def test_missing_runtime_and_mismatched_build_are_rejected(self):
        del self.files['runtime/node/node.exe']
        with self.assertRaisesRegex(ValueError,'missing'): self.stage()
        self.files['runtime/node/node.exe']=b'node'
        self.files['dist/server/radaz-build.json']=b'{"product":{"version":"9.0.0"}}'
        with self.assertRaisesRegex(ValueError,'Build version'): self.stage()

    def test_only_new_complete_release_on_fixed_repository_is_accepted(self):
        asset={'name':'RADAZ-0.2.9-Windows-x64.zip','state':'uploaded','size':123,'digest':'sha256:'+'a'*64,
               'browser_download_url':f'https://github.com/{desktop.UPDATE_REPOSITORY}/releases/download/v0.2.9/RADAZ-0.2.9-Windows-x64.zip'}
        release={'tag_name':'v0.2.9','draft':False,'prerelease':False,'assets':[asset]}
        self.assertEqual(desktop.select_asset(release,'0.2.8')[0],'0.2.9')
        self.assertIsNone(desktop.select_asset(release,'0.2.9'))
        for mutation in ({'draft':True},{'prerelease':True},{'assets':[]},{'assets':[{**asset,'digest':None}]},{'assets':[{**asset,'browser_download_url':'https://example.com/payload.zip'}]}):
            with self.subTest(mutation=mutation),self.assertRaises(ValueError): desktop.select_asset({**release,**mutation},'0.2.8')

    def test_successful_launch_switches_pointer_only_after_health_check(self):
        self.stage()
        def start(root,target):
            self.assertEqual(desktop.read_json(root/'active.json')['version'],'0.2.8')
            return 'synthetic'
        with patch.object(desktop,'open_version',side_effect=start),patch.object(desktop,'run_hidden'):
            desktop.launch(self.root,no_browser=True)
        self.assertEqual(desktop.read_json(self.root/'active.json'),{'version':'0.2.9','previousVersion':'0.2.8'})
        self.assertFalse((self.root/'pending.json').exists())

    def test_apply_does_not_wait_for_a_release_check_or_update_lock(self):
        self.stage()
        desktop.atomic_json(self.root/'apply-request.json', {'confirmed':True,'version':self.target})
        with desktop.lock(self.root, 'update'), patch.object(desktop,'get_latest_release',side_effect=AssertionError('Offline apply must not check GitHub')), patch.object(desktop,'open_version',return_value='healthy'), patch.object(desktop,'run_hidden'):
            self.assertTrue(desktop.apply_update(self.root))
        self.assertEqual(desktop.read_json(self.root/'active.json')['version'],self.target)
        self.assertFalse((self.root/'apply-request.json').exists())
        self.assertFalse((self.root/'apply-request.consumed.json').exists())

    def test_stale_apply_cannot_activate_a_different_download(self):
        self.stage()
        desktop.atomic_json(self.root/'apply-request.json', {'confirmed':True,'version':'0.2.99'})
        with patch.object(desktop,'launch') as launched:
            self.assertFalse(desktop.apply_update(self.root))
            launched.assert_not_called()
        self.assertEqual(desktop.read_json(self.root/'active.json')['version'],'0.2.8')

    def test_runtime_recovery_keeps_unapplied_download_staged(self):
        self.stage()
        with patch.object(desktop,'open_version',return_value='old-build') as started:
            desktop.recover_server(self.root)
            started.assert_called_once_with(self.root,'0.2.8')
        self.assertEqual(desktop.read_json(self.root/'pending.json')['version'],self.target)

    def test_app_window_preserves_browser_profile_and_localhost_origin(self):
        with patch.object(desktop,'app_browser',return_value=Path('C:/test browser/msedge.exe')), patch.object(desktop,'run_hidden') as started, patch.dict(os.environ,{'RADAZ_PORT':'5173'}):
            desktop.open_app(self.root,'verified-build')
        command=started.call_args.args[0]
        self.assertEqual(command[0],'C:\\test browser\\msedge.exe' if os.name=='nt' else 'C:/test browser/msedge.exe')
        self.assertIn('--app=http://localhost:5173/?radaz-build=verified-build',command)
        self.assertFalse(any('user-data-dir' in arg or 'incognito' in arg or 'inprivate' in arg for arg in command))

    def test_update_feed_uses_the_main_product_repository(self):
        self.assertEqual(desktop.UPDATE_REPOSITORY, desktop.REPOSITORY)
        self.assertEqual(desktop.UPDATE_REPOSITORY, 'drnaghiyev/RADAZ-D-COM')
        with patch.object(desktop, 'get_json', return_value={'tag_name':'v0.2.8'}) as request:
            desktop.check_update(self.root)
        self.assertIn(desktop.UPDATE_REPOSITORY, request.call_args.args[0])
        self.assertEqual(desktop.read_json(self.root/'update-state.json')['state'], 'current')
        self.stage()  # Existing installations still validate the original product identity.

    def test_feed_failures_are_not_reported_as_current(self):
        self.assertIn('404', desktop.update_error_message(HTTPError('https://api.github.com',404,'missing',{},None)))
        self.assertIn('GitHub', desktop.update_error_message(HTTPError('https://api.github.com',403,'limited',{},None)))
        self.assertIn('İnternet', desktop.update_error_message(URLError('offline')))

    def test_failed_health_check_preserves_cause_and_rolls_back(self):
        self.stage()
        with patch.object(desktop,'open_version',side_effect=[RuntimeError('bad runtime'),'old-build']) as start,patch.object(desktop,'run_hidden'):
            desktop.launch(self.root,no_browser=True)
        self.assertEqual([call.args[1] for call in start.call_args_list],['0.2.9','0.2.8'])
        self.assertEqual(desktop.read_json(self.root/'active.json')['version'],'0.2.8')
        self.assertEqual(desktop.read_json(self.root/'failed-update.json')['version'],'0.2.9')
        detail=desktop.read_json(self.root/'update-state.json')['diagnostic']
        self.assertEqual(detail['message'],'bad runtime')
        self.assertEqual(detail['phase'],'startup-health')
        self.assertIn('bad runtime',(self.root/'logs/update-errors.jsonl').read_text())

    def test_failed_release_is_discoverable_and_explicit_retry_is_allowed(self):
        release=self.release()
        desktop.atomic_json(self.root/'failed-update.json',{'version':self.target,'diagnostic':{'message':'old timeout'}})
        with patch.object(desktop,'get_latest_release',return_value=release),patch.object(desktop,'open_release_download',side_effect=lambda _:self.archive.open('rb')) as download:
            desktop.check_update(self.root)
            self.assertEqual(desktop.read_json(self.root/'update-state.json')['state'],'available')
            self.assertEqual(desktop.read_json(self.root/'update-state.json')['diagnostic']['message'],'old timeout')
            download.assert_not_called()
            desktop.check_update(self.root,self.target)
            self.assertEqual(download.call_count,1)
            self.assertEqual(desktop.read_json(self.root/'update-state.json')['state'],'ready')
        with patch.object(desktop,'open_version',return_value='verified-build'),patch.object(desktop,'run_hidden'):
            desktop.launch(self.root,no_browser=True)
        self.assertFalse((self.root/'failed-update.json').exists())

    def test_fresh_verified_download_repairs_corrupt_inactive_candidate(self):
        self.stage()
        (self.root/'versions'/self.target/'runtime/node/node.exe').write_bytes(b'corrupt')
        digest,size=self.package()
        desktop.stage_package(self.root,self.archive,self.target,digest,size)
        desktop.validate_directory(self.root/'versions'/self.target,self.target)
        self.assertEqual(desktop.read_json(self.root/'active.json')['version'],'0.2.8')

    def test_rollback_failure_does_not_claim_previous_version_is_running(self):
        self.stage()
        with patch.object(desktop,'open_version',side_effect=[RuntimeError('new failed'),RuntimeError('old failed')]),patch.object(desktop,'run_hidden'),self.assertRaisesRegex(RuntimeError,'old failed'):
            desktop.launch(self.root,no_browser=True)
        status=desktop.read_json(self.root/'update-state.json')
        self.assertEqual(status['diagnostic']['message'],'new failed')
        self.assertEqual(status['diagnostic']['rollback']['message'],'old failed')
        self.assertEqual(desktop.read_json(self.root/'active.json')['version'],'0.2.8')

    def test_receiving_archive_defers_update_instead_of_marking_it_broken(self):
        self.stage()
        with patch.object(desktop,'open_version',side_effect=[desktop.ArchiveBusy(),'old-build']),patch.object(desktop,'run_hidden'):
            desktop.launch(self.root,no_browser=True)
        self.assertEqual(desktop.read_json(self.root/'active.json')['version'],'0.2.8')
        self.assertTrue((self.root/'pending.json').exists())
        self.assertFalse((self.root/'failed-update.json').exists())

    def test_denied_activation_commit_restores_old_runtime_and_keeps_old_pointer(self):
        self.stage()
        write=desktop.atomic_json
        def denied(file,value):
            if file.name=='active.json' and value['version']==self.target:raise PermissionError('active pointer locked')
            return write(file,value)
        with patch.object(desktop,'atomic_json',side_effect=denied),patch.object(desktop,'open_version',side_effect=['new-build','old-build']) as start,patch.object(desktop,'run_hidden'):
            desktop.launch(self.root,no_browser=True)
        self.assertEqual([call.args[1] for call in start.call_args_list],[self.target,'0.2.8'])
        self.assertEqual(desktop.read_json(self.root/'active.json')['version'],'0.2.8')
        detail=desktop.read_json(self.root/'update-state.json')['diagnostic']
        self.assertEqual(detail['phase'],'activation-commit')
        self.assertEqual(detail['message'],'active pointer locked')

if __name__=='__main__': unittest.main()
