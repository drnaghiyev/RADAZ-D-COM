import test from 'node:test';
import assert from 'node:assert/strict';
import {cropPlanes,transferArrays,validateTransfer} from '../lib/transfer-function.ts';
const transfer={schema:1,domain:'relative',points:[{x:0,opacity:0,color:'#000000'},{x:1,opacity:1,color:'#ff8000'}]};
test('MR transfer maps normalized intensities to source signal, CT preserves HU',()=>{
 assert.deepEqual(transferArrays(transfer,[20,2020]).scalar,[[20,0],[2020,1]]);
 assert.deepEqual(transferArrays({...transfer,domain:'ct-hu'},[20,2020]).scalar,[[0,0],[1,1]]);
 assert.deepEqual(transferArrays(transfer,[20,2020]).color[1],[2020,1,128/255,0]);
});
test('untrusted presets reject wrong modality, invalid points, duplicate positions and oversized curves',()=>{
 assert.throws(()=>validateTransfer(transfer,'ct-hu'));
 for(const points of [[],[transfer.points[0],transfer.points[0]],Array(33).fill(transfer.points[0]),[{x:NaN,opacity:0,color:'#ffffff'},transfer.points[1]],[transfer.points[0],{x:1,opacity:2,color:'#ffffff'}]])assert.throws(()=>validateTransfer({...transfer,points}));
});
test('six planes retain correct physical sides on an oblique anisotropic volume',()=>{
 const c=Math.SQRT1_2,g={origin:[10,-20,30],spacing:[.7,1.3,2],dimensions:[20,30,40],direction:[c,c,0,-c,c,0,0,0,1]};
 const planes=cropPlanes({enabled:true,bounds:[.1,.8,.2,.9,.3,.7]},g);
 const world=indices=>g.origin.map((v,i)=>v+indices.reduce((sum,n,j)=>sum+n*g.spacing[j]*g.direction[j*3+i],0));
 const inside=point=>planes.every(p=>p.normal.reduce((s,n,i)=>s+n*(point[i]-p.origin[i]),0)>=-1e-8);
 assert.equal(planes.length,6);assert.ok(inside(world([10,15,20])));
 for(const point of [[0,15,20],[19,15,20],[10,0,20],[10,29,20],[10,15,0],[10,15,39]])assert.equal(inside(world(point)),false);
 assert.deepEqual(cropPlanes({enabled:false,bounds:[0,1,0,1,0,1]},g),[]);
});
