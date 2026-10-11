import {readFileSync} from 'node:fs';
/** The gateway holds the credential. Never forward a browser-supplied key, URL,
 * expiry or device ID to the seller service as authority. */
export function anatomyAccess(product,{env=process.env,request=fetch}={}){
 const research=product.channel==='local-anatomy';
 async function remote(action){
  if(!env.RADAZ_ANATOMY_LICENSE_URL||!env.RADAZ_ANATOMY_LICENSE_KEY_FILE){
   const port=Number(env.RADAZ_ARCHIVE_PORT||8766);if(!Number.isInteger(port)||port<1||port>65535)throw Error('license_not_configured');
   const origin='http://127.0.0.1:'+port;
   let response;try{response=await request(origin+'/anatomy-license'+(action==='trial'?'/trial':''),{method:action==='trial'?'POST':'GET',headers:{Origin:origin,'Content-Type':'application/json'},...(action==='trial'?{body:'{}'}:{}),redirect:'error',signal:AbortSignal.timeout(10000)});}catch{throw Error('license_not_configured');}
   if(!response.ok)throw Error('license_not_configured');const result=await response.json();
   if(result.moduleId!=='anatomy_ai'||typeof result.allowed!=='boolean')throw Error('invalid_license_response');return result;
  }
  const base=new URL(env.RADAZ_ANATOMY_LICENSE_URL);if(base.protocol!=='https:'||base.username||base.password||base.search||base.hash||base.pathname!=='/')throw Error('license_not_configured');
  const stored=JSON.parse(readFileSync(env.RADAZ_ANATOMY_LICENSE_KEY_FILE,'utf8'));
  if(typeof stored.key!=='string'||stored.key.length>16384)throw Error('license_not_configured');
  const route=action==='status'?'license':action==='trial'?'trial/start':'authorize';
  const response=await request(new URL('/v1/anatomy/'+route,base),{method:action==='status'?'GET':'POST',headers:{Authorization:'Bearer '+stored.key,'Content-Type':'application/json'},...(action==='status'?{}:{body:'{}'}),redirect:'error',signal:AbortSignal.timeout(10000)});
  if(!response.ok)throw Error('anatomy_license_required');
  const result=await response.json();if(result.moduleId!=='anatomy_ai'||!Number.isSafeInteger(result.serverTime)||typeof result.allowed!=='boolean')throw Error('invalid_license_response');
  return result;
 }
 return {research,
  status:()=>research?Promise.resolve({moduleId:'anatomy_ai',status:'local-research',allowed:true,trialStartedAt:null,trialExpiresAt:null}):remote('status'),
  trial:()=>research?Promise.reject(Error('research_has_no_trial')):remote('trial'),
  async authorize(){if(research)return;const status=await remote('authorize');if(!status.allowed)throw Error('anatomy_license_required');},
 };
}
