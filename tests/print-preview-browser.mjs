import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdirSync} from 'node:fs';
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'playwright');
const base=process.env.RADAZ_TEST_URL||'http://127.0.0.1:5197';
const browser=await chromium.launch({headless:true,channel:'msedge'});let page;
mkdirSync('outputs/print-qa',{recursive:true});
try{
 const context=await browser.newContext({viewport:{width:1440,height:1050}});page=await context.newPage();const errors=[],sent=[];
 page.on('pageerror',error=>errors.push(error.message));
 await page.route('**/local-archive-api/**',async route=>{
  const url=new URL(route.request().url());
  if(url.pathname.endsWith('/print')){sent.push(route.request().postDataJSON());return route.fulfill({json:{message:'Synthetic printer accepted'}});}
  return route.fulfill({json:url.pathname.endsWith('/license')?{valid:true,required:true,kind:'owner'}:url.pathname.endsWith('/printer-settings')?{host:'synthetic-printer',layout:'2,2'}:[]});
 });
 await page.goto(base+'/archive');
 await page.evaluate(async()=>{
  const frames=[];
  for(let i=0;i<6;i++){
   const c=document.createElement('canvas');c.width=i%2?160:320;c.height=i%2?320:160;
   const ctx=c.getContext('2d');ctx.fillStyle=i%2?'rgb(64,64,64)':'rgb(128,128,128)';ctx.fillRect(0,0,c.width,c.height);
   const labels=document.createElement('canvas');labels.width=c.width;labels.height=c.height;const l=labels.getContext('2d');if(i===0){l.fillStyle='white';l.fillRect(8,8,14,5);}const overlay=await new Promise(resolve=>labels.toBlob(resolve));
   const blob=await new Promise(resolve=>c.toBlob(resolve));frames.push({id:String(i),name:'Synthetic '+i,blob,overlay,width:c.width,height:c.height});
  }
  await new Promise((resolve,reject)=>{const r=indexedDB.open('radaz-output-jobs',1);r.onupgradeneeded=()=>r.result.createObjectStore('jobs',{keyPath:'id'});r.onsuccess=()=>{const db=r.result,t=db.transaction('jobs','readwrite');t.objectStore('jobs').put({id:'synthetic-print',title:'Synthetic print fitting',created:Date.now(),frames});t.oncomplete=()=>{db.close();resolve();};t.onerror=reject;};});
 });
 await page.goto(base+'/print?job=synthetic-print');await page.getByRole('status').filter({hasText:'6 görüntü hazırdır'}).waitFor();
 const cell=n=>page.getByRole('button',{name:`${n}-ci görüntü`,exact:true});
 const sample=n=>cell(n).locator('canvas').evaluate(c=>{
  const data=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let x0=c.width,y0=c.height,x1=0,y1=0;
  for(let y=0;y<c.height;y++)for(let x=0;x<c.width;x++){if(data[(y*c.width+x)*4]>2){x0=Math.min(x0,x);x1=Math.max(x1,x);y0=Math.min(y0,y);y1=Math.max(y1,y);}}
  return {center:data[(Math.floor(c.height/2)*c.width+Math.floor(c.width/2))*4],box:[x0,y0,x1,y1],width:c.width,height:c.height};
 });
 const initial=await sample(1),second=await sample(2);
 assert.ok(Math.abs((initial.box[2]-initial.box[0]+1)/(initial.box[3]-initial.box[1]+1)-2)<.02,'Wide image fits without cropping or stretching');
 assert.ok(Math.abs((second.box[2]-second.box[0]+1)/(second.box[3]-second.box[1]+1)-.5)<.02,'Tall image fits without cropping');
 const white=()=>cell(1).locator('canvas').evaluate(c=>{const d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let x0=c.width,y0=c.height,x1=0,y1=0;for(let y=0;y<c.height;y++)for(let x=0;x<c.width;x++)if(d[(y*c.width+x)*4]>240){x0=Math.min(x0,x);x1=Math.max(x1,x);y0=Math.min(y0,y);y1=Math.max(y1,y);}return[x0,y0,x1,y1];});
 const fixedLabels=await white();
 const sheetBefore=await page.locator('.is-preview').boundingBox();
 await page.getByRole('slider',{name:'Görüntü zoomu',exact:true}).fill('2');
 assert.ok((await sample(1)).box[3]-(await sample(1)).box[1]>initial.box[3]-initial.box[1]);
 assert.deepEqual(await page.locator('.is-preview').boundingBox(),sheetBefore,'Zoom changes the image, not the sheet');
 assert.deepEqual(await white(),fixedLabels,'Corner labels do not zoom with anatomy');
 await page.getByRole('slider',{name:'Parlaqlıq',exact:true}).fill('50');
 assert.equal((await sample(1)).center,178);assert.deepEqual(await sample(2),second,'Single applies only to selected image');
 await page.getByRole('checkbox',{name:'Hamısı',exact:true}).check();assert.equal(await page.getByRole('checkbox',{name:'Tək',exact:true}).isChecked(),false);
 await page.getByRole('slider',{name:'Parlaqlıq',exact:true}).fill('-20');assert.equal((await sample(1)).center,108);assert.equal((await sample(2)).center,44);
 await page.getByRole('button',{name:'Sonrakı plyonka',exact:true}).click();assert.equal((await sample(5)).center,108,'All includes other pages');
 await page.getByRole('button',{name:'Əvvəlki plyonka',exact:true}).click();assert.equal((await sample(1)).center,108);
 await page.getByRole('combobox',{name:'Önbaxış formatı'}).selectOption('film');
 const expected=await page.locator('.is-preview canvas').evaluateAll(canvases=>canvases.map(c=>{const rgba=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let hash=0;for(let i=0;i<rgba.length;i+=4)hash=(hash+rgba[i])>>>0;return {rows:c.height,columns:c.width,hash};}));
 await page.getByRole('button',{name:'DICOM printerə göndər',exact:true}).click();await page.getByRole('status').filter({hasText:'2 plyonkanın çap əmri'}).waitFor();
 assert.equal(sent.length,2);
 assert.deepEqual(sent[0].images.map(i=>({rows:i.rows,columns:i.columns,hash:Buffer.from(i.pixels,'base64').reduce((sum,v)=>(sum+v)>>>0,0)})),expected,'DICOM output contains exactly the adjusted preview pixels');
 await page.emulateMedia({media:'print'});await page.evaluate(()=>window.dispatchEvent(new Event('beforeprint')));
 assert.equal(await page.locator('.print-sheet canvas').count(),6,'All pages render for PDF/paper');
 const fitted=await page.locator('.film-cell canvas').evaluateAll(canvases=>canvases.every(c=>{const a=c.getBoundingClientRect(),b=c.parentElement.getBoundingClientRect();return Math.abs(a.width-b.width)<1&&Math.abs(a.height-b.height)<1;}));assert.equal(fitted,true);
 await page.screenshot({path:'outputs/print-qa/paper.png',fullPage:true});
 await page.emulateMedia({media:'screen'});await page.evaluate(()=>window.dispatchEvent(new Event('afterprint')));
 await page.screenshot({path:'outputs/print-qa/preview.png',fullPage:true});
 for(const layout of ['5,5','6,6']){await page.getByRole('combobox',{name:'Bölgü',exact:true}).selectOption(layout);assert.equal(await page.locator('.is-preview .film-cell').count(),6);assert.equal(await page.locator('.is-preview').evaluate(e=>getComputedStyle(e).getPropertyValue('--film-columns').trim()),layout.split(',')[0]);}
 assert.deepEqual(errors,[]);console.log('PASS: image fit, single/all brightness, zoom without resizing paper, persistence across pages, matching DICOM pixels and PDF layout');
}catch(error){await page?.screenshot({path:'outputs/print-qa/failure.png',fullPage:true});throw error;}finally{await browser.close();}
