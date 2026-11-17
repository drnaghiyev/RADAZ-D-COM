import assert from 'node:assert/strict';
import {test} from 'node:test';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,rmSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {chromium} from '../outputs/browser-test-tools/node_modules/playwright/index.mjs';

test('production stitch fills the installed-size window and toolbar reaches the right edge',async()=>{
 const root=mkdtempSync(join(tmpdir(),'radaz-stitch-prod-'));let browser;
 try{
  const fixture=spawnSync('python',['-c',`from pathlib import Path\nimport sys\nsys.path.insert(0,'tests')\nfrom removable_media_test import write_image\np=Path(r'${root.replaceAll('\\','/')}')\nfor i in range(2):\n d=write_image(p/f'rf-{i}.dcm',i)\n d.PatientName='TEST^RADAZ';d.PatientID='QA-RF';d.StudyInstanceUID='2.25.987654322';d.SeriesInstanceUID='2.25.987654322.1';d.SOPInstanceUID=f'2.25.987654322.1.{i+1}';d.Modality='RF';d.SeriesDescription='Stitch Production QA';d.SeriesNumber=1;d.SOPClassUID='1.2.840.10008.5.1.4.1.1.1';d.save_as(p/f'rf-{i}.dcm',enforce_file_format=True)`],{windowsHide:true,encoding:'utf8'});
  assert.equal(fixture.status,0,fixture.stderr);
  browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
  const context=await browser.newContext({viewport:{width:1920,height:1000}});context.setDefaultTimeout(15000);
  await context.addInitScript(()=>localStorage.setItem('radaz-toolbar-v1:viewer',JSON.stringify({rotation:{side:'right',order:0},window:{side:'right',order:1}})));
  await context.route('**/local-archive-api/license',route=>route.fulfill({json:{valid:true,required:true,kind:'owner'}}));
  await context.route('**/local-archive-api/status',route=>route.fulfill({status:503,json:{error:'Synthetic browser archive only'}}));
  const page=await context.newPage();await page.goto(process.env.RADAZ_TEST_URL||'http://127.0.0.1:5445/');await page.locator('.topbar').waitFor();
  const header=await page.locator('.topbar').boundingBox();assert.ok(Math.abs(header.width-1920)<2,'header spans the full width');
  const settings=page.locator('.topbar [data-toolbar-group="toolbar-settings"]');await settings.waitFor();const settingsBox=await settings.boundingBox();assert.ok(settingsBox.x+settingsBox.width>=1900,'rightmost toolbar command reaches the screen edge');
  await page.locator('input[type="file"]').first().setInputFiles([join(root,'rf-0.dcm'),join(root,'rf-1.dcm')]);
  await page.locator('[data-panel="A"][data-has-image="true"]').waitFor();
  const button=page.getByRole('button',{name:'İki rentgeni birləşdir',exact:true});await button.waitFor();assert.equal(await button.getAttribute('title'),'İki rentgeni birləşdir (stitch)');
  await button.click();const dialog=page.getByRole('dialog',{name:'İki rentgen görüntüsünü birləşdir'});await dialog.waitFor();
  const box=await dialog.boundingBox();assert.ok(Math.abs(box.x)<2&&Math.abs(box.y)<2&&box.width>=1918&&box.height>=998,`production dialog is fullscreen: ${JSON.stringify(box)}`);
  const css=await dialog.evaluate(node=>({translate:getComputedStyle(node).translate,classes:node.className}));assert.ok(css.classes.includes('translate-x-0'),JSON.stringify(css));
  await dialog.getByRole('button',{name:'Pəncərəni kiçilt'}).click();await dialog.waitFor({state:'hidden'});
  await page.getByRole('button',{name:'Stitch pəncərəsini aç'}).click();await dialog.waitFor();await page.waitForFunction(()=>{const canvas=document.querySelector('.stitch-preview canvas');if(!canvas||!canvas.width||!canvas.height)return false;return canvas.getContext('2d')?.getImageData(Math.floor(canvas.width/2),Math.floor(canvas.height/2),1,1).data[0]>5;},null,{timeout:8000});await page.waitForTimeout(350);
  mkdirSync('outputs/stitch-qa',{recursive:true});await page.screenshot({path:'outputs/stitch-qa/stitch-production-fullscreen.png'});
 }finally{await browser?.close();rmSync(root,{recursive:true,force:true});}
});
