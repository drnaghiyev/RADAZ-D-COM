import assert from 'node:assert/strict';
import {test} from 'node:test';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,rmSync,mkdirSync} from 'node:fs';
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
  let copyReady=false;for(let attempt=0;attempt<60;attempt++){copyReady=await page.evaluate(async()=>{if(!(await indexedDB.databases()).some(item=>item.name==='radaz-measurement-copies'))return false;const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('radaz-measurement-copies',1);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});if(!db.objectStoreNames.contains('copies')){db.close();return false}const count=await new Promise(resolve=>{const r=db.transaction('copies').objectStore('copies').count();r.onsuccess=()=>resolve(r.result)});db.close();return count>0;});if(copyReady)break;await page.waitForTimeout(250);}assert.ok(copyReady,'RF measurement copy saved; alerts: '+await page.getByRole('alert').allInnerTexts()+'; errors: '+errors.join('; '));
  const initialCopies=await page.evaluate(async()=>{const databases=await indexedDB.databases(),db=await new Promise(resolve=>{const r=indexedDB.open('radaz-measurement-copies',1);r.onsuccess=()=>resolve(r.result)}),stores=[...db.objectStoreNames];if(!stores.includes('copies'))return {href:location.href,databases,stores};const list=await new Promise(resolve=>{const r=db.transaction('copies').objectStore('copies').getAll();r.onsuccess=()=>resolve(r.result)});db.close();return {href:location.href,databases,stores,list:list.map(x=>({study:x.study,sop:x.sop,id:x.id}))}});
  let result;try{result=await page.evaluate(async()=>{const media=await import('/lib/dicom-media.ts'),archive=await import('/lib/local-archive.ts');const study=(await archive.listArchiveStudies()).find(x=>x.uid==='2.25.987654321');if(!study)throw Error('Synthetic RF study missing');const files=await archive.getArchiveFiles(study.uid);const {blob}=await media.buildDicomCdPackage(study,files);return [...new Uint8Array(await blob.arrayBuffer())]});}
  catch(error){throw Error('CD package failed: '+JSON.stringify({initialCopies,url:page.url(),error:String(error)}));}
  const zip=await JSZip.loadAsync(Uint8Array.from(result));const names=Object.keys(zip.files),measured=names.find(name=>name.startsWith('MEASUREMENTS/')&&name.endsWith('.dcm'));
  if(!measured){const debug=await page.evaluate(async()=>{const archive=await import('/lib/local-archive.ts'),copies=await import('/lib/measurement-copies.ts');return {files:(await archive.getArchiveFiles('2.25.987654321')).map(x=>x.name),copies:(await copies.measurementCopies('2.25.987654321')).map(x=>x.sop)}});throw Error('CD includes no RF measured DICOM: '+JSON.stringify({names,initialCopies,debug}));}
  const bytes=new Uint8Array(await zip.file(measured).async('uint8array')),ds=dicomParser.parseDicom(bytes);
  assert.equal(ds.string('x00280301'),'YES');assert.equal(ds.string('x00080060'),'OT');
  const pixel=ds.elements.x7fe00010,rgb=bytes.subarray(pixel.dataOffset,pixel.dataOffset+pixel.length);assert.ok(rgb.some((v,i)=>i%3===0&&v!==rgb[i+1]),'annotation color is burned into the DICOM pixels');
  await page.getByRole('button',{name:'Ölçmə alətləri',exact:true}).click();await page.getByRole('menuitem',{name:/İki rentgeni birləşdir/}).click();
  const dialog=page.getByRole('dialog',{name:'İki rentgen görüntüsünü birləşdir'});await dialog.waitFor();
  const bounds=await dialog.boundingBox();assert.ok(bounds.width>1000&&bounds.height>650,'stitch window uses most of desktop screen');
  const stitchButton=page.getByRole('button',{name:'Ayrıca DICOM kimi saxla'});
  try{await stitchButton.waitFor({state:'visible',timeout:10000});await page.waitForFunction(()=>[...document.querySelectorAll('.stitch-dialog button')].find(e=>e.textContent.includes('Ayrıca DICOM'))?.disabled===false,null,{timeout:10000});}
  catch{throw Error('Stitch unavailable: '+await page.getByRole('dialog',{name:'İki rentgen görüntüsünü birləşdir'}).innerText());}
  await dialog.getByRole('button',{name:'Kənardan kəs'}).click();
  const cropEdge=await page.locator('.stitch-preview canvas').evaluate(canvas=>{const ctx=canvas.getContext('2d'),{data,width,height}=ctx.getImageData(0,0,canvas.width,canvas.height);let x=width,y=0;for(let row=0;row<height;row++)for(let col=0;col<width;col++){const i=(row*width+col)*4;if(data[i]<150&&data[i+1]>190&&data[i+2]>190&&col<x){x=col;y=row}}return {x,y,width,height}});
  assert.ok(cropEdge.x<cropEdge.width,'crop outline is visible');
  const stitchStage=await page.locator('.stitch-preview').boundingBox();
  await page.mouse.move(stitchStage.x+cropEdge.x,stitchStage.y+cropEdge.y);await page.mouse.down();await page.mouse.move(stitchStage.x+cropEdge.x+24,stitchStage.y+cropEdge.y,{steps:8});await page.mouse.up();
  await page.waitForFunction(()=>{const text=document.querySelector('.stitch-controls')?.textContent||'';return /Kəsim, px: sol [1-9]/.test(text)},null,{timeout:5000});
  const cropBounds=async()=>page.locator('.stitch-preview canvas').evaluate(canvas=>{const {data,width,height}=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height);let minX=width,maxX=0,minY=height,maxY=0;for(let y=0;y<height;y++)for(let x=0;x<width;x++){const i=(y*width+x)*4;if(data[i]<150&&data[i+1]>190&&data[i+2]>190){minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y)}}return {minX,maxX,minY,maxY}});
  for(const [edge,dx,dy,pattern] of [['right',-24,0,/sağ [1-9]/],['top',0,24,/yuxarı [1-9]/],['bottom',0,-24,/aşağı [1-9]/]]){
   const b=await cropBounds(),px=edge==='right'?b.maxX:(b.minX+b.maxX)/2,py=edge==='top'?b.minY:edge==='bottom'?b.maxY:(b.minY+b.maxY)/2;
   await page.mouse.move(stitchStage.x+px,stitchStage.y+py);await page.mouse.down();await page.mouse.move(stitchStage.x+px+dx,stitchStage.y+py+dy,{steps:8});await page.mouse.up();
   assert.match(await dialog.locator('.stitch-controls').innerText(),pattern,`${edge} crop edge moves with the mouse`);
  }
  await dialog.getByRole('button',{name:'Kadrı sürüşdür'}).click();
  const alignment=await page.getByTestId('stitch-offset').innerText();
  await page.mouse.move(stitchStage.x+stitchStage.width/2,stitchStage.y+stitchStage.height*.75);await page.mouse.down();await page.mouse.move(stitchStage.x+stitchStage.width/2+30,stitchStage.y+stitchStage.height*.75+12,{steps:8});await page.mouse.up();
  assert.notEqual(await page.getByTestId('stitch-offset').innerText(),alignment,'mouse drag aligns lower frame');
  await page.locator('.stitch-preview').hover();await page.mouse.wheel(0,-120);await page.waitForFunction(()=>!(document.querySelector('[data-testid="stitch-offset"]')?.textContent||'').includes('miqyas 100%'));
  await dialog.getByRole('button',{name:'Parlaqlıq / kontrast'}).click();const windowBefore=await dialog.locator('.stitch-controls').innerText();
  await page.mouse.move(stitchStage.x+stitchStage.width/2,stitchStage.y+stitchStage.height*.75);await page.mouse.down();await page.mouse.move(stitchStage.x+stitchStage.width/2+35,stitchStage.y+stitchStage.height*.75-20,{steps:8});await page.mouse.up();
  assert.notEqual(await dialog.locator('.stitch-controls').innerText(),windowBefore,'mouse drag changes brightness and contrast of selected frame');
  await dialog.getByRole('button',{name:'Yuxarı kadr'}).click();const topBefore=await page.getByTestId('stitch-offset').innerText();await dialog.getByRole('button',{name:'Yaxınlaşdır'}).click();assert.notEqual(await page.getByTestId('stitch-offset').innerText(),topBefore,'selected upper frame zoom changes independently');
  await page.keyboard.press('w');assert.match(await page.getByTestId('stitch-offset').innerText(),/Seçilmiş: aşağı/,'W selects the lower frame');
  await page.keyboard.press('2');assert.match(await dialog.getByRole('button',{name:'Kənardan kəs'}).getAttribute('class'),/active/,'2 selects crop');
  mkdirSync('outputs/stitch-qa',{recursive:true});await page.screenshot({path:'outputs/stitch-qa/large-interactive-stitch.png'});
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
