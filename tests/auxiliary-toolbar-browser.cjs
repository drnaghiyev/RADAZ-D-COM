// Exercise per-button separators in the production windows using synthetic CT only.
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const base = process.env.RADAZ_TEST_URL;
async function toggle(page, scope, action) {
  const edit = scope.getByRole('button',{name:'Alət panelini fərdiləşdir'});
  await edit.click();
  const menu = page.getByRole('dialog',{name:'Alət panelinin düzülüşü'});
  const choice = menu.locator('.aux-tool-row').filter({has:page.locator('span').filter({hasText:action})}).getByRole('button',{name:/ əvvəl ayırıcı$/});
  assert.equal(await choice.count(),1,'Expected '+action+' in '+await menu.innerText());
  await choice.click();
  await menu.getByRole('button',{name:'Təsdiq'}).click();
  assert.equal(await scope.locator('[data-radaz-divider]').count(),1);
}
(async()=>{
  const browser = await chromium.launch({channel:'msedge',headless:true});
  try {
    const ctx=await browser.newContext({viewport:{width:1536,height:900}});
    await ctx.route('**/local-archive-api/**',r=>r.fulfill({json:r.request().url().endsWith('/license')?{valid:true,required:true,kind:'owner'}:r.request().url().endsWith('/output-devices')?{drives:[],printers:[]}:[]}));
    const page=await ctx.newPage();
    await page.goto(base+'/report');
    const header=page.locator('.report-top-actions');
    await toggle(page,header,'Email');
    await page.reload();
    await header.locator('button[title="Email"][data-radaz-divider]').waitFor({state:'attached'});
    assert.ok(await header.locator('.record-action-group').first().evaluate(el=>getComputedStyle(el).display==='contents'));
    await page.goto(base+'/media');
    const nav=page.locator('.output-page-nav');
    const name=await nav.locator('a').first().getAttribute('title');
    await toggle(page,nav,name);
    console.log('PASS report persistence, unboxed header, and independent CD toolbar settings');
    await page.goto(base+'/');
    await page.locator('.statusbar').filter({hasText:'Cornerstone3D hazırdır'}).waitFor();
    const folder=process.env.VR_CT_DIR;
    const files=fs.readdirSync(folder).filter(n=>n.endsWith('.dcm')).slice(0,32).map(n=>path.resolve(folder,n));
    await page.locator('input[type=file][multiple]:not([webkitdirectory])').first().setInputFiles(files);
    await page.locator('[data-panel=A][data-has-image=true]').waitFor();
    const [sv]=await Promise.all([ctx.waitForEvent('page'),page.getByRole('button',{name:'Smart Volume',exact:true}).click()]);
    await sv.getByRole('button',{name:'Freehand',exact:true}).waitFor();
    assert.equal(await sv.locator('.smart-dock-grip,.smart-dock-group').count(),0);
    await toggle(sv,sv.locator('.smart-dock-root'),/^Freehand(?: ·|$)/);
    const brush=sv.locator('[data-smart-tool="sv-contour-tools:Brush"]');
    const pencil=sv.locator('[data-smart-tool="sv-contour-tools:Freehand"]');
    await brush.getByRole('button').press('Alt+ArrowUp');
    await sv.waitForFunction(()=>document.querySelector('[data-smart-tool="sv-contour-tools:Brush"]')?.dataset.preferred==='top');
    assert.equal(await pencil.getAttribute('data-preferred'),'right');
    console.log('PASS Smart Volume individual controls, separator and independent placement');
  } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
