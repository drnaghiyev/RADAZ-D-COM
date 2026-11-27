const assert = require('node:assert/strict');
const {withTablet, frame} = require('../../tests/private-tablet-fixture.cjs');

withTablet(async ({p, pane, errors}) => {
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
  for (const [label, route, selector] of studies) {
    // A dismissed native prompt exercises the same-origin popup fallback for records.
    const opening = p.waitForEvent('popup');
    const button = p.getByRole('button', {name:label, exact:true}).first();
    await button.tap();
    const child = await opening;
    child.on('pageerror', error => errors.push(error.message));
    await child.locator(selector).first().waitFor({timeout:45000});
    assert.equal(new URL(child.url()).pathname, '/'+route);
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
      const box = await child.locator(selector).first().boundingBox();
      assert.ok(box.width>60 && box.height>60 && box.x>=-1 && box.y>=-1
        && box.x+box.width<=width+2 && box.y+box.height<=height+2, route+' '+JSON.stringify(box));
    }
    await child.close();
    await p.bringToFront();
    // The image counter appears before the restored canvas reports its orientation.
    await p.waitForFunction(expected => document.querySelector('[data-panel=A] .bottom-right')?.innerText === expected, before);
    assert.equal(await pane.locator('.bottom-right').innerText(), before);
    assert.equal(await pane.locator('.bottom-left').innerText(), initialWindow);
    console.log('PASS '+route+' in both orientations; original slice and window level restored');
  }
  assert.deepEqual(errors, []);
}).catch(error => { console.error(error); process.exitCode=1; });
