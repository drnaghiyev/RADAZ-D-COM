import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({channel:'msedge',headless:true});const context=await browser.newContext({viewport:{width:1920,height:1080}});const errors=[];context.on('page',p=>p.on('pageerror',e=>errors.push(e.stack)));const page=await context.newPage();page.setDefaultTimeout(45000);
await context.route('**/local-archive-api/**',r=>r.fulfill({json:r.request().url().endsWith('/license')?{valid:true,required:true,kind:'owner'}:[]}));
try{
 await page.goto(process.env.RADAZ_TEST_URL||'http://127.0.0.1:5362');await page.waitForFunction(()=>document.querySelector('.statusbar')?.textContent.includes('Cornerstone3D'));
 await page.locator('input[type=file]:not([accept]):not([webkitdirectory])').setInputFiles(['MONO','RGB','JPEG'].map(v=>({name:v+'.dcm',mimeType:'application/dicom',buffer:readFileSync('outputs/us-fixture/'+v+'.dcm')})));
 await page.waitForFunction(()=>document.querySelectorAll('.series-card').length===3&&document.querySelector('.statusbar')?.textContent.includes('İdxal tamamlandı'));
 if(!await page.getByRole('button',{name:'Play',exact:true}).isVisible())await page.getByRole('button',{name:'Əlavə alətlər',exact:true}).click();
 const panel=page.locator('[data-panel=A]');const frame=async()=>{const t=await panel.innerText();const m=t.match(/(?:Image|İmage|Şəkil)\s*(\d+)\s*\/\s*12/i);if(!m)throw Error('Frame counter absent: '+t);return Number(m[1]);};
 for(const variant of ['MONO','RGB','JPEG']){
  await page.locator('.series-card').filter({hasText:'SYNTHETIC US '+variant}).click();await page.waitForTimeout(250);assert.equal(await frame(),1);
  await page.getByLabel('Play sürəti',{exact:true}).fill('10');await page.getByRole('button',{name:'Play',exact:true}).click();await page.waitForTimeout(350);assert.notEqual(await frame(),1);
  await page.getByRole('button',{name:'Pauza',exact:true}).click();await page.waitForTimeout(200);const paused=await frame();await page.waitForTimeout(350);assert.equal(await frame(),paused);
  await page.getByRole('button',{name:'Stop',exact:true}).click();await page.waitForTimeout(250);assert.equal(await frame(),1);
  await page.screenshot({path:'outputs/us-'+variant+'.png'});console.log('PASS',variant,'12 frames, play/pause/stop');
 }
 await page.getByLabel('Play sürəti',{exact:true}).fill('1');await page.getByRole('button',{name:'Play',exact:true}).click();await page.waitForTimeout(300);assert.equal(await frame(),1);await page.waitForTimeout(850);assert.equal(await frame(),2);await page.getByRole('button',{name:'Pauza',exact:true}).click();assert.deepEqual(errors,[]);console.log('PASS 1-10 fps speed control and no JS errors');
}catch(e){console.error((await page.locator('body').innerText()).slice(-2500));console.error(errors);await page.screenshot({path:'outputs/us-failure.png'});throw e;}finally{await browser.close();}
