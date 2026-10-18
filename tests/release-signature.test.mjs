import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync} from 'node:crypto';
import {signRelease,verifyRelease} from '../scripts/release-signature.mjs';
test('release signature authenticates exact asset hashes and rejects modified payloads or another signer',()=>{
  const keys=generateKeyPairSync('ed25519');
  const publicKey=keys.publicKey.export({format:'pem',type:'spki'}),privateKey=keys.privateKey.export({format:'pem',type:'pkcs8'});
  const release={tag_name:'v0.2.41',assets:[{name:'distribution.zip',digest:'sha256:'+'a'.repeat(64)}]};
  const signed=signRelease(Buffer.from(JSON.stringify(release)),privateKey,publicKey);
  assert.deepEqual(verifyRelease(signed,publicKey),release);
  assert.throws(()=>verifyRelease({...signed,payload:Buffer.from(JSON.stringify({...release,tag_name:'v0.2.42'})).toString('base64')},publicKey));
  assert.throws(()=>verifyRelease({...signed,signature:Buffer.alloc(64).toString('base64')},publicKey));
  assert.throws(()=>verifyRelease({...signed,keyId:'untrusted'},publicKey));
  assert.throws(()=>verifyRelease(signed,generateKeyPairSync('ed25519').publicKey));
});
