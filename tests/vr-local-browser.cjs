// Exercises the installed viewer's ordinary 3D button with the same synthetic CT as the RadiAnt comparison.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const source=process.env.VR_CT_DIR,files=fs.readdirSync(source).filter(n=>n.endsWith('.dcm')).sort().map(n=>fs.readFileSync(path.join(source,n)));
const resultDir=process.env.VR_RESULTS,base=process.env.RADAZ_TEST_URL||'http://127.0.0.1:5399',tablet=!!process.env.VR_TABLET_ASSETS;
const origin=tablet?'https://appassets.androidplatform.net':base;
(async()=>{
 const browser=await chromium.launch({headless:true,channel:'msedge',args:['--enable-webgl','--enable-unsafe-swiftshader']});
 const context=await browser.newContext({viewport:{width:1100,height:730},hasTouch:tablet,isMobile:tablet,acceptDownloads:true});
 context.setDefaultTimeout(files.length>256?90000:45000);const errs=[];context.on('page',p=>{p.on('pageerror',e=>errs.push(e.message));p.on('dialog',d=>{if(d.message()!=='radaz-tablet/open-studies')void d.dismiss();});});
 if(tablet && (process.env.VR_TABLET_RETURN_TEST || process.env.VR_TABLET_MULTIPANE))await require('./vr-tablet-return.cjs').observeTabletCanvas(context);
 if(tablet){await context.route(origin+'/**',async route=>{
   const url=new URL(route.request().url()),p=decodeURIComponent(url.pathname);
   if(p.startsWith('/local-archive-api/'))return route.fallback();
   const folder=process.env.VR_TABLET_ASSETS;
   const asset=path.join(folder,p.slice(1));
   const f=fs.existsSync(asset)&&fs.statSync(asset).isDirectory()?path.join(asset,'index.html'):asset;
   if(!fs.existsSync(f)||!fs.statSync(f).isFile())return route.fulfill({status:404,body:''});
   const map={'.js':'application/javascript','.json':'application/json','.css':'text/css','.html':'text/html','.svg':'image/svg+xml','.wasm':'application/wasm'};
   return route.fulfill({body:fs.readFileSync(f),contentType:map[path.extname(f)]||'application/octet-stream'});
 });}
 await context.route('**/local-archive-api/**',route=>{const p=new URL(route.request().url()).pathname;
   if(p.endsWith('/license'))return route.fulfill({json:{valid:true,required:true,kind:'owner',deviceId:'TEST',message:'Synthetic'}});
   if(p.endsWith('/instances'))return route.fulfill({json:files.map((_,i)=>({uid:String(i)}))});
   if(p.includes('/file/'))return route.fulfill({contentType:'application/dicom',body:files[Number(p.split('/').pop())]});
   return route.fulfill({json:[]});
 });
 const home=await context.newPage();let view=home;
 try{
  if(tablet && process.env.VR_TABLET_MULTIPANE){
    await home.goto(origin+'/');
    await require('./vr-tablet-multipane.cjs').verifyTabletMultiPaneReturn(home,files);
    return;
  }
  const archived=!tablet || !!process.env.VR_TABLET_ARCHIVE;
  if(tablet && archived){
    await home.goto(origin+'/');
    await home.locator('.statusbar').filter({hasText:'Cornerstone3D hazırdır'}).waitFor();
    const archive=await context.newPage();
    await archive.goto(origin+'/archive/');
    await archive.locator('.today-filter input').uncheck();
    await archive.locator('input[type=file][webkitdirectory]').first().setInputFiles(path.resolve(source));
    const study=archive.locator('tr').filter({hasText:'SYNTHETIC VOLUME'}).first();
    await study.waitFor();
    const handoff=archive.waitForEvent('dialog',{predicate:d=>d.message()==='radaz-tablet/open-studies'}).then(async d=>{
      const ids=JSON.parse(d.defaultValue());
      await d.accept('ok');
      return ids;
    });
    const [ids]=await Promise.all([handoff,study.locator('.record-open-button').first().click()]);
    assert.deepEqual(ids,['2.25.702']);
    const stored=await home.evaluate(uid=>new Promise((resolve,reject)=>{
      const open=indexedDB.open('radaz-local-archive');
      open.onsuccess=()=>{
        const db=open.result,read=db.transaction('instances').objectStore('instances').index('studyUID').count(uid);
        read.onsuccess=()=>{db.close();resolve(read.result);};
        read.onerror=()=>{db.close();reject(read.error);};
      };
      open.onerror=()=>reject(open.error);
    }),ids[0]);
    assert.equal(stored,files.length);
    await home.bringToFront();
    assert.ok(await home.evaluate(ids=>!dispatchEvent(new CustomEvent('radaz-tablet-open-studies',{cancelable:true,detail:ids})),ids));
    console.log('PASS selected synthetic archive study with',stored,'stored images in the main tablet Viewer');
  }else{
    await home.goto(archived?origin+'/#archive-study=2.25.702':origin+'/');
  }
  if(tablet && !archived){await home.locator('.statusbar').filter({hasText:'Cornerstone3D hazırdır'}).waitFor();const local=home.locator('input[type=file][multiple]:not([webkitdirectory])').first();await local.setInputFiles(fs.readdirSync(source).filter(n=>n.endsWith('.dcm')).sort().map(n=>path.resolve(source,n)));}
  const panel=home.locator('[data-panel="A"]');await panel.locator('.bottom-right').filter({hasText:new RegExp('/\\s*'+files.length)}).waitFor();
  if(tablet){
   const cdp=await context.newCDPSession(home),box=await panel.locator('.dicom-canvas').boundingBox(),x=box.x+box.width*.5,y=box.y+box.height*.5;
   const send=(type,points)=>cdp.send('Input.dispatchTouchEvent',{type,touchPoints:points.map(([id,x,y])=>({id,x,y}))});
   const ww=()=>panel.locator('.bottom-left').innerText(),slice=()=>panel.locator('.bottom-right').innerText(),screen=()=>panel.locator('.dicom-canvas').screenshot();
   await home.locator('button.view-tool[title$=" · W / Ü"]').click();
   const beforeWW=await ww(),beforeIndex=await slice(),before=await screen();
   await send('touchStart',[[1,x-35,y],[2,x+35,y]]);await send('touchMove',[[1,x-70,y+1],[2,x+70,y+1]]);await send('touchEnd',[]);
   await home.waitForTimeout(100);assert.notDeepEqual(await screen(),before,'pinch zoom');assert.equal(await ww(),beforeWW);assert.equal(await slice(),beforeIndex);
   const afterZoom=await screen();await send('touchStart',[[1,x-40,y],[2,x+40,y]]);await send('touchMove',[[1,x-15,y+24],[2,x+65,y+24]]);await send('touchEnd',[]);
   assert.notDeepEqual(await screen(),afterZoom,'two finger pan');assert.equal(await ww(),beforeWW);assert.equal(await slice(),beforeIndex);
   await send('touchStart',[[1,x,y]]);await send('touchMove',[[1,x+45,y+27]]);await send('touchEnd',[]);assert.notEqual(await ww(),beforeWW);
   await home.locator('button.view-tool[title$=" · S"]').click();await send('touchStart',[[1,x,y]]);await send('touchMove',[[1,x,y+67]]);await send('touchEnd',[]);
   await home.waitForFunction(i=>document.querySelector('[data-panel="A"] .bottom-right').innerText!==i,beforeIndex);
   console.log('PASS two-finger zoom/pan, one-finger window and stack scroll');
  }
  if(tablet && process.env.VR_TABLET_RETURN_TEST)await require('./vr-tablet-return.cjs').rememberTabletFrame(home);
  if(!tablet && process.env.VR_DESKTOP_LOADING_TEST)await require('./vr-desktop-loading.cjs').verifyDesktopLoading(home,context);
  const pop=home.waitForEvent('popup');const t=Date.now();await home.getByRole('button',{name:'3D həcm görüntüləmə',exact:true}).first().click();view=await pop;
  let vr=view.locator('.radaz-vr');await vr.locator('.vr-raster[data-ready="true"]').waitFor();
  const initial=Date.now()-t;console.log('OPEN',initial,'ms',await vr.getAttribute('data-backend'),files.length);
  let raster=vr.locator('.vr-raster'),stage=vr.locator('.vr-stage');await raster.screenshot({path:path.join(resultDir,(tablet?'tablet':'desktop')+'-volume.png')});
  const b=await stage.boundingBox(),x=b.x+b.width*.45,y=b.y+b.height*.48,drag=async(dx,dy)=>{await view.mouse.move(x,y);await view.mouse.down();await view.mouse.move(x+dx,y+dy,{steps:4});await view.mouse.up();};
  if(process.env.VR_CONTROLS_TEST){
    view=await require('./vr-controls.cjs').verifyVrControls({home,view,vr,stage,tablet,context});
    vr=view.locator('.radaz-vr');raster=vr.locator('.vr-raster');stage=vr.locator('.vr-stage');
    await view.keyboard.press('1');
  }
  const button=name=>vr.getByRole('button',{name,exact:true});
  if(process.env.VR_OPEN_ONLY){console.log('PASS large study first frame');return;}
  const original=await raster.screenshot();await drag(70,31);assert.notDeepEqual(await raster.screenshot(),original,'orbit changes output');
  await button('Baxış istiqaməti').click();await button('A · Ön').click();
  await button('3D rəng rejimləri').click();await button('Angioqrafiya').click();assert.notDeepEqual(await raster.screenshot(),original,'material changes output');
  await button('Proyeksiyada uzunluq').click();await drag(56,35);assert.equal(await button('Seçilmiş işarəni sil').count(),1);
  await button('Ox').click();await view.mouse.move(x-50,y-60);await view.mouse.down();await view.mouse.move(x-15,y-30,{steps:3});await view.mouse.up();
  await button('3D görünüşlər · F3').click();await button('Görünüşü yadda saxla · K').click();await button('Görünüş 1').waitFor();await button('Menyunu bağla').click();
  await button('Skalpel').click();await view.mouse.move(x-40,y-40);await view.mouse.down();for(const [dx,dy]of [[40,-40],[40,40],[-40,40],[-40,-40]])await view.mouse.move(x+dx,y+dy,{steps:3});await view.mouse.up();
  const preCut=await raster.screenshot();await button('Konturun içini kəs · Del').click();let changed=false;
  for(let i=0;i<25&&!changed;i++){await view.waitForTimeout(120);changed=!preCut.equals(await raster.screenshot());}assert.ok(changed,'scalpel changes reconstructed pixels');
  await button('Son kəsimi geri al · Ctrl+Z').click();await button('Kəsimi təkrarla · Ctrl+Y').click();await button('Həcmi bərpa et').click();await button('Menyunu bağla').click();
  await button('3D görüntüləmə ayarları').click();await vr.getByLabel('Hesablama').selectOption('cpu');await view.waitForFunction(()=>document.querySelector('.radaz-vr')?.dataset.backend==='CPU');await button('Menyunu bağla').click();
  await raster.screenshot({path:path.join(resultDir,(tablet?'tablet':'desktop')+'-cpu.png')});
  if(!tablet){
   await context.grantPermissions(['clipboard-read','clipboard-write'],{origin:base});
   await view.evaluate(()=>{window.print=()=>document.body.dataset.vrPrintCalled='yes';});
   await button('Çap · Ctrl+P').click();await view.waitForFunction(()=>document.body.dataset.vrPrintCalled==='yes'&&document.querySelector('.vr-print-image')?.naturalWidth>0);
   await view.evaluate(()=>window.dispatchEvent(new Event('afterprint')));
   await button('Şəkil və video ixracı').click();await button('Görüntünü kopyala').click();await vr.getByText('3D görüntü kopyalandı.').waitFor();await button('Menyunu bağla').click();
   await button('Şəkil və video ixracı').click();const saving=view.waitForEvent('download');await button('JPEG kimi saxla').click();const jpeg=await saving;assert.ok(fs.statSync(await jpeg.path()).size>5000);await button('Menyunu bağla').click();
   await button('3D görünüşlər · F3').click();const jsonSaving=view.waitForEvent('download');await button('Görünüşləri fayla yaz').click();const saved=JSON.parse(fs.readFileSync(await(await jsonSaving).path()));assert.equal(saved.shots[0].marks.length,2);await vr.locator('input[type=file]').setInputFiles({name:'saved.radazvr',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(saved))});await button('Görünüş 1').click();await button('Menyunu bağla').click();
   await button('3D görüntüləmə ayarları').click();await vr.getByLabel('Hesablama').selectOption('gpu');await view.waitForFunction(()=>document.querySelector('.radaz-vr')?.dataset.backend==='GPU');await button('Menyunu bağla').click();
   await button('Şəkil və video ixracı').click();await button('Fırlanma videosu · F2').click();await vr.getByLabel('Müddət (san)').fill('1');await vr.getByLabel('En (piksel)').selectOption('480');await vr.getByLabel('Kadr/s').selectOption('10');
   const movie=view.waitForEvent('download',{timeout:60000});await button('Videonu saxla').click();const video=await movie;await video.saveAs(path.join(resultDir,'vr-spin.webm'));assert.ok(fs.statSync(await video.path()).size>2000,'3D spin bytes '+fs.statSync(await video.path()).size);await button('Menyunu bağla').click();
   await view.keyboard.press('ArrowRight');await view.keyboard.press('k');await view.keyboard.press('F3');await vr.getByLabel('Görünüş 1 müddəti').fill('0.5');await button('Menyunu bağla').click();await view.keyboard.press('Control+F2');await vr.getByLabel('Kadr/s').selectOption('10');const advanced=view.waitForEvent('download',{timeout:60000});await button('Videonu saxla').click();const advancedFile=await advanced;await advancedFile.saveAs(path.join(resultDir,'vr-keyframes.webm'));assert.ok(fs.statSync(await advancedFile.path()).size>2000);await button('Menyunu bağla').click();
  }
  if(tablet)await view.close();else await button('3D pəncərəni bağla').click();
  await home.bringToFront();await panel.waitFor();assert.equal(errs.length,0,errs.join('\n'));console.log('PASS viewer 3D tools, capture, cut history, projected marks and CPU/GPU');
 }catch(e){console.error('PAGE ERRORS',errs);console.error('VISIBLE',await view.locator('body').innerText().catch(()=>''));throw e;}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
