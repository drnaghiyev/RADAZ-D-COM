import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';
import {readFileSync,readdirSync,mkdirSync} from 'node:fs';
import dicomParser from 'dicom-parser';
import JSZip from 'jszip';
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'playwright');
const fixture=spawnSync('python',['tests/features-041-fixture.py'],{windowsHide:true,encoding:'utf8'});assert.equal(fixture.status,0,fixture.stderr);
const files=readdirSync('outputs/features-041-fixture').map(name=>{const body=readFileSync('outputs/features-041-fixture/'+name),ds=dicomParser.parseDicom(new Uint8Array(body));return {body,study:ds.string('x0020000d'),series:ds.string('x0020000e'),sop:ds.string('x00080018')};});
const browser=await chromium.launch({channel:'msedge',headless:true});
const context=await browser.newContext({viewport:{width:1920,height:1080}});context.setDefaultTimeout(20000);
let holdImport=false,releaseImport,importStarted;let resume;let fileCount=0;const barrier=new Promise(r=>resume=r);
let resumeOther;const otherSeries=new Promise(r=>resumeOther=r);
await context.route('**/local-archive-api/**',async route=>{
  const u=new URL(route.request().url()),path=u.pathname;
  if(path.endsWith('/license'))return route.fulfill({json:{valid:true,required:true,kind:'owner'}});
  if(path.endsWith('/import')){
    if(holdImport){holdImport=false;importStarted?.();await new Promise(resolve=>{releaseImport=resolve;});}
    return route.fulfill({json:{ok:true}});
  }
  if(path.endsWith('/instances'))return route.fulfill({json:files.filter(f=>u.search.includes(f.study)).map(f=>({uid:f.sop,series:f.series}))});
  if(path.includes('/file/')){++fileCount;if(fileCount===2)await barrier;if(fileCount===25)await otherSeries;return route.fulfill({contentType:'application/dicom',body:files.find(f=>f.sop===decodeURIComponent(path.split('/').at(-1))).body});}
  return route.fulfill({json:[]});
});
const page=await context.newPage();
try{
 await page.goto('http://localhost:5317/#archive-study=2.25.410');
 await page.locator('.series-card.chosen').waitFor();
 assert.equal(fileCount,2,'remaining files are still blocked');
 assert.match(await page.locator('.series-card.chosen .series-info').textContent(),/1/);
 assert.ok(await page.locator('.series-work-progress progress').count());
 console.log('PASS first archive image and patient/series list appear before the remaining download');
 await page.locator('.series-card.chosen').click();
 resume();
 await page.waitForFunction(()=>document.querySelector('.series-card.chosen .series-info')?.textContent.includes('24'));
 assert.equal(await page.locator('progress').count(),1,'one import indicator, never sidebar plus overlay');
 for(const [mode,label] of [['mpr','MPR rekonstruksiya'],['3d','3D həcm görüntüləmə']]){
   const opening=context.waitForEvent('page');await page.getByRole('button',{name:label,exact:true}).click();const child=await opening;
   if(mode==='mpr')await child.waitForFunction(()=>['MS','MC','MA'].every(id=>document.querySelector(`[data-panel="${id}"]`)?.getAttribute('data-has-image')==='true'),null,{timeout:60000});
   else await child.locator('[data-volume-id]').waitFor({timeout:60000});
   assert.equal(fileCount,25,'other series remains blocked while reconstruction is usable');
   assert.equal(await child.locator('.mpr-error-notice').count(),0);
   console.log(`PASS complete series opens in ${mode.toUpperCase()} while next series is blocked`);
   await child.close();
 }
 resumeOther();await page.waitForFunction(()=>document.querySelectorAll('.series-card').length===2&&!document.querySelector('.series-work-progress progress'),null,{timeout:60000});
 console.log('PASS completed study and sidebar stay synchronized');
 const fresh=await context.newPage();await fresh.goto('http://localhost:5317/');
 const broken=Buffer.from(files[0].body),offset=broken.indexOf('MONOCHROME2');assert.ok(offset>=0);broken.write('RGB        ',offset,'ascii');
 await fresh.locator('input[type=file]:not([accept]):not([webkitdirectory])').setInputFiles([
 {name:'bad.dcm',mimeType:'application/dicom',buffer:broken},{name:'good.dcm',mimeType:'application/dicom',buffer:files[0].body}]);
 await fresh.waitForFunction(()=>document.querySelector('[data-panel="A"][data-has-image="true"]')&&!document.querySelector('.import-job-progress progress'),null,{timeout:30000});
 assert.equal(await fresh.locator('.series-card').count(),1);console.log('PASS damaged leading file does not replace the valid imported image');
}finally{resume();resumeOther();await browser.close();}
