// Run after a portable build. All archive, PACS and disc data is synthetic.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, mkdirSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import http from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import dicomParser from 'dicom-parser';
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const freePort = () => new Promise(resolve => {
  const server = http.createServer();
  server.listen(0, '127.0.0.1', () => { const port = server.address().port; server.close(() => resolve(port)); });
});
function fixture(name) {
  const bytes = readFileSync(new URL(`./fixtures/demo/${name}-1.dcm`, import.meta.url));
  const ds = dicomParser.parseDicom(new Uint8Array(bytes));
  if(name==='thorax'){
    const uid=ds.elements.x0020000d;
    ds.byteArray[uid.dataOffset+ds.string('x0020000d').trim().length-1]='2'.charCodeAt(0);
    ds.byteArray.set(Buffer.from('DISC'),ds.elements.x00100010.dataOffset);
    Buffer.from(ds.byteArray).copy(bytes);
  }
  const tag = id => ds.string('x' + id)?.trim() || '';
  const tags=Object.fromEntries(Object.entries(ds.elements).filter(([id])=>/^x(0008|0010|0018|0020|0028)/.test(id)).map(([id,e])=>[id,String(e.vr==='US'?ds.uint16(id):ds.string(id)||'')]));
  return { bytes, tags, uid: tag('0020000d'), seriesUID: tag('0020000e'), sopUID: tag('00080018'),
    patient: tag('00100010').replaceAll('^', ' '), patientId: tag('00100020'), birth: tag('00100030'),
    date: tag('00080020'), modality: tag('00080060'), name: tag('0008103e'), number: tag('00200011') };
}
const archived = fixture('abdomen'), disc = fixture('thorax');
const value = (v, vr = 'LO') => ({ vr, Value: [v] });
const study = { uid: archived.uid, patient: archived.patient, patientId: archived.patientId, birth: archived.birth,
  date: archived.date, time: '', modality: archived.modality, description: 'Synthetic archive study',
  accession: '', referring: '', imageCount: 1, size: archived.bytes.length, addedAt: 0, openedAt: null, storage: 'disk',
  series: [{ uid: archived.seriesUID, number: archived.number, modality: archived.modality,
    description: archived.name, protocol: '', imageCount: 1, addedAt: 0 }] };
