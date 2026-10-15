/** Direct browser DICOMweb (QIDO-RS and WADO-RS) client. No PACS credentials are persisted. */
type DicomAttribute = { vr?: string; Value?: Array<string | number | { Alphabetic?: string; Ideographic?: string }> };
type DicomObject = Record<string, DicomAttribute>;

export type RemoteStudy = { uid: string; patient: string; patientId: string; date: string; modality: string; description: string; seriesCount: number; instanceCount: number };
export type RemoteSeries = { uid: string; number: string; modality: string; description: string; instanceCount: number };

function field(item: DicomObject, tag: string): string {
  const value = item[tag]?.Value?.[0];
  if (typeof value === 'object') return value.Alphabetic?.replaceAll('^', ' ') || value.Ideographic || '';
  return value == null ? '' : String(value).replaceAll('^', ' ');
}

function baseURL(raw: string): string {
  const url = new URL(raw.trim());
  if (url.protocol !== 'https:' && !(location.protocol === 'http:' && url.protocol === 'http:'))
    throw new Error('DICOMweb üçün HTTPS ünvanı daxil edin');
  if (url.username || url.password) throw new Error('İstifadəçi adı və şifrəni URL-də yazmayın');
  return url.href.replace(/\/$/, '');
}

async function request(url: string, token: string, accept: string): Promise<Response> {
  try {
    const response = await fetch(url, { headers: { Accept: accept, ...(token ? { Authorization: `Bearer ${token}` } : {}) }, cache: 'no-store', signal: AbortSignal.timeout(120000) });
    if (!response.ok) throw new Error(`PACS HTTP ${response.status}: ${response.statusText || 'sorğu alınmadı'}`);
    return response;
  } catch (error) {
    if (error instanceof TypeError) throw new Error('DICOMweb əlaqəsi alınmadı. HTTPS ünvanı, şəbəkə və PACS CORS icazəsini yoxlayın.');
    throw error;
  }
}

async function query(url: string, token: string): Promise<DicomObject[]> {
  const response = await request(url, token, 'application/dicom+json');
  if (response.status === 204) return [];
  const payload: unknown = await response.json();
  if (!Array.isArray(payload)) throw new Error('PACS DICOM JSON siyahısı qaytarmadı');
  return payload as DicomObject[];
}

export async function queryRemoteStudies(endpoint: string, token = '', patient = '', dateFrom = '', dateTo = '', modalities: string[] = []): Promise<RemoteStudy[]> {
  const url = new URL(`${baseURL(endpoint)}/studies`);
  url.searchParams.set('limit', '100');
  if (patient.trim()) url.searchParams.set('PatientName', `*${patient.trim()}*`);
  const from = dateFrom.trim().replaceAll('-', ''), to = dateTo.trim().replaceAll('-', '');
  if (from || to) url.searchParams.set('StudyDate', from === to ? from : `${from}-${to}`);
  if (modalities.length) url.searchParams.set('ModalitiesInStudy', modalities.join(','));
  const items = await query(url.href, token);
  return items.map(item => ({ uid: field(item, '0020000D'), patient: field(item, '00100010') || 'Naməlum pasiyent',
    patientId: field(item, '00100020'), date: field(item, '00080020'),
    modality: field(item, '00080061') || field(item, '00080060'), description: field(item, '00081030'),
    seriesCount: Number(field(item, '00201206')) || 0, instanceCount: Number(field(item, '00201208')) || 0,
  })).filter(item => item.uid);
}

export async function queryRemoteSeries(endpoint: string, token: string, studyUID: string): Promise<RemoteSeries[]> {
  const items = await query(`${baseURL(endpoint)}/studies/${encodeURIComponent(studyUID)}/series`, token);
  return items.map(item => ({ uid: field(item, '0020000E'), number: field(item, '00200011') || '—',
    modality: field(item, '00080060'), description: field(item, '0008103E') || 'Adsız seriya',
    instanceCount: Number(field(item, '00201209')) || 0,
  })).filter(item => item.uid);
}

function findBytes(data: Uint8Array, match: Uint8Array, start: number): number {
  for (let pos = start; pos <= data.length - match.length; pos++) {
    if (data[pos] !== match[0]) continue;
    let index = 1;
    for (; index < match.length && data[pos + index] === match[index]; index++);
    if (index === match.length) return pos;
  }
  return -1;
}

