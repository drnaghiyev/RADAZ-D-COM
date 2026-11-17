import assert from 'node:assert/strict';
import {test} from 'node:test';
import {moveStitchPoint} from '../lib/stitch-annotation-geometry.ts';
test('frame points follow their own source through translation, scaling and composite crop',()=>{
 const old={sourceKey:'test',left:0,topEdge:0,origins:[{x:0,y:0},{x:0,y:100}],scales:[1,1],rects:[{x:0,y:0,width:100,height:100},{x:0,y:100,width:100,height:100}],selected:1};
 const next={...old,left:-20,topEdge:10,origins:[{x:0,y:0},{x:-20,y:130}],scales:[1,2]};
 assert.deepEqual(moveStitchPoint([25,150],old,next),{layer:1,point:[50,220]});
 assert.deepEqual(moveStitchPoint([25,50],old,next),{layer:0,point:[45,40]});
 const lower=moveStitchPoint([25,150],old,next);assert.deepEqual(moveStitchPoint(lower.point,next,old,lower.layer).point,[25,150]);
});
