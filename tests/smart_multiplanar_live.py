"""Explicit local synthetic smoke test; does not assess clinical accuracy."""
import json, struct, time, urllib.request
import numpy as np
base='http://127.0.0.1:5324/smart-volume-api'
n=16
z,y,x=np.indices((n,n,n))
values=np.where((x-8)**2+(y-8)**2+(z-8)**2<25,180,20).astype('<f4')
contours=[dict(axis=a,slice=8,points=[[5,5],[11,5],[11,11],[5,11]]) for a in range(3)]
header=json.dumps(dict(dimensions=[n]*3,axis=2,slices=[8],label=1,lower=0,upper=200,contours=contours)).encode()
body=struct.pack('<I',len(header))+header+values.tobytes()+bytes(n**3)
request=urllib.request.Request(base+'/jobs',data=body,headers={'Content-Type':'application/octet-stream'})
job=json.load(urllib.request.urlopen(request,timeout=30))['id']
deadline=time.monotonic()+240
while time.monotonic()<deadline:
    state=json.load(urllib.request.urlopen(base+'/jobs/'+job,timeout=15))
    if state['status']!='running': break
    time.sleep(2)
assert state['status']=='needs-review',state
mask=urllib.request.urlopen(base+'/jobs/'+job+'/mask',timeout=15).read()
assert len(mask)==n**3
assert any(mask)
print(json.dumps(dict(result='PASS real local MedSAM2 three-plane synthetic request',state=state,voxels=sum(mask),clinical_validation=False)))