/** A WADO-RS instance may be returned directly or wrapped as one MIME part. */
export function dicomPart(buffer: ArrayBuffer, contentType: string): Uint8Array {
  const bytes = new Uint8Array(buffer);
  if (!contentType.toLowerCase().includes('multipart/related')) return bytes;
  const boundary = contentType.match(/boundary\s*=\s*(?:"([^"]+)"|([^;\s]+))/i)?.[1] || contentType.match(/boundary\s*=\s*(?:"([^"]+)"|([^;\s]+))/i)?.[2];
  if (!boundary) throw new Error('PACS multipart cavabında sərhəd yoxdur');
  const encoder = new TextEncoder();
  const headerEnd = findBytes(bytes, encoder.encode('\r\n\r\n'), 0);
  if (headerEnd < 0) throw new Error('PACS DICOM hissəsinin başlığı oxunmadı');
  const start = headerEnd + 4;
  const end = findBytes(bytes, encoder.encode(`\r\n--${boundary}`), start);
  if (end < 0) throw new Error('PACS DICOM hissəsi yarımçıqdır');
  return bytes.slice(start, end);
}

export async function retrieveRemoteStudy(endpoint: string, token: string, studyUID: string,
  series: RemoteSeries[], onProgress: (done: number, total: number) => void): Promise<File[]> {
  const base = baseURL(endpoint);
  const catalog = (await Promise.all(series.map(async item => {
    const metadata = await query(`${base}/studies/${encodeURIComponent(studyUID)}/series/${encodeURIComponent(item.uid)}/instances`, token);
    return metadata.map(entry => ({ seriesUID: item.uid, sopUID: field(entry, '00080018') })).filter(entry => entry.sopUID);
  }))).flat();
  if (!catalog.length) throw new Error('PACS seriyalarında görüntü tapılmadı');
  if (catalog.length > 800) throw new Error('800-dən çox görüntü var. Əvvəlcə bir seriya seçib açın.');
  const files: File[] = new Array(catalog.length);
  let done = 0;
  for (let offset = 0; offset < catalog.length; offset += 4) {
    await Promise.all(catalog.slice(offset, offset + 4).map(async (item, index) => {
      const url = `${base}/studies/${encodeURIComponent(studyUID)}/series/${encodeURIComponent(item.seriesUID)}/instances/${encodeURIComponent(item.sopUID)}`;
      const response = await request(url, token, 'multipart/related; type="application/dicom"');
      const bytes = dicomPart(await response.arrayBuffer(), response.headers.get('content-type') || '');
      files[offset + index] = new File([Uint8Array.from(bytes)], `${item.sopUID}.dcm`, { type: 'application/dicom' });
      onProgress(++done, catalog.length);
    }));
  }
  return files;
}

/** Full-study export: paginated metadata, then one original instance at a time. */
export async function* streamRemoteStudy(endpoint: string, token: string, studyUID: string, expected: number): AsyncGenerator<File> {
  const base = `${baseURL(endpoint)}/studies/${encodeURIComponent(studyUID)}`;
  const catalog: { sop: string; series: string }[] = [], seen = new Set<string>();
  for (let offset = 0; ; offset += 200) {
    const response = await request(`${base}/instances?limit=200&offset=${offset}&includefield=0020000E`, token, 'application/dicom+json');
    const page: DicomObject[] = response.status === 204 ? [] : await response.json();
    if (!Array.isArray(page)) throw Error('PACS DICOM JSON siyahısı qaytarmadı');
    for (const item of page) {
      const sop = field(item, '00080018'), series = field(item, '0020000E');
      if (!sop || !series || seen.has(sop)) throw Error('PACS tam və təkrarsız görüntü siyahısı qaytarmadı; göndəriş başlanmadı.');
      seen.add(sop); catalog.push({ sop, series });
    }
    if (catalog.length > 1000000) throw Error('PACS görüntü siyahısı həddən böyükdür');
    if (page.length < 200) {
      if (response.headers.get('warning')?.includes('299')) throw Error('PACS nəticəni məhdudlaşdırıb; müayinənin tam siyahısı alınmadı.');
      break;
    }
  }
  if (!catalog.length || catalog.length < expected) throw Error('PACS-dən müayinənin bütün DICOM fayllarının siyahısı alınmadı');
  for (const item of catalog) {
    const response = await request(`${base}/series/${encodeURIComponent(item.series)}/instances/${encodeURIComponent(item.sop)}`, token, 'multipart/related; type="application/dicom"; transfer-syntax=*');
    const bytes = dicomPart(await response.arrayBuffer(), response.headers.get('content-type') || '');
    yield new File([Uint8Array.from(bytes)], `${item.sop}.dcm`, { type: 'application/dicom' });
  }
}
