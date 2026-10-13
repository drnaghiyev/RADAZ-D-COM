import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {mkdirSync,readdirSync,readFileSync,writeFileSync} from 'node:fs';
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'playwright');
const base=process.env.RADAZ_TEST_URL||'http://localhost:5397';
const browser=await chromium.launch({channel:'msedge',headless:true});
const context=await browser.newContext({viewport:{width:1920,height:1080},acceptDownloads:true});context.setDefaultTimeout(45000);
const fixture=spawnSync(process.env.PYTHON||'python',['tests/workspace-browser-fixture.py'],{encoding:'utf8',windowsHide:true});assert.equal(fixture.status,0,fixture.stderr);
const files=readdirSync('outputs/viewer-qa-fixture').map(f=>readFileSync('outputs/viewer-qa-fixture/'+f));
const errors=[];context.on('page',p=>p.on('pageerror',e=>errors.push(e.message)));
await context.route('**/local-archive-api/**',route=>{
  const url=new URL(route.request().url());
  if(url.pathname.endsWith('/license'))return route.fulfill({json:{valid:true,required:true,kind:'owner'}});
  if(url.pathname.endsWith('/instances'))return route.fulfill({json:files.map((_,i)=>({uid:String(i)}))});
  if(url.pathname.includes('/file/'))return route.fulfill({body:files[Number(url.pathname.split('/').pop())],contentType:'application/dicom'});
  return route.fulfill({json:[]});
});
mkdirSync('outputs/workspace-qa',{recursive:true});
const page=await context.newPage();
try {
  await page.goto(base+'/#archive-study=2.25.800');await page.locator('.series-card').filter({hasText:'CT PROTOCOL TEST'}).waitFor();
  await page.waitForFunction(()=>document.querySelectorAll('.series-card img').length===2);
  await page.locator('[data-panel="A"] .institution-name').filter({hasText:'RADAZ SYNTHETIC CLINIC'}).waitFor();
  const paneA=page.locator('[data-panel="A"]');
  const count=()=>paneA.locator('.bottom-right').textContent();
  await paneA.locator('canvas').first().click({position:{x:80,y:80}});
  const initial=await count();await page.keyboard.press('ArrowDown');await page.waitForFunction(t=>document.querySelector('[data-panel="A"] .bottom-right').textContent!==t,initial);
  await page.keyboard.press('ArrowUp');await page.waitForFunction(t=>document.querySelector('[data-panel="A"] .bottom-right').textContent===t,initial);
  await page.getByRole('button',{name:'DICOM məlumatları',exact:true}).click();
  await page.getByRole('dialog').getByText('Institution Name / Klinika',{exact:true}).waitFor();
  await page.getByRole('textbox',{name:'DICOM teqlərində axtar'}).fill('0028,0010');assert.equal(await page.locator('.dicom-info-table tbody tr').count(),1);
  await page.keyboard.press('Escape');
  console.log('PASS thumbnails, clinic, keyboard and metadata');
  assert.equal(await page.locator('.toolbar-overflow-trigger').count(),0,'All commands visible at 1920 px');
  for(const group of await page.locator('.topbar [data-toolbar-group]').all()) {
    const g=await group.boundingBox(),h=await group.locator('.toolbar-drag-handle').boundingBox();
    assert.ok(h.x>g.x+g.width/2&&h.x+h.width<=g.x+g.width+1,'Grip on right edge');
  }
  // Reorder real HTML drag handles, then dock and return to the header.
  const grip=page.locator('[data-toolbar-group="import"] .toolbar-drag-handle');
  const start=await grip.boundingBox(),target=await page.locator('[data-toolbar-group="workspace"]').boundingBox();
  const oldX=start.x;await page.mouse.move(start.x+start.width/2,start.y+start.height/2);await page.mouse.down();
  await page.mouse.move(target.x+target.width*.75,target.y+target.height/2,{steps:15});
  await page.waitForFunction(x=>document.querySelector('[data-toolbar-group="import"] .toolbar-drag-handle').getBoundingClientRect().x!==x,oldX);
  assert.ok(Number(await page.locator('[data-toolbar-group="import"]').evaluate(n=>n.style.order))<5,'Reorder stays beside pointer instead of jumping to end');
  await page.mouse.up();console.log('PASS live reorder before mouse release');
  let box=await grip.boundingBox();await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();
  await page.mouse.move(1900,200,{steps:25});await page.mouse.up();
  await page.locator('.right-tool-dock [data-toolbar-group="import"]').waitFor();
  await page.screenshot({path:'outputs/workspace-qa/docked-1920.png'});
  console.log('PASS drag to dock');
  await page.reload({waitUntil:'domcontentloaded'});console.log('reloaded');await page.locator('.right-tool-dock [data-toolbar-group="import"]').waitFor();
  console.log('found persisted group');
  const rightGrip=page.locator('.right-tool-dock .toolbar-drag-handle');
  await page.screenshot({path:'outputs/workspace-qa/persisted-dock.png',timeout:5000});
  await rightGrip.dragTo(page.locator('.topbar'),{targetPosition:{x:260,y:36}});
  console.log('drag return dispatched');
  await page.locator('.right-tool-dock').waitFor({state:'hidden'});
  console.log('PASS dock persistence and return');
  // A split layout and a series replacement must keep native length tools usable.
  await page.locator('[data-panel="A"] .institution-name').waitFor();
  // Switching tools after an unfinished angle must release Cornerstone's drawing lock.
  const a=await page.locator('[data-panel="A"] .dicom-canvas').boundingBox();
  await page.keyboard.press('a');await page.mouse.click(a.x+a.width*.25,a.y+a.height*.25);
  await page.keyboard.press('l');
  async function draw(panel){
    const c=await page.locator(`[data-panel="${panel}"] .dicom-canvas`).boundingBox();
    await page.mouse.move(c.x+c.width*.35,c.y+c.height*.4);await page.mouse.down();await page.mouse.move(c.x+c.width*.65,c.y+c.height*.6,{steps:10});await page.mouse.up();
  }
  await draw('A');await paneA.locator('.dicom-canvas svg').getByText(/mm/).first().waitFor();
  const metric=await paneA.locator('.dicom-canvas svg').getByText(/mm/).first().textContent();
  await page.getByRole('button',{name:'Ölçmə alətləri',exact:true}).click();
  await page.getByRole('menuitem',{name:/Ölçü ayarları/}).click();
  await page.getByRole('radio',{name:'sm — santimetr'}).check();await page.keyboard.press('Escape');
  const converted=await paneA.locator('.dicom-canvas svg').getByText(/sm/).first().textContent();
  assert.ok(Math.abs(parseFloat(metric)/10-parseFloat(converted))<.03,`${metric} -> ${converted}`);
  await page.getByRole('button',{name:'Ölçmə alətləri',exact:true}).click();await page.getByRole('menuitem',{name:/Ölçü ayarları/}).click();
  await page.getByRole('radio',{name:'mm — millimetr'}).check();await page.keyboard.press('Escape');
  // Middle-button pan moves the image without changing its window or slice.
  const before=await paneA.locator('canvas').first().screenshot(),windowBefore=await paneA.locator('.bottom-left').textContent(),sliceBefore=await count();
  await page.mouse.move(a.x+a.width*.6,a.y+a.height*.5);await page.mouse.down({button:'middle'});await page.mouse.move(a.x+a.width*.6+65,a.y+a.height*.5+40,{steps:10});await page.mouse.up({button:'middle'});
  assert.notDeepEqual(await paneA.locator('canvas').first().screenshot(),before);
  assert.equal(await paneA.locator('.bottom-left').textContent(),windowBefore);assert.equal(await count(),sliceBefore);
  console.log('PASS interrupted measurement, unit conversion and middle pan');
  await page.keyboard.press('2');await page.locator('[data-panel="B"]').waitFor();
  await page.locator('.series-card').filter({hasText:'CT PROTOCOL TEST'}).dragTo(page.locator('[data-panel="B"]'));
  await page.locator('[data-panel="B"][data-has-image="true"]').waitFor();
  await page.keyboard.press('l');
  async function line(panel){
    const c=await page.locator(`[data-panel="${panel}"] .dicom-canvas`).boundingBox();
    await page.mouse.move(c.x+c.width*.35,c.y+c.height*.4);await page.mouse.down();await page.mouse.move(c.x+c.width*.65,c.y+c.height*.6,{steps:10});await page.mouse.up();
    await page.locator(`[data-panel="${panel}"] .dicom-canvas svg`).getByText(/mm/).first().waitFor();
  }
  await line('A');await line('B');
  await page.locator('.series-card').filter({hasText:'Synthetic CT'}).dragTo(page.locator('[data-panel="B"]'));await line('B');
  await page.getByRole('button',{name:'Panel düzülüşü',exact:true}).click();await page.getByRole('gridcell',{name:'6 sütun, 6 sətir, 36 panel',exact:true}).click();
  assert.equal(await page.locator('[data-panel]').count(),36);assert.equal(await page.locator('[data-panel="AJ"]').count(),1);
  await page.keyboard.press('1');
  // Export initiates a real browser download even without a chosen directory.
  await page.getByRole('button',{name:'Görüntüləri ixrac et',exact:true}).click();
  const file=page.waitForEvent('download').catch(error=>({error}));
  await page.getByRole('dialog').getByRole('button',{name:'İxrac et',exact:true}).last().click();
  const exported=await file;if(exported.error){console.log('Export failure',await page.getByRole('dialog').innerText());throw exported.error;}assert.ok(exported.suggestedFilename().length>4);await exported.saveAs('outputs/workspace-qa/exported-image');
  await page.keyboard.press('Escape');
  // Exercise real FileSystemDirectoryHandle writes in an isolated origin-owned folder.
  // The native OS chooser is replaced here; permission handling is inspected in the Desktop shell.
  await page.evaluate(()=>{window.showDirectoryPicker=async()=>await (await navigator.storage.getDirectory()).getDirectoryHandle('export-qa',{create:true});});
  await page.getByRole('button',{name:'Görüntüləri ixrac et',exact:true}).click();
  await page.getByRole('dialog').getByRole('button',{name:'Qovluq seç',exact:true}).click();
  await page.getByRole('dialog').getByRole('button',{name:'İxrac et',exact:true}).last().click();
  await page.getByRole('dialog').getByText(/Saxlanıldı: export-qa/).waitFor();
  const saved=await page.evaluate(async()=>{const d=await (await navigator.storage.getDirectory()).getDirectoryHandle('export-qa');const sizes=[];for await(const h of d.values())if(h.kind==='file')sizes.push((await h.getFile()).size);return sizes;});
  assert.ok(saved.some(size=>size>1000),JSON.stringify(saved));
  await page.keyboard.press('Escape');
  for(const path of ['/archive','/pacs']){
    await page.goto(base+path);await page.locator('.records-header').waitFor();
    assert.equal(await page.locator('.dockable-tool-group .dockable-tool-group').count(),0);
    for(const width of [1000,1024,1280,1366,1920,2560,3840]) {
      await page.setViewportSize({width,height:1080});await page.waitForTimeout(200);
      const header=await page.locator('.records-header').evaluate(e=>({scroll:e.scrollWidth,width:e.clientWidth,height:e.getBoundingClientRect().height}));
      assert.ok(header.height<=106,JSON.stringify({path,width,...header}));
      assert.ok(header.scroll<=header.width+1,JSON.stringify({path,width,...header}));
      await page.screenshot({path:`outputs/workspace-qa/${path.slice(1)}-${width}.png`});
    }
  }
  assert.deepEqual(errors,[]);writeFileSync('outputs/workspace-qa/result.json',JSON.stringify({passed:true,errors}));
  console.log('PASS: thumbnails, metadata, institution, slice keys, drag docking/persistence, split measurements, 6x6 and export');
}catch(error){console.error(error);await page.screenshot({path:'outputs/workspace-qa/failure.png',timeout:5000}).catch(()=>{});throw error;}finally{await browser.close();}
