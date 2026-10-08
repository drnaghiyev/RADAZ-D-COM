import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function digestFiles(root, inputs) {
  const hash = createHash('sha256');
  const visit = relative => {
    const absolute = path.join(root, relative);
    if (!existsSync(absolute)) return;
    for (const entry of readdirSync(absolute, { withFileTypes: true }).sort((a,b) => a.name.localeCompare(b.name))) {
      const name = `${relative}/${entry.name}`;
      if (entry.isDirectory()) visit(name);
      else if (entry.isFile() && entry.name !== 'radaz-build.json') { hash.update(name); hash.update(readFileSync(path.join(root, name))); }
    }
  };
  for (const input of inputs) {
    if (input.endsWith('/')) visit(input.slice(0,-1));
    else if (existsSync(path.join(root,input))) { hash.update(input); hash.update(readFileSync(path.join(root,input))); }
  }
  return hash.digest('hex');
}

export const sourceHash = root => digestFiles(root, ['app/','components/','lib/','public/','scripts/','package.json','pnpm-lock.yaml','vite.config.ts','tsconfig.json','postcss.config.mjs']);
export function writeBuildIdentity(root, expectedSource) {
  const current = sourceHash(root);
  if (current !== expectedSource) throw new Error('Source changed during build. Build RADAZ again.');
  const product = JSON.parse(readFileSync(path.join(root, 'public/product.json'), 'utf8'));
  const assets = {};
  for (const name of readdirSync(path.join(root, 'dist/client'), {recursive:true}).sort()) {
    const relative = name.replaceAll('\\', '/');
    // product.json is served from the immutable build identity by the gateway.
    if (['product.json','vinext-client-entry-manifest.json'].includes(relative) || relative.endsWith('.map') || relative.split('/').some(part => part.startsWith('.'))) continue;
    const file = path.join(root, 'dist/client', name);
    if (!statSync(file).isFile()) continue;
    const raw = readFileSync(file);
    assets['/' + relative] = {sha256:createHash('sha256').update(raw).digest('hex'), size:raw.length};
  }
  const result = { product, assets, healthProtocol:1, sourceHash: current, buildId: createHash('sha256').update(current).update(digestFiles(root, ['dist/client/','dist/server/','dist/runtime/','dist/node_modules/'])).digest('hex') };
  writeFileSync(path.join(root, 'dist/server/radaz-build.json'), JSON.stringify(result, null, 2));
  return result;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(sourceHash(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')));
}
