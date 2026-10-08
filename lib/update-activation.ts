export type UpdateDiagnostic = {phase?:string;type?:string;message?:string;version?:string;at?:number;startup?:unknown;rollback?:unknown};
export type InstallationState = {managed?:boolean;state:string;message:string;version?:string;activeVersion?:string;buildId?:string;healthy?:boolean;activationComplete?:boolean;diagnostic?:UpdateDiagnostic|null;progress?:{done:number;total:number;unit?:string}|null};
let lastDiagnostic = '';
export function reportUpdateDiagnostic(state: Pick<InstallationState,'diagnostic'>) {
  if (!state.diagnostic) return;
  const key = JSON.stringify(state.diagnostic);
  if (key === lastDiagnostic) return;
  lastDiagnostic = key;
  console.error('[RADAZ update]', state.diagnostic);
}
async function json(url:string) {
  const response = await fetch(url,{cache:'no-store',signal:AbortSignal.timeout(3000)});
  if (!response.ok) throw Error(`${url}: HTTP ${response.status}`);
  return response.json();
}
export function isActivated(target:string, status:InstallationState, runtime:{version?:string;buildId?:string}) {
  return status.managed === true && status.activationComplete === true && status.healthy === true &&
    status.activeVersion === target && runtime.version === target && !!runtime.buildId && status.buildId === runtime.buildId;
}
export async function activatedBuild(target:string):Promise<string|null> {
  const status = await json('/radaz-installation.json') as InstallationState;
  reportUpdateDiagnostic(status);
  const runtime = await json('/radaz-runtime.json') as {version?:string;buildId?:string};
  // A later feed/network error must not undo a completed, healthy activation.
  if (isActivated(target,status,runtime)) return runtime.buildId!;
  if (['error','deferred'].includes(status.state)) throw Object.assign(Error(status.message),{terminal:true});
  return null;
}
export function reloadBuild(buildId:string) {
  const url = new URL(location.href);
  url.searchParams.set('radaz-build',buildId);
  location.replace(url.href);
}
