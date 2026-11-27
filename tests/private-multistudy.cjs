const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE);
(async()=>{const browser=await chromium.launch({channel:'msedge',headless:true});
try{for(const tablet of [false,true]){
 const ctx=await browser.newContext({viewport:{width:1100,height:660},hasTouch:tablet,isMobile:tablet});
 const origin=tablet?'https://appassets.androidplatform.net':process.env.RADAZ_TEST_URL;
 if(tablet)await ctx.route(origin+'/**',r=>{const n=new URL(r.request().url()).pathname,p=path.join(process.env.VR_TABLET_ASSETS,path.extname(n)?n:n+'/index.html');return fs.existsSync(p)?r.fulfill({path:p}):r.fulfill({status:404,body:''});});
 await ctx.route('**/local-archive-api/**',r=>r.fulfill({json:r.request().url().endsWith('/license')?{required:true,valid:true,kind:'owner'}:[]}));
 const page=await ctx.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(origin);
 const dir=path.resolve('outputs/features-041-fixture'),files=fs.readdirSync(dir).map(x=>path.join(dir,x));
 await page.locator('input[type=file][multiple]:not([webkitdirectory])').first().setInputFiles(files);
 await page.waitForFunction(()=>document.querySelectorAll('.series-card').length===3 && !document.querySelector('.status-job-progress'));
 assert.equal(await page.locator('.patient-group-heading').count(),2);
 for(const m of ['CT','MR','CR']){const card=page.locator('.series-card').filter({hasText:'SYNTHETIC '+m});await card.click();
 await page.waitForFunction(m=>document.querySelector('[data-panel=A] .top-right')?.textContent.includes(m),m);
 const raster=page.locator('[data-panel=A] .dicom-canvas canvas').first();await page.waitForFunction(()=>{const c=document.querySelector('[data-panel=A] .dicom-canvas canvas');if(!c?.width)return false;return c.getContext('2d').getImageData(0,0,c.width,c.height).data.some((n,i)=>!(i%4)&&n>8);});}
 if(!tablet){await page.setViewportSize({width:1050,height:390});const current=await page.locator('[data-panel=A] .bottom-right').innerText();
 const rail=await page.locator('.series-list').evaluate(list=>{const heads=[...list.querySelectorAll('.patient-group-heading')],top=()=>list.getBoundingClientRect().top;
 const diff=()=>heads[0].getBoundingClientRect().top-top();list.scrollTop=50;const sticky=Math.abs(diff());list.scrollTop=list.scrollHeight;const next=heads[1].getBoundingClientRect().top;list.scrollTop=0;return {sticky,next,overflow:list.scrollHeight-list.clientHeight};});assert.ok(rail.sticky<4 && rail.overflow>30,JSON.stringify(rail));assert.equal(await page.locator('[data-panel=A] .bottom-right').innerText(),current);}
 for(const n of [4,2,1]){await page.keyboard.press(String(n));await page.waitForFunction(n=>document.querySelectorAll('[data-panel]').length===n,n);}
 assert.deepEqual(errors,[]);console.log('PASS',tablet?'tablet':'desktop','two synthetic patients, CT/MR/CR rasters, 1/2/4 layouts');await ctx.close();
}}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1});
