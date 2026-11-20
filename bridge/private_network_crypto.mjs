// Binary stdin/out avoids placing keys, patient data or plaintext on disk or in argv.
import { generateKeyPairSync, randomBytes, publicEncrypt, privateDecrypt, createCipheriv, createDecipheriv, constants } from 'node:crypto';
const chunks=[];
for await (const chunk of process.stdin) chunks.push(chunk);
const input=Buffer.concat(chunks), split=input.indexOf(10);
try {
  if(split<0) throw Error('Missing header');
  const {operation,key,context}=JSON.parse(input.subarray(0,split));
  const body=input.subarray(split+1);
  if(operation==='keygen') {
    const pair=generateKeyPairSync('rsa', {modulusLength:3072,
      publicKeyEncoding:{type:'spki',format:'pem'}, privateKeyEncoding:{type:'pkcs8',format:'pem'}});
    process.stdout.write(JSON.stringify(pair));
  } else if(operation==='seal') {
    const aes=randomBytes(32),iv=randomBytes(12);
    const wrapped=publicEncrypt({key,padding:constants.RSA_PKCS1_OAEP_PADDING,oaepHash:'sha256'},aes);
    const cipher=createCipheriv('aes-256-gcm',aes,iv);
    cipher.setAAD(Buffer.from(context));
    const ciphertext=Buffer.concat([cipher.update(body),cipher.final()]);
    const head=Buffer.alloc(6);head.write('PDN1');head.writeUInt16BE(wrapped.length,4);
    process.stdout.write(Buffer.concat([head,wrapped,iv,cipher.getAuthTag(),ciphertext]));
  } else if(operation==='open') {
    if(body.length<34 || body.subarray(0,4).toString()!=='PDN1') throw Error('Envelope');
    const end=6+body.readUInt16BE(4);
    if(end+28>body.length) throw Error('Truncated');
    const aes=privateDecrypt({key,padding:constants.RSA_PKCS1_OAEP_PADDING,oaepHash:'sha256'},body.subarray(6,end));
    const decipher=createDecipheriv('aes-256-gcm',aes,body.subarray(end,end+12));
    decipher.setAAD(Buffer.from(context));decipher.setAuthTag(body.subarray(end+12,end+28));
    const plaintext=Buffer.concat([decipher.update(body.subarray(end+28)),decipher.final()]);
    process.stdout.write(plaintext);
  } else throw Error('Action');
} catch { process.stderr.write('Private DICOM cryptographic operation failed');process.exitCode=1; }
