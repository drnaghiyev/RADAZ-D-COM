// End-to-end local inference on official public samples converted to test DICOM.
// Only archive access is intercepted. Anatomy requests use the real local worker.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync,readdirSync,mkdirSync,writeFileSync} from 'node:fs';
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({headless:true,channel:'msedge'}),out='outputs/anatomy-platform';mkdirSync(out,{recursive:true});
const results=[];
try{
 for(const kind of ['ct','mr']){
  const folder=`outputs/anatomy-volume/${kind}`,files=readdirSync(folder).filter(f=>f.endsWith('.dcm')).sort().map(f=>readFileSync(folder+'/'+f));
  const context=await browser.newContext({viewport:{width:1600,height:1100}});context.setDefaultTimeout(20000);
  const errors=[];context.on('page',p=>p.on('pageerror',e=>errors.push(e.message)));
  await context.route('**/local-archive-api/**',route=>{const p=new URL(route.request().url()).pathname;if(p.endsWith('/license'))return route.fulfill({json:{valid:true,required:true,kind:'owner',deviceId:'PUBLIC-FIXTURE-TEST',message:'Test'}});if(p.endsWith('/instances'))return route.fulfill({json:files.map((_,i)=>({uid:String(i)}))});if(p.includes('/file/'))return route.fulfill({contentType:'application/dicom',body:files[Number(p.split('/').pop())]});return route.fulfill({json:[]});});
  const page=await context.newPage();await page.goto(`http://127.0.0.1:5297/#archive-study=2.25.9910${kind==='ct'?1:2}`);await page.waitForFunction(n=>document.querySelector('.statusbar')?.textContent.includes(n+' DICOM'),files.length);
  await page.getByRole('button',{name:'KT və MRT anatomiyası',exact:true}).click();const panel=page.locator('.anatomy-volume-panel');await panel.getByRole('button',{name:'Seriyanı analiz et',exact:true}).click();
  await page.waitForFunction(()=>['ready','error'].includes(document.querySelector('.anatomy-volume-panel')?.getAttribute('data-phase')),{},{timeout:180000});
  assert.equal(await panel.getAttribute('data-phase'),'ready',await panel.innerText());const count=await panel.locator('.anatomy-structure-list>div').count();assert.ok(count>=10);
  const liver=panel.locator('.anatomy-structure-list>div').filter({has:page.getByRole('button',{name:'Qaraciyər',exact:true})});await liver.getByRole('button',{name:'Struktura keç',exact:true}).click();await page.screenshot({path:`${out}/public-${kind}-overlay.png`});
  const popup=context.waitForEvent('page');await page.getByRole('button',{name:'3D həcm görüntüləmə',exact:true}).click();const volume=await popup;await volume.locator('.cornerstone-volume-stage[data-ready=true]').waitFor();
  await volume.getByRole('button',{name:'KT və MRT anatomiyası',exact:true}).click();const volumePanel=volume.locator('.anatomy-volume-panel');
  const row=volumePanel.locator('.anatomy-structure-list>div').filter({has:volume.getByRole('button',{name:'Qaraciyər',exact:true})});await row.getByRole('button',{name:'Yalnız bunu göstər',exact:true}).click();await row.getByRole('button',{name:'Struktura keç',exact:true}).click();
  await volume.getByRole('checkbox',{name:'3D səthlər',exact:true}).check();await volume.locator('.anatomy-surface-controls[data-state=ready]').waitFor();await volume.getByRole('checkbox',{name:'Mənbə həcm',exact:true}).uncheck();await volume.screenshot({path:`${out}/public-${kind}-liver-3d.png`});
  assert.deepEqual(errors,[]);results.push({modality:kind,structures:count,realLocalInference:true,publicReferenceOnly:true,clinicalValidation:false,errors});await context.close();
 }
 writeFileSync(out+'/inference-browser-result.json',JSON.stringify(results,null,2));console.log('PASS: actual CT/MR DICOM upload, local inference, overlay, focus and isolated 3D liver');
}catch(error){for(const context of browser.contexts())for(const [i,page] of context.pages().entries()){await page.screenshot({path:`${out}/inference-failure-${i}.png`}).catch(()=>{});writeFileSync(`${out}/inference-failure-${i}.txt`,await page.locator('body').innerText().catch(()=>''));}throw error;}finally{await browser.close();}
