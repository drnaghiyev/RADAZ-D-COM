import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync,readdirSync,mkdirSync,writeFileSync} from 'node:fs';
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'playwright');
const out='outputs/vr-release';mkdirSync(out,{recursive:true});
const files=readdirSync('outputs/desktop-fixture').filter(f=>f.endsWith('.dcm')).sort().map(f=>readFileSync('outputs/desktop-fixture/'+f));
const browser=await chromium.launch({headless:true,channel:'msedge'});
const context=await browser.newContext({viewport:{width:1600,height:1000}});context.setDefaultTimeout(30000);
const errors=[];context.on('page',p=>p.on('pageerror',e=>errors.push(e.message)));
await context.route('**/local-archive-api/**',route=>{const p=new URL(route.request().url()).pathname;if(p.endsWith('/license'))return route.fulfill({json:{valid:true,required:true,kind:'owner',deviceId:'SYNTHETIC-TEST',message:'Test'}});if(p.endsWith('/instances'))return route.fulfill({json:files.map((_,i)=>({uid:String(i)}))});if(p.includes('/file/'))return route.fulfill({contentType:'application/dicom',body:files[Number(p.split('/').pop())]});return route.fulfill({json:[]});});
const page=await context.newPage();
try{
 await page.goto((process.env.RADAZ_TEST_URL||'http://127.0.0.1:5397')+'/#archive-study=2.25.702');await page.waitForFunction(()=>document.querySelector('.statusbar')?.textContent.includes('40 DICOM'));
 const results=[];
 for(const width of [1920,1440,1024,768,390]){
  await page.setViewportSize({width,height:1000});
  const r=await page.locator('.topbar').evaluate(el=>({width:innerWidth,scroll:el.scrollWidth,client:el.clientWidth,buttons:[...el.querySelectorAll('button')].filter(b=>b.getBoundingClientRect().width>0).map(b=>{const r=b.getBoundingClientRect();return {label:b.getAttribute('aria-label')||b.title,left:r.left,right:r.right,width:r.width};})}));
  results.push(r);assert.ok(r.scroll<=r.client+1,JSON.stringify(r));assert.ok(r.buttons.every(b=>b.left>=0&&b.right<=width+1&&b.width>=28),JSON.stringify(r));
  await page.screenshot({path:`${out}/header-${width}.png`});
 }
 await page.setViewportSize({width:1600,height:1000});
 const opened=context.waitForEvent('page');await page.getByRole('button',{name:'3D həcm görüntüləmə',exact:true}).click();const volume=await opened;await volume.locator('.cornerstone-volume-stage[data-ready=true]').waitFor();
 await volume.locator('.volume-orientation').waitFor();await volume.getByRole('button',{name:'LPS S view',exact:true}).click();await volume.locator('.volume-orientation svg [aria-label="LPS S"]').waitFor();await volume.getByRole('button',{name:'LPS A view',exact:true}).click();
 await volume.getByRole('button',{name:'3D HU / Opacity',exact:true}).click();await volume.getByRole('slider',{name:'3D HU həddi',exact:true}).fill('300');await volume.keyboard.press('Escape');await volume.locator('.volume-parameter-menu').waitFor({state:'hidden'});
 await volume.screenshot({path:out+'/bone-vr.png'});
 assert.deepEqual(errors,[]);writeFileSync(out+'/result.json',JSON.stringify({passed:true,responsive:results,errors},null,2));console.log('PASS responsive header, real volume renderer, orientation, transfer controls');
}finally{await browser.close();}
