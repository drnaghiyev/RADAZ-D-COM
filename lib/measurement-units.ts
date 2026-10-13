export type LengthUnit = 'mm' | 'cm';
const key = 'radaz-measurement-unit';
const event = 'radaz-measurement-unit-change';
export function getLengthUnit(): LengthUnit {
  try { return localStorage.getItem(key) === 'cm' ? 'cm' : 'mm'; } catch { return 'mm'; }
}
export function setLengthUnit(unit: LengthUnit) {
  try { localStorage.setItem(key, unit); } catch {}
  window.dispatchEvent(new Event(event));
}
export function subscribeLengthUnit(update: () => void) {
  const storage = (e: StorageEvent) => { if (!e.key || e.key === key) update(); };
  window.addEventListener(event, update); window.addEventListener('storage', storage);
  return () => { window.removeEventListener(event, update); window.removeEventListener('storage', storage); };
}
/** Change presentation only. Pixel/unknown units and calibrated source data remain intact. */
export function displayMeasurement(value: number, source: string, unit = getLengthUnit()) {
  const match = /^(mm|cm)(²)?(?=\s|$)/.exec(source);
  if (!match) return { value, unit: source };
  const power = match[2] ? 2 : 1;
  const factor = ((match[1] === 'cm' ? 10 : 1) / (unit === 'cm' ? 10 : 1)) ** power;
  return { value: value * factor, unit: (unit === 'cm' ? 'sm' : 'mm') + (match[2] || '') + source.slice(match[0].length) };
}
