// Runs inside the existing seller service and database. No browser time/trial state.
import {verify,createPublicKey} from 'node:crypto';
const MODULE='anatomy_ai',TRIAL_SECONDS=30*24*60*60;
export function anatomyEntitlements(db,privateKey,now){
 const publicKey=privateKey?createPublicKey(privateKey):null;
 db.exec(`CREATE TABLE IF NOT EXISTS module_trials(deviceId TEXT NOT NULL,moduleId TEXT NOT NULL,licenseId TEXT NOT NULL,startedAt INTEGER NOT NULL,expiresAt INTEGER NOT NULL,suspended INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(deviceId,moduleId));
 CREATE TABLE IF NOT EXISTS module_suspensions(deviceId TEXT NOT NULL,moduleId TEXT NOT NULL,suspended INTEGER NOT NULL,PRIMARY KEY(deviceId,moduleId));
 CREATE TABLE IF NOT EXISTS module_audit(id INTEGER PRIMARY KEY,deviceId TEXT NOT NULL,moduleId TEXT NOT NULL,action TEXT NOT NULL,at INTEGER NOT NULL);`);
 function principal(token){
  if(!publicKey||typeof token!=='string'||token.length>16384)throw Error('unauthorized');
  const parts=token.split('.');if(parts.length!==3||parts[0]!=='RADAZ1'||!parts.every(p=>/^[A-Za-z0-9_-]+$/.test(p))||!verify('RSA-SHA256',Buffer.from(parts[0]+'.'+parts[1]),publicKey,Buffer.from(parts[2],'base64url')))throw Error('unauthorized');
  const claims=JSON.parse(Buffer.from(parts[1],'base64url'));
  if(claims.v!==1||claims.product!=='RADAZ'||claims.moduleId||!/^([A-F0-9]{64})$/.test(claims.deviceId)||typeof claims.licenseId!=='string'||claims.licenseId.length>250||!Number.isSafeInteger(claims.expiresAt)||!Number.isSafeInteger(claims.issuedAt)||claims.issuedAt>now()+300||claims.expiresAt<=now())throw Error('unauthorized');
  return claims;
 }
 const row=device=>db.prepare('SELECT * FROM module_trials WHERE deviceId=? AND moduleId=?').get(device,MODULE);
 function state(claims){
  const current=now(),trial=row(claims.deviceId),paid=db.prepare("SELECT MAX(expiresAt) AS expiresAt FROM orders WHERE deviceId=? AND moduleId=? AND status='paid'").get(claims.deviceId,MODULE);
  const expiresAt=Math.max(paid?.expiresAt||0,trial?.expiresAt||0)||null;
  const suspended=db.prepare('SELECT suspended FROM module_suspensions WHERE deviceId=? AND moduleId=?').get(claims.deviceId,MODULE)?.suspended??trial?.suspended;
  const status=suspended?'suspended':paid?.expiresAt>current?'active':trial?.expiresAt>current?'trial':trial||paid?.expiresAt?'expired':'inactive';
  return {moduleId:MODULE,status,allowed:['active','trial'].includes(status),serverTime:current,trialStartedAt:trial?.startedAt??null,trialExpiresAt:trial?.expiresAt??null,expiresAt,remainingTrialDays:trial?Math.max(0,Math.ceil((trial.expiresAt-current)/86400)):0};
 }
 return {
  status(token){return state(principal(token));},
  startTrial(token){
   const claims=principal(token),current=now();db.exec('BEGIN IMMEDIATE');
   try{
    const before=row(claims.deviceId);
    if(!before){db.prepare('INSERT INTO module_trials(deviceId,moduleId,licenseId,startedAt,expiresAt) VALUES (?,?,?,?,?)').run(claims.deviceId,MODULE,claims.licenseId,current,current+TRIAL_SECONDS);db.prepare('INSERT INTO module_audit(deviceId,moduleId,action,at) VALUES (?,?,?,?)').run(claims.deviceId,MODULE,'trial-started',current);}
    db.exec('COMMIT');return state(claims);
   }catch(error){db.exec('ROLLBACK');throw error;}
  },
  authorize(token){const status=state(principal(token));if(!status.allowed)throw Error('anatomy_license_required');return status;},
  // Owner-side service method. No public HTTP endpoint exposes this action.
  suspend(device,suspended){if(!/^[A-F0-9]{64}$/.test(device)||typeof suspended!=='boolean')throw Error('invalid_device');db.prepare('INSERT INTO module_suspensions(deviceId,moduleId,suspended) VALUES (?,?,?) ON CONFLICT(deviceId,moduleId) DO UPDATE SET suspended=excluded.suspended').run(device,MODULE,Number(suspended));db.prepare('INSERT INTO module_audit(deviceId,moduleId,action,at) VALUES (?,?,?,?)').run(device,MODULE,suspended?'suspended':'resumed',now());},
 };
}
