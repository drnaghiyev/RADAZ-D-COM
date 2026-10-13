/** Use recorded acquisition names; never infer anatomy from image appearance. */
export function dicomSeriesName(get: (tag: string) => string | undefined) {
  const clean = (tag: string) => (get(tag) || '').trim().replace(/\^/g, ' ');
  for (const tag of ['x0008103e', 'x00181030', 'x00180024']) {
    const value = clean(tag);
    if (value && !/^(adsız seriya|unnamed series|unknown|no description|series)$/i.test(value)) return value;
  }
  const detail = [clean('x00180015') || clean('x00081030'), clean('x00185101')].filter(Boolean).join(' · ');
  return [clean('x00080060') || 'DICOM', detail || `Seriya ${clean('x00200011') || '—'}`].join(' · ');
}

export const paneId = (index: number): string => index < 26 ? String.fromCharCode(65 + index) : `A${String.fromCharCode(65 + index - 26)}`;
export const paneIndex = (id: string) => id.length === 1 ? id.charCodeAt(0) - 65 : 26 + id.charCodeAt(1) - 65;
