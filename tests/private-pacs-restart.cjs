// Verify a tablet PACS read survives a complete browser process restart in a private profile.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const dicomParser = require('dicom-parser');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE);
const origin = 'https://appassets.androidplatform.net';
const sample = fs.readFileSync(path.join(__dirname,'fixtures/demo/abdomen-1.dcm'));
const ds = dicomParser.parseDicom(new Uint8Array(sample));
const study = ds.string('x0020000d'), series = ds.string('x0020000e'), sop = ds.string('x00080018');
const attr = (v, vr='LO') => ({vr,Value:[v]});
const fixture = new Map([
  ['/test-pacs/studies',[{'0020000D':attr(study,'UI'),'00100010':attr({Alphabetic:'SYNTHETIC^PACS'},'PN'),'00080061':attr('CT'),'00201206':attr(1,'IS'),'00201208':attr(1,'IS')}]],
  ['/test-pacs/studies/'+study+'/series',[{'0020000E':attr(series,'UI'),'00080060':attr('CT'),'00201209':attr(1,'IS')}]],
  ['/test-pacs/studies/'+study+'/series/'+series+'/instances',[{'00080018':attr(sop,'UI')}]],
]);
const errors = [], requested = new Set();
async function start(profile) {
  const ctx = await chromium.launchPersistentContext(profile,{channel:'msedge',headless:true,viewport:{width:1200,height:800},hasTouch:true,isMobile:true});
  ctx.setDefaultTimeout(20000);
  const attach = p => p.on('pageerror', e => errors.push(String(e)));
  ctx.pages().forEach(attach);
  ctx.on('page',attach);
  await ctx.route('**/*', async r=>{
    const u=new URL(r.request().url()), n=u.pathname;
    if(u.origin!==origin)return r.abort();
    if(n.startsWith('/test-pacs/')){
      requested.add(n);
      if(fixture.has(n))return r.fulfill({json:fixture.get(n)});
      if(n.endsWith('/instances/'+sop))return r.fulfill({body:sample,contentType:'application/dicom'});
      return r.fulfill({status:404,body:''});
    }
    if(n==='/local-archive-api/license')return r.fulfill({json:{valid:true,required:true,kind:'owner'}});
    if(n==='/radaz-installation.json')return r.fulfill({json:{managed:false}});
    if(n.startsWith('/local-archive-api/'))return r.fulfill({status:503,json:{error:'isolated tablet'}});
    const file=path.join(process.env.VR_TABLET_ASSETS,path.extname(n)?n:n+'/index.html');
    if(fs.existsSync(file)&&fs.statSync(file).isFile())return r.fulfill({path:file});
    return r.fulfill({status:404,body:''});
  });
  return ctx;
}
async function rendered(p){
  await p.waitForFunction(()=>{
    const c=document.querySelector('[data-panel=A] .dicom-canvas canvas');
    if(!c?.width)return false;
    const data=c.getContext('2d').getImageData(0,0,c.width,c.height).data;
    let lit=0;for(let i=0;i<data.length;i+=128)if(data[i]>20 && ++lit>50)return true;
    return false;
  });
}
(async()=>{
  const profile=fs.mkdtempSync(path.join(os.tmpdir(),'radaz-pacs-restart-'));
  let ctx;
  try{
    ctx=await start(profile);
    const home=ctx.pages()[0];await home.goto(origin);
    await home.locator('.statusbar').filter({hasText:'Cornerstone3D hazırdır'}).waitFor();
    await home.evaluate(()=>localStorage.setItem('radaz-pacs-config-v1',JSON.stringify({selected:'qa',locations:[{id:'qa',description:'QA',aeTitle:'QA',port:'11112',host:'',dicomwebUrl:location.origin+'/test-pacs'}]})));
    const pacs=await ctx.newPage();await pacs.goto(origin+'/pacs');
    const today=pacs.locator('.today-filter input');if(await today.isChecked())await today.uncheck();
    await pacs.locator('.pacs-search-button').tap();
    const row=pacs.locator('.pacs-results table').locator('tbody tr').first();
    await row.locator('.record-open-button').tap();
    await pacs.getByText(/1 görüntü local arxivə saxlanıldı/).waitFor();
    await rendered(home);
    assert.equal(requested.size,4);
    console.log('PASS tablet QIDO study/series/SOP query, WADO DICOM, archive write and real Viewer pixels');
    await ctx.close();ctx=undefined;
    ctx=await start(profile);
    const reopened=ctx.pages()[0];await reopened.goto(origin+'/archive');
    const filter=reopened.locator('.today-filter input');if(await filter.isChecked())await filter.uncheck();
    await reopened.locator('tbody tr .record-open-button').first().waitFor();
    await reopened.goto(origin+'/#archive-study='+study);
    await rendered(reopened);
    assert.equal(requested.size,4);
    assert.deepEqual(errors,[]);
    console.log('PASS fresh browser process on same private profile restored archived DICOM pixels with no new PACS request');
  }finally{
    if(ctx)await ctx.close();
    fs.rmSync(profile,{recursive:true,force:true,maxRetries:3,retryDelay:300});
  }
})().catch(e=>{console.error(e);process.exitCode=1;});
