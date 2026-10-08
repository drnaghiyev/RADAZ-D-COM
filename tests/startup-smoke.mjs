// Run after a portable build. Exercise the actual packaged runtime and proxy.
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
const product = JSON.parse(readFileSync('public/product.json', 'utf8'));
const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
const close = server => new Promise(resolve => server.close(resolve));
async function freePort() { const server = http.createServer(); const port = await listen(server); await close(server); return port; }
const fixture = http.createServer((req, res) => {
  let body = ''; req.on('data', chunk => { body += chunk; });
  req.on('end', () => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ path: req.url, method: req.method, body })); });
});
const archivePort = await listen(fixture);
function launch(port, workerPort) {
  const child = spawn(process.execPath, ['scripts/start-release.mjs'], { windowsHide: true, env: {
    ...process.env, RADAZ_PORT: String(port), RADAZ_WORKER_PORT: String(workerPort), RADAZ_ARCHIVE_PORT: String(archivePort),
  }, stdio: ['ignore', 'pipe', 'pipe'] });
  child.output = ''; child.stdout.on('data', data => { child.output += data; }); child.stderr.on('data', data => { child.output += data; });
  return child;
}
async function ready(child, base) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (child.exitCode !== null) throw new Error(child.output);
    try {
      const result = await fetch(`${base}/product.json`, { signal: AbortSignal.timeout(1000) });
      if (result.ok && (await result.json()).version === product.version && (await fetch(`${base}/`)).status === 200) return;
    } catch {}
    await delay(200);
  }
  throw new Error(`Startup timed out: ${child.output}`);
}
async function stop(child) {
  if (child.exitCode !== null) return;
  if (process.platform === 'win32') spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
  else child.kill('SIGTERM');
  for (let i = 0; i < 30 && child.exitCode === null; i++) await delay(100);
  assert.notEqual(child.exitCode, null, 'Server process must stop');
}
try {
  for (let cycle = 0; cycle < 2; cycle++) {
    const port = await freePort(), workerPort = await freePort();
    const child = launch(port, workerPort), base = `http://127.0.0.1:${port}`;
    try {
      await ready(child, base);
      const runtime = await fetch(`${base}/radaz-runtime.json`);
      assert.equal(runtime.headers.get('cache-control'), 'no-store');
      assert.equal((await runtime.json()).buildId, JSON.parse(readFileSync('dist/server/radaz-build.json','utf8')).buildId);
      const health=await fetch(base+'/radaz-health.json');assert.equal(health.status,200);assert.equal((await health.json()).ready,true);
      assert.equal((await fetch(base+'/_next/static/chunks/old-missing.js')).status,404);
      for (const route of ['/', '/archive', '/pacs', '/mpr', '/3d', '/report']) {
        const response = await fetch(`${base}${route}`);
        assert.equal(response.status, 200, route);
        assert.equal(response.headers.get('cache-control'), 'no-store');
        const html = await response.text(); assert.match(html, /RADAZ/);
        assert.match(html, /meta name="radaz-build"/);assert.match(html,/radaz-boot.js\?build=/);
        const script = html.match(/src="([^" ]+\.js)"/);
        assert.ok(script, `Built JavaScript missing: ${route}`);
        assert.equal((await fetch(new URL(script[1], base))).status, 200, 'Built asset must load');
      }
      const api = await fetch(`${base}/local-archive-api/probe?check=1`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"synthetic":true}' });
      assert.deepEqual(await api.json(), { path: '/probe?check=1', method: 'POST', body: '{"synthetic":true}' });
      assert.doesNotMatch(child.output, /miniflare|workerd|wrangler|fetch failed|ECONNRESET/i);
      console.log(`Node runtime startup ${cycle + 1}: six routes, built assets and archive proxy passed`);
    } finally { await stop(child); }
  }
  const occupied = http.createServer();
  const port = await new Promise(resolve => occupied.listen(0, '0.0.0.0', () => resolve(occupied.address().port)));
  const child = launch(port, await freePort());
  try {
    for (let i = 0; i < 100 && child.exitCode === null; i++) await delay(100);
    assert.ok(child.exitCode !== null && child.exitCode !== 0, `A busy viewer port must fail instead of leaving a hidden server: ${child.output}`);
    assert.match(child.output, /EADDRINUSE/);
    console.log('Busy-port startup exits with an error');
  } finally { await stop(child); await close(occupied); }
} finally { await close(fixture); }
