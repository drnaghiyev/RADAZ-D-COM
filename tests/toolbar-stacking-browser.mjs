import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';
import {readFileSync,readdirSync} from 'node:fs';
import dicomParser from 'dicom-parser';
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'playwright');
const fixture=spawnSync('python',['tests/features-041-fixture.py'],{windowsHide:true,encoding:'utf8'});assert.equal(fixture.status,0,fixture.stderr);
const files=readdirSync('outputs/features-041-fixture').map(name=>{const body=readFileSync('outputs/features-041-fixture/'+name),ds=dicomParser.parseDicom(new Uint8Array(body));return {body,study:ds.string('x0020000d'),sop:ds.string('x00080018')};});
const browser=await chromium.launch({channel:'msedge',headless:true});
const context=await browser.newContext({viewport:{width:1920,height:1080}});context.setDefaultTimeout(20000);
let holdImport=false,releaseImport,importStarted;
await context.route('**/local-archive-api/**',async route=>{
  const u=new URL(route.request().url()),path=u.pathname;
  if(path.endsWith('/license'))return route.fulfill({json:{valid:true,required:true,kind:'owner'}});
  if(path.endsWith('/import')){
    if(holdImport){holdImport=false;importStarted?.();await new Promise(resolve=>{releaseImport=resolve;});}
    return route.fulfill({json:{ok:true}});
  }
  if(path.endsWith('/instances'))return route.fulfill({json:files.filter(f=>u.search.includes(f.study)).map(f=>({uid:f.sop}))});
  if(path.includes('/file/'))return route.fulfill({contentType:'application/dicom',body:files.find(f=>f.sop===decodeURIComponent(path.split('/').at(-1))).body});
  return route.fulfill({json:[]});
});
const page=await context.newPage(),errors=[],failures=[];page.on('pageerror',e=>errors.push(e.message));
const check=async(name,fn)=>{try{await fn();console.log('PASS',name);}catch(e){failures.push(name+': '+e.message);console.error('FAIL',name,e.message);}};
try{
 await page.goto('http://localhost:5317/#archive-study=2.25.410');
 await page.getByRole('button',{name:'Alət panelini fərdiləşdir',exact:true}).click();
 await page.getByRole('combobox',{name:'Alət panelinin sıra sayı',exact:true}).selectOption('2');
 const select=page.locator('select[aria-label$=" daxilində düzülüş"]').first();
 await select.selectOption('2');
 await page.getByRole('button',{name:'Təsdiq',exact:true}).click();
 await page.waitForTimeout(500);
 for(const width of [1920,1366,1024,640]){
  await page.setViewportSize({width,height:1080});await page.waitForTimeout(300);
  const result=await page.evaluate(()=>({outside:[...document.querySelectorAll('.topbar [data-toolbar-group]')].filter(n=>{const b=n.getBoundingClientRect();return b.width&&b.right>innerWidth+1}).map(n=>n.dataset.toolbarGroup),grid:getComputedStyle(document.querySelector('[data-item-rows="2"]')).display,second:document.querySelector('.toolbar-second-row').getBoundingClientRect().height}));
  assert.deepEqual(result.outside,[],JSON.stringify(result));assert.equal(result.grid,'grid');assert.ok(result.second>0);console.log('PASS stacked toolbar',width);
 }
 await page.reload();await page.waitForSelector('[data-item-rows="2"]');console.log('PASS inner rows persisted');
}finally{await browser.close();}
