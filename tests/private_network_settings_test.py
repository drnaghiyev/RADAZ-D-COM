"""Local settings authorization with generated secrets and isolated test stores."""
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import secrets
import sys
import tempfile
import time
import unittest
from unittest.mock import Mock, patch

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'bridge'))
from private_network_client import NetworkClient
from private_network_settings import SettingsError, SettingsLock, SESSION_SECONDS


class NetworkSettingsPasswordTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)
        self.database = self.root / 'settings' / 'password.sqlite3'
        self.guard = SettingsLock(self.database)
        self.password = secrets.token_urlsafe(32)

    def test_first_setup_is_atomic_and_never_overwrites(self):
        def enroll(password):
            try:
                return SettingsLock(self.database).action('settings_set', {'password':password})
            except SettingsError as error:
                return error.code

        choices = [self.password, secrets.token_urlsafe(32)]
        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(enroll, choices))
        self.assertEqual(results.count('SETTINGS_PASSWORD_EXISTS'), 1)
        index = next(i for i,result in enumerate(results) if isinstance(result,dict))
        self.assertFalse(self.guard.status(results[index]['session'])['unlocked'])
        self.assertTrue(self.guard.status()['passwordSet'])
        self.assertTrue(self.guard.action('settings_unlock',{'password':choices[index]})['unlocked'])
        self.assertNotIn(choices[index].encode(), self.database.read_bytes())

    def test_archive_change_and_desktop_update_preserve_the_local_password_location(self):
        installation = self.root/'RADAZ'
        with patch.dict('os.environ',{'LOCALAPPDATA':str(self.root/'local'),'RADAZ_INSTALL_ROOT':''}):
            first = SettingsLock.for_install(installation)
            first.action('settings_set',{'password':self.password})
            for version in ('0.2.92','0.2.93'):
                bridge = installation/'versions'/version/'bridge'/'private_network_settings.py'
                with patch('private_network_settings.__file__',str(bridge)):
                    a = NetworkClient(Mock(root=self.root/'archive1'))
                    b = NetworkClient(Mock(root=self.root/'archive2'))
                    self.assertEqual(a.settings_lock.database,b.settings_lock.database)
                    self.assertEqual(a.settings_lock.database, first.database)
                    self.assertTrue(b.action('settings_status',{})['passwordSet'])
            self.assertFalse(SettingsLock.for_install(self.root/'other-install').status()['passwordSet'])

    def test_expiry_relock_and_password_change_revoke_tokens(self):
        g = self.guard
        first = g.action('settings_set',{'password':self.password})['session']
        second = g.action('settings_unlock',{'password':self.password})['session']
        other_process = SettingsLock(self.database)
        third = other_process.action('settings_unlock',{'password':self.password})['session']
        g.action('settings_lock',{},first)
        self.assertFalse(g.status(first)['unlocked'])
        self.assertTrue(g.status(second)['unlocked'])
        replacement = secrets.token_urlsafe(32)
        with self.assertRaises(SettingsError):
            g.action('settings_change',{'currentPassword':replacement,'newPassword':replacement},second)
        changed = g.action('settings_change',{'currentPassword':self.password,'newPassword':replacement},second)['session']
        self.assertFalse(g.status(second)['unlocked'])
        self.assertFalse(other_process.status(third)['unlocked'])
        with self.assertRaises(SettingsError):
            other_process.action('settings_unlock',{'password':self.password})
        self.assertTrue(g.status(changed)['unlocked'])
        with patch('private_network_settings.time.monotonic',return_value=time.monotonic()+SESSION_SECONDS+1):
            with self.assertRaises(SettingsError):
                g.require(changed)

    def test_throttle_persists_and_clear_password_never_replaces_verifier(self):
        self.guard.action('settings_set',{'password':self.password})
        guess = secrets.token_urlsafe(32)
        for _ in range(5):
            with self.assertRaises(SettingsError) as wrong:
                self.guard.action('settings_unlock',{'password':guess})
            self.assertEqual(wrong.exception.code,'SETTINGS_PASSWORD_INVALID')
        restarted = SettingsLock(self.database)
        with self.assertRaises(SettingsError) as limited:
            restarted.action('settings_unlock',{'password':self.password})
        self.assertEqual(limited.exception.status,429)
        with patch('private_network_settings.time.time',return_value=time.time()+10):
            self.assertTrue(restarted.action('settings_unlock',{'password':self.password})['unlocked'])

    def test_all_settings_require_token_and_operational_state_uses_only_recipient_information(self):
        network = NetworkClient(Mock(root=self.root/'archive'),self.root/'network')
        locked_actions = ('settings_state','device','configure','register','local_setup','create_clinic','member',
                          'remove_member','invite','policy','link_clinic','device-set','block_device','block_user')
        for action in locked_actions:
            with self.subTest(action=action), self.assertRaises(SettingsError) as error:
                network.action(action,{})
            self.assertEqual(error.exception.code,'SETTINGS_LOCKED')
        self.assertFalse(network.settings_lock.database.exists())
        raw = {'enabled':True,'online':True,'configured':True,'url':'private','policy':{'rules':[]},
               'memberManagementVersion':2,'devices':[{'id':'internal'}],'membership':{'permissions':['send']},
               'members':[{'id':'r','name':'Receiver','permissions':['receive','download'],'active':True},
                          {'id':'a','name':'Admin','permissions':['manage_schedule'],'active':True}],
               'history':[{'action':'member'},{'action':'send'}],'deliveries':[],'sent':[],'queue':[]}
        with patch.object(network,'state',return_value=raw):
            public = network.action('state',{})
            self.assertEqual(public['members'],[{'id':'r','name':'Receiver','active':True,'permissions':['receive']}])
            self.assertEqual(public['history'],[{'action':'send'}])
            self.assertTrue({'policy','url','devices','memberManagementVersion'}.isdisjoint(public))
            token = network.action('settings_set',{'password':self.password})['session']
            self.assertEqual(network.action('settings_state',{},token),raw)
            network.action('settings_lock',{},token)
            with self.assertRaises(SettingsError):
                network.action('settings_state',{},token)


if __name__ == '__main__':
    unittest.main()
