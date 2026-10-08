import assert from 'node:assert/strict';
import test from 'node:test';
import {isActivated,activatedBuild} from '../lib/update-activation.ts';
test('a responding candidate cannot reload the UI before committed healthy activation',()=>{
 const runtime={version:'0.2.24',buildId:'new'},status={managed:true,state:'activating',message:'',activeVersion:'0.2.23',buildId:'new',healthy:true,activationComplete:false};
 assert.equal(isActivated('0.2.24',status,runtime),false);
 const committed={...status,activeVersion:'0.2.24',activationComplete:true};
 assert.equal(isActivated('0.2.24',committed,runtime),true);
 assert.equal(isActivated('0.2.24',{...committed,healthy:false},runtime),false);
 assert.equal(isActivated('0.2.24',committed,{...runtime,buildId:'old'}),false);
 assert.equal(isActivated('0.2.24',committed,{...runtime,version:'0.2.23'}),false);
});
test('a feed outage after commit cannot make a healthy activation look failed',async t=>{
 const original=globalThis.fetch;t.after(()=>globalThis.fetch=original);
 let active='0.2.24';
 globalThis.fetch=async url=>({ok:true,json:async()=>url.includes('installation')?{managed:true,state:'error',message:'GitHub offline',activeVersion:active,buildId:'new',healthy:true,activationComplete:active==='0.2.24'}:{version:active,buildId:'new'}});
 assert.equal(await activatedBuild('0.2.24'),'new');
 active='0.2.23';await assert.rejects(activatedBuild('0.2.24'),/GitHub offline/);
});
