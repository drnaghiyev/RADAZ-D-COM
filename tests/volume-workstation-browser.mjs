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
 for(const width of [3840,2560,1920,1712,1440,1399,1366,1280,1024,768,650,390]){
  await page.setViewportSize({width,height:1000});await page.waitForTimeout(200);
  const r=await page.locator('.topbar').evaluate(el=>({width:innerWidth,height:el.getBoundingClientRect().height,scroll:el.scrollWidth,client:el.clientWidth,buttons:[...el.querySelectorAll('button:not(.toolbar-drag-handle)')].filter(b=>b.getBoundingClientRect().width>0&&getComputedStyle(b).visibility!=='hidden').map(b=>{const r=b.getBoundingClientRect();return {label:b.getAttribute('aria-label')||b.title,left:r.left,right:r.right,width:r.width,font:getComputedStyle(b).fontSize};})}));
  results.push(r);assert.ok(r.height<=106,JSON.stringify(r));assert.ok(r.buttons.every(b=>b.font==='0px'),JSON.stringify(r));assert.ok(r.scroll<=r.client+1,JSON.stringify(r));assert.ok(r.buttons.every(b=>b.left>=0&&b.right<=width+1&&b.width>=28),JSON.stringify(r));
  await page.screenshot({path:`${out}/header-${width}.png`});
 }
 await page.getByRole('button',{name:'Əlavə alətlər',exact:true}).click();await page.getByRole('button',{name:'TotalSegmentator',exact:true}).waitFor({state:'visible'});await page.getByRole('button',{name:'Əlavə alətlər',exact:true}).click();
 await page.setViewportSize({width:1600,height:1000});
 const opened=context.waitForEvent('page');await page.getByRole('button',{name:'3D həcm görüntüləmə',exact:true}).click();const volume=await opened;await volume.locator('.cornerstone-volume-stage[data-ready=true]').waitFor();
 assert.equal(await volume.locator('.topbar [aria-label=Scalpel]').count(),1);
 await volume.locator('.volume-orientation').waitFor();await volume.locator('.volume-orientation svg [role=button]').first().click();assert.equal(await volume.locator('.volume-axis-views').count(),0);await volume.screenshot({path:out+'/after-cube.png'});
 await volume.getByRole('button',{name:'3D HU / Opacity',exact:true}).click();await volume.getByRole('slider',{name:'3D HU həddi',exact:true}).fill('300');await volume.keyboard.press('Escape');await volume.locator('.volume-parameter-menu').waitFor({state:'hidden'});
 await volume.screenshot({path:out+'/bone-vr.png'});
 await volume.getByRole('button',{name:'Scalpel',exact:true}).click();
 const box=await volume.locator('.volume-scalpel-overlay').boundingBox();
 const points=[[.35,.35],[.65,.35],[.65,.65],[.35,.65],[.35,.35]];
 await volume.mouse.move(box.x+box.width*points[0][0],box.y+box.height*points[0][1]);await volume.mouse.down();
 for(const [x,y] of points.slice(1))await volume.mouse.move(box.x+box.width*x,box.y+box.height*y,{steps:5});
 await volume.mouse.up();await volume.getByRole('button',{name:'Scalpel',exact:true}).waitFor();
 await volume.waitForFunction(()=>!document.querySelector('[aria-label="Scalpel"]')?.disabled);
 const status=await volume.locator('.volume-scalpel-status').innerText();assert.ok(status.includes('Silmək'),status);
 await volume.screenshot({path:out+'/after-scalpel.png'});await volume.getByRole('button',{name:'Kəsimi geri al',exact:true}).click();
 await volume.getByRole('button',{name:'3D rotate',exact:true}).click();await volume.screenshot({path:out+'/after-undo.png'});
 const mprOpened=context.waitForEvent('page');await page.getByRole('button',{name:'MPR rekonstruksiya',exact:true}).click();const mpr=await mprOpened;await mpr.locator('.topbar').waitFor();
 for(const width of [1712,1366,768,390]){await mpr.setViewportSize({width,height:1000});const bounds=await mpr.locator('.topbar').evaluate(e=>({height:e.getBoundingClientRect().height,scroll:e.scrollWidth,client:e.clientWidth}));assert.ok(bounds.height<=106&&bounds.scroll<=bounds.client+1,JSON.stringify({width,...bounds}));}
 assert.deepEqual(await mpr.locator('.mpr-mode-label').allTextContents(),['MPR','MİP','MinİP','Avg']);
 await page.keyboard.press('Control+F1');const about=page.getByRole('dialog',{name:'RADAZ haqqında',exact:true});await about.waitFor();assert.equal(await about.locator('.radaz-logo').count(),1);assert.equal(await about.locator('.product-about img').count(),0);await page.screenshot({path:out+'/about.png'});
 assert.deepEqual(errors,[]);writeFileSync(out+'/result.json',JSON.stringify({passed:true,responsive:results,errors},null,2));console.log('PASS responsive header, real volume renderer, orientation, transfer controls');
}finally{await browser.close();}
