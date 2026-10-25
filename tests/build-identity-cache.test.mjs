import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {sourceHash} from '../scripts/build-identity.mjs';

test('generated Python cache does not change build identity; runtime source does',()=>{
  const root=mkdtempSync(path.join(tmpdir(),'radaz-build-identity-'));
  try {
    mkdirSync(path.join(root,'scripts'));
    writeFileSync(path.join(root,'scripts/runtime.py'),'original');
    const before=sourceHash(root);
    mkdirSync(path.join(root,'scripts/__pycache__'));
    writeFileSync(path.join(root,'scripts/__pycache__/runtime.pyc'),'generated');
    assert.equal(sourceHash(root),before);
    writeFileSync(path.join(root,'scripts/runtime.py'),'changed runtime');
    assert.notEqual(sourceHash(root),before);
  } finally {rmSync(root,{recursive:true,force:true});}
});
