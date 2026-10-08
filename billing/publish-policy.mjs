import {execFileSync} from 'node:child_process';
// Called only by an authenticated owner's explicit Publish button. Only signed
// public pricing is sent; merchant accounts and issuer/provider secrets stay local.
export async function publishPolicy(policy){
 let password;
 try{const result=execFileSync('git',['credential','fill'],{input:'protocol=https\nhost=github.com\nusername=drnaghiyev\n\n',encoding:'utf8',windowsHide:true,stdio:['pipe','pipe','pipe'],env:{...process.env,GIT_TERMINAL_PROMPT:'0',GCM_INTERACTIVE:'Never'}});password=result.split(/\r?\n/).find(s=>s.startsWith('password='))?.slice(9);}catch{throw Error('GitHub hesabını bu kompüterdə qoşun.');}
 if(!password)throw Error('GitHub hesabını bu kompüterdə qoşun.');
 const url='https://api.github.com/repos/drnaghiyev/RADAZ-D-COM/contents/commerce.json';
 const headers={Authorization:'Bearer '+password,Accept:'application/vnd.github+json','Content-Type':'application/json'};
 const previous=await fetch(url,{headers,signal:AbortSignal.timeout(20000)});
 if(!previous.ok&&previous.status!==404)throw Error('GitHub qiymət faylı oxunmadı.');
 const sha=previous.ok?(await previous.json()).sha:undefined;
 const response=await fetch(url,{method:'PUT',headers,body:JSON.stringify({message:'Update signed RADAZ commerce policy',sha,content:Buffer.from(JSON.stringify(policy)).toString('base64')}),signal:AbortSignal.timeout(20000)});
 if(!response.ok)throw Error('Qiymətlər GitHub-da yayımlanmadı. Saxlanmış ayarlar qorundu.');
 return {ok:true,message:'İmzalı qiymət və demo ayarları yayımlandı. Müştərilər internet olduqda yeniləyəcək.'};
}
