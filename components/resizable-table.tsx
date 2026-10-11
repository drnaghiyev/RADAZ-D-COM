'use client';
import {useTranslation as useUiTranslation,translate as tr} from '@/lib/i18n';


import { createContext, useContext, useEffect, useRef, useState, type PointerEvent, type TableHTMLAttributes, type ThHTMLAttributes } from 'react';

type Widths = Record<string, number>;
type ResizeContext = { widths: Widths; start: (column: string, event: PointerEvent<HTMLSpanElement>) => void; move: (event: PointerEvent<HTMLSpanElement>) => void; finish: () => void; adjust: (column: string, delta: number) => void; reset: () => void };
const Columns = createContext<ResizeContext | null>(null);
const clamp = (value: number, minimum = 40) => Math.round(Math.max(minimum, Math.min(900, value)));

export function ResizableTable({ storageKey, children, ...props }: TableHTMLAttributes<HTMLTableElement> & { storageKey: string }) {
  const table = useRef<HTMLTableElement>(null);
  const [widths, setWidths] = useState<Widths>({});
  const drag = useRef<{ column: string; x: number; widths: Widths; minimum: number } | null>(null);
  const latest = useRef<Widths>({});
  const key = `radaz-table-widths-v1:${storageKey}`;
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(key) || '{}');
      const columns = [...(table.current?.tHead?.rows[0]?.cells || [])].map(cell => cell.dataset.column);
      const restored = Object.fromEntries(Object.entries(saved).filter(([column, value]) => columns.includes(column) && typeof value === 'number' && Number.isFinite(value)).map(([column, value]) => [column, clamp(value as number, 24)]));
      latest.current = restored; setWidths(restored);
    } catch { /* Unavailable browser storage must not prevent resizing. */ }
  }, [key]);
  const snapshot = () => Object.fromEntries([...(table.current?.tHead?.rows[0]?.cells || [])].map(cell => [cell.dataset.column!, cell.getBoundingClientRect().width]));
  const save = () => { try { localStorage.setItem(key, JSON.stringify(latest.current)); } catch {} };
  const apply = (next: Widths) => { latest.current = next; setWidths(next); };
  const reset = () => { drag.current = null; apply({}); try { localStorage.removeItem(key); } catch {} };
  const context: ResizeContext = {
    widths,
    start(column, event) {
      if (event.button !== 0) return;
      event.preventDefault(); event.stopPropagation();
      const header = event.currentTarget.closest('th')!;
      drag.current = { column, x: event.clientX, widths: snapshot(), minimum: Number(header.dataset.minimum) || 40 };
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    move(event) {
      if (!drag.current) return;
      const { column, x, widths: initial, minimum } = drag.current;
      apply({ ...initial, [column]: clamp(initial[column] + event.clientX - x, minimum) });
    },
    finish() { if (drag.current) { drag.current = null; save(); } },
    adjust(column, delta) { const current = snapshot(); apply({ ...current, [column]: clamp(current[column] + delta) }); save(); },
    reset,
  };
  const total = Object.values(widths).reduce((sum, width) => sum + width, 0);
  return <Columns.Provider value={context}><table {...props} ref={table} style={{ ...props.style, ...(total ? { width: total, minWidth: total } : {}) }}>{children}</table></Columns.Provider>;
}

export function ResizableHeader({ column, label, minimum = 40, children, ...props }: ThHTMLAttributes<HTMLTableCellElement> & { column: string; label?: string; minimum?: number }) {
  useUiTranslation();
  const context = useContext(Columns);
  return <th {...props} data-column={column} data-minimum={minimum} style={{ ...props.style, ...(context?.widths[column] ? { width: context.widths[column] } : {}) }}>
    {children}
    {context && <span className="column-resizer" role="separator" aria-orientation="vertical" aria-label={`${label || column} sütununun eni`} aria-valuemin={minimum} aria-valuemax={900} aria-valuenow={context.widths[column]} tabIndex={0}
      title={tr('ui.drag_to_resize_the_column_double_click_to_res_b5848')}
      onClick={event => event.stopPropagation()} onDoubleClick={event => { event.stopPropagation(); context.reset(); }}
      onPointerDown={event => context.start(column, event)} onPointerMove={context.move} onPointerUp={context.finish} onPointerCancel={context.finish} onLostPointerCapture={context.finish}
      onKeyDown={event => { if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); event.stopPropagation(); context.adjust(column, (event.key === 'ArrowRight' ? 1 : -1) * (event.shiftKey ? 25 : 5)); } if (event.key === 'Home') { event.preventDefault(); context.reset(); } }}/>}</th>;
}
