"""An actual loopback PACS must send complete, selected studies to the private outbox."""
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'bridge'))
from bridge_send_test import (AE, Archive, CTImageStorage, ExplicitVRLittleEndian,
                              StudyRootQueryRetrieveInformationModelGet, StudyRootQueryRetrieveInformationModelMove,
                              encoded, evt, image, port)
from private_network_client import NetworkClient


class DimseStageTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory(prefix='radaz-private-dimse-')
        self.addCleanup(temp.cleanup)
        root = Path(temp.name)
        self.client = NetworkClient(Archive(root/'archive',http_only=True),root/'network')
        self.client._settings = dict(enabled=True,token='synthetic-only')
        self.permission = patch.object(self.client,'rpc',return_value={'membership':{'permissions':['send']}}).start()
        self.addCleanup(patch.stopall)
        self.first = image()
        self.images = [self.first, image(self.first.StudyInstanceUID)]
        self.params = dict(clinic='clinic',study=str(self.first.StudyInstanceUID),expected=2,
                           series=[dict(uid=str(ds.SeriesInstanceUID),instanceCount=1) for ds in self.images],
                           pacs=dict(host='127.0.0.1',port=port(),aeTitle='SOURCE',callingAe='RADAZ',listenerPort=port()))

    def serve(self, move=False):
        ae = AE(ae_title='SOURCE')
        if move:
            ae.add_supported_context(StudyRootQueryRetrieveInformationModelMove)
            ae.add_requested_context(CTImageStorage, ExplicitVRLittleEndian)
        else:
            ae.add_supported_context(StudyRootQueryRetrieveInformationModelGet)
            ae.add_supported_context(CTImageStorage, ExplicitVRLittleEndian, scu_role=True, scp_role=True)
        def retrieve(event):
            self.assertEqual(event.identifier.QueryRetrieveLevel, 'STUDY')
            self.assertEqual(str(event.identifier.StudyInstanceUID), self.params['study'])
            if move:
                yield '127.0.0.1', self.params['pacs']['listenerPort']
            yield len(self.images)
            for ds in self.images:
                yield 0xFF00, ds
        server=ae.start_server(('127.0.0.1',self.params['pacs']['port']),block=False,
                               evt_handlers=[(evt.EVT_C_MOVE if move else evt.EVT_C_GET,retrieve)])
        self.addCleanup(server.shutdown)

    def test_get_queues_only_selected_complete_manifest(self):
        self.serve()
        stale=image(self.first.StudyInstanceUID)
        self.client.archive.store(encoded(stale),stale)
        with patch('radaz_pacs_bridge.MAX_IMAGES',1):
            staged=self.client.action('stage_dimse',self.params)
        self.assertEqual(staged['count'],2)
        send=dict(clinic='clinic',study=self.params['study'],mode='direct',recipients=['recipient'],stageId=staged['stageId'])
        with self.assertRaises(ValueError):
            self.client.send({**send,'clinic':'different'})
        job=self.client.send(send)
        with self.client.db() as db:
            record=json.loads(db.execute('SELECT payload FROM jobs WHERE id=?',(job['id'],)).fetchone()[0])
        self.assertEqual({f['uid'] for f in record['files']},{str(ds.SOPInstanceUID) for ds in self.images})
        self.assertEqual(len(self.client.archive.instances(self.params['study'])),1)
        self.permission.return_value={'membership':{'permissions':['receive']}}
        with self.assertRaisesRegex(ValueError,'icazə'):
            self.client.action('stage_dimse',self.params)

    def test_incomplete_and_foreign_series_never_staged(self):
        self.serve()
        with self.assertRaisesRegex(ValueError,'tam alınmadı'):
            self.client.action('stage_dimse',{**self.params,'expected':3})
        with self.assertRaises(ValueError):
            self.client.action('stage_dimse',{**self.params,'series':[self.params['series'][0]]})
        self.assertEqual(list((self.client.root/'pacs-stage').iterdir()),[])
        self.assertEqual(self.client.archive.studies(),[])

    def test_move_fallback(self):
        self.serve(move=True)
        staged=self.client.action('stage_dimse',self.params)
        self.assertEqual(staged['count'],2)
