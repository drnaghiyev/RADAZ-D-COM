import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { readExecutionProfile } from "./execution-profile.mjs";
import { sourceHash, writeBuildIdentity } from './build-identity.mjs';

const [command, ...args] = process.argv.slice(2);
if (!["dev", "build"].includes(command)) throw new Error("Expected dev or build.");
await import('./prepare-dicom-codecs.mjs');
if(command==='build')await import('./build-dicom-lite.mjs');
const managedLinux = readExecutionProfile() === "managed-linux";

if (managedLinux && command === "build") {
  const result = spawnSync("bash", [
    fileURLToPath(new URL("./build-verified.sh", import.meta.url)), ...args,
  ], { stdio: "inherit" });
  if (result.error) throw result.error;
  process.exit(result.status ?? 1);
}

if (process.platform === 'win32' && command === 'dev' && !managedLinux) {
  const archive = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', fileURLToPath(new URL('./start-archive.ps1', import.meta.url))], { windowsHide: true, stdio: 'inherit' });
  if (archive.status !== 0) console.warn('RADAZ permanent archive unavailable; browser archive remains available.');
}

// Import in this process so the preview owner retains its PID and signals.
const cli = new URL(managedLinux
  ? "../node_modules/vite/bin/vite.js"
  : "../node_modules/vinext/dist/cli.js", import.meta.url);
if (command === 'build' && !managedLinux) {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const expectedSource = sourceHash(root);
  const result = spawnSync(process.execPath, [fileURLToPath(cli), command, ...args], { stdio: 'inherit', windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
  const bundle = spawnSync(process.execPath, [fileURLToPath(new URL('./bundle-runtime.mjs', import.meta.url))], {stdio:'inherit',windowsHide:true});
  if (bundle.status !== 0) process.exit(bundle.status ?? 1);
  const build = writeBuildIdentity(root, expectedSource);
  console.log(`RADAZ ${build.product.version} build ${build.buildId.slice(0,12)}`);
  process.exit(0);
}
process.argv = [process.execPath, fileURLToPath(cli), command,
  ...(!managedLinux && command === "dev" ? ["--port", "5173"] : []), ...args];
await import(cli.href);
