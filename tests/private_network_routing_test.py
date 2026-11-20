import sys, unittest, tempfile
from pathlib import Path
from datetime import datetime, timezone
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'bridge'))
from private_network_routing import select_recipients
from private_network_sync import observe,poll

class RoutingTest(unittest.TestCase):
    def test_midnight_absence_override_and_workload(self):
        members=[{'id':n,'role':'radiologist','permissions':['receive'],'active':True} for n in ('A','B','C')]
        policy={'timezone':'UTC','shifts':[{'days':[1],'start':'20:00','end':'06:00','recipients':['A','B']}],
                'exceptions':[{'date':'2026-11-17','off':['A'],'substitutes':{'A':'C'}}],
                'autoEnabled':True,'rules':[{'enabled':True,'modalities':['CT'],'leastLoaded':True}]}
        tue=datetime(2026,11,17,1,0,tzinfo=timezone.utc)
        self.assertEqual(select_recipients('duty',{},policy,members,{},tue),['C','B'])
        self.assertEqual(select_recipients('auto',{'modality':'CT'},policy,members,{'C':3},tue),['B'])
        with self.assertRaises(ValueError):
            select_recipients('auto',{'modality':'MR'},policy,members,{},tue)
        with self.assertRaises(ValueError):
            select_recipients('duty',{},policy,members,{},tue.replace(hour=8))

    def test_quiet_window_and_clinic_isolation(self):
        import time
        class Client:
            def __init__(self,root):
                self.root=root
                self.jobs=[]
                self.clinic='clinicA'
            def settings(self):return {'enabled':True,'syncClinic':self.clinic}
            def rpc(self,*args):return {'policy':{'autoEnabled':True,'rules':[{'enabled':True,'aeTitles':['CT1']}]}}
            def received(self,study):return True  # The same study once had an incoming series.
            def send(self,payload):self.jobs.append(payload)
        with tempfile.TemporaryDirectory() as temp:
            client=Client(Path(temp));now=time.time()
            observe(client,'study','1','CT','archive','CT1','dev')
            poll(client,now);self.assertFalse(client.jobs)
            client.clinic='clinicB';poll(client,now+100);self.assertFalse(client.jobs)
            client.clinic='clinicA';poll(client,now+100);poll(client,now+101)
            self.assertEqual([j['onlyUids'] for j in client.jobs],[['1']])
            observe(client,'study','2','CT','archive','CT1','dev')
            poll(client,now+101)
            self.assertEqual(client.jobs[-1]['onlyUids'],['2'])
