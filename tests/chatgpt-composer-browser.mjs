// Local-only browser fixture for the real extension adapter; synthetic data only.
import http from 'node:http';
import {readFileSync} from 'node:fs';
import JSZip from 'jszip';
const base=new URL('../extensions/chatgpt/',import.meta.url),zip=new JSZip();
zip.file('RADAZ-image-000001.jpg',Buffer.from([255,216,255,217]));zip.file('manifest.json',JSON.stringify({imageCount:1,images:[{name:'RADAZ-image-000001.jpg',series:1,slice:1}]}));
const data=await zip.generateAsync({type:'nodebuffer'});
const bundle={name:'RADAZ-ChatGPT.zip',size:data.length,count:1,prompt:'Synthetic test: RADAZ-ChatGPT.zip RADAZ-image-000001.jpg. No patient data.',attachments:{first:0,count:1,total:1,includeZip:true}};
http.createServer((req,res)=>{
 const url=new URL(req.url,'http://localhost');
 if(['/vendor/jszip.min.js','/composer-helpers.js','/composer.js'].includes(url.pathname)){res.writeHead(200,{'Content-Type':'text/javascript'});res.end(readFileSync(new URL('.'+url.pathname,base)));return;}
 const cases=['success','noattachments','ziponly','uploading','disabled','auto','auto-noattachments','auto-existing','auto-unconfirmed','auto-tampered'];
 if(url.pathname==='/'){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(`<h1>RADAZ ChatGPT adapter regression</h1><p>Synthetic local test, no external upload.</p>${cases.map(c=>`<h2>${c}</h2><iframe title="${c}" src="/fixture?case=${c}" width="950" height="210"></iframe>`).join('')}`);return;}
 const mode=cases.includes(url.searchParams.get('case'))?url.searchParams.get('case'):'noattachments';
 res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(`<!doctype html><meta charset="utf-8"><style>body{font:14px system-ui} form{border:1px solid #777;padding:10px} aside{display:none} img{width:20px;height:20px}</style><article>Earlier transcript: <span>RADAZ-ChatGPT.zip</span><button aria-label="Remove file">×</button></article><form><div id="attachments"></div><input type="file" multiple><textarea id="prompt-textarea"></textarea><button type="submit" data-testid="send-button">Send</button></form><p id="result">Running</p><script>
const mode=${JSON.stringify(mode)},bundle=${JSON.stringify(bundle)},chunk=${JSON.stringify(data.toString('base64'))};
const originalTimeout=window.setTimeout;window.setTimeout=(fn,ms)=>originalTimeout(fn,Math.min(ms,2));
let submitted=0;bundle.autoSubmit=mode.startsWith('auto');
if(mode==='auto-existing'){const old=document.createElement('div');old.dataset.messageAuthorRole='assistant';old.textContent='Existing conversation';document.body.append(old);}
document.querySelector('form').onsubmit=e=>{e.preventDefault();submitted++;if(!['auto','auto-unconfirmed'].includes(mode))throw Error('Unexpected submit');if(mode==='auto'){const user=document.createElement('div');user.dataset.messageAuthorRole='user';user.textContent=document.querySelector('textarea').value;document.body.append(user);document.querySelector('textarea').value='';}};
document.querySelector('textarea').oninput=e=>{if(mode==='auto-tampered')e.target.value='Changed prompt';};
document.querySelector('input').onchange=e=>{if(['noattachments','auto-noattachments'].includes(mode))return;for(const file of e.target.files){if(mode==='ziponly'&&file.type==='image/jpeg')continue;const card=document.createElement('div');const label=document.createElement('span');label.title=file.name;label.textContent=file.name;const remove=document.createElement('button');remove.type='button';remove.setAttribute('aria-label','Remove file');remove.textContent='×';card.append(label,remove);document.querySelector('#attachments').append(card);}if(mode==='uploading'){const p=document.createElement('progress');p.setAttribute('role','progressbar');document.querySelector('#attachments').append(p);}if(mode==='disabled')document.querySelector('[type=submit]').disabled=true;};
window.chrome={runtime:{sendMessage:async m=>{if(m.type==='COMPOSER_READY')return {ok:true,bundle};if(m.type==='COMPOSER_CHUNK')return {ok:true,data:chunk};if(m.type==='COMPOSER_RESULT'){const text=document.querySelector('textarea').value;const pass=mode==='auto'?m.ok&&m.sent===true&&submitted===1:mode==='success'?m.ok&&m.sent===false&&text===bundle.prompt&&submitted===0:mode==='auto-unconfirmed'?!m.ok&&submitted===1:mode.startsWith('auto')?!m.ok&&submitted===0:!m.ok&&submitted===0&&(mode==='disabled'||text==='');document.querySelector('#result').textContent=(pass?'PASS':'FAIL')+': '+mode+'; '+(m.ok?'attachments verified':m.error);return {ok:true};}}}};
</script><script src="/vendor/jszip.min.js"></script><script src="/composer-helpers.js"></script><script src="/composer.js"></script>`);
}).listen(5182,'127.0.0.1',()=>console.log('Synthetic browser regression: http://localhost:5182'));
