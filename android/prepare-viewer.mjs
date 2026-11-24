// Read a complete RADAZ production build. All generated files stay inside the Android project.
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {copyFile, mkdir, readFile, writeFile} from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';

const project = path.dirname(fileURLToPath(import.meta.url));
const release = path.resolve(process.argv[2]);
const target = path.resolve(process.argv[3]);
const manifest = JSON.parse(await readFile(path.join(release, 'dist/server/radaz-build.json'), 'utf8'));
const product=JSON.parse(await readFile(path.join(release,'public/product.json'),'utf8'));
if (manifest.product.version!==product.version) throw new Error('Tablet UI version differs from the release.');

const web = path.join(target, 'web');
await mkdir(web, {recursive:true});
for (const [url, record] of Object.entries(manifest.assets)) {
  if (!/^\/(?:_next\/static\/|dicom-codecs\/|dicom-lite\/|anatomy\/|(?:radaz-[\w-]+|favicon|rotate-cursor)\.(?:svg|png|js)$|product\.json$)/.test(url)) continue;
  const source = path.join(release, 'dist/client', url.slice(1));
  const bytes = await readFile(source);
  if (bytes.length !== record.size || createHash('sha256').update(bytes).digest('hex') !== record.sha256) {
    throw new Error('RADAZ build integrity error: ' + url);
  }
  const file = path.join(web, url.slice(1));
  await mkdir(path.dirname(file), {recursive:true});
  await writeFile(file, bytes);
}
await writeFile(path.join(web, 'product.json'), JSON.stringify(manifest.product));
await writeFile(path.join(web, 'radaz-runtime.json'), JSON.stringify({name:'RADAZ',version:manifest.product.version,buildId:manifest.buildId,activationComplete:true}));
await copyFile(path.join(project, 'tablet.js'), path.join(web, 'tablet.js'));

// Render static shells using just the UI worker on loopback, without starting the archive or reading studies.
const socket = net.createServer();
await new Promise((ok, fail) => socket.once('error', fail).listen(0, '127.0.0.1', ok));
const port = socket.address().port;
await new Promise(ok => socket.close(ok));
const worker = spawn(process.execPath, [path.join(release, 'dist/runtime/web-server.mjs')], {
  cwd:release, windowsHide:true, env:{...process.env,NODE_ENV:'production',RADAZ_WORKER_PORT:String(port)}, stdio:['ignore','ignore','pipe']
});
let diagnostic = '';
worker.stderr.on('data', data => {diagnostic = (diagnostic + data).slice(-1500);});
try {
  const base = 'http://127.0.0.1:' + port;
  let ready = false;
  for (let t = 0; t < 100; t++) {
    if (worker.exitCode !== null) throw new Error('RADAZ renderer stopped: ' + diagnostic);
    try { if ((await fetch(base + '/product.json', {signal:AbortSignal.timeout(1000)})).ok) {ready = true; break;} } catch {}
    await delay(200);
  }
  if (!ready) throw new Error('RADAZ renderer did not start');
  const routes = ['/', '/mpr', '/3d', '/archive', '/pacs', '/stitch', '/print', '/printer-settings', '/report', '/media', '/voice', '/chatgpt-help', '/private-network', '/private-network/settings'];
  const flight = path.join(target,'flight');
  await mkdir(flight, {recursive:true});
  for (const route of routes) {
    const response = await fetch(base + route);
    if (!response.ok) throw new Error('Missing RADAZ route ' + route);
    const html = await response.text();
    if (!html.includes('/_next/static/') || !html.includes('</head>')) throw new Error('Invalid route ' + route);
    const folder = path.join(web, route.slice(1));
    await mkdir(folder, {recursive:true});
    await writeFile(path.join(folder, 'index.html'), html.replace('</head>', '<script defer src="/tablet.js"></script></head>'));
    const rsc = await fetch(base + route, {headers:{RSC:'1',Accept:'text/x-component'}});
    if (rsc.ok && rsc.headers.get('content-type')?.includes('text/x-component')) {
      await writeFile(path.join(flight, (route.slice(1).replaceAll('/','-') || 'index') + '.rsc'), Buffer.from(await rsc.arrayBuffer()));
    }
  }
  console.log('Packed original viewer ' + manifest.product.version + ' (' + routes.length + ' routes).');
} finally {
  worker.kill();
}
