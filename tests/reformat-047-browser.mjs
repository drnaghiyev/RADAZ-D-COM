import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';
import {readFileSync,readdirSync,mkdirSync} from 'node:fs';
import dicomParser from 'dicom-parser';
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'playwright');
const fixture=spawnSync('python',['tests/features-041-fixture.py'],{windowsHide:true,encoding:'utf8'});assert.equal(fixture.status,0,fixture.stderr);
const files=readdirSync('outputs/features-041-fixture').map(name=>{const body=readFileSync('outputs/features-041-fixture/'+name),ds=dicomParser.parseDicom(new Uint8Array(body));return {body,study:ds.string('x0020000d'),sop:ds.string('x00080018'),series:ds.string('x0020000e')};});
const base=process.env.RADAZ_TEST_URL||'http://localhost:5317',browser=await chromium.launch({channel:'msedge',headless:true});
const context=await browser.newContext({viewport:{width:1920,height:1080}});context.setDefaultTimeout(45000);
let releaseOther;const otherGate=new Promise(r=>releaseOther=r);let stalled=false;
const errors=[],windowActions=[];context.on('page',p=>p.on('pageerror',error=>errors.push(error.stack)));
await context.route('**/local-archive-api/**',async route=>{
  const u=new URL(route.request().url()),path=u.pathname;
  if(path.endsWith('/license'))return route.fulfill({json:{valid:true,required:true,kind:'owner'}});
  if(path.endsWith('/instances'))return route.fulfill({json:files.filter(f=>u.search.includes(f.study)).sort((a,b)=>a.series.localeCompare(b.series)).map(f=>({uid:f.sop,series:f.series}))});
  if(path.includes('/file/')&&decodeURIComponent(path.split('/').at(-1)).startsWith('2.25.410.2.')){stalled=true;await otherGate;}
  if(path.includes('/file/'))return route.fulfill({contentType:'application/dicom',body:files.find(f=>f.sop===decodeURIComponent(path.split('/').at(-1))).body});
  if(path.includes('/window/'))windowActions.push(path.split('/').at(-1));
  return route.fulfill({json:[]});
});
await context.route('**/product.json',route=>route.fulfill({contentType:'application/json',body:readFileSync('public/product.json')}));
const page=await context.newPage();mkdirSync('outputs/features-041-qa',{recursive:true});
const api=(p,fn,arg)=>p.evaluate(async({fn,arg})=>{
  const url=performance.getEntriesByType('resource').find(e=>e.name.includes('/lib/cornerstone.ts'))?.name;
  if(!url)throw Error('Development module URL unavailable');
  const module=await import(url),viewer=await module.getViewer();return new Function('viewer','module','arg',`return (${fn})(viewer,module,arg)`)(viewer,module,arg);
},{fn:fn.toString(),arg});

