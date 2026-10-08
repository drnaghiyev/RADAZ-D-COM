import test from 'node:test';
import assert from 'node:assert/strict';
import {reportHandoff} from '../lib/report-handoff.ts';

test('Assistant receives every series in the selected study without mixing other studies',()=>{
 const source=[
  {id:'s1/a',studyId:'s1',imageIds:['a1','a2']},
  {id:'media:archive:s1/b',studyId:'s1',imageIds:['b1','b2'],archived:true,mediaSession:'removed'},
  {id:'s2/c',studyId:'s2',imageIds:['other-patient']},
  {id:'s1/d',studyId:'s1',imageIds:['a1','d1'],mediaSession:'disc'},
 ];
 assert.deepEqual(reportHandoff(source,'media:archive:s1/b'),{imageIds:['a1','a2','b1','b2','d1'],preferredSeriesId:'s1/b',mediaSessions:['disc']});
 assert.deepEqual(reportHandoff(source,'missing').imageIds,[]);
});
test('Unknown study identities cannot combine unrelated images',()=>{
 assert.deepEqual(reportHandoff([{id:'a',studyId:'',imageIds:['one']},{id:'b',studyId:'',imageIds:['two']}],'a').imageIds,['one']);
});
