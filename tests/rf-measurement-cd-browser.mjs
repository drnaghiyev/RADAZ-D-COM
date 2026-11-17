import assert from 'node:assert/strict';
import {test} from 'node:test';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {chromium} from '../outputs/browser-test-tools/node_modules/playwright/index.mjs';
import JSZip from 'jszip';
import dicomParser from 'dicom-parser';

test('RF measurement becomes a visible separate DICOM on offline CD; stitch opens',async()=>{
 const root=mkdtempSync(join(tmpdir(),'radaz-rf-cd-'));let browser;
 try{
  const fixture=spawnSync('python',['-c',`from pathlib import Path\nimport sys\nsys.path.insert(0,'tests')\nfrom removable_media_test import write_image\np=Path(r'${root.replaceAll('\\','/')}')\nfor i in range(2):\n d=write_image(p/f'rf-{i}.dcm',i)\n d.PatientName='TEST^RADAZ';d.PatientID='QA-RF';d.StudyInstanceUID='2.25.987654321';d.SeriesInstanceUID='2.25.987654321.1';d.SOPInstanceUID=f'2.25.987654321.1.{i+1}';d.Modality='RF';d.SeriesDescription='RF Stitch QA';d.SeriesNumber=1;d.SOPClassUID='1.2.840.10008.5.1.4.1.1.1';d.save_as(p/f'rf-{i}.dcm',enforce_file_format=True)`],{windowsHide:true,encoding:'utf8'});
  assert.equal(fixture.status,0,fixture.stderr);
  browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
  const context=await browser.newContext({viewport:{width:1500,height:900}});context.setDefaultTimeout(30000);
  await context.route('**/local-archive-api/license',route=>route.fulfill({json:{valid:true,required:true,kind:'owner'}}));
  await context.route('**/local-archive-api/status',route=>route.fulfill({status:503,json:{error:'Synthetic browser archive only'}}));
  const page=await context.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(process.env.RADAZ_TEST_URL||'http://127.0.0.1:5444/');
  await page.locator('input[type="file"]').first().setInputFiles([join(root,'rf-0.dcm'),join(root,'rf-1.dcm')]);
  await page.locator('[data-panel="A"][data-has-image="true"]').waitFor();
  try{await page.waitForFunction(()=>document.querySelector('.series-card')?.textContent.includes('2 görüntü'),null,{timeout:8000});}
  catch{throw Error('RF series: '+await page.locator('.series-card').allInnerTexts()+'; '+await page.locator('.statusbar').innerText());}
  await page.getByRole('button',{name:'Ölçmə alətləri',exact:true}).click();
  await page.getByRole('menuitem',{name:/Uzunluq/}).click();
  const canvas=await page.locator('[data-panel="A"] .dicom-canvas').boundingBox(),x=canvas.x+canvas.width/2,y=canvas.y+canvas.height/2;
  await page.mouse.move(x-60,y);await page.mouse.down();await page.mouse.move(x+60,y,{steps:8});await page.mouse.up();
  await page.waitForFunction(async()=>{if(!(await indexedDB.databases()).some(item=>item.name==='radaz-measurement-copies'))return false;const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('radaz-measurement-copies',1);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});if(!db.objectStoreNames.contains('copies')){db.close();return false}const count=await new Promise(resolve=>{const r=db.transaction('copies').objectStore('copies').count();r.onsuccess=()=>resolve(r.result)});db.close();return count>0;},null,{timeout:15000});
  const result=await page.evaluate(async()=>{const media=await import('/lib/dicom-media.ts'),archive=await import('/lib/local-archive.ts');const study=(await archive.listArchiveStudies()).find(x=>x.uid==='2.25.987654321');if(!study)throw Error('Synthetic RF study missing');const files=await archive.getArchiveFiles(study.uid);const {blob}=await media.buildDicomCdPackage(study,files);return [...new Uint8Array(await blob.arrayBuffer())]});
  const zip=await JSZip.loadAsync(Uint8Array.from(result));const names=Object.keys(zip.files),measured=names.find(name=>name.startsWith('MEASUREMENTS/')&&name.endsWith('.dcm'));
  assert.ok(measured,'CD includes RF measured DICOM');const bytes=new Uint8Array(await zip.file(measured).async('uint8array')),ds=dicomParser.parseDicom(bytes);
  assert.equal(ds.string('x00280301'),'YES');assert.equal(ds.string('x00080060'),'OT');
  const pixel=ds.elements.x7fe00010,rgb=bytes.subarray(pixel.dataOffset,pixel.dataOffset+pixel.length);assert.ok(rgb.some((v,i)=>i%3===0&&v!==rgb[i+1]),'annotation color is burned into the DICOM pixels');
  await page.getByRole('button',{name:'Ölçmə alətləri',exact:true}).click();await page.getByRole('menuitem',{name:/İki rentgeni birləşdir/}).click();
  await page.getByRole('dialog',{name:'İki rentgen görüntüsünü birləşdir'}).waitFor();
  const stitchButton=page.getByRole('button',{name:'Ayrıca DICOM kimi saxla'});
  try{await stitchButton.waitFor({state:'visible',timeout:10000});await page.waitForFunction(()=>[...document.querySelectorAll('.stitch-dialog button')].find(e=>e.textContent.includes('Ayrıca DICOM'))?.disabled===false,null,{timeout:10000});}
  catch{throw Error('Stitch unavailable: '+await page.getByRole('dialog',{name:'İki rentgen görüntüsünü birləşdir'}).innerText());}
  await stitchButton.click();
  await page.waitForFunction(async()=>{const archive=await import('/lib/local-archive.ts');const files=await archive.getArchiveFiles('2.25.987654321');return files.length===3;},null,{timeout:20000});
  const stitched=await page.evaluate(async()=>{const archive=await import('/lib/local-archive.ts'),parser=await import('/lib/dicom-file.ts'),files=await archive.getArchiveFiles('2.25.987654321');for(const file of files){const bytes=new Uint8Array(await file.arrayBuffer());if(parser.parseDicomFile(bytes).string('x0008103e')==='RADAZ Stitched Radiograph')return [...bytes]}throw Error('Stitched DICOM missing')});
  const stitchedDs=dicomParser.parseDicom(Uint8Array.from(stitched));assert.equal(stitchedDs.string('x0008103e'),'RADAZ Stitched Radiograph');
  assert.equal(stitchedDs.elements.x00082112.items.length,2);
  await page.locator('[data-panel="A"][data-has-image="true"]').waitFor();
  await page.getByRole('button',{name:'Ölçmə alətləri',exact:true}).click();await page.getByRole('menuitem',{name:/Uzunluq/}).click();
  const mergedCanvas=await page.locator('[data-panel="A"] .dicom-canvas').boundingBox(),mx=mergedCanvas.x+mergedCanvas.width/2,my=mergedCanvas.y+mergedCanvas.height/2;
  await page.mouse.move(mx-50,my);await page.mouse.down();await page.mouse.move(mx+50,my,{steps:8});await page.mouse.up();
  await page.waitForFunction(async()=>{const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('radaz-measurement-copies',1);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});const count=await new Promise(resolve=>{const r=db.transaction('copies').objectStore('copies').count();r.onsuccess=()=>resolve(r.result)});db.close();return count===2;},null,{timeout:15000});
  assert.deepEqual(errors,[]);
 }finally{await browser?.close();rmSync(root,{recursive:true,force:true});}
});