try {
 await page.goto(base+'/#archive-study=2.25.410',{timeout:120000});
 await page.locator('[data-panel="A"][data-has-image="true"]').waitFor();
 await page.getByRole('button',{name:'Panel düzülüşü',exact:true}).waitFor();

 await page.waitForFunction(()=>document.querySelector('.series-card')?.textContent.includes('24'));
 for(let i=0;i<50&&!stalled;i++)await page.waitForTimeout(100);
 assert.ok(stalled,'second series remains in flight');
 const popup=context.waitForEvent('page');await page.getByRole('button',{name:'MPR rekonstruksiya',exact:true}).click();const mpr=await popup;
 await mpr.waitForFunction(()=>['MA','MC','MS'].every(id=>document.querySelector(`[data-panel="${id}"]`)?.dataset.hasImage==='true'),{},{timeout:90000});
 console.log('PASS all MPR planes while other series blocked');
 const pop3=context.waitForEvent('page');await page.getByRole('button',{name:'3D həcm görüntüləmə',exact:true}).click();const volume=await pop3;
 await volume.waitForFunction(()=>document.querySelector('[data-volume-id]')?.getAttribute('data-volume-id'),{},{timeout:90000});
 await api(volume,async({core})=>{const id=document.querySelector('[data-volume-id]').dataset.volumeId;for(let i=0;i<100&&!core.cache.getVolume(id).loadStatus.loaded;i++)await new Promise(r=>setTimeout(r,100));if(!core.cache.getVolume(id).loadStatus.loaded)throw Error('3D volume is not complete');});
 console.log('PASS complete 3D while other series blocked');
 releaseOther();await mpr.close();await volume.close();
 await page.waitForFunction(()=>document.querySelectorAll('.series-card').length===2&&!document.querySelector('.series-work-progress progress'));
 console.log('BEFORE REFORMAT');
 await page.getByRole('button',{name:'MPR açılış seçimləri',exact:true}).click();
 await page.getByRole('menuitem',{name:'Coronal',exact:true}).click();
 console.log('AFTER REFORMAT CLICK');
 await page.waitForFunction(()=>document.querySelector('[data-panel="A"] .top-right')?.textContent.includes('Coronal'));
 await page.getByRole('button',{name:'Panel düzülüşü',exact:true}).click();await page.getByRole('gridcell',{name:'2 sütun, 1 sətir, 2 panel',exact:true}).click();
 await page.locator('[data-panel="B"]').evaluate(el=>{const d=new DataTransfer();d.setData('application/x-series-id','2.25.410/2.25.410.2');el.dispatchEvent(new DragEvent('drop',{bubbles:true,dataTransfer:d}));});
 await page.waitForTimeout(2000);
 const pixels=await api(page,({engine})=>engine.getViewports().map(v=>({id:v.id,bright:Array.from(v.canvas.getContext('2d').getImageData(0,0,v.canvas.width,v.canvas.height).data).filter((x,i)=>i%4!==3&&x>30).length})));
 assert.ok(pixels.length===2&&pixels.every(v=>v.bright>1000));console.log('PASS reformat, split and drop pixels',pixels);

 await page.getByRole('button',{name:'Sync Scroll',exact:true}).click();await page.locator('[data-panel="A"]').hover();
 const synced=await api(page,({engine})=>{const a=engine.getViewport('panel-A'),b=engine.getViewport('panel-B');a.setZoom(1.5);a.setPan([25,30]);a.setProperties({voiRange:{lower:-300,upper:700}});return {a:[a.getZoom(),a.getPan(),a.getProperties().voiRange],b:[b.getZoom(),b.getPan(),b.getProperties().voiRange]};});
 assert.ok(Math.abs(synced.a[0]-synced.b[0])<.001);assert.deepEqual(synced.a[2],synced.b[2]);assert.ok(Math.abs(synced.a[1][0]-synced.b[1][0])<1);
 console.log('PASS presentation sync',synced);
 await page.getByRole('button',{name:'Sync Scroll',exact:true}).click();
 const isolated=await api(page,({engine})=>{const a=engine.getViewport('panel-A'),b=engine.getViewport('panel-B');const before=[b.getZoom(),b.getPan(),b.getProperties().voiRange];a.setZoom(2);a.setPan([50,60]);a.setProperties({voiRange:{lower:0,upper:500}});return {before,after:[b.getZoom(),b.getPan(),b.getProperties().voiRange]};});
 assert.deepEqual(isolated.before,isolated.after);console.log('PASS sync off isolates presentation');

 for(const panel of ['A','B'])await page.locator(`[data-panel="${panel}"]`).evaluate(el=>{const d=new DataTransfer();d.setData('application/x-series-id','2.25.410/2.25.410.1');el.dispatchEvent(new DragEvent('drop',{bubbles:true,dataTransfer:d}));});
 await page.waitForTimeout(500);
 await page.locator('[data-panel="A"]').click({position:{x:60,y:60}});
 await page.getByRole('button',{name:'Ölçmə alətləri',exact:true}).click();await page.getByRole('menuitem',{name:/Uzunluq/}).click();
 const box=await page.locator('[data-panel="A"]').boundingBox();await page.mouse.move(box.x+box.width*.4,box.y+box.height*.4);await page.mouse.down();await page.mouse.move(box.x+box.width*.6,box.y+box.height*.6,{steps:8});await page.mouse.up();await page.waitForTimeout(200);
 assert.ok(await page.locator('[data-panel="A"] line[data-id*="-endpoint-"]').count()>0);assert.equal(await page.locator('[data-panel="B"] line[data-id*="-endpoint-"]').count(),0);
 console.log('PASS CT measurements stay in the drawing pane');
 assert.deepEqual(errors,[]);
}finally{releaseOther();console.log('BROWSER ERRORS',errors);await page.screenshot({path:'outputs/reformat-047.png'});await browser.close();}
