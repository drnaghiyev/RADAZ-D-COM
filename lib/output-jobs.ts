export type PrintFrame = { id: string; name: string; blob: Blob; overlay?: Blob; width: number; height: number };
export type OutputJob = { id: string; created: number; frames?: PrintFrame[]; files?: File[]; title: string };
export const outputId = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('');

async function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('radaz-output-jobs', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('jobs', { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
}
export async function saveOutputJob(job: Omit<OutputJob, 'id' | 'created'>) {
  const db = await database(), id = outputId();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('jobs', 'readwrite'), store = tx.objectStore('jobs');
      const cursor = store.openCursor();
      cursor.onsuccess = () => { const value = cursor.result; if (value) { if (value.value.created < Date.now() - 7 * 86400000) value.delete(); value.continue(); } };
      store.put({ ...job, id, created: Date.now() });
      tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error);
    }); return id;
  } finally { db.close(); }
}
export async function readOutputJob(id: string): Promise<OutputJob | undefined> {
  const db = await database();
  try { return await new Promise((resolve, reject) => { const r = db.transaction('jobs').objectStore('jobs').get(id); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); }); }
  finally { db.close(); }
}

export async function outputRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/local-archive-api${path}`, { ...init, cache: 'no-store' });
  const result = await response.json().catch(() => null) as { error?: string } | null;
  if (!response.ok || !result) throw new Error(result?.error || 'Lokal xidmət cavab vermir. START-RADAZ.cmd ilə başladın.');
  return result as T;
}
