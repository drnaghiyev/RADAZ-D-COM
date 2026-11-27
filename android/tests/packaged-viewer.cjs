// Exercises the actual signed APK's web bundle with a touch viewport. Native picker/device tests are separate.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {createRequire} = require('node:module');
const deps = createRequire(path.resolve(process.argv[2], 'package.json'));
const JSZip = deps('jszip');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const project = path.resolve(__dirname, '..');
const {fixture,checkNetwork}=require('./clinic-workflow.cjs');
const gestures=require('../../tests/navigation-measurement.cjs');
const origin = 'https://appassets.androidplatform.net';
const waitReady = page => page.waitForFunction(() => document.querySelector('.statusbar')?.textContent.includes('Cornerstone3D hazırdır'));
async function command(page, name) {
  const button=page.getByRole('button',{name,exact:true}).first();
  if(!await button.isVisible()){
    const more=page.getByRole('button',{name:'Əlavə alətlər',exact:true}).first();
    if(await more.isVisible() && await more.getAttribute('aria-expanded')!=='true')await more.tap();
  }
  await button.tap();
}
async function dismissOverflow(page) {
  const more=page.getByRole('button',{name:'Əlavə alətlər',exact:true}).first();
  if(await more.isVisible() && await more.getAttribute('aria-expanded')==='true')await more.tap();
}
const types = {html:'text/html',js:'application/javascript',css:'text/css',json:'application/json',svg:'image/svg+xml',wasm:'application/wasm',rsc:'text/x-component',woff2:'font/woff2',png:'image/png'};
(async () => {
  const apk = await JSZip.loadAsync(fs.readFileSync(path.join(project,'out',process.env.RADAZ_TEST_APK||'RADAZ-Tablet-0.2.98-1.apk')));
  assert.ok(apk.file('classes.dex'));
  assert.ok(Object.keys(apk.files).some(p => p.startsWith('assets/web/_next/static/chunks/') && p.endsWith('.js')));
  const sample = fs.readFileSync(path.resolve(process.argv[3]));
  const selection = '8c41525c-4162-4148-bde5-e762ef98b64d';
  const folderTicket='d858ca66-227f-491d-bb4e-3d09e8ca739f';
  const folderData=Object.values((await JSZip.loadAsync(sample)).files).filter(entry=>!entry.dir && /\.dcm$/i.test(entry.name));
  assert.equal(folderData.length,12);
  const requests = new Set(), issues = [];
  const browser = await chromium.launch({headless:true,channel:'msedge',args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  let network;
  try {
    if(!process.argv.includes('--viewer-only'))network=await fixture(path.resolve(process.argv[2]));
    const context = await browser.newContext({viewport:{width:1200,height:800},isMobile:true,hasTouch:true,deviceScaleFactor:1});
    context.setDefaultTimeout(20000);
    let picker = '',delayReceiver=false,interruptReceipt=false,damageRead=false;
    let archiveWindow=null,archiveOpens=0;
    context.on('page',p=>{
      p.on('pageerror',e=>issues.push(e.message));
      p.on('dialog',async d=>{
        const cmd=d.message().replace('radaz-tablet/','');
        if(cmd==='pick')picker=d.defaultValue();
        if(cmd==='inbox'){
          const v=JSON.parse(d.defaultValue());
          await d.accept('ok');
          let reply;
          if(delayReceiver||!network)reply={data:{}};
          else if(interruptReceipt&&v.action==='stored'){interruptReceipt=false;reply={error:'synthetic disconnected receipt'};}
          else reply=await network.call('Tablet','inbox_'+v.action,{ticket:v.ticket});
          if(!p.isClosed())await p.evaluate(([id,result])=>window.radazInboxResult?.(id,result),[v.id,reply.data||reply]).catch(()=>{});
          return;
        }
        if(cmd==='open-archive'){
          await d.accept('ok');
          if(!archiveWindow || archiveWindow.isClosed()){
            archiveWindow=await context.newPage();await archiveWindow.goto(origin+'/archive');
          }
          await archiveWindow.bringToFront();archiveOpens++;return;
        }
        if(cmd==='open-studies'){
          const ids=JSON.parse(d.defaultValue());
          await d.accept('ok');
          const home=context.pages().find(web=>new URL(web.url()).pathname==='/');
          assert.ok(home);await home.bringToFront();
          assert.ok(await home.evaluate(ids=>{
            const handled=!dispatchEvent(new CustomEvent('radaz-tablet-open-studies',{cancelable:true,detail:ids}));
            if(handled)window.qaArchiveHandoffs=[...(window.qaArchiveHandoffs||[]),ids];
            return handled;
          },ids));return;
        }
        if(cmd==='network'){
          const v=JSON.parse(d.defaultValue());
          await d.accept('ok');
          const reply=await network.call('Tablet',v.action,v.data,v.session,v.profile);
          if(!p.isClosed())await p.evaluate(([id,result])=>window.radazTabletNetworkResult(id,JSON.stringify(result)),[v.id,reply]).catch(()=>{});
          return;
        }
        if(d.type()==='prompt')await d.accept('ok');else await d.accept();
      });
    });
    await context.route('**/*',async route=>{
      const req=route.request(), u=new URL(req.url());
      if(u.origin!==origin){requests.add(u.origin);return route.abort();}
      const p=u.pathname, json=data=>route.fulfill({json:data});
      if(p==='/local-archive-api/license')return json({valid:true,required:true,kind:'trial',deviceId:'test-install',trial:{daysRemaining:180},modules:{}});
      if(p==='/radaz-installation.json')return json({managed:false});
      if(p==='/local-archive-api/updates')return json({state:'current'});
      if(p.startsWith('/local-archive-api/window/'))return json({});
      if(p.startsWith('/local-archive-api/')||p.startsWith('/smart-volume-api/')||p.startsWith('/anatomy-volume/')||p.startsWith('/api/'))return route.fulfill({status:503,json:{error:'Xidmət tələb olunur.'}});
      if(p==='/_tablet/files/'+selection+'/list')return json([{name:'TABLET-CT.zip',mime:'application/zip',relative:''}]);
      if(p==='/_tablet/files/'+selection+'/0')return route.fulfill({body:sample,contentType:'application/octet-stream'});
      if(p==='/_tablet/files/'+folderTicket+'/list')return json(folderData.map(e=>({name:path.basename(e.name),relative:'CT/'+path.basename(e.name),mime:'application/dicom'})));
      if(p.startsWith('/_tablet/files/'+folderTicket+'/'))return route.fulfill({body:await folderData[Number(p.split('/').pop())].async('nodebuffer'),contentType:'application/dicom'});
      if(p.startsWith('/_tablet/inbox/')){
        const out=await network.call('Tablet','inbox_read',{ticket:p.split('/').pop()});
        if(out.error)return route.fulfill({status:404,body:''});
        const original=Buffer.from(out.data.bytes,'base64');
        if(damageRead){damageRead=false;original[0]^=1;}
        return route.fulfill({body:original,contentType:'application/dicom'});
      }
      const part=decodeURIComponent(p).replace(/^\/|\/$/g,'');
      const flight=req.headers().rsc==='1'||(req.headers().accept||'').includes('text/x-component');
      const asset=flight?'assets/flight/'+(part.replaceAll('/','-')||'index')+'.rsc':
        'assets/web/'+(part.includes('.')?part:(part?part+'/':'')+'index.html');
      const item=apk.file(asset);
      if(!item)return route.fulfill({status:404,body:'{}'});
      return route.fulfill({body:await item.async('nodebuffer'),contentType:types[asset.split('.').at(-1)]||'application/octet-stream'});
    });
    const page=await context.newPage();
    await page.goto(origin+'/');await waitReady(page);
    console.log('Packaged viewer is ready.');
    const suite={};
    async function verifyAutomaticDelivery(){
      delayReceiver=true;interruptReceipt=true;damageRead=true;
      const sent=await network.call('Clinic Alpha','fixture_send');
      assert.ok(sent.data,sent.error);
      const pending=await network.call('Clinic Alpha','fixture_progress');
      assert.deepEqual(pending.data,{state:'queued',done:0,total:12});
      const other=await network.call('Clinic Beta','inbox_next');
      assert.ok(other.data&&!other.data.ticket);
      delayReceiver=false;
      const until=Date.now()+90000;
      let receipt;
      do{
        const check=await network.call('Clinic Alpha','fixture_progress');assert.ok(check.data,check.error);
        receipt=check.data;if(receipt.state==='complete')break;
        await new Promise(resolve=>setTimeout(resolve,600));
      }while(Date.now()<until);
      assert.deepEqual(receipt,{state:'complete',done:12,total:12});
      const firstOpen=context.waitForEvent('page');
      await command(page,'Local arxiv');
      const archive=await firstOpen;await archive.waitForURL(origin+'/archive');
      const today=archive.locator('.today-filter input');
      if(await today.isChecked())await today.uncheck();
      await archive.getByText('RADAZ DELIVERY QA',{exact:true}).first().waitFor();
      const totals=await archive.evaluate(async uid=>{
        const db=await new Promise(resolve=>{const req=indexedDB.open('radaz-local-archive');req.onsuccess=()=>resolve(req.result);});
        const files=await new Promise(resolve=>{const req=db.transaction('instances').objectStore('instances').index('studyUID').getAll(uid);req.onsuccess=()=>resolve(req.result);});
        db.close();
        const hashes=await Promise.all(files.map(async f=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await f.file.arrayBuffer())),b=>b.toString(16).padStart(2,'0')).join('')));
        return hashes.sort();
      },sent.data.study);
      assert.deepEqual(totals,sent.data.hashes);
      assert.ok(!interruptReceipt&&!damageRead);
      const row=archive.locator('tr').filter({hasText:'RADAZ DELIVERY QA'}).first();
      await row.locator('.record-open-button').click();
      await archive.getByText(/1 seçilmiş müayinə Viewer-də açıldı/).waitFor();
      await page.waitForFunction(()=>document.querySelector('.series-rail, .study-rail, [data-panel="A"]')?.ownerDocument.body.innerText.includes('RADAZ DELIVERY QA')&&document.querySelector('[data-panel="A"] canvas')?.width>0);
      await command(page,'Local arxiv');await archive.waitForFunction(()=>document.body.innerText.includes('RADAZ DELIVERY QA'));
      await new Promise((resolve,reject)=>{const end=Date.now()+5000;const check=()=>archiveOpens>=2?resolve():Date.now()>end?reject(Error('archive did not reopen')):setTimeout(check,20);check();});
      assert.equal(archiveWindow,archive);
      suite.automaticDelivery={reopened:true,confirmed:receipt.done,originalHashesMatched:totals.length,openedInViewer:true,offlineResume:true,damagedReadRetried:true,lostReceiptRetried:true,uniqueTransfer:true};
      await archive.close();
    }
    async function assertDock(count){
      await page.waitForFunction(n=>{
        const host=document.querySelector('.right-tool-dock .flat-toolbar-right');
        if(!host)return false;
        const boxes=[...host.querySelectorAll(':scope > .toolbar-portable > button')].map(b=>b.getBoundingClientRect()).filter(b=>b.width>0);
        if(boxes.length<3)return false;
        const first=Math.min(...boxes.map(b=>b.top));
        const dock=host.closest('aside').getBoundingClientRect();
        return boxes.filter(b=>Math.abs(b.top-first)<3).length===n && boxes.every(b=>b.x>=dock.x-1&&b.right<=dock.right+1);
      },count);
    }
    async function openSettings(){
      await command(page,'Yardım və lisenziya');
      await page.getByRole('menuitem',{name:'Ayarlar',exact:true}).click();
      return page.locator('dialog.product-dialog[open]');
    }
    await assertDock(2);
    let settingsDialog=await openSettings();
    await settingsDialog.getByLabel('Sağ paneldə sütun sayı').selectOption('1');
    await settingsDialog.locator('header button').click();await assertDock(1);
    await page.reload();await waitReady(page);await assertDock(1);
    settingsDialog=await openSettings();
    await settingsDialog.getByLabel('Sağ paneldə sütun sayı').selectOption('2');
    if(network){
      const networkWindow=context.waitForEvent('page');
      await settingsDialog.getByRole('link',{name:'DICOM Network ayarları'}).click();
      const settings=await networkWindow;
      suite.clinicConnections=await checkNetwork(network,settings);await settings.close();
    }
    await settingsDialog.locator('header button').click();
    if(process.argv.includes('--delivery-only')){
      await verifyAutomaticDelivery();assert.deepEqual(issues,[]);assert.deepEqual([...requests],[]);
      console.log(JSON.stringify(suite));return;
    }
    await page.setViewportSize({width:800,height:1200});await assertDock(2);
    await page.setViewportSize({width:1200,height:800});await assertDock(2);
    suite.rightDock='one/two columns, persisted, portrait/landscape';
    console.log('Both toolbar layouts passed.',suite.clinicConnections||'');
    assert.equal(await page.locator('[data-tool-home="cd"],.cd-import-command').count(),0);
    await command(page,'Qovluq aç');
    assert.equal(picker,'folder');
    await page.evaluate(s=>window.radazTabletReceive(s,false),folderTicket);
    await page.waitForFunction(()=>document.querySelector('.statusbar')?.textContent.includes('12 DICOM'));
    console.log('Primary folder command imported 12 individual slices.');
    await page.reload();await waitReady(page);
    await command(page,'DICOM import');
    await page.getByRole('menuitem',{name:'ZIP / RAR aç'}).click();
    assert.equal(picker,'multiple');
    await page.evaluate(s=>window.radazTabletReceive(s,false),selection);
    await page.waitForFunction(()=>document.querySelector('[data-panel="A"]')?.getAttribute('data-has-image')==='true');
    await page.waitForFunction(()=>document.querySelector('.statusbar')?.textContent.includes('12 DICOM'));
    console.log('Twelve synthetic CT slices opened from one ZIP.');
    const panel=page.locator('[data-panel="A"]');
    assert.ok(await panel.locator('canvas').count());
    const readPanel=()=>panel.innerText();
    const initial=await readPanel();
    await page.bringToFront();await panel.tap();
    await page.keyboard.press('F1');
    await page.waitForFunction(()=>/1500/.test(document.querySelector('[data-panel="A"]')?.textContent||''));
    await page.keyboard.press('F2');
    await page.waitForFunction(()=>/400/.test(document.querySelector('[data-panel="A"]')?.textContent||''));
    const frame=panel.locator('.bottom-right span').first();
    await page.keyboard.press('s');
    await command(page,'Play');
    await page.waitForFunction(()=>!/1\s*\/\s*12/.test(document.querySelector('[data-panel="A"] .bottom-right span')?.textContent||''));
    await command(page,'Pauza');
    await command(page,'Stop');
    await dismissOverflow(page);
    await page.waitForFunction(()=>/\b1\s*\/\s*12/.test((document.querySelector('[data-panel="A"] .bottom-right span')?.textContent||'').replace(/[^\d/ ]/g,'')));
    Object.assign(suite,{folderSlices:12,zipSlices:12,presets:true,cine:true,source:initial.match(/SYNTHETIC/i)?.[0],offlineOrigins:[...requests]});
    await panel.locator('canvas').first().waitFor();
    await page.locator('.series-card img').first().waitFor();
    await command(page,'Ölçmə alətləri');
    await page.getByRole('menuitem',{name:/Uzunluq/}).tap();await dismissOverflow(page);
    await page.getByRole('menu').waitFor({state:'hidden'});await page.waitForTimeout(250);
    const tabletInput=await context.newCDPSession(page),mainBox=await panel.locator('.dicom-canvas').boundingBox();
    const from={x:mainBox.x+mainBox.width*.45,y:mainBox.y+mainBox.height*.42};
    await gestures.contact(page,tabletInput,'touch',from,{x:from.x+105,y:from.y+8});
    await gestures.verifyEdits(page,panel,tabletInput);suite.navigationMeasurements=true;
    const mprButton=page.getByRole('button',{name:'MPR rekonstruksiya',exact:true}).first();
    const [mpr]=await Promise.all([context.waitForEvent('page'),mprButton.tap()]);
    await mpr.waitForFunction(()=>document.querySelectorAll('[data-has-image="true"]').length>=3 && !document.querySelector('.viewport-loading'),{},{timeout:60000});
    await mpr.keyboard.press('s');
    const mprInput=await context.newCDPSession(mpr),cross=mpr.locator('[data-panel="MA"] .localizer-center-hit');
    for(const kind of ['touch','pen']){
      const box=await cross.boundingBox(),overlay=mpr.locator('[data-panel="MA"] .localizer-overlay');
      assert.ok(box);const before=await overlay.getAttribute('data-world');
      const center={x:box.x+box.width/2,y:box.y+box.height/2};
      await gestures.contact(mpr,mprInput,kind,center,{x:center.x+16,y:center.y+12});
      assert.notEqual(await overlay.getAttribute('data-world'),before,'MPR intersection moves with '+kind);
    }
    for(const kind of ['touch','pen']){
      const overlay=mpr.locator('[data-panel="MA"] .localizer-overlay');
      const line=await overlay.evaluate(svg=>{
        for(const node of svg.querySelectorAll('.localizer-hit')){
          const length=node.getTotalLength(),matrix=node.getScreenCTM();
          for(const fraction of [.3,.65,.4,.8,.18]){
            const q=node.getPointAtLength(length*fraction).matrixTransform(matrix);
            if(document.elementFromPoint(q.x,q.y)!==node)continue;
            const next=node.getPointAtLength(length*fraction+1).matrixTransform(matrix);
            const dx=next.x-q.x,dy=next.y-q.y,mag=Math.hypot(dx,dy);
            return {from:{x:q.x,y:q.y},to:{x:q.x-18*dy/mag,y:q.y+18*dx/mag}};
          }
        }
      });
      assert.ok(line,'an exposed MPR line can receive a contact');
      const before=await overlay.getAttribute('data-world');
      await gestures.contact(mpr,mprInput,kind,line.from,line.to);
      assert.notEqual(await overlay.getAttribute('data-world'),before,'MPR line moves its source plane with '+kind);
    }
    console.log('Navigation edits and MPR lines and intersection passed for touch and pen.');suite.mprTouchAndPen=true;
    suite.mprPanels=await mpr.locator('[data-has-image="true"]').count();
    await mpr.locator('[data-panel="MA"]').click({position:{x:60,y:70}});
    await command(mpr,'Ölçmə alətləri');
    await mpr.getByRole('menuitem',{name:/Uzunluq/}).click();
    await mpr.getByRole('menu').waitFor({state:'hidden'});
    await dismissOverflow(mpr);
    await mpr.waitForTimeout(200);
    const measure=await mpr.locator('[data-panel="MA"] .dicom-canvas').boundingBox();
    const x=measure.x+measure.width*.30,y=measure.y+measure.height*.71;
    await mpr.mouse.move(x,y);await mpr.mouse.down();await mpr.mouse.move(x+55,y+15,{steps:8});await mpr.mouse.up();
    await mpr.waitForFunction(()=>!!document.querySelector('[data-panel="MA"] line[data-id*="-endpoint-"],[data-panel="MA"] .dicom-canvas svg text,[data-panel="MA"] [data-kind="length"]'));
    suite.measurement=true;
    await mpr.close();await page.bringToFront();
    await page.getByRole('button',{name:'3D həcm görüntüləmə',exact:true}).first().click();
    const volume=page;
    await volume.locator('.vr-raster[data-ready=true]').waitFor({timeout:60000});
    assert.equal(await volume.locator('.tablet-volume-overlay .vr-close:visible').count(),0);
    suite.volumeCanvas=true;
    await volume.evaluate(()=>dispatchEvent(new Event('radaz:close-volume')));await page.bringToFront();
    await panel.locator('.bottom-right').filter({hasText:'/ 12'}).waitFor();
    assert.equal(await panel.getAttribute('data-has-image'),'true');
    await page.waitForFunction(()=>!document.querySelector('.tablet-volume-overlay,.sv-surface'));
    const smartOpen=context.waitForEvent('page');
    await command(page,'Smart Volume');
    const smart=await smartOpen;
    await smart.getByRole('button',{name:'Seqment əlavə et',exact:true}).click();
    assert.equal(await smart.getByLabel('Aktiv seqment').locator('option').count(),2);
    assert.equal(await smart.locator('.sv-plane canvas').count(),3);
    suite.smartManualSegments=true;
    await smart.close();await page.bringToFront();
    await page.setViewportSize({width:800,height:1200});
    assert.ok((await panel.boundingBox()).width>100);
    await page.setViewportSize({width:1200,height:800});
    const archOpen=context.waitForEvent('page');await command(page,'Local arxiv');
    const archive=await archOpen;
    await archive.locator('input[type=file][accept*="zip"]').first().setInputFiles({name:'TABLET-CT.zip',mimeType:'application/zip',buffer:sample});
    await archive.getByText(/1 müayinə saxlanıldı/).waitFor();
    await archive.reload();
    await archive.getByText(/1 müayinə arxivdədir/).waitFor();
    const todayFilter=archive.locator('.today-filter input');if(await todayFilter.isChecked())await todayFilter.uncheck();
    const row=archive.locator('tbody tr').filter({has:archive.locator('.record-open-button')}).first();
    const dateCell=row.locator('td').nth(2);
    await dateCell.tap();
    await archive.getByRole('button',{name:'Viewer',exact:true}).tap();
    await page.waitForFunction(()=>window.qaArchiveHandoffs?.length===1 && location.hash.includes('archive-studies='));
    const opened=await page.evaluate(()=>window.qaArchiveHandoffs[0]);
    assert.equal(opened.length,1);
    assert.equal(new URLSearchParams(new URL(page.url()).hash.slice(1)).get('archive-studies'),opened[0]);
    await archive.getByText(/1 seçilmiş müayinə Viewer-də açıldı/).waitFor();
    await archive.bringToFront();
    // The initial selection tap and the next double gesture are separate actions.
    await archive.waitForTimeout(460);
    await dateCell.tap();await dateCell.tap();
    await page.waitForFunction(()=>window.qaArchiveHandoffs?.length===2 && document.querySelector('[data-panel="A"] canvas')?.width>0);
    assert.deepEqual(await page.evaluate(()=>window.qaArchiveHandoffs[1]),opened);
    await page.waitForFunction(()=>!document.querySelector('.viewport-loading'));
    console.log('Archive Viewer and double-tap handoffs passed.');suite.archiveAfterReopen=true;
    await archive.close();await page.bringToFront();
    const beforeTouch=await frame.innerText();
    const box=await panel.boundingBox();
    const cdp=await context.newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:box.x+box.width*.52,y:box.y+box.height*.55}]});
    for(let n=1;n<=5;n++)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:box.x+box.width*.52,y:box.y+box.height*.55+12*n}]});
    await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    await page.waitForFunction(before=>document.querySelector('[data-panel="A"] .bottom-right span')?.textContent!==before,beforeTouch);
    const afterTouch=await frame.innerText();
    suite.touch=[beforeTouch,afterTouch];
    if(process.env.RADAZ_TABLET_THUMB_ZIP){
      await page.locator('input[type=file][accept*="zip"]').first().setInputFiles(process.env.RADAZ_TABLET_THUMB_ZIP);
      const preview=page.locator('.series-card').filter({hasText:'THUMBNAIL RECOVERY QA'}).locator('img');
      await preview.waitFor();
      await page.waitForFunction(()=>{
        const card=[...document.querySelectorAll('.series-card')].find(item=>item.textContent.includes('THUMBNAIL RECOVERY QA'));
        const img=card?.querySelector('img');if(!img?.complete||!img.naturalWidth)return false;
        const canvas=document.createElement('canvas');canvas.width=canvas.height=48;
        const ctx=canvas.getContext('2d');ctx.drawImage(img,0,0,48,48);
        const pixels=ctx.getImageData(0,0,48,48).data;
        let min=255,max=0;for(let i=0;i<pixels.length;i+=4){min=Math.min(min,pixels[i]);max=Math.max(max,pixels[i]);}
        return max-min>100;
      });
      suite.thumbnailRecovered=true;
    }
    if(process.env.RADAZ_LARGE_TABLET_ZIP){
      await page.locator('input[type=file][accept*="zip"]').first().setInputFiles(process.env.RADAZ_LARGE_TABLET_ZIP);
      await page.waitForFunction(()=>document.querySelector('.statusbar')?.textContent.includes('442 DICOM'),{},{timeout:120000});
      const start=Date.now();
      await page.getByRole('button',{name:'3D həcm görüntüləmə',exact:true}).first().click();
      const texture=page.locator('.sv-surface-canvas[data-context-dimensions]');await texture.waitFor({timeout:120000});
      const dims=(await texture.getAttribute('data-context-dimensions')).split('x').map(Number);
      assert.ok(dims.every(n=>n>=3)&&dims.reduce((a,b)=>a*b,4)<=24*1024*1024);
      assert.match(await page.locator('.sv-surface footer').innerText(),/442 mənbə kəsiyi/);
      suite.largeVolume={source:'512x512x442',texture:dims,ms:Date.now()-start};
      const image=texture.locator('canvas').first(),prior=await image.screenshot(),rect=await image.boundingBox();
      const startPoint={x:rect.x+rect.width*.5,y:rect.y+rect.height*.4};
      await gestures.contact(page,tabletInput,'touch',startPoint,{x:startPoint.x+75,y:startPoint.y+30});
      assert.ok(!prior.equals(await image.screenshot()),'volume rotates and repaints');
      await page.getByRole('button',{name:'3D-ni bağla',exact:true}).click();
    }
    if(network)await verifyAutomaticDelivery();
    assert.deepEqual([...requests],[]);
    assert.deepEqual(issues,[]);
    console.log(JSON.stringify(suite));
  }finally{await browser.close();network?.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
