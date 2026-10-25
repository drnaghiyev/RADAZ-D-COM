import {spawnSync} from 'node:child_process';
const fixture=spawnSync('python',['tests/smart-volume-native-fixture.py'],{windowsHide:true});if(fixture.status!==0)throw Error(fixture.stderr.toString());
import {createRequire} from 'node:module';import {readFileSync,readdirSync} from 'node:fs';import assert from 'node:assert/strict';import dicomParser from 'dicom-parser';
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'playwright');
const files=readdirSync('outputs/features-041-fixture').map(n=>{const body=readFileSync('outputs/features-041-fixture/'+n),ds=dicomParser.parseDicom(new Uint8Array(body));return{body,study:ds.string('x0020000d'),series:ds.string('x0020000e'),sop:ds.string('x00080018')};}).filter(f=>f.study==='2.25.410');
const browser=await chromium.launch({channel:'msedge',headless:true});const context=await browser.newContext({viewport:{width:1450,height:950}});const page=await context.newPage();context.setDefaultTimeout(45000);const errors=[];context.on('page',p=>{p.on('pageerror',e=>errors.push(e.stack));p.on('dialog',d=>d.accept());});
await context.route('**/local-archive-api/**',route=>{const p=new URL(route.request().url()).pathname;if(p.endsWith('/license'))return route.fulfill({json:{valid:true,required:true,kind:'owner'}});if(p.endsWith('/instances'))return route.fulfill({json:files.map(f=>({uid:f.sop,series:f.series}))});if(p.includes('/file/'))return route.fulfill({contentType:'application/dicom',body:files.find(f=>f.sop===decodeURIComponent(p.split('/').at(-1))).body});return route.fulfill({json:[]});});
const prompts=[];let mask;await context.route('**/smart-volume-api/**',route=>{const p=new URL(route.request().url()).pathname;if(route.request().method()==='POST'){const body=route.request().postDataBuffer(),h=JSON.parse(body.subarray(4,4+body.readUInt32LE()).toString()),[x,y,z]=h.dimensions;assert.ok(h.point);prompts.push(h);mask=Buffer.alloc(x*y*z);for(let k=5;k<10;k++)for(let j=10;j<20;j++)for(let i=10;i<20;i++)mask[(k*y+j)*x+i]=1;return route.fulfill({json:{id:'test'}});}if(p.endsWith('/mask'))return route.fulfill({body:mask,contentType:'application/octet-stream'});return route.fulfill({json:{status:'needs-review',progress:1,seconds:.1}});});
try{await page.goto((process.env.RADAZ_TEST_URL||'http://127.0.0.1:5324')+'/#archive-study=2.25.410');await page.locator('[data-panel=A][data-has-image=true]').waitFor();const opened=context.waitForEvent('page');await page.getByRole('button',{name:'Smart Volume',exact:true}).click();const sv=await opened;await sv.getByRole('status').filter({hasText:'Manual sınaq'}).waitFor();console.log('PASS detached Smart Volume');

await sv.setViewportSize({width:1450,height:950});
const plane=sv.locator('.sv-plane[data-axis="2"]');
const box=await plane.boundingBox(),x=box.x+box.width*.4,y=box.y+box.height*.55;
await sv.getByRole('button',{name:'AI nöqtə',exact:true}).click();
await sv.mouse.click(x,y);
await sv.getByRole('button',{name:'AI nəticəsini rədd et',exact:true}).click();
const seed=prompts.at(-1).point;
await sv.getByRole('button',{name:'Polygon',exact:true}).click();
await sv.mouse.click(x,y);await sv.mouse.click(x+25,y);await sv.mouse.click(x+25,y+25);
const handle=plane.locator('circle').first();
const center=async()=>{const b=await handle.boundingBox();return {x:b.x+b.width/2,y:b.y+b.height/2};};
const initial=await center();
await sv.getByRole('button',{name:'Pan',exact:true}).click();
await sv.mouse.move(x+70,y+70);await sv.mouse.down();await sv.mouse.move(x+110,y+100,{steps:10});await sv.mouse.up();
await sv.waitForTimeout(200);const panned=await center();
assert.ok(Math.abs(panned.x-initial.x-40)<2,JSON.stringify({initial,panned}));
assert.ok(Math.abs(panned.y-initial.y-30)<2);
await sv.getByRole('button',{name:'Zoom',exact:true}).click();
await sv.mouse.move(x+70,y+70);await sv.mouse.down();await sv.mouse.move(x+70,y+110,{steps:10});await sv.mouse.up();
await sv.waitForTimeout(200);const zoomed=await center();assert.ok(Math.hypot(zoomed.x-panned.x,zoomed.y-panned.y)>5);
// Complete the contour so the handle cannot intercept the AI point.
await sv.keyboard.press('Enter');
await sv.getByRole('button',{name:'AI nöqtə',exact:true}).click();await sv.mouse.click(zoomed.x,zoomed.y);
await sv.getByRole('button',{name:'AI nəticəsini rədd et',exact:true}).waitFor();
const after=prompts.at(-1).point;assert.equal(prompts.length,2);
assert.ok(Math.abs(seed[0]-after[0])<.15&&Math.abs(seed[1]-after[1])<.15,JSON.stringify({seed,after}));
assert.deepEqual(errors,[]);console.log('PASS contour remains anchored through pan/zoom; AI point maps to same voxel',JSON.stringify({seed,after}));
await sv.screenshot({path:'outputs/smart-coordinate-regression.png'});
}finally{console.log(errors);await browser.close();}
