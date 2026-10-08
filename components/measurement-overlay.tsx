'use client';

import { useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import type * as Core from '@cornerstonejs/core';
import { getMeasurementUnit, getLocalizerGeometry, sampleLocalDicom } from '@/lib/cornerstone';
import { measureArch } from '@/lib/arch-measurement';
import { measureDeviation } from '@/lib/deviation-measurement';

let markSerial = 0;
const newMarkId = () => `mark-${Date.now()}-${markSerial++}`;

export type Point3 = [number, number, number];
export type LocalMark = {
  id: string;
  imageId: string;
  kind: 'hu' | 'deviation' | 'arch' | 'arrow' | 'pencil';
  points: Point3[];
  labelOffset: [number, number];
  heightLabelOffset?: [number, number];
  override?: number;
  comment?: string;
};

type Props = {
  element: HTMLDivElement | null;
  viewport: Core.Types.IStackViewport | null;
  imageId: string;
  modality?: string;
  tool: string;
  marks: LocalMark[];
  onAdd: (mark: LocalMark) => void;
  onUpdate: (id: string, patch: Partial<LocalMark>) => void;
  onRemove: (id: string) => void;
  selectedMarkId?: string | null;
  onSelectMark?: (id: string) => void;
};

function apexArc(start: [number, number], end: [number, number], apex: [number, number]): string | null {
  const left = Math.hypot(start[0] - apex[0], start[1] - apex[1]);
  const right = Math.hypot(end[0] - apex[0], end[1] - apex[1]);
  if (Math.min(left, right) < 8) return null;
  const radius = Math.max(12, Math.min(29, Math.min(left, right) * .22));
  let first = Math.atan2(start[1] - apex[1], start[0] - apex[0]);
  let second = Math.atan2(end[1] - apex[1], end[0] - apex[0]);
  const sweep = (second - first + Math.PI * 2) % (Math.PI * 2);
  if (sweep > Math.PI) [first, second] = [second, first];
  const p1: [number, number] = [apex[0] + Math.cos(first) * radius, apex[1] + Math.sin(first) * radius];
  const p2: [number, number] = [apex[0] + Math.cos(second) * radius, apex[1] + Math.sin(second) * radius];
  return `M ${p1[0]} ${p1[1]} A ${radius} ${radius} 0 0 1 ${p2[0]} ${p2[1]}`;
}

export function MeasurementOverlay({ element, viewport, imageId, modality, tool, marks, onAdd, onUpdate, onRemove, selectedMarkId, onSelectMark }: Props) {
  const [draft, setDraft] = useState<Point3[]>([]);
  const [cursor, setCursor] = useState<Point3 | null>(null);
  const [revision, setRevision] = useState(0);
  const [editing, setEditing] = useState<string | null>(null);
  const [entry, setEntry] = useState('');
  const drag = useRef<{ id: string; point?: number; whole?: boolean; heightLabel?: boolean; startWorld?: Point3 | null; start: [number, number]; offset: [number, number]; points: Point3[] } | null>(null);

  useEffect(() => { setDraft([]); setCursor(null); setEditing(null); }, [imageId, tool]);
  useEffect(() => {
    if (!element || !viewport) return;
    const repaint = () => setRevision(n => n + 1);
    const clear=()=>{setDraft([]);setCursor(null);setEditing(null);drag.current=null;};
    element.addEventListener('radaz-clear-measurements',clear);
    const observer = new ResizeObserver(repaint);
    observer.observe(element);
    element.addEventListener('CORNERSTONE_CAMERA_MODIFIED', repaint);
    element.addEventListener('CORNERSTONE_STACK_NEW_IMAGE', repaint);
    element.addEventListener('CORNERSTONE_IMAGE_RENDERED', repaint);
    return () => {
      observer.disconnect();element.removeEventListener('radaz-clear-measurements',clear);
      element.removeEventListener('CORNERSTONE_CAMERA_MODIFIED', repaint);
      element.removeEventListener('CORNERSTONE_STACK_NEW_IMAGE', repaint);
      element.removeEventListener('CORNERSTONE_IMAGE_RENDERED', repaint);
    };
  }, [element, viewport]);

  const toWorld = (clientX: number, clientY: number): Point3 | null => {
    if (!viewport || !element || !imageId) return null;
    const rect = element.getBoundingClientRect();
    return viewport.canvasToWorld([clientX - rect.left, clientY - rect.top]) as Point3;
  };
  const toCanvas = (point: Point3): [number, number] => viewport!.worldToCanvas(point) as [number, number];

  useEffect(() => {
    if (!element || !viewport || !imageId || (tool !== 'hu' && tool !== 'deviation' && tool !== 'arch')) return;
    const pointerDown = (ev: PointerEvent) => {
      if (ev.button !== 0 || !(ev.target instanceof Node) || !element.contains(ev.target)) return;
      const rect = element.getBoundingClientRect();
      const point = viewport.canvasToWorld([ev.clientX - rect.left, ev.clientY - rect.top]) as Point3;
      if (tool === 'hu') {
        onAdd({ id: newMarkId(), imageId, kind: 'hu', points: [point], labelOffset: [17, -18] });
      } else if (draft.length < (tool === 'deviation' ? 1 : 2)) {
        setDraft([...draft, point]);
      } else {
        const points = [...draft, point];
        const geometry=getLocalizerGeometry(imageId);
        if (tool === 'arch' ? measureArch(points) : geometry && measureDeviation(points,geometry.columnDirection,geometry.rowDirection)) {
          const id = newMarkId();
          onAdd({ id, imageId, kind: tool === 'arch' ? 'arch' : 'deviation', points, labelOffset: tool === 'arch' ? [14, -38] : [16, -20] });
          if (tool === 'arch') onSelectMark?.(id);
        }
        setDraft([]); setCursor(null);
      }
    };
    const pointerMove = (ev: PointerEvent) => {
      if (!draft.length) return;
      const rect = element.getBoundingClientRect();
      setCursor(viewport.canvasToWorld([ev.clientX - rect.left, ev.clientY - rect.top]) as Point3);
    };
    element.addEventListener('pointerdown', pointerDown);
    element.addEventListener('pointermove', pointerMove);
    return () => { element.removeEventListener('pointerdown', pointerDown); element.removeEventListener('pointermove', pointerMove); };
  }, [element, viewport, imageId, tool, draft, onAdd, onSelectMark]);

  const startDrag = (e: ReactPointerEvent<SVGGElement>, mark: LocalMark, point?: number | 'all' | 'height') => {
    if(e.button!==0)return;
    e.stopPropagation(); e.preventDefault();
    if (tool === 'erase') { onRemove(mark.id); return; }
    onSelectMark?.(mark.id);
    drag.current = { id: mark.id, point: typeof point === 'number' ? point : undefined, whole: point === 'all', heightLabel: point === 'height',
      startWorld: point === 'all' ? toWorld(e.clientX, e.clientY) : null,
      start: [e.clientX, e.clientY], offset: [...(point === 'height' ? mark.heightLabelOffset || [0, 0] : mark.labelOffset)], points: mark.points.map(p => [...p] as Point3) };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const moveDrag = (e: ReactPointerEvent<SVGGElement>) => {
    const current = drag.current;
    if (!current) return;
    e.stopPropagation();
    if (current.whole && current.startWorld) {
      const position = toWorld(e.clientX, e.clientY);
      if (!position) return;
      const delta = position.map((value, i) => value - current.startWorld![i]);
      onUpdate(current.id, { points: current.points.map(point => point.map((value, i) => value + delta[i]) as Point3) });
    } else if (current.point === undefined) {
      const offset: [number, number] = [current.offset[0] + e.clientX - current.start[0], current.offset[1] + e.clientY - current.start[1]];
      onUpdate(current.id, current.heightLabel ? { heightLabelOffset: offset } : { labelOffset: offset });
    } else {
      const position = toWorld(e.clientX, e.clientY);
      if (!position) return;
      const points = current.points.map(p => [...p] as Point3);
      points[current.point] = position;
      onUpdate(current.id, { points });
    }
  };
  const endDrag = (e: ReactPointerEvent<SVGGElement>) => {
    if (drag.current) { e.stopPropagation(); drag.current = null; if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId); }
  };
  if (!viewport || !imageId) return null;
  // A render revision tracks Cornerstone camera changes without copying its transform into React state.
  void revision;
  const visible = marks.filter(mark => mark.imageId === imageId && mark.kind !== 'arrow' && mark.kind !== 'pencil');
  const unit = modality === 'CT' ? 'HU' : 'piksel';
  const lengthUnit = getMeasurementUnit(imageId);
  const guide = draft.map(toCanvas);
  const pointer = cursor ? toCanvas(cursor) : null;

  return <>
    <svg className="measurement-overlay" aria-label="Ölçmə işarələri">
      {draft.length > 0 && <g className="mark-preview">
        {guide.map(([x, y], i) => <circle key={i} cx={x} cy={y} r={4} />)}
        {guide.length === 2 && <line x1={guide[0][0]} y1={guide[0][1]} x2={guide[1][0]} y2={guide[1][1]} />}
        {pointer && <line x1={guide[guide.length - 1][0]} y1={guide[guide.length - 1][1]} x2={pointer[0]} y2={pointer[1]} strokeDasharray="5 5" />}
        {tool === 'arch' && guide.length === 2 && pointer && <line x1={guide[0][0]} y1={guide[0][1]} x2={pointer[0]} y2={pointer[1]} strokeDasharray="5 5" />}
      </g>}
      {visible.map(mark => {
        const canvas = mark.points.map(toCanvas);
        const position = canvas[mark.kind === 'hu' ? 0 : mark.kind === 'deviation' ? 1 : 2];
        const labelX = position[0] + mark.labelOffset[0];
        const labelY = position[1] + mark.labelOffset[1];
        const measured = mark.kind === 'hu' ? sampleLocalDicom(imageId, mark.points[0]) : null;
        const value = mark.kind === 'hu' ? (mark.override ?? measured) : null;
        const arch = mark.kind === 'arch' ? measureArch(mark.points) : null;
        const geometry=getLocalizerGeometry(imageId);
        const foot = mark.kind === 'deviation' && geometry ? measureDeviation(mark.points,geometry.columnDirection,geometry.rowDirection) : null;
        const footCanvas = arch ? toCanvas(arch.foot) : foot ? toCanvas(foot.foot) : null;
        const arc = arch ? apexArc(canvas[0], canvas[1], canvas[2]) : null;
        const heightText = arch ? `H ${arch.height.toFixed(1)} ${lengthUnit}` : '';
        const heightX = footCanvas && arch ? (canvas[2][0] + footCanvas[0]) / 2 + 12 + (mark.heightLabelOffset?.[0] || 0) : 0;
        const heightY = footCanvas && arch ? (canvas[2][1] + footCanvas[1]) / 2 + (mark.heightLabelOffset?.[1] || 0) : 0;
        const title = mark.kind === 'hu' ? `${unit} ${value === null ? '—' : Math.round(value)}${mark.override === undefined ? '' : ' · əl ilə'}`
          : mark.kind === 'arch' ? `${arch?.angle.toFixed(1) ?? '—'}°`
          : `H ${foot?.height.toFixed(1) ?? '—'} ${lengthUnit} · ${foot?.angle.toFixed(1) ?? '—'}°`;
        const width = Math.max(98, title.length * 9.5 + 20);
        return <g key={mark.id} data-measurement={mark.id} data-kind={mark.kind} className={selectedMarkId === mark.id ? 'themed-measurement selected-measurement' : 'themed-measurement'} onClick={e => e.stopPropagation()}>
          {mark.kind === 'deviation' && footCanvas && <g className="deviation-lines">
            <polygon className="deviation-interior" points={[canvas[0], footCanvas, canvas[1]].map(point => point.join(',')).join(' ')} onPointerDown={e => startDrag(e, mark, 'all')} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag}/>
            <line className="deviation-base" x1={canvas[0][0]} y1={canvas[0][1]} x2={footCanvas[0]} y2={footCanvas[1]} />
            <line className="deviation-diagonal" x1={canvas[0][0]} y1={canvas[0][1]} x2={canvas[1][0]} y2={canvas[1][1]} />
            <line className="deviation-perpendicular" x1={canvas[1][0]} y1={canvas[1][1]} x2={footCanvas[0]} y2={footCanvas[1]} />
            {[canvas[0], canvas[1]].map(([x,y], index) => <g key={index} className="deviation-cross"><line x1={x-5} y1={y-5} x2={x+5} y2={y+5}/><line x1={x-5} y1={y+5} x2={x+5} y2={y-5}/></g>)}
            {[[canvas[0],canvas[1]],[canvas[0],footCanvas],[canvas[1],footCanvas]].map(([a,b], index) => <line key={index} className="mark-hit" x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} onPointerDown={e => startDrag(e, mark, 'all')} onPointerMove={moveDrag} onPointerUp={endDrag}/>)}
          </g>}
          {mark.kind === 'arch' && arch && footCanvas && <g className="arch-lines">
            <polygon className="arch-interior" points={canvas.map(point => point.join(',')).join(' ')} onPointerDown={e => startDrag(e, mark, 'all')} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag}/>
            <line x1={canvas[0][0]} y1={canvas[0][1]} x2={canvas[1][0]} y2={canvas[1][1]} />
            <line x1={canvas[0][0]} y1={canvas[0][1]} x2={canvas[2][0]} y2={canvas[2][1]} />
            <line x1={canvas[1][0]} y1={canvas[1][1]} x2={canvas[2][0]} y2={canvas[2][1]} />
            {arch.baseFraction < 0 && <line className="base-extension" x1={canvas[0][0]} y1={canvas[0][1]} x2={footCanvas[0]} y2={footCanvas[1]}/>}
            {arch.baseFraction > 1 && <line className="base-extension" x1={canvas[1][0]} y1={canvas[1][1]} x2={footCanvas[0]} y2={footCanvas[1]}/>}
            <line className="arch-height-line" x1={canvas[2][0]} y1={canvas[2][1]} x2={footCanvas[0]} y2={footCanvas[1]} />
            <circle cx={footCanvas[0]} cy={footCanvas[1]} r={3} />
            {arc && <path className="angle-arc" d={arc}/>}
            {[ [canvas[0], canvas[1]], [canvas[0], canvas[2]], [canvas[1], canvas[2]], [canvas[2], footCanvas] ].map(([a, b], i) => <line key={i} className="mark-hit" x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} onPointerDown={e => startDrag(e, mark, 'all')} onPointerMove={moveDrag} onPointerUp={endDrag}/>)}
            <g className="arch-height-label" onPointerDown={e => startDrag(e, mark, 'height')} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag}><rect x={heightX} y={heightY - 16} width={heightText.length * 8.5 + 16} height={27} rx={4}/><text x={heightX + 8} y={heightY + 1}>{heightText}</text></g>
          </g>}
          {canvas.map(([x, y], i) => <g key={i} className="mark-anchor" onPointerDown={e => startDrag(e, mark, i)} onPointerMove={moveDrag} onPointerUp={endDrag}>
            <circle cx={x} cy={y} r={16} className="mark-hit-circle"/>
            <circle cx={x} cy={y} r={4} className="mark-dot"/>
          </g>)}
          <g className={`mark-label ${mark.kind === 'deviation' ? 'deviation-label' : ''}`} onPointerDown={e => startDrag(e, mark)} onPointerMove={moveDrag} onPointerUp={endDrag}
            onDoubleClick={e => { e.stopPropagation(); if (mark.kind === 'hu' && tool !== 'erase') { setEditing(mark.id); setEntry(String(mark.override ?? measured ?? '')); } }}>
            <rect x={labelX} y={labelY - 15} width={width} height={29} rx={4}/>
            <text x={labelX + 8} y={labelY + 2}>{title}</text>
          </g>
          {mark.kind === 'hu' && mark.override !== undefined && <text className="measured-value" x={labelX + 8} y={labelY + 23}>Ölçülən: {measured === null ? '—' : Math.round(measured)} {unit}</text>}
        </g>;
      })}
    </svg>
    {editing && (() => {
      const mark = visible.find(item => item.id === editing);
      if (!mark || mark.kind !== 'hu') return null;
      const [x, y] = toCanvas(mark.points[0]);
      return <form className="hu-editor" style={{ left: Math.max(8, x + mark.labelOffset[0]), top: Math.max(8, y + mark.labelOffset[1] + 14) }}
        onSubmit={e => { e.preventDefault(); const value = Number(entry); if (entry.trim() && Number.isFinite(value)) { onUpdate(mark.id, { override: value }); setEditing(null); } }}>
        <label htmlFor="hu-override">{unit} göstərimi · əl ilə</label>
        <input id="hu-override" type="number" step="any" value={entry} onChange={e => setEntry(e.target.value)} autoFocus/>
        <small>Ölçülən: {sampleLocalDicom(imageId, mark.points[0])?.toFixed(0) ?? '—'} {unit}</small>
        <div><button type="submit">Saxla</button><button type="button" onClick={() => { onUpdate(mark.id, { override: undefined }); setEditing(null); }}>Ölçüləni qaytar</button><button type="button" onClick={() => setEditing(null)}>Bağla</button></div>
      </form>;
    })()}
  </>;
}
