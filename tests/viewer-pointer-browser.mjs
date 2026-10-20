import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';
import {readFileSync,readdirSync,mkdirSync} from 'node:fs';
import dicomParser from 'dicom-parser';
import JSZip from 'jszip';
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
const pane=id=>page.locator(`[data-panel="${id}"]`);
const index=id=>pane(id).locator('.vertical-stack-scroll input').inputValue().then(Number);
const waitIndex=(id,n)=>page.waitForFunction(({id,n})=>Number(document.querySelector(`[data-panel="${id}"] .vertical-stack-scroll input`)?.value)===n,{id,n},{timeout:3000});
const split=async()=>{await page.getByRole('button',{name:'Panel düzülüşü',exact:true}).click();await page.getByRole('gridcell',{name:'2 sütun, 1 sətir, 2 panel',exact:true}).click();};
const drag=async(source,target)=>{
  const a=await source.boundingBox(),b=await target.boundingBox();assert.ok(a&&b);
  await page.mouse.move(a.x+a.width/2,a.y+a.height/2);await page.mouse.down();
  await page.mouse.move(a.x+a.width/2+10,a.y+a.height/2+10,{steps:4});
  await page.mouse.move(b.x+b.width*.55,b.y+b.height*.55,{steps:15});
  await page.mouse.move(b.x+b.width*.55+1,b.y+b.height*.55+1);await page.mouse.up();
};
try{
  await page.goto((process.env.RADAZ_TEST_URL||'http://localhost:5317')+'/#archive-study=2.25.410',{timeout:60000,waitUntil:'domcontentloaded'});
  console.log('STEP viewer loaded');
  await page.waitForFunction(()=>document.querySelectorAll('.series-card img').length===2&&!document.querySelector('.series-work-progress [role="progressbar"]'),null,{timeout:30000});
  console.log('STEP thumbnails loaded');
  await pane('A').filter({has:page.locator('.vertical-stack-scroll input')}).waitFor();
  await page.getByTitle('Listələ · S',{exact:true}).click();
  await check('continuous left drag survives multiple rendered slices and reverses',async()=>{
    const r=await pane('A').boundingBox(),x=Math.round(r.x+r.width*.55),y=Math.round(r.y+r.height*.4),start=await index('A');
    await page.mouse.move(x,y);await page.mouse.down();
    try{
      for(const steps of [2,4,6,4]){await page.mouse.move(x,y+steps*14);await waitIndex('A',(start+steps)%24);}
    }finally{await page.mouse.up();}
    const stopped=await index('A');await page.mouse.move(x,y+150);assert.equal(await index('A'),stopped,'released mouse must stop scrolling');
  });
  await split();
  const ct=page.locator('.series-card').filter({hasText:'SYNTHETIC CT'}),mr=page.locator('.series-card').filter({hasText:'SYNTHETIC MR'});
  for(const [name,card,part] of [['thumbnail to empty pane',mr,'img'],['title replaces loaded pane',ct,'.series-info strong'],['thumbnail replaces loaded pane',mr,'img'],['handle replaces loaded pane',ct,'.drag-handle']]){
    await check(name,async()=>{const title=await card.locator('strong').textContent();await drag(card.locator(part),pane('B'));await page.waitForFunction(title=>document.querySelector('[data-panel="B"] .top-right')?.textContent.includes(title),title,{timeout:4000});});
  }
  await check('hover chooses the synchronization source without moving a slice',async()=>{
    await drag(mr.locator('img'),pane('B'));
    await page.waitForFunction(()=>document.querySelector('[data-panel="B"] .top-right')?.textContent.includes('SYNTHETIC MR'));
    await pane('A').click({position:{x:80,y:80}});
    await page.getByRole('button',{name:'Sync Scroll',exact:true}).click();
    await page.waitForTimeout(250);const before=[await index('A'),await index('B')],r=await pane('B').boundingBox();
    await page.mouse.move(r.x+r.width*.6,r.y+r.height*.6);await page.waitForTimeout(250);
    assert.deepEqual([await index('A'),await index('B')],before);
    await page.mouse.wheel(0,100);await waitIndex('B',(before[1]+1)%12);await waitIndex('A',((before[1]+1)%12)*2);
    await page.getByRole('button',{name:'Sync Scroll',exact:true}).click();
  });
  await check('rapid series changes retain the final selection after rendering settles',async()=>{
    for(let i=0;i<6;i++){await ct.click();await mr.click();}
    await page.waitForFunction(()=>document.querySelector('[data-panel="A"] .top-right')?.textContent.includes('SYNTHETIC MR'));
    await page.waitForTimeout(1200);
    assert.match(await pane('A').locator('.top-right').textContent(),/SYNTHETIC MR/);
    assert.equal(await pane('A').locator('.vertical-stack-scroll input').getAttribute('max'),'11');
  });
  await page.evaluate(()=>{const c=new BroadcastChannel('radaz-viewer-open-v2');c.postMessage({kind:'OPEN',request:crypto.randomUUID(),target:window.name,studies:['2.25.411']});setTimeout(()=>c.close(),50);});
  await page.locator('.series-card').filter({hasText:'SYNTHETIC CR'}).waitFor();
  await split();
  await check('explicit drop of another study preserves chosen target and layout',async()=>{
    await drag(ct.locator('img'),pane('B'));
    await page.waitForFunction(()=>document.querySelector('[data-panel="B"] .top-right')?.textContent.includes('SYNTHETIC CT'),null,{timeout:4000});
    assert.equal(await page.locator('.viewport-grid > .viewport').count(),2);
  });
  await check('MPR menu reconstructs only the active pane and keeps scroll usable',async()=>{
    const before=await pane('A').locator('.top-right').textContent(),pages=context.pages().length;
    await page.getByRole('button',{name:'MPR açılış seçimləri',exact:true}).click();
    const menu=page.getByRole('menu');
    assert.deepEqual(await menu.getByRole('menuitem').allTextContents(),['MPR','Coronal','Sagittal','Axial']);
    await menu.getByRole('menuitem',{name:'Coronal',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('[data-panel="B"] .top-right')?.textContent.includes('Coronal'),null,{timeout:30000});
    assert.equal(context.pages().length,pages);assert.equal(await page.locator('.viewport-grid > .viewport').count(),2);
    assert.equal(await pane('A').locator('.top-right').textContent(),before);
    const n=await index('B'),r=await pane('B').boundingBox();
    await page.mouse.move(Math.round(r.x+r.width/2),Math.round(r.y+r.height/2));await page.mouse.wheel(0,100);
    await waitIndex('B',n+1);
  });
  await check('two toolbar rows, cross-row commands, visible confirmation and persistence',async()=>{
    await page.getByRole('button',{name:'Alət panelini fərdiləşdir',exact:true}).click();
    await page.getByRole('combobox',{name:'Alət panelinin sıra sayı',exact:true}).selectOption('2');
    await page.getByRole('textbox',{name:'Yeni qrupun adı'}).fill('Second row');
    await page.getByRole('button',{name:'Qrup yarat',exact:true}).click();
    await page.getByRole('combobox',{name:'Second row sırası',exact:true}).selectOption('2');
    await page.getByRole('button',{name:'Sürüşdürərək düzəlt',exact:true}).click();
    const second=page.locator('.toolbar-second-row [data-item-group^="custom-"]');
    await page.locator('.toolbar-portable').filter({has:page.getByTitle('Listələ · S',{exact:true})}).dragTo(second);
    await second.getByTitle('Listələ · S',{exact:true}).waitFor();
    await page.setViewportSize({width:640,height:700});
    const confirm=page.getByRole('button',{name:'Təsdiq ✓',exact:true}),r=await confirm.boundingBox();
    assert.ok(r&&r.x>=0&&r.y>=0&&r.x+r.width<=640&&r.y+r.height<=700);await confirm.click();
    await page.setViewportSize({width:1920,height:1080});await page.reload({waitUntil:'domcontentloaded'});
    await second.getByTitle('Listələ · S',{exact:true}).waitFor();
    await page.getByRole('button',{name:'Alət panelini fərdiləşdir',exact:true}).click();
    await page.getByRole('button',{name:'Second row qrupunu sil',exact:true}).click();
    const item=page.locator('.toolbar-editor-item').filter({has:page.locator('span').filter({hasText:/^Listələ/})});
    assert.equal(await item.locator('select').inputValue(),'pool');
    await item.locator('select').selectOption('measure');
    await page.getByRole('button',{name:'Təsdiq',exact:true}).click();
    await page.getByTitle('Listələ · S',{exact:true}).waitFor();
  });
  await check('different series keep independent detached MPR and 3D windows',async()=>{
    await page.evaluate(()=>{const c=new BroadcastChannel('radaz-viewer-open-v2');c.postMessage({kind:'OPEN',request:crypto.randomUUID(),target:window.name,studies:['2.25.410']});setTimeout(()=>c.close(),50);});
    await ct.waitFor();
    for(const mode of ['mpr','3d']){
      const button=mode==='mpr'?'MPR rekonstruksiya':'3D həcm görüntüləmə';
      await ct.click();let opening=context.waitForEvent('page');await page.getByRole('button',{name:button,exact:true}).click();const first=await opening;
      await first.getByText(/SYNTHETIC CT/).first().waitFor({state:'attached',timeout:45000});
      await mr.click();opening=context.waitForEvent('page');await page.getByRole('button',{name:button,exact:true}).click();const second=await opening;
      await second.getByText(/SYNTHETIC MR/).first().waitFor({state:'attached',timeout:45000});
      await first.getByText(/SYNTHETIC CT/).first().waitFor({state:'attached'});
      const count=context.pages().length;await page.getByRole('button',{name:button,exact:true}).click();await page.waitForTimeout(200);assert.equal(context.pages().length,count);
      await first.close();await second.close();
    }
  });
  await check('multi-source import progress survives opening another examination',async()=>{
    // Fresh page avoids already-loaded SOP deduplication; reuse only synthetic files.
    const fresh=await context.newPage();await fresh.goto((process.env.RADAZ_TEST_URL||'http://localhost:5317')+'/#archive-study=2.25.411');
    await fresh.locator('[data-panel="A"] .vertical-stack-scroll input').waitFor();
    const zip=new JSZip();files.filter(f=>f.study==='2.25.410').forEach((f,i)=>zip.file(`nested/${i}.dcm`,f.body));
    const started=new Promise(resolve=>{importStarted=resolve;});holdImport=true;
    await fresh.locator('input[type=file]:not([accept]):not([webkitdirectory])').setInputFiles([
      {name:'nested-study.zip',mimeType:'application/zip',buffer:await zip.generateAsync({type:'nodebuffer'})},
      {name:'extra.dcm',mimeType:'application/dicom',buffer:files.find(f=>f.study==='2.25.411').body},
    ]);
    await Promise.race([started,new Promise((_,reject)=>setTimeout(async()=>reject(new Error('Import did not reach disk save: '+await fresh.locator('.statusbar').textContent())),20000))]);
    await fresh.locator('.import-job-progress progress').waitFor();
    await fresh.evaluate(()=>{const c=new BroadcastChannel('radaz-viewer-open-v2');c.postMessage({kind:'OPEN',request:crypto.randomUUID(),target:window.name,studies:['2.25.411']});setTimeout(()=>c.close(),50);});
    await fresh.waitForFunction(()=>document.querySelector('[data-panel="A"] .top-right')?.textContent.includes('SYNTHETIC CR'));
    assert.equal(await fresh.locator('.import-job-progress progress').count(),1);
    releaseImport();
    await fresh.locator('.import-job-progress progress').waitFor({state:'detached',timeout:30000});
    assert.match(await fresh.locator('[data-panel="A"] .top-right').textContent(),/SYNTHETIC CR/);
    await fresh.locator('input[type=file]:not([accept]):not([webkitdirectory])').setInputFiles({name:'invalid.dcm',mimeType:'application/dicom',buffer:Buffer.from('not a DICOM')});
    await fresh.waitForFunction(()=>document.querySelector('.statusbar')?.textContent.includes('Əvvəlki müayinə saxlanıldı'));
    assert.match(await fresh.locator('[data-panel="A"] .top-right').textContent(),/SYNTHETIC CR/);
    await fresh.close();
  });
  assert.deepEqual(errors,[]);assert.deepEqual(failures,[]);
  console.log('PASS viewer pointer regressions');
}finally{console.log('PAGE',await page.locator('.statusbar').textContent({timeout:3000}).catch(()=>''),errors);mkdirSync('outputs/viewer-pointer-qa',{recursive:true});await page.screenshot({path:'outputs/viewer-pointer-qa/result.png',timeout:5000}).catch(()=>{});await browser.close();}
