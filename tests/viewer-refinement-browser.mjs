import {spawnSync} from 'node:child_process';
const fixture=spawnSync('python',['tests/smart-volume-native-fixture.py'],{windowsHide:true});if(fixture.status!==0)throw Error(fixture.stderr.toString());
import {createRequire} from 'node:module';import {readFileSync,readdirSync} from 'node:fs';import assert from 'node:assert/strict';import dicomParser from 'dicom-parser';
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'playwright');
const files=readdirSync('outputs/features-041-fixture').map(n=>{const body=readFileSync('outputs/features-041-fixture/'+n),ds=dicomParser.parseDicom(new Uint8Array(body));return{body,study:ds.string('x0020000d'),series:ds.string('x0020000e'),sop:ds.string('x00080018')};}).filter(f=>f.study==='2.25.410');
const browser=await chromium.launch({channel:'msedge',headless:true});const context=await browser.newContext({viewport:{width:1450,height:950}});const page=await context.newPage();context.setDefaultTimeout(45000);const errors=[];context.on('page',p=>{p.on('pageerror',e=>errors.push(e.stack));p.on('dialog',d=>d.accept());});
await context.route('**/local-archive-api/**',route=>{const p=new URL(route.request().url()).pathname;if(p.endsWith('/license'))return route.fulfill({json:{valid:true,required:true,kind:'owner'}});if(p.endsWith('/instances'))return route.fulfill({json:files.map(f=>({uid:f.sop,series:f.series}))});if(p.includes('/file/'))return route.fulfill({contentType:'application/dicom',body:files.find(f=>f.sop===decodeURIComponent(p.split('/').at(-1))).body});return route.fulfill({json:[]});});
let mask;await context.route('**/smart-volume-api/**',route=>{const p=new URL(route.request().url()).pathname;if(route.request().method()==='POST'){const body=route.request().postDataBuffer(),h=JSON.parse(body.subarray(4,4+body.readUInt32LE()).toString()),[x,y,z]=h.dimensions;assert.ok(h.point);mask=Buffer.alloc(x*y*z);for(let k=5;k<10;k++)for(let j=10;j<20;j++)for(let i=10;i<20;i++)mask[(k*y+j)*x+i]=1;return route.fulfill({json:{id:'test'}});}if(p.endsWith('/mask'))return route.fulfill({body:mask,contentType:'application/octet-stream'});return route.fulfill({json:{status:'needs-review',progress:1,seconds:.1}});});
try{
console.log('start');await page.goto('http://127.0.0.1:5324/#archive-study=2.25.410');await page.locator('[data-panel=A][data-has-image=true]').waitFor();
assert.equal(await page.getByRole('button',{name:'TotalSegmentator',exact:true}).count(),0);
assert.equal(await page.getByRole('button',{name:'Smart Volume',exact:true}).getAttribute('title'),'Smart Volume');
for(const width of [1920,1280]){
 await page.setViewportSize({width,height:950});console.log('layout click');await page.locator('.layout-trigger').click();
 const cells=page.locator('.layout-matrix button');assert.equal(await cells.count(),30);
 for(const cell of await cells.all()){const box=await cell.boundingBox();assert.ok(Math.abs(box.width-box.height)<.1,JSON.stringify(box));}
 await page.screenshot({path:`outputs/layout-square-${width}.png`});await page.keyboard.press('Escape');
}
await page.setViewportSize({width:1920,height:1080});console.log('layout click');await page.locator('.layout-trigger').click();await page.getByRole('gridcell',{name:'6 sütun, 5 sətir, 30 panel',exact:true}).click();assert.equal(await page.locator('.viewport-grid > *').count(),30);
await page.locator('.help-trigger').click();await page.locator('.product-menu [role=menuitem]').first().click();
await page.getByRole('status').filter({hasText:'MedSAM2'}).waitFor();assert.equal(await page.locator('.product-dialog legend').filter({hasText:'Smart Volume'}).count(),1);assert.equal(await page.getByText('Anatomiya AI lisenziyası',{exact:true}).count(),0);
assert.deepEqual(errors,[]);console.log('PASS main viewer removal, Smart Volume, square 5x6 picker at 1920/1280 and 30 panes, settings replacement');
}finally{console.log(errors);await browser.close();}
