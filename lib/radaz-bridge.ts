import { getArchiveFiles } from './local-archive';
import { streamRemoteStudy } from './dicomweb';
import type { DimseLocation } from './pacs-bridge';

export type BridgeTarget = DimseLocation & { callingAe: string };
export type BridgeStudy = { uid: string; patient: string; count: number; storage?: 'disk' | 'browser' };
export type BridgePacs = DimseLocation & { callingAe: string; listenerPort: string; dicomwebUrl: string; token: string };
export type BridgeJob = { id: string; state: 'running' | 'receiving' | 'completed' | 'warning' | 'failed' | 'cancelled'; sent: number; total: number; warnings: number; error: string; cancelled: boolean };

export async function bridgeApi<T>(path: string, body?: unknown, file?: File): Promise<T> {
  const response = await fetch(`/local-archive-api/bridge/${path}`, {
    method: body !== undefined || file ? 'POST' : 'GET', cache: 'no-store',
    headers: file ? { 'Content-Type': 'application/dicom' } : body !== undefined ? { 'Content-Type': 'application/json' } : {},
    body: file || (body !== undefined ? JSON.stringify(body) : undefined), signal: AbortSignal.timeout(file ? 150000 : 20000),
  });
  const result: unknown = await response.json().catch(() => null);
  if (!response.ok) throw Error(result && typeof result === 'object' && 'error' in result ? String(result.error) : 'RADAZBRIDGE xidməti əlçatan deyil. RADAZ yenilənməsini quraşdırıb proqramı yenidən açın.');
  return result as T;
}

export async function sendBridgeStudy(study: BridgeStudy, target: BridgeTarget, pacs: BridgePacs | undefined,
  report: (job: BridgeJob) => void, cancelled: () => boolean, register: (id: string) => void): Promise<BridgeJob> {
  const source = pacs ? pacs.dicomwebUrl ? 'upload' : 'dimse' : study.storage === 'disk' ? 'disk' : 'upload';
  let job = await bridgeApi<BridgeJob>('start', {
    target, source, studyUID: study.uid, expected: study.count,
    // DICOMweb tokens stay in the browser and are never sent to the local bridge.
    ...(source === 'dimse' && pacs ? { pacs: { host: pacs.host, port: pacs.port, aeTitle: pacs.aeTitle, callingAe: pacs.callingAe, listenerPort: pacs.listenerPort } } : {}),
  });
  register(job.id); report(job);
  try {
    if (source === 'upload') {
      const files = pacs ? streamRemoteStudy(pacs.dicomwebUrl, pacs.token, study.uid, study.count) : await getArchiveFiles(study.uid);
      for await (const file of files) {
        if (cancelled()) break;
        job = await bridgeApi<BridgeJob>(`file?id=${encodeURIComponent(job.id)}`, undefined, file);
        report(job);
      }
      job = await bridgeApi<BridgeJob>(cancelled() ? 'cancel' : 'finish', { id: job.id });
    }
    while (job.state === 'running' || job.state === 'receiving') {
      if (cancelled() && !job.cancelled) await bridgeApi('cancel', { id: job.id });
      await new Promise(resolve => setTimeout(resolve, 500));
      job = await bridgeApi<BridgeJob>(`job?id=${encodeURIComponent(job.id)}`);
      report(job);
    }
    report(job);
    if (job.state === 'failed') throw Error(job.error);
    return job;
  } catch (error) {
    // Do not silently retry a C-STORE whose acknowledgement may have been lost.
    await bridgeApi('cancel', { id: job.id }).catch(() => undefined);
    const last = await bridgeApi<BridgeJob>(`job?id=${encodeURIComponent(job.id)}`).catch(() => null);
    if (last) report(last);
    throw error;
  }
}
