import sys, unittest, threading
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'bridge'))
import numpy as np
from smart_volume_prompts import contour_prompts,infer_multiplanar

class MultiPlaneTests(unittest.TestCase):
 def test_three_planes_and_full_volume_consensus(self):
  contours=[dict(axis=a,slice=5,points=[[3,3],[7,3],[7,7],[3,7]]) for a in range(3)]
  groups=contour_prompts(contours,[10,10,10]);calls=[];progress=[]
  class Adapter:
   def infer(self,data,prompts,**kwargs):
    calls.append(prompts);kwargs['progress'](1)
    mask=np.zeros(data.shape,dtype='u1');mask[3:7,3:7,3:7]=1
    return {'mask':mask}
  mask=infer_multiplanar(Adapter(),np.zeros((10,10,10)),groups,0,1,threading.Event(),progress.append)
  self.assertEqual(len(calls),3);self.assertEqual(mask.sum(),64);self.assertEqual(progress[-1],1)
  for axis in range(3): np.testing.assert_array_equal(np.moveaxis(mask,2-axis,0)[5],groups[axis][5])
 def test_inconsistent_crossing_contours_rejected(self):
  with self.assertRaisesRegex(ValueError,'uyğun deyil'):
   contour_prompts([dict(axis=0,slice=5,points=[[3,3],[7,3],[7,7],[3,7]]),dict(axis=1,slice=5,points=[[0,0],[2,0],[2,2],[0,2]])],[10,10,10])
 def test_outside_rejected(self):
  with self.assertRaises(ValueError):contour_prompts([dict(axis=2,slice=5,points=[[-5,0],[7,3],[7,7]])],[10,10,10])

if __name__=='__main__':unittest.main()
