import assert from 'node:assert/strict';
import {test} from 'node:test';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,rmSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import dicomParser from 'dicom-parser';
import {chromium} from '../outputs/browser-test-tools/node_modules/playwright/index.mjs';

test('stitch uses a separate web window, preserves registration on center, and burns measurements into derived DICOM',async()=>{
 const root=mkdtempSync(join(tmpdir(),'radaz-stitch-detached-'));let browser;
 try{
  const fixture=spawnSync('python',['-c',`from pathlib import Path\nimport sys\nsys.path.insert(0,'tests')\nfrom removable_media_test import write_image\np=Path(r'${root.replaceAll('\\','/')}')\nfor i in range(2):\n d=write_image(p/f'rf-{i}.dcm',i)\n d.PatientName='TEST^RADAZ';d.PatientID='QA-STITCH';d.StudyInstanceUID='2.25.987654323';d.SeriesInstanceUID='2.25.987654323.1';d.SOPInstanceUID=f'2.25.987654323.1.{i+1}';d.Modality='RF';d.SeriesDescription='Stitch Detached QA';d.SeriesNumber=1;d.SOPClassUID='1.2.840.10008.5.1.4.1.1.1';d.save_as(p/f'rf-{i}.dcm',enforce_file_format=True)`],{windowsHide:true,encoding:'utf8'});
  assert.equal(fixture.status,0,fixture.stderr);
  browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
  const context=await browser.newContext({viewport:{width:1600,height:900}});context.setDefaultTimeout(15000);
  await context.route('**/local-archive-api/license',route=>route.fulfill({json:{valid:true,required:true,kind:'owner'}}));
  await context.route('**/local-archive-api/status',route=>route.fulfill({status:503,json:{error:'Synthetic browser archive only'}}));
  const page=await context.newPage();await page.goto(process.env.RADAZ_TEST_URL||'http://127.0.0.1:5445/');await page.locator('.topbar').waitFor();
  await page.locator('input[type="file"]').first().setInputFiles([join(root,'rf-0.dcm'),join(root,'rf-1.dcm')]);
  await page.locator('[data-panel="A"][data-has-image="true"]').waitFor();
  const [popup]=await Promise.all([page.waitForEvent('popup'),page.getByRole('button',{name:'İki rentgeni birləşdir',exact:true}).click()]);
  await popup.waitForLoadState();assert.match(popup.url(),/\/stitch\?handoff=/);
  const editor=popup.locator('.stitch-standalone');await editor.waitFor();await popup.locator('.stitch-preview canvas').waitFor();
  const box=await editor.boundingBox(),viewport=await popup.evaluate(()=>({width:innerWidth,height:innerHeight}));assert.ok(Math.abs(box.x)<2&&Math.abs(box.y)<2&&Math.abs(box.width-viewport.width)<2&&Math.abs(box.height-viewport.height)<2,JSON.stringify({box,viewport}));
  assert.equal(await popup.locator('.stitch-window-header').count(),0);
  assert.equal(await popup.locator('.stitch-controls [aria-label="Hamısını sıfırla"]').count(),1);
  assert.equal(await popup.locator('.stitch-controls [aria-label="Ayrıca DICOM kimi saxla"]').count(),1);
  await popup.waitForFunction(()=>!document.querySelector('[aria-label="Ayrıca DICOM kimi saxla"]')?.disabled,null,{timeout:15000});
  const stage=await popup.locator('.stitch-preview').boundingBox();
  await popup.getByRole('button',{name:'Kadrı sürüşdür'}).click();
  await popup.mouse.move(stage.x+stage.width/2,stage.y+stage.height*.75);await popup.mouse.down();await popup.mouse.move(stage.x+stage.width/2+34,stage.y+stage.height*.75+18,{steps:6});await popup.mouse.up();
  const offset=await popup.getByTestId('stitch-offset').innerText();
  await popup.getByRole('button',{name:'Görüntüləri mərkəzləşdir'}).click();
  assert.equal(await popup.getByTestId('stitch-offset').innerText(),offset,'centering must preserve manual frame alignment');



  await popup.locator('.stitch-stage-toolbar').getByRole('button',{name:/Uzunluq/}).click();
  await popup.locator('[data-panel="STITCH"][data-has-image="true"]').waitFor();
  assert.equal(await popup.locator('.workstation').count(),0,'measurement tools stay in stitch');
  assert.equal(await popup.locator('.stitch-stage-toolbar button').count(),19,'all original Viewer measurement tools are in the stitch toolbar');
  const measurementCanvas=await popup.locator('[data-panel="STITCH"] .dicom-canvas').boundingBox();
  await popup.mouse.move(measurementCanvas.x+measurementCanvas.width*.4,measurementCanvas.y+measurementCanvas.height*.45);await popup.mouse.down();
  await popup.mouse.move(measurementCanvas.x+measurementCanvas.width*.6,measurementCanvas.y+measurementCanvas.height*.55,{steps:8});await popup.mouse.up();
  await popup.waitForTimeout(600);
  assert.ok(await popup.locator('.stitch-inline-measurements .dicom-canvas svg text').count()>0,'measurement values are shown with the lines');
  mkdirSync('outputs/stitch-qa',{recursive:true});await popup.screenshot({path:'outputs/stitch-qa/detached-stitch-measurement.png'});
  await popup.getByRole('button',{name:'Ayrıca DICOM kimi saxla'}).click();
  await popup.waitForEvent('close',{timeout:30000});
  if(process.env.RADAZ_TEST_PROD==='1'){
   await page.getByText('Birləşmiş rentgen ayrıca DICOM seriyası kimi saxlandı.').waitFor({timeout:20000});
   return;
  }
  await page.waitForFunction(async()=>{const {getArchiveFiles}=await import('/lib/local-archive.ts');return (await getArchiveFiles('2.25.987654323')).length===3;},null,{timeout:20000});
  const bytes=await page.evaluate(async()=>{const {getArchiveFiles}=await import('/lib/local-archive.ts');const {parseDicomFile}=await import('/lib/dicom-file.ts');for(const file of await getArchiveFiles('2.25.987654323')){const data=new Uint8Array(await file.arrayBuffer());if(parseDicomFile(data).string('x00080060')==='OT')return [...data];}throw Error('Derived DICOM missing');});
  const data=Uint8Array.from(bytes),ds=dicomParser.parseDicom(data);assert.equal(ds.string('x00280301'),'YES');
  const element=ds.elements.x7fe00010,rgb=data.subarray(element.dataOffset,element.dataOffset+element.length);
  assert.ok(rgb.some((v,i)=>i%3===0&&v!==rgb[i+1]),'measurement color is in exported pixels');
 }finally{await browser?.close();rmSync(root,{recursive:true,force:true});}
});
