import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {chromium} from '../outputs/browser-test-tools/node_modules/playwright/index.mjs';
import {viewerHtml} from '../lib/dicom-lite-html.ts';

test('offline Lite centers images and edits length, angle, Cobb and calibrated CT HU',async()=>{
 const root=mkdtempSync(join(tmpdir(),'radaz-lite-'));let browser;
 try{
  mkdirSync(join(root,'PREVIEWS'));mkdirSync(join(root,'HU'));
  writeFileSync(join(root,'PREVIEWS','one.svg'),'<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="gray"/></svg>');
  const hu=new Int16Array(10000);hu.fill(123);
  writeFileSync(join(root,'HU','one.js'),'window.__RADAZ_HU={index:0,data:"'+Buffer.from(hu.buffer).toString('base64')+'"};');
  const study={patient:'TEST PATIENT',description:'CT'};
  writeFileSync(join(root,'START.html'),viewerHtml(study,[{name:'one.dcm',path:'PREVIEWS/one.svg',hu:'HU/one.js',rows:100,columns:100,spacing:[.5,.5]}]));
  browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--allow-file-access-from-files']});
  const page=await browser.newPage({viewport:{width:1100,height:750}});await page.goto(pathToFileURL(join(root,'START.html')).href);
  await page.waitForFunction(()=>document.getElementById('image').naturalWidth===100);
  await page.getByRole('button',{name:'HU ROI'}).click();
  await page.waitForFunction(()=>document.getElementById('hint').textContent.includes('orijinal KT'));
  const image=await page.locator('#image').boundingBox();assert.ok(image);
  assert.ok(Math.abs(image.x+image.width/2-550)<1,'image is horizontally centered');
  const point=(x,y)=>[image.x+image.width*x/100,image.y+image.height*y/100];
  await page.getByRole('button',{name:'Uzunluq'}).click();await page.mouse.click(...point(10,20));await page.mouse.click(...point(40,20));
  let marks=await page.evaluate(()=>eval('marks[index]'));assert.equal(marks[0].type,'length');
  assert.deepEqual(marks[0].points.map(p=>p.map(Math.round)),[[10,20],[40,20]]);
  await page.mouse.move(...point(40,20));await page.mouse.down();await page.mouse.move(...point(50,20));await page.mouse.up();
  marks=await page.evaluate(()=>eval('marks[index]'));assert.ok(marks[0].points[1][0]>48,'endpoint is editable');
  await page.getByRole('button',{name:'Bucaq'}).click();for(const p of [[10,40],[30,40],[30,60]])await page.mouse.click(...point(...p));
  await page.getByRole('button',{name:'Cobb'}).click();for(const p of [[10,70],[40,70],[10,80],[40,90]])await page.mouse.click(...point(...p));
  await page.getByRole('button',{name:'HU ROI'}).click();await page.mouse.move(...point(60,60));await page.mouse.down();await page.mouse.move(...point(80,80));await page.mouse.up();
  marks=await page.evaluate(()=>eval('marks[index]'));assert.deepEqual(marks.map(x=>x.type),['length','angle','cobb','roi']);
  assert.equal(await page.evaluate(()=>eval('roi(marks[index][3])')),'123 HU');
  await page.getByRole('button',{name:'Ölçünü sil'}).click();assert.equal((await page.evaluate(()=>eval('marks[index]'))).length,3);
 }finally{await browser?.close();rmSync(root,{recursive:true,force:true});}
});
