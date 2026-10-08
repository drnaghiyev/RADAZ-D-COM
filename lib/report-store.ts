export type SavedReport = {
  studyUID: string;
  patient: string;
  birth: string;
  date: string;
  modality: string;
  studyDescription: string;
  header: string;
  body: string;
  bodyHtml?: string;
  logoData?: string;
  notes: Record<string, string>;
  aiInstruction?: string;
  updatedAt: number;
};

function openReports(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('radaz-report-drafts', 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains('reports')) request.result.createObjectStore('reports', { keyPath: 'studyUID' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Hesabat arxivi açıla bilmədi'));
  });
}

export async function listSavedReports(): Promise<SavedReport[]> {
  const db = await openReports();
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction('reports').objectStore('reports').getAll();
      request.onsuccess = () => resolve((request.result as SavedReport[]).sort((a, b) => b.updatedAt - a.updatedAt));
      request.onerror = () => reject(request.error);
    });
  } finally { db.close(); }
}

export async function loadSavedReport(studyUID: string): Promise<SavedReport | undefined> {
  const db = await openReports();
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction('reports').objectStore('reports').get(studyUID);
      request.onsuccess = () => resolve(request.result as SavedReport | undefined);
      request.onerror = () => reject(request.error);
    });
  } finally { db.close(); }
}

export async function saveReport(report: SavedReport): Promise<void> {
  const db = await openReports();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction('reports', 'readwrite');
      transaction.objectStore('reports').put(report);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error || new Error('Hesabat saxlanmadı'));
      transaction.onabort = () => reject(transaction.error || new Error('Hesabat saxlanmadı'));
    });
  } finally { db.close(); }
}

export function reportPlainText(report: Pick<SavedReport, 'patient' | 'birth' | 'date' | 'modality' | 'header' | 'body'>): string {
  return [report.header.trim(), `Pasiyent: ${report.patient || '—'}`, `Təvəllüd: ${report.birth || '—'}`,
    `Müayinə tarixi: ${report.date || '—'}`, `Müayinə: ${report.modality || '—'}`, '', report.body.trim()]
    .filter((line, index) => index !== 0 || !!line).join('\n');
}

export async function exportReportWord(report: SavedReport): Promise<void> {
  const { buildReportDocx } = await import('./report-word');
  const blob = await buildReportDocx(report);
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `RADAZ-hesabat-${report.date || 'tarixsiz'}.docx`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30000);
}
