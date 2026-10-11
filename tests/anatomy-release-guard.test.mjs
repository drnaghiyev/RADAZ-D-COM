import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
test('private anatomy branch cannot overwrite public release archives or Setup',()=>{
 if(JSON.parse(readFileSync('public/product.json')).channel!=='local-anatomy')return;
 for(const script of ['scripts/package-release.py','scripts/package-desktop.py']){
  const result=spawnSync(process.env.PYTHON||'python',[script],{encoding:'utf8',windowsHide:true});
  assert.equal(result.status,1);assert.match(result.stderr,/Private Anatomy AI development must not be packaged/);
 }
});
