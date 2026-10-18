import {readFileSync} from 'node:fs';
import {createPrivateKey,createPublicKey,sign,verify} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';

export function verifyRelease(envelope,publicKey){
  if(envelope?.algorithm!=='Ed25519'||envelope.keyId!=='radaz-release-2026'||typeof envelope.payload!=='string'||envelope.payload.length>2*1024*1024||typeof envelope.signature!=='string')throw Error('Invalid release signature envelope');
  const payload=Buffer.from(envelope.payload,'base64'),signature=Buffer.from(envelope.signature,'base64');
  if(signature.length!==64||!verify(null,payload,publicKey,signature))throw Error('Release signature verification failed');
  const release=JSON.parse(payload.toString('utf8'));
  if(release.signature||typeof release.tag_name!=='string')throw Error('Invalid signed release');
  return release;
}
export function signRelease(payload,privateKey,publicKey){
  const key=createPrivateKey(privateKey);
  if(!createPublicKey(key).export({format:'der',type:'spki'}).equals(createPublicKey(publicKey).export({format:'der',type:'spki'})))throw Error('Release signer does not match the pinned public key');
  return {algorithm:'Ed25519',keyId:'radaz-release-2026',payload:payload.toString('base64'),signature:sign(null,payload,key).toString('base64')};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    const input=readFileSync(0),publicKey=readFileSync(new URL('../public/update-public.pem',import.meta.url));
    const result=process.argv[2]==='sign'?signRelease(input,process.env.RADAZ_RELEASE_SIGNING_KEY,publicKey):verifyRelease(JSON.parse(input),publicKey);
    process.stdout.write(JSON.stringify(result));
  }catch{process.stderr.write('RADAZ release authenticity check failed.\n');process.exitCode=1;}
}