const secondStudy={...study,uid:disc.uid,patient:disc.patient,patientId:disc.patientId,series:[{...study.series[0],uid:disc.seriesUID,description:disc.name}]};
let server, browser, releasePacs;
const pacsGate = new Promise(resolve => { releasePacs = resolve; });
let serverOutput = '';
try {
  const port = await freePort(), workerPort = await freePort(), archivePort = await freePort();
  const base = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, ['scripts/start-release.mjs'], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, RADAZ_PORT: String(port), RADAZ_WORKER_PORT: String(workerPort), RADAZ_ARCHIVE_PORT: String(archivePort) } });
  server.stdout.on('data', data => { serverOutput += data; });
  server.stderr.on('data', data => { serverOutput += data; });
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (server.exitCode !== null) throw Error(serverOutput);
    try { if ((await fetch(base, { signal: AbortSignal.timeout(1000) })).ok) { ready = true; break; } } catch {}
    await delay(200);
  }
  assert.ok(ready, 'Runtime startup: ' + serverOutput);
  browser = await chromium.launch({ headless: true, channel: 'msedge' });
  const context = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  context.setDefaultTimeout(20000);
  // Reproduce the persisted setting left behind by an older release.
  await context.addInitScript(origin => {
    if (location.origin !== origin) return;
    localStorage.setItem('radaz-cd-auto', '1');
    localStorage.setItem('radaz-pacs-config-v1', JSON.stringify({ selected: 'test', aeTitle: 'RADAZ', listenerPort: '11112',
      locations: [{ id: 'test', host: '', port: '11112', aeTitle: 'TEST', description: 'Synthetic PACS', dicomwebUrl: location.origin + '/test-pacs' }] }));
  }, base);
  const errors = [], mediaRequests = [], pacsRequests = [], maximizeRequests=[];
  let pickers = 0;
  context.on('page', page => { page.on('pageerror', error => errors.push(error.message)); page.on('filechooser', () => pickers++); });
  context.on('request', request => {
    if (request.url().includes('/removable/')) mediaRequests.push({ page: request.frame().page(), url: request.url() });
    if (request.url().includes('/test-pacs/')) pacsRequests.push(request.url());
  });
  await context.route('**/local-archive-api/**', async route => {
    const path = new URL(route.request().url()).pathname.slice('/local-archive-api'.length);
    const json = body => route.fulfill({ json: body });
    if (path === '/license') return json({ valid: true, required: true, kind: 'owner', message: 'Synthetic license', deviceId: 'TEST' });
    if (path === '/status') return json({ capabilities: [], aeTitle: 'TEST', port: 11112, enabled: false, running: false, error: '', addresses: [], databasePath: '', storagePath: '', instanceCount: 1, size: archived.bytes.length });
    if (path === '/window/maximize') {maximizeRequests.push(JSON.parse(route.request().postData()));return json({maximized:true});}
    if (path === '/studies') return json([study,secondStudy]);
    if (path === '/instances') return json([{ uid: route.request().url().includes(disc.uid)?disc.sopUID:archived.sopUID }]);
    if (path.startsWith('/file/')) return route.fulfill({ contentType: 'application/dicom', body: path.includes(disc.sopUID)?disc.bytes:archived.bytes });
    if (path === '/opened' || path === '/import' || path === '/removable/close') return json({ ok: true });
    if (path === '/removable/watch') return json({ sessions: [{ id: 'synthetic-cd', label: 'Synthetic disc', stage: 'ready', scanned: 1, total: 1, error: '', dicomdir: false }] });
    if (path === '/removable/entries') return json({ next: 1, items: [{ id: 'image-1', tags:disc.tags, studyId: disc.uid, seriesUID: disc.seriesUID,
      sopUID: disc.sopUID, name: disc.name, modality: disc.modality, patient: disc.patient, patientId: disc.patientId,
      birth: disc.birth, date: disc.date, number: disc.number, instance: 1, size: disc.bytes.length, decodedBytes: 524288 }] });
    if (path.startsWith('/removable/file/')) return route.fulfill({ contentType: 'application/dicom', body: disc.bytes });
    return route.fulfill({ status: 404, json: { error: 'Unexpected fixture endpoint: ' + path } });
  });
  await context.route('**/test-pacs/**', async route => {
    const path = new URL(route.request().url()).pathname;
    const item=path.includes(disc.uid)?disc:archived;
    if (path === '/test-pacs/studies') return route.fulfill({ json: [archived,disc].map(item=>({ '0020000D': value(item.uid, 'UI'),
      '00100010': value({ Alphabetic: item.patient }, 'PN'), '00100020': value(item.patientId),
      '00080020': value(item.date, 'DA'), '00080061': value(item.modality), '00201206': value(1, 'IS'), '00201208': value(1, 'IS') })) });
    if (path.endsWith('/series')) {
      await pacsGate;
      return route.fulfill({ json: [{ '0020000E': value(item.seriesUID, 'UI'), '00200011': value(item.number, 'IS'),
        '00080060': value(item.modality), '0008103E': value(item.name), '00201209': value(1, 'IS') }] });
    }
    if (path.endsWith('/instances')) return route.fulfill({ json: [{ '00080018': value(item.sopUID, 'UI') }] });
    return route.fulfill({ contentType: 'application/dicom', body: item.bytes });
  });
  const button = page => page.getByRole('button', { name: 'CD/DVD import', exact: true });
  const noAutoImport = async page => {
    await page.locator('.statusbar').filter({ hasText: 'Cornerstone3D hazırdır' }).waitFor();
    assert.equal(await button(page).getAttribute('aria-pressed'), 'false', 'Disc import must start off even with the legacy stored preference');

    assert.equal(await page.locator('.media-import-progress').count(), 0);
  };
  const discViewer = await context.newPage();
  await discViewer.goto(base);
  await noAutoImport(discViewer);
  await button(discViewer).click();
  await discViewer.locator('[data-panel="A"][data-has-image="true"]').waitFor();
  assert.equal(await button(discViewer).getAttribute('aria-pressed'), 'true');
  assert.ok(mediaRequests.some(request => request.page === discViewer && request.url.includes('/removable/file/')));

  const popup=context.waitForEvent('page');await discViewer.getByRole('button',{name:'Local arxiv',exact:true}).click();const archivePage=await popup;
  await archivePage.waitForLoadState();
  await archivePage.getByRole('checkbox', { name: 'Bu gün', exact: true }).uncheck();
  const existingCount=context.pages().length,archiveViewer=discViewer;
  await archivePage.getByRole('cell').filter({hasText:archived.patient}).dblclick();
  await archiveViewer.waitForURL('**/#archive-studies=*');
  await archiveViewer.locator('[data-panel="A"][data-has-image="true"]').waitFor();
  assert.equal(context.pages().length,existingCount,'Archive replaces disc in existing Viewer');
  assert.equal(await button(archiveViewer).getAttribute('aria-pressed'),'true');
  assert.equal(await archiveViewer.locator('.series-card').count(),2);
  const discReads=mediaRequests.filter(r=>r.url.includes('/removable/file/')).length;
  await archivePage.waitForTimeout(250);assert.ok(maximizeRequests.length>=1);assert.match(maximizeRequests[0].token,/^RADAZ_VIEWER_[a-f0-9]{32}$/);assert.equal(await archivePage.title(),'RADAZ · Local arxiv');
  console.log('PASS: archive reuses Viewer and keeps its explicit disc import running.');

  const pacsPage = await context.newPage();
  await pacsPage.goto(base + '/pacs');
  await pacsPage.getByRole('checkbox', { name: 'Bu gün', exact: true }).uncheck();
  await pacsPage.getByRole('button', { name: 'Axtar', exact: true }).click();
  const pacsViewer=discViewer;
  await pacsPage.getByRole('cell').filter({hasText:archived.patient}).dblclick();
  await pacsViewer.getByRole('progressbar',{name:'PACS yüklənir',exact:true}).waitFor();
  const downloaded=pacsPage.waitForResponse(response=>response.url().includes('/test-pacs/')&&response.url().includes('/instances/'));
  assert.equal(await button(pacsViewer).getAttribute('aria-pressed'),'true');releasePacs();await downloaded;
  await pacsPage.locator('.records-spinner').waitFor({state:'hidden'});
  await pacsViewer.locator('.statusbar').filter({hasText:'1 DICOM görüntüsü yükləndi'}).waitFor();
  assert.equal(context.pages().length,existingCount+1,'PACS uses the existing Viewer');
  assert.equal(await pacsViewer.locator('.series-card').count(),2);
  assert.ok(pacsRequests.some(url=>url.includes('/instances/')));
  await archiveViewer.reload();await archiveViewer.locator('[data-panel="A"][data-has-image="true"]').waitFor();
  await noAutoImport(archiveViewer);
  for(const records of [archivePage,pacsPage]){
    const table=records.getByRole('table',{name:records===archivePage?'Arxiv müayinələri':'PACS müayinələri',exact:true});
    await table.getByRole('checkbox',{name:'Hamısını seç',exact:true}).check();
    const before=context.pages().length;

    if(records===archivePage)await records.getByRole('button',{name:'Seçilmişləri aç (2)',exact:true}).click();
    else await table.getByRole('cell').filter({hasText:archived.patient}).dblclick();
    const selected=discViewer;
    await selected.waitForURL('**/#archive-studies=*');
    await selected.waitForFunction(()=>document.querySelectorAll('.series-card').length===2);
    await selected.locator('.statusbar').filter({hasText:'2 DICOM görüntüsü yükləndi'}).waitFor();
    assert.equal(context.pages().length,before,'Same Viewer for the whole selection');
    await noAutoImport(selected);
  }
  console.log('PASS: archive checkbox group and PACS checkbox double-click open exactly two selected studies in one Viewer');
  assert.equal(mediaRequests.filter(r=>r.url.includes('/removable/file/')).length,discReads,'Archive/PACS/reload never restart disc reads');
  assert.equal(pickers, 0);
  assert.deepEqual(errors, []);
  console.log('PASS: legacy preference ignored; explicit CD import survives other study opens; archive click, PACS pending/download/open and reload never start disc import; all opens reuse the same Viewer.');
} catch (error) {
  console.error(error.message);
  mkdirSync('outputs/media-scope', { recursive: true });
  for (const [index, page] of (browser?.contexts()[0]?.pages() || []).entries()) {
    console.error(`PAGE ${index}: ${page.url()}`, await page.locator('.statusbar').allTextContents());
    await page.screenshot({ path: `outputs/media-scope/failure-${index}.png` }).catch(() => {});
  }
  throw error;
} finally {
  releasePacs();
  await browser?.close();
  if (server?.pid) spawnSync('taskkill.exe', ['/PID', String(server.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
}
