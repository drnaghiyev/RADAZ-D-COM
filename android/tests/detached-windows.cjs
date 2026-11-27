const assert = require('node:assert/strict');
const {withTablet, frame} = require('../../tests/private-tablet-fixture.cjs');

async function tapClose(page,button){
  const closed=page.waitForEvent('close');
  // Chromium can tear down the target in pointerup, before tap's synthetic click.
  await button.tap().catch(error=>{if(!page.isClosed())throw error;});
  await closed;
}
withTablet(async ({ctx, p, pane, errors}) => {
  const studies = [
    ['Local arxiv', 'archive', '.archive-shell'],
    ['PACS müayinələri', 'pacs', '.pacs-shell'],
    ['MPR rekonstruksiya', 'mpr', '[data-panel=MA][data-has-image=true]'],
    ['3D həcm görüntüləmə', '3d', '.vr-raster[data-ready=true]'],
  ];
  await pane.hover();
  await p.mouse.wheel(0, 120);
  await frame(p);
  const before = await pane.locator('.bottom-right').innerText();
  const initialWindow = await pane.locator('.bottom-left').innerText();
  const [archive,pacs,mpr,volume]=studies;
  for (const [label, route, selector] of [volume,archive,volume,pacs,volume,mpr,archive]) {
    // A dismissed native prompt exercises the same-origin popup fallback for records.
    const opening = route==='3d'?Promise.resolve(p):p.waitForEvent('popup');
    const button = p.getByRole('button', {name:label, exact:true}).first();
    await button.tap();
    const child = await opening;
    if(child!==p)child.on('pageerror', error => errors.push(error.message));
    await child.locator(selector).first().waitFor({timeout:45000});
    assert.equal(new URL(child.url()).pathname, route==='3d'?'/':'/'+route);
    assert.equal(new URL(p.url()).pathname, '/');
    assert.equal(await child.locator('.embedded-close:visible, a[href="/"]:visible').count(), 0);
    for (const [width,height] of [[800,1200],[1200,800]]) {
      await child.setViewportSize({width,height});
      await frame(child);
      const size = await child.evaluate(() => ({
        viewport: [innerWidth, innerHeight],
        body: [document.documentElement.scrollWidth, document.documentElement.scrollHeight],
      }));
      assert.ok(size.body.every((n,i)=>n <= size.viewport[i]+2), route+' '+JSON.stringify(size));
      const inline=await child.locator(route==='3d'?'.vr-tools .vr-close':':is(.topbar,.records-header) > [data-tablet-close]').evaluate(button=>{
        const b=button.getBoundingClientRect(),bar=button.parentElement.getBoundingClientRect();
        return (!button.classList.contains('vr-close') || b.right>=innerWidth-8) && b.width>=30 && b.left>=bar.left-1 && b.right<=innerWidth+1 && b.top>=bar.top-1 && b.bottom<=bar.bottom+1 && button.contains(document.elementFromPoint(b.left+b.width/2,b.top+b.height/2));
      });
      assert.ok(inline,route+' close is inside the tool row');
      const box = await child.locator(selector).first().boundingBox();
      assert.ok(box.width>60 && box.height>60 && box.x>=-1 && box.y>=-1
        && box.x+box.width<=width+2 && box.y+box.height<=height+2, route+' '+JSON.stringify(box));
    }
    const close=child.locator(route==='3d'?'.vr-tools .vr-close':':is(.topbar,.records-header) > [data-tablet-close]');
    assert.equal(await close.count(),1);
    if(route==='3d'){
      await close.tap();
      await child.locator('dialog.tablet-volume-dialog').waitFor({state:'detached'});
    }else{
      if(route==='archive'||route==='pacs'){
        const field=child.locator(route==='archive'?'.records-search input':'.pacs-patient input');
        await field.fill('QA');assert.equal(await field.inputValue(),'QA');
      }
      await tapClose(child,close);
    }
    await p.bringToFront();
    // The image counter appears before the restored canvas reports its orientation.
    await p.waitForFunction(expected => document.querySelector('[data-panel=A] .bottom-right')?.innerText === expected, before);
    assert.equal(await pane.locator('.bottom-right').innerText(), before);
    assert.equal(await pane.locator('.bottom-left').innerText(), initialWindow);
    console.log('PASS '+route+' in both orientations; original slice and window level restored');
  }
  // Records are native-created WebViews on HONOR, so they cannot rely on window.close().
  const bridgeErrors=[];
  const bridge=async d=>{
    const cmd=d.message();
    if(cmd==='radaz-tablet/open-archive' || cmd==='radaz-tablet/open-pacs'){
      await d.accept('ok');
      const child=await ctx.newPage();await child.goto(new URL('/'+cmd.split('open-')[1],p.url()).href);
    }else if(cmd==='radaz-tablet/close-window'){
      const owner=d.page();await d.accept('ok');await owner.close();
    }else await d.dismiss();
  };
  const handleDialog=d=>{void bridge(d).catch(e=>bridgeErrors.push(e.message));};
  ctx.on('dialog',handleDialog);
  for(const [label,route,selector] of [archive,pacs]){
    await p.getByRole('button',{name:volume[0],exact:true}).first().tap();
    await p.locator('dialog .vr-raster[data-ready=true]').waitFor();
    await p.locator('dialog .vr-close').tap();
    await p.locator('dialog.tablet-volume-dialog').waitFor({state:'detached'});
    const opening=ctx.waitForEvent('page');
    await p.getByRole('button',{name:label,exact:true}).first().tap();
    const records=await opening;await records.locator(selector).waitFor();
    const close=records.locator(':is(.topbar,.records-header) > [data-tablet-close]');
    await tapClose(records,close);
    assert.equal(p.isClosed(),false);
    console.log('PASS immediate 3D X -> '+route+' -> native close');
  }
  ctx.off('dialog',handleDialog);
  assert.deepEqual(bridgeErrors,[]);
  assert.deepEqual(errors, []);
}).catch(error => { console.error(error); process.exitCode=1; });
