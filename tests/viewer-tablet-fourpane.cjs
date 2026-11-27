const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { withTablet, frame } = require('./private-tablet-fixture.cjs');
const { syntheticSeriesFile } = require('./vr-tablet-multipane.cjs');

async function doubleTap(page, pane) {
  const rect = await pane.locator('.dicom-canvas').boundingBox();
  for (let i = 0; i < 2; i++) {
    await page.touchscreen.tap(rect.x + rect.width * .63, rect.y + rect.height * .47);
    await page.waitForTimeout(55);
  }
}

async function snapshot(page) {
  return page.locator('[data-panel]').evaluateAll(panes => panes.map(pane => {
    const canvas = pane.querySelector('.dicom-canvas canvas');
    const rgba = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    let lit = 0;
    for (let i = 0; i < rgba.length; i += 64) if (rgba[i] > 32) lit++;
    return {panel: pane.dataset.panel, series: pane.querySelector('.top-right').innerText,
      slice: pane.querySelector('.bottom-right').innerText,
      windowing: pane.querySelector('.bottom-left').innerText, lit};
  }));
}

withTablet(async ({p, errors}) => {
  const folder = process.env.VR_CT_DIR;
  const names = fs.readdirSync(folder).filter(name => name.endsWith('.dcm')).sort();
  assert.ok(names.length >= 64);
  const start = Math.floor((names.length - 64) / 2);
  const files = [];
  for (let j = 0; j < 64; j++) {
    const bytes = fs.readFileSync(path.join(folder, names[start + j]));
    files.push(syntheticSeriesFile(bytes, Math.floor(j / 16) + 1, j % 16));
  }
  await p.locator('input[type=file][multiple]:not([webkitdirectory])').first().setInputFiles(files);
  await p.locator('.series-card').filter({hasText:'Synthetic CT set 04'}).waitFor();
  await p.keyboard.press('4');
  const panes = p.locator('[data-panel]');
  await panes.nth(3).waitFor();
  for (let i = 0; i < 4; i++) {
    const pane = panes.nth(i);
    await pane.tap({position:{x:60, y:70}});
    await p.locator('.series-card').filter({hasText:'Synthetic CT set 0' + (i + 1)}).tap();
    const overlay=pane.locator('.bottom-right');
    await overlay.filter({hasText:'/ 16'}).waitFor();
    await pane.hover();
    for (let j = 0; j <= i; j++) {
      const previous=await overlay.innerText();
      await p.mouse.wheel(0,100);
      await p.waitForFunction(({id,previous})=>document.querySelector('[data-panel='+id+'] .bottom-right')?.innerText!==previous,
        {id:await pane.getAttribute('data-panel'),previous});
    }
  }
  const initial = await snapshot(p);
  assert.equal(new Set(initial.map(v=>v.series)).size,4,'four distinct series');
  assert.equal(new Set(initial.map(v=>v.slice)).size,4,'four independent indices');
  assert.ok(initial.every(v=>v.lit>100),'four independently rendered DICOM rasters');
  const geometry = v=>v.map(({panel, series, slice, windowing})=>({panel,series,slice,windowing}));
  for(let i=0;i<4;i++){
    const pane=panes.nth(i);
    await doubleTap(p,pane);
    await p.waitForFunction(id=>document.querySelector('[data-panel='+id+']')?.dataset.expanded==='true' &&
      document.querySelectorAll('[data-panel][aria-hidden=true]').length===3,initial[i].panel);
    assert.equal(await pane.locator('.bottom-right').innerText(),initial[i].slice);
    await doubleTap(p,pane);
    await p.waitForFunction(()=>!document.querySelector('[data-panel][aria-hidden=true], [data-panel][data-expanded=true]'));
    await frame(p);
    const restored=await snapshot(p);
    assert.deepEqual(geometry(restored),geometry(initial));
    assert.ok(restored.every(v=>v.lit>100),'four visible DICOM rasters after restoring '+initial[i].panel);
  }
  assert.deepEqual(errors,[]);
  console.log('PASS touch double tap on each of four independently populated CT panes, four stack indices, WL/WW and all rasters restored',initial.map(v=>[v.panel,v.slice]));
}).catch(error=>{console.error(error);process.exitCode=1});
