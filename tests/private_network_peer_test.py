import hashlib
from pathlib import Path
import sys
import unittest
from unittest.mock import Mock
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'bridge'))
from private_network_peer import start
import radaz_pacs_bridge  # Add bundled DICOM wheels to the embedded Python runtime.
from private_network_client import crypto
import json


class PeerTest(unittest.TestCase):
    def test_direct_encrypted_delivery_and_fallback(self):
        keys=json.loads(crypto('keygen'))
        raw=b'synthetic DICOM bytes'
        sealed=crypto('seal',key=keys['publicKey'],context='object',data=raw)
        digest=hashlib.sha256(raw).hexdigest()
        receiver=Mock()
        receiver.peer=None
        receiver.settings.return_value={'url':'http://127.0.0.1:4000','enabled':True}
        receiver.peer=start(receiver)
        self.addCleanup(receiver.peer.stop)
        grant={'size':len(raw),'role':'recipient','peerProof':'ac'*32,'recipientDevice':'dev','peerHost':'127.0.0.1','peerPort':receiver.peer.server.server_port}
        receiver.rpc.return_value=grant
        sender=Mock()
        sender.peer=None
        sender.settings.return_value=receiver.settings()
        sender.peer=start(sender)
        self.addCleanup(sender.peer.stop)
        sender.rpc.return_value={**grant,'role':'sender'}
        item={'id':'delivery'}
        self.assertTrue(sender.peer.publish(item,'dev',digest,sealed))
        self.assertEqual(crypto('open',key=keys['privateKey'],context='object',data=receiver.peer.take(item,digest)),raw)
        self.assertIsNone(receiver.peer.take(item,digest))
        self.assertTrue(sender.peer.publish(item,'dev',digest,sealed))
        receiver.rpc.side_effect=PermissionError('download revoked')
        with self.assertRaises(PermissionError):
            receiver.peer.take(item,digest)
        self.assertIsNone(receiver.peer.take(item,digest))
        receiver.rpc.side_effect=None
        sender.rpc.return_value={**grant,'role':'sender','peerProof':'ee'*32}
        self.assertFalse(sender.peer.publish(item,'dev',digest,sealed))
        self.assertIsNone(receiver.peer.take(item,digest))
        sender.rpc.return_value={**grant,'role':'sender','peerHost':''}
        self.assertFalse(sender.peer.publish(item,'dev',digest,sealed))
