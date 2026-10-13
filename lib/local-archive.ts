import {dicomSeriesName} from './dicom-description';
import { deleteDiskStudies, diskFiles, diskStudies, diskStudyOpened, receiverStatus, saveDiskFiles, hasLocalArchiveEndpoint } from './disk-archive';
import { parseDicomFile } from './dicom-file';

const DATABASE = 'radaz-local-archive';
const VERSION = 1;

export type ArchiveSeries = {
  uid: string; number: string; modality: string; description: string; protocol: string;
  imageCount: number; addedAt: number;
};
export type ArchiveStudy = {
  storage?: 'browser' | 'disk';
  uid: string; date: string; time: string; patient: string; patientId: string; birth: string;
  modality: string; description: string; accession: string; referring: string;
  series: ArchiveSeries[]; imageCount: number; size: number; addedAt: number; openedAt: number | null;
};
type StoredInstance = {
  id: string; studyUID: string; seriesUID: string; sopUID: string; number: number;
  filename: string; file: Blob; size: number;
};

function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('studies')) db.createObjectStore('studies', { keyPath: 'uid' });
      if (!db.objectStoreNames.contains('instances')) {
        const instances = db.createObjectStore('instances', { keyPath: 'id' });
        instances.createIndex('studyUID', 'studyUID');
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Local arxiv açıla bilmədi'));
  });
}

function result<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Local arxiv əməliyyatı alınmadı'));
  });
}

function complete(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error || new Error('Arxiv yazıla bilmədi. Brauzerin boş yaddaşını yoxlayın.'));
    transaction.onerror = () => reject(transaction.error || new Error('Arxiv yazıla bilmədi'));
  });
}

async function browserListArchiveStudies(): Promise<ArchiveStudy[]> {
  const db = await database();
  try { return (await result(db.transaction('studies').objectStore('studies').getAll() as IDBRequest<ArchiveStudy[]>))
    .sort((a, b) => b.date.localeCompare(a.date) || b.addedAt - a.addedAt); }
  finally { db.close(); }
}

async function browserGetArchiveFiles(studyUID: string): Promise<File[]> {
  const db = await database();
  try {
    const saved = await result(db.transaction('instances').objectStore('instances').index('studyUID').getAll(studyUID) as IDBRequest<StoredInstance[]>);
    return saved.sort((a, b) => a.seriesUID.localeCompare(b.seriesUID) || a.number - b.number)
      .map(item => new File([item.file], item.filename || `${item.sopUID}.dcm`, { type: 'application/dicom' }));
  } finally { db.close(); }
}

async function browserRecordStudyOpened(studyUID: string): Promise<void> {
  const db = await database();
  try {
    const study = await result(db.transaction('studies').objectStore('studies').get(studyUID) as IDBRequest<ArchiveStudy | undefined>);
    if (!study) return;
    const transaction = db.transaction('studies', 'readwrite');
    const done = complete(transaction);
    transaction.objectStore('studies').put({ ...study, openedAt: Date.now() });
    await done;
  } finally { db.close(); }
}

export async function deleteArchiveStudy(studyUID: string): Promise<void> {
  const db = await database();
  try {
    const transaction = db.transaction(['studies', 'instances'], 'readwrite');
    const done = complete(transaction);
    transaction.objectStore('studies').delete(studyUID);
    const index = transaction.objectStore('instances').index('studyUID');
    const cursor = index.openKeyCursor(IDBKeyRange.only(studyUID));
    cursor.onsuccess = () => {
      const item = cursor.result;
      if (item) { transaction.objectStore('instances').delete(item.primaryKey); item.continue(); }
    };
    await done;
  } finally { db.close(); }
}

/** Remove permanent files first; a receiver failure must preserve the browser copy. */
export async function deleteLocalStudies(studies: ArchiveStudy[]) {
  let deleted = 0, pendingBytes = 0;
  for (let start = 0; start < studies.length; start += 100) {
    const batch = studies.slice(start, start + 100);
    try {
      if (hasLocalArchiveEndpoint()) {
        const result = await deleteDiskStudies(batch.map(study => study.uid));
        pendingBytes = result.pendingBytes;
      } else if (batch.some(study => study.storage === 'disk')) throw new Error('Disk arxivinə bağlantı yoxdur');
      for (const study of batch) { await deleteArchiveStudy(study.uid); deleted++; }
    } catch (error) { throw new Error(`${deleted} müayinə silindi. ${error instanceof Error ? error.message : String(error)}`); }
  }
  return `${deleted} müayinənin lokal nüsxələri silindi${pendingBytes ? ' · Bəzi fayllar kilidlidir; disk yerini tam boşaltmaq üçün arxiv xidmətini yenidən başladın.' : ''}`;
}

