"""Coordinate and job lifecycle regressions; real-model tests are separate."""
import sys, unittest, threading, time, asyncio
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'bridge'))
import smart_volume_service as service
import numpy as np

class JobTests(unittest.TestCase):
    def test_interrupted_upload_releases_model_lock(self):
        class InterruptedRequest:
            async def body(self): raise asyncio.CancelledError()
        with self.assertRaises(asyncio.CancelledError):
            asyncio.run(service.create(InterruptedRequest()))
        self.assertFalse(service.lock.locked())

    def test_all_axes_roundtrip_and_manual_prompts(self):
        original=service.adapter
        try:
            voxels=np.arange(5*7*9,dtype=np.float32).reshape(5,7,9)
            mask=np.zeros(voxels.shape,dtype=np.uint8);mask[2,3,4]=2
            for axis,index in [(0,4),(1,3),(2,2)]:
                class Adapter:
                    def infer(self,data,prompts,**kwargs):
                        np.testing.assert_array_equal(data,np.moveaxis(voxels,2-axis,0))
                        self_test.assertEqual(int(prompts[index].sum()),1)
                        return {'mask':np.moveaxis((mask==2).astype('u1'),2-axis,0)}
                self_test=self;service.adapter=Adapter()
                job={'cancel':threading.Event(),'started':time.monotonic(),'progress':0}
                service.lock.acquire()
                service.infer(job,voxels,mask,{'axis':axis,'slices':[index],'label':2,'lower':0,'upper':500})
                self.assertEqual(job['status'],'needs-review')
                self.assertEqual(job['result'],(mask==2).astype('u1').tobytes())
                self.assertFalse(service.lock.locked())
        finally: service.adapter=original

    def test_cancel_preserves_no_candidate_and_releases_model(self):
        original=service.adapter
        class Adapter:
            def infer(self,*args,**kwargs): raise InterruptedError('Cancelled')
        service.adapter=Adapter()
        try:
            job={'cancel':threading.Event(),'started':time.monotonic(),'progress':0}
            service.lock.acquire()
            service.infer(job,np.ones((2,2,2)),np.ones((2,2,2)),{'axis':2,'slices':[0],'label':1,'lower':0,'upper':2})
            self.assertEqual(job['status'],'cancelled');self.assertNotIn('result',job)
            self.assertFalse(service.lock.locked())
        finally: service.adapter=original

if __name__=='__main__': unittest.main()
