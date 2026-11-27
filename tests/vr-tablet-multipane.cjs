const assert = require('node:assert/strict');

function syntheticSeriesFile(source, series, slice) {
  const buffer = Buffer.from(source);
  const replacements = [
    ['2.25.703', '2.25.7' + (20 + series)],
    ['2.25.701.', '2.25.7' + (40 + series) + '.'],
    ['Synthetic CT volume', 'Synthetic CT set 0' + series],
  ];
  for (const [original, replacement] of replacements) {
    assert.equal(original.length, replacement.length);
    let offset = buffer.indexOf(original);
    assert.ok(offset >= 0, 'Requires tests/volume-fixture.py synthetic data');
    while (offset >= 0) {
      buffer.write(replacement, offset, 'ascii');
      offset = buffer.indexOf(original, offset + replacement.length);
    }
  }
  return {name: `series-${series}-${slice}.dcm`, mimeType: 'application/dicom', buffer};
}

async function readPanes(home) {
  return home.locator('[data-panel]').evaluateAll(panes => panes.map(pane => {
    const canvas = pane.querySelector('.dicom-canvas canvas');
    if (!canvas) return null;
    const rgba = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    let lit = 0;
    for (let i = 0; i < rgba.length; i += 64) if (rgba[i] > 32) lit++;
    return {panel: pane.dataset.panel, slice: pane.querySelector('.bottom-right').innerText,
      windowing: pane.querySelector('.bottom-left').innerText, lit};
  }).filter(Boolean));
}

async function verifyTabletMultiPaneReturn(home, sources) {
  const errors = [];
  home.on('pageerror', error => errors.push(error.message));
  const files = [];
  const length = 16;
  assert.ok(sources.length >= 64);
  for (let series = 1; series <= 4; series++) {
    for (let slice = 0; slice < length; slice++) {
      const index = Math.floor((sources.length - 64) / 2) + (series - 1) * length + slice;
      files.push(syntheticSeriesFile(sources[index], series, slice));
    }
  }
  await home.locator('.statusbar').filter({hasText:'Cornerstone3D hazırdır'}).waitFor();
  await home.locator('input[type=file][multiple]:not([webkitdirectory])').first().setInputFiles(files);
  await home.locator('.series-card').nth(3).waitFor();
  await home.keyboard.press('2');
  const panels = home.locator('[data-panel]');
  await panels.nth(1).waitFor();
  for (const [index, steps] of [[0, 3], [1, 5]]) {
    const pane = panels.nth(index);
    await pane.tap({position:{x:55,y:65}});
    await home.locator('.series-card').filter({hasText:'Synthetic CT set 0' + (index + 1)}).tap();
    await pane.locator('.bottom-right').filter({hasText:'/ 16'}).waitFor();
    await pane.hover();
    for (let step = 0; step < steps; step++) {
      await home.mouse.wheel(0, 90);
      await home.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    }
  }
  const before = await readPanes(home);
  console.log('Captured independent stacks in two visible panes', before);
  assert.equal(before.length, 2);
  assert.notEqual(before[0].slice, before[1].slice);
  assert.ok(before.every(p => p.lit > 100));
  await home.getByRole('button', {name:'3D həcm görüntüləmə', exact:true}).first().tap();
  const volume = home.locator('dialog.tablet-volume-dialog .radaz-vr');
  await volume.locator('.vr-raster[data-ready=true]').waitFor();
  await require('./vr-tablet-return.cjs').discardCoveredCanvas(home,true);
  await home.evaluate(() => { window.testDenyNewGL = true; window.testDeniedContexts = 0; });
  await volume.locator('.vr-close').tap();
  await home.waitForFunction(()=>window.testDeniedContexts>0 && window.testStackHash()?.lit>100);
  for (const pane of before) {
    await home.waitForFunction(expected=>{
      const returned=document.querySelector('[data-panel="'+expected.panel+'"]');
      return returned?.querySelector('.bottom-right')?.innerText===expected.slice &&
        returned?.querySelector('.bottom-left')?.innerText===expected.windowing;
    },pane);
  }
  assert.ok(await home.evaluate(() => window.testDeniedContexts > 0));
  const after = await readPanes(home);
  assert.deepEqual(after.map(p => [p.panel,p.slice,p.windowing]), before.map(p => [p.panel,p.slice,p.windowing]));
  assert.ok(after.every(p => p.lit > 100));
  assert.equal(await home.locator('.pane-error').count(), 0);
  assert.deepEqual(errors, []);
  console.log('PASS denied WebGL after 3D on the second of four series: both 2D panes recovered', after);
}

module.exports = { verifyTabletMultiPaneReturn, syntheticSeriesFile };
