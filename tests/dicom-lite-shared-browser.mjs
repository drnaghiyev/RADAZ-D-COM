import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,cpSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {deflateSync} from 'node:zlib';
import {createRequire} from 'node:module';
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'../outputs/browser-test-tools/node_modules/playwright');
import {portableViewerHtml} from '../lib/dicom-lite-html.ts';
test('CD Lite uses the main Viewer tools offline, with calibrated pixels and exclusive mouse actions',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'radaz-lite-shared-'));let browser;
 try{
  mkdirSync(join(dir,'LITE'));mkdirSync(join(dir,'DATA'));cpSync('public/dicom-lite/viewer.js',join(dir,'LITE/viewer.js'));cpSync('public/dicom-lite/viewer.css',join(dir,'LITE/viewer.css'));
  const values=new Int16Array(128*128);for(let y=0;y<128;y++)for(let x=0;x<128;x++)values[y*128+x]=x<64?123:700;
  const packet={rows:128,columns:128,kind:'int16',tags:{x00080060:'CT',x00080018:'2.25.123.1',x0020000d:'2.25.123',x0020000e:'2.25.123.2',x00280030:'0.5\\0.5',x00280004:'MONOCHROME2',x00281050:'400',x00281051:'1000'},data:deflateSync(Buffer.from(values.buffer)).toString('base64')};
  writeFileSync(join(dir,'DATA/IMG000001_F000001.js'),'window.RADAZ_LITE_PACKET='+JSON.stringify(packet)+';');
  writeFileSync(join(dir,'START.html'),portableViewerHtml({patient:'TEST PATIENT'},[{name:'test.dcm',path:'DATA/IMG000001_F000001.js'}]));
  browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
  const page=await browser.newPage({viewport:{width:1200,height:850}}),errors=[],requests=[];page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>{if(/^https?:/.test(request.url()))requests.push(request.url());});
  await page.goto(pathToFileURL(join(dir,'START.html')).href);
  try{await page.locator('[data-panel="LITE"][data-has-image="true"]').waitFor({timeout:20000});}catch(error){throw Error(JSON.stringify({errors,body:await page.locator('body').innerText()}));}
  const toolbar=page.getByRole('toolbar'),canvas=page.locator('.dicom-canvas');assert.ok(await toolbar.getByRole('button').count()>=17);
  await toolbar.getByRole('button',{name:'Alət panelini fərdiləşdir'}).click();
  await page.getByRole('dialog').getByRole('button',{name:/^Uzunluq.* əvvəl ayırıcı$/}).first().click();
  await page.getByRole('dialog').getByRole('button',{name:'Təsdiq'}).click();
  assert.equal(await toolbar.locator('[data-radaz-divider]').count(),1);
  await toolbar.getByRole('button',{name:/Uzunluq/}).click();const bounds=await canvas.boundingBox(),x=bounds.x+bounds.width*.5,y=bounds.y+bounds.height*.5;
  await page.mouse.move(x-70,y);await page.mouse.down();await page.mouse.move(x+70,y,{steps:6});await page.mouse.up();
  await page.waitForFunction(()=>!!document.querySelector('.dicom-canvas svg text'));assert.ok(await page.locator('.dicom-canvas svg text').count()>0);
  const windowBefore=await page.locator('.overlay.bottom-left').innerText();
  await toolbar.getByRole('button',{name:'Pan',exact:true}).click();await page.mouse.move(x,y+100);await page.mouse.down();await page.mouse.move(x+30,y+120,{steps:6});await page.mouse.up();assert.ok(await page.locator('.dicom-canvas svg text').count()>0);
  await toolbar.getByRole('button',{name:'Zoom',exact:true}).click();await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x,y-35,{steps:6});await page.mouse.up();assert.ok(await page.locator('.dicom-canvas svg text').count()>0);
  assert.equal(await page.locator('.overlay.bottom-left').innerText(),windowBefore,'pan/zoom must not change brightness');
  await toolbar.getByRole('button',{name:'Parlaqlıq / kontrast',exact:true}).click();await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+35,y+20,{steps:6});await page.mouse.up();
  assert.notEqual(await page.locator('.overlay.bottom-left').innerText(),windowBefore,'windowing adjusts the calibrated display range');
  await toolbar.getByRole('button',{name:'Mərkəzləşdir',exact:true}).click();await toolbar.locator('button[title$=" · H"]').click();await page.mouse.click(x-150,y);
  await page.waitForFunction(()=>document.querySelector('svg.measurement-overlay [data-kind="hu"]')?.textContent.includes('HU 123'));
  await toolbar.getByRole('button',{name:/Cobb/}).click();assert.equal(await toolbar.getByRole('button',{name:/Cobb/}).getAttribute('aria-pressed'),'true');
  await toolbar.getByRole('button',{name:'Ölçü ayarları',exact:true}).click();const dialog=page.getByRole('dialog');await dialog.waitFor();const box=await dialog.boundingBox();assert.ok(box.x>=0&&box.y>=0&&box.x+box.width<=1201&&box.y+box.height<=851);await page.keyboard.press('Escape');
  assert.deepEqual(errors,[]);assert.deepEqual(requests,[],'the CD viewer must not contact the Internet or the local archive');
 }finally{await browser?.close();rmSync(dir,{recursive:true,force:true});}
});