/** Browser cache plus, when available, the local PC's permanent disk archive. */
export async function saveArchiveFiles(files: File[], onProgress?: (done: number, total: number) => void): Promise<number> {
  const groups = new Map<string, { study: ArchiveStudy; instances: StoredInstance[]; series: Map<string, ArchiveSeries> }>();
  const now = Date.now();
  for (let index = 0; index < files.length; index++) {
    const file = files[index];
    if (file.name.split('/').pop()?.toUpperCase() === 'DICOMDIR') continue;
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const data = parseDicomFile(bytes);
      const tag = (id: string) => data.string(id)?.trim() || '';
      const studyUID = tag('x0020000d');
      const seriesUID = tag('x0020000e');
      const sopUID = tag('x00080018');
      if (!studyUID || !seriesUID || !sopUID) continue;
      let group = groups.get(studyUID);
      if (!group) {
        group = { study: {
          uid: studyUID, date: tag('x00080020'), time: tag('x00080030'),
          patient: (tag('x00100010') || 'Naməlum pasiyent').replaceAll('^', ' '),
          patientId: tag('x00100020'), birth: tag('x00100030'), modality: tag('x00080060'),
          description: tag('x00081030'), accession: tag('x00080050'),
          referring: tag('x00080090').replaceAll('^', ' '),
          series: [], imageCount: 0, size: 0, addedAt: now, openedAt: null,
        }, instances: [], series: new Map() };
        groups.set(studyUID, group);
      }
      group.instances.push({ id: `${studyUID}|${sopUID}`, studyUID, seriesUID, sopUID,
        number: Number(tag('x00200013')) || 0, filename: file.name, file, size: file.size });
      group.series.set(seriesUID, { uid: seriesUID, number: tag('x00200011') || '—',
        modality: tag('x00080060') || 'DICOM', description: dicomSeriesName(tag),
        protocol: tag('x00181030'), imageCount: 0, addedAt: now });
    } catch { /* Other files in an imported folder are ignored. */ }
    if (index % 20 === 0) onProgress?.(index + 1, files.length);
  }
  if (!groups.size) return 0;
  const db = await database();
  try {
    for (const [uid, group] of groups) {
      const read = db.transaction(['studies', 'instances']);
      const [old, existing] = await Promise.all([
        result(read.objectStore('studies').get(uid) as IDBRequest<ArchiveStudy | undefined>),
        result(read.objectStore('instances').index('studyUID').getAll(uid) as IDBRequest<StoredInstance[]>),
      ]);
      const instances = new Map(existing.map(item => [item.id, item]));
      for (const item of group.instances) instances.set(item.id, item);
      const series = new Map((old?.series || []).map(item => [item.uid, { ...item, imageCount: 0 }]));
      for (const item of group.series.values()) series.set(item.uid, { ...series.get(item.uid), ...item, addedAt: series.get(item.uid)?.addedAt || now });
      for (const item of instances.values()) {
        const entry = series.get(item.seriesUID);
        if (entry) entry.imageCount++;
      }
      const study: ArchiveStudy = {
        ...group.study, ...old,
        patient: group.study.patient || old?.patient || 'Naməlum pasiyent',
        date: group.study.date || old?.date || '',
        modality: [...new Set([...series.values()].map(item => item.modality))].join('/'),
        series: [...series.values()].sort((a, b) => Number(a.number) - Number(b.number)),
        imageCount: instances.size,
        size: [...instances.values()].reduce((sum, item) => sum + item.size, 0),
      };
      const write = db.transaction(['studies', 'instances'], 'readwrite');
      const done = complete(write);
      write.objectStore('studies').put(study);
      for (const item of group.instances) write.objectStore('instances').put(item);
      await done;
    }
  } finally { db.close(); }
  if (hasLocalArchiveEndpoint() && await receiverStatus().then(() => true).catch(() => false)) {
    const validFiles = [...groups.values()].flatMap(group => group.instances.map(instance => new File([instance.file], instance.filename, { type: 'application/dicom' })));
    await saveDiskFiles(validFiles);
  }
  onProgress?.(files.length, files.length);
  return groups.size;
}

/** Merge the existing browser archive with the permanent local receiver. */
export async function listArchiveStudies(requireDisk = false): Promise<ArchiveStudy[]> {
  const browser = await browserListArchiveStudies();
  const disk = hasLocalArchiveEndpoint() ? await diskStudies().catch(error => { if (requireDisk) throw error; return [] as ArchiveStudy[]; }) : [];
  const entries = new Map(browser.map(item => [item.uid, { ...item, storage: 'browser' as const }] as [string, ArchiveStudy]));
  for (const study of disk) entries.set(study.uid, study);
  return [...entries.values()].sort((a, b) => b.date.localeCompare(a.date) || b.addedAt - a.addedAt);
}
export async function getArchiveFiles(study: string, onProgress?: (done: number, total: number) => void): Promise<File[]> {
  const browser = await browserGetArchiveFiles(study);
  let disk: File[] = [];
  if (hasLocalArchiveEndpoint()) {
    try { disk = await diskFiles(study, onProgress); }
    catch (error) { if (!browser.length) throw error; }
  }
  const unique = new Map<string, File>();
  if (!disk.length) onProgress?.(browser.length, browser.length);
  for (const file of [...browser, ...disk]) {
    const data = parseDicomFile(new Uint8Array(await file.arrayBuffer()));
    unique.set(data.string('x00080018') || file.name, file);
  }
  return [...unique.values()];
}
export async function recordStudyOpened(study: string) {
  await browserRecordStudyOpened(study);
  if (hasLocalArchiveEndpoint()) await diskStudyOpened(study).catch(() => undefined);
}
