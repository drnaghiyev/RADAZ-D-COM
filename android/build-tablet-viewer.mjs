// Compile the tablet UI from the same release as Windows, in an Android-only staging area.
import {createHash} from 'node:crypto';
import {spawnSync,execFileSync} from 'node:child_process';
import {readFileSync, writeFileSync, appendFileSync, copyFileSync, mkdirSync, existsSync, symlinkSync, realpathSync, mkdtempSync, unlinkSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const project = path.dirname(fileURLToPath(import.meta.url));
const checkout = path.resolve(process.argv[2]);
const destination = path.resolve(process.argv[3]);
const commit = execFileSync('git',['rev-parse','--verify','HEAD'],{cwd:checkout,encoding:'utf8'}).trim();
const components = ['tablet-layout.tsx','tablet-layout.css','tablet-inbox.ts','tablet-volume-window.tsx'];
const inputs = ['viewer.patch','archive-incoming.ts',...components];
const digest = createHash('sha256').update(commit).update(readFileSync(fileURLToPath(import.meta.url)));
for (const input of inputs) digest.update(readFileSync(path.join(project,input)));
const cache = path.join(project,'build','viewer-' + digest.digest('hex').slice(0,16));
const marker = path.join(cache,'ready.txt');
function run(exe,args,cwd,environment={}) {
  const result = spawnSync(exe,args,{cwd,env:{...process.env,...environment},windowsHide:true,stdio:'inherit'});
  if (result.error || result.status !== 0) throw result.error || Error(exe+' failed ('+result.status+')');
}
if (!existsSync(marker)) {
  mkdirSync(cache,{recursive:true});
  const work = mkdtempSync(path.join(cache,'source-'));
  const archive = path.join(work,'source.tar');
  const sourcePaths = ['.openai','app','components','hooks','lib','offline','scripts','build','db','types','cloudflare-env.d.ts','vendor/shadcn-tailwind-4.13.0.css','public','bridge/radiology-profile.json','package.json','pnpm-lock.yaml','vite.config.ts','next.config.ts','postcss.config.mjs','tsconfig.json','components.json'];
  run('git',['archive',commit,'--format=tar','--output',archive,'--',...sourcePaths],checkout);
  run('tar',['-xf',archive],work);
  unlinkSync(archive);
  run('git',['apply','--no-index','--whitespace=nowarn',path.join(project,'viewer.patch')],work,{GIT_CEILING_DIRECTORIES:cache});
  for (const input of components) copyFileSync(path.join(project,input),path.join(work,'components',input));
  appendFileSync(path.join(work,'lib','local-archive.ts'),'\n'+readFileSync(path.join(project,'archive-incoming.ts'),'utf8'));
  symlinkSync(realpathSync(path.join(checkout,'node_modules')),path.join(work,'node_modules'),'junction');
  run(process.execPath,['node_modules/typescript/bin/tsc','--noEmit','--incremental','false'],work);
  run(process.execPath,['scripts/run-framework.mjs','build'],work);
  writeFileSync(marker,path.basename(work));
}
run(process.execPath,[path.join(project,'prepare-viewer.mjs'),path.join(cache,readFileSync(marker,'utf8')),destination],project);
