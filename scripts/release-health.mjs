import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import path from 'node:path';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export function verifyClientFiles(root, build) {
  if (build.healthProtocol !== 1 || !build.assets || !Object.keys(build.assets).some(p => p.endsWith('.js')) || !Object.keys(build.assets).some(p => p.endsWith('.css'))) throw Error('Client asset manifest missing JS/CSS');
  const base = path.resolve(root, 'dist/client');
  for (const [url, expected] of Object.entries(build.assets)) {
    const file = path.resolve(base, '.' + url);
    if (!url.startsWith('/') || !file.startsWith(base + path.sep)) throw Error('Unsafe client asset: ' + url);
    const bytes = readFileSync(file);
    if (bytes.length !== expected.size || hash(bytes) !== expected.sha256) throw Error('Client asset SHA-256 mismatch: ' + url);
  }
}

export async function verifyClientHttp(base, build) {
  const urls = Object.keys(build.assets);
  let index = 0;
  await Promise.all(Array.from({length:8}, async () => {
    while (index < urls.length) {
      const url = urls[index++], expected = build.assets[url];
      const response = await fetch(base + url, {cache:'no-store', signal:AbortSignal.timeout(5000)});
      if (response.status !== 200) throw Error(`Asset HTTP ${response.status}: ${url}`);
      const mime = response.headers.get('content-type') || '';
      const required = url.endsWith('.js') ? /javascript/ : url.endsWith('.css') ? /text\/css/ : url.endsWith('.wasm') ? /application\/wasm/ : null;
      if (required && !required.test(mime)) throw Error(`Asset MIME ${mime}: ${url}`);
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length !== expected.size || hash(bytes) !== expected.sha256) throw Error('Served asset SHA-256 mismatch: ' + url);
    }
  }));
  for (const route of ['/', '/archive', '/pacs', '/mpr', '/3d', '/report']) {
    const response = await fetch(base + route, {cache:'no-store', signal:AbortSignal.timeout(10000)});
    if (response.status !== 200 || !response.headers.get('content-type')?.includes('text/html')) throw Error(`Page HTTP ${response.status}: ${route}`);
    const html = await response.text();
    const scripts = [...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)].map(m => m[1]);
    if (!scripts.length) throw Error('Page has no JavaScript: ' + route);
    const resources = [...scripts, ...[...html.matchAll(/<link\b[^>]*\bhref="([^"]+\.css(?:\?[^"]*)?)"/g)].map(m => m[1])];
    for (const reference of resources) {
      const url = new URL(reference.replaceAll('&amp;', '&'), base);
      if (url.origin !== new URL(base).origin || !build.assets[url.pathname]) throw Error(`Unlisted page resource ${reference}: ${route}`);
    }
  }
  return {ready:true, buildId:build.buildId, version:build.product.version, assetCount:urls.length};
}
