'use client';
import {useTranslation as useUiTranslation,translate as tr} from '@/lib/i18n';


import { useEffect, useRef, useState } from 'react';
import type { PointerEvent } from 'react';
import type * as Core from '@cornerstonejs/core';
import { getLocalizerGeometry } from '@/lib/cornerstone';
import { sameCoordinateSpace, type ImageGeometry, type Point3 } from '@/lib/localizer';
import type { LocalMark } from './measurement-overlay';
import type { AnatomyLabel } from '@/lib/anatomy-atlas';

export type CursorPosition = { world: Point3; geometry: ImageGeometry };

/** Coalesce slider/drag input: never race two asynchronous stack loads. */
export function useStackNavigation(viewport: Core.Types.IStackViewport | null, imageId: string, onError: (message: string) => void) {
  const pending = useRef<{ viewport: Core.Types.IStackViewport; index: number } | null>(null);
  const loading = useRef(false);
  const desired = useRef<number | null>(null);
  useEffect(() => { if (!loading.current) desired.current = null; }, [imageId]);
  useEffect(() => { pending.current = null; desired.current = null; }, [viewport]);
  return (value: number, relative = false) => {
    if (!viewport) return;
    const count = viewport.getImageIds().length;
    if (!count) return;
    const next = relative ? (desired.current ?? viewport.getCurrentImageIdIndex()) + value : value;
    const index = ((Math.round(next) % count) + count) % count;
    desired.current = index; pending.current = { viewport, index };
    if (loading.current) return;
    loading.current = true;
    void (async () => {
      try {
        while (pending.current) {
          const target = pending.current; pending.current = null;
          await target.viewport.setImageIdIndex(target.index);
        }
      } catch (error) { pending.current = null; onError(`Görüntü dəyişdirilə bilmədi: ${String(error)}`); }
      finally { loading.current = false; desired.current = null; }
    })();
  };
}

export function ViewerInteractionOverlay({ viewport, element, imageId, tool, slice, count, marks, selectedMarkId, onSelectMark, cursor, onCursor, onAdd, onUpdate, onRemove, onSelect, onEditArrow, navigate, anatomyLabel, onRecognizeAnatomy }: {
  viewport: Core.Types.IStackViewport | null; element: HTMLDivElement | null; imageId: string;
  tool: string; slice: number; count: number; marks: LocalMark[]; cursor: CursorPosition | null;
  onCursor: (position: CursorPosition) => void; onAdd: (mark: LocalMark) => void;
  onEditArrow: (id:string)=>void;
  onUpdate: (id: string, patch: Partial<LocalMark>) => void;
  onRemove: (id: string) => void; onSelect: () => void; navigate: (index: number, relative?: boolean) => void;
  selectedMarkId?: string | null; onSelectMark?: (id: string) => void;
  anatomyLabel?: AnatomyLabel | null;
  onRecognizeAnatomy?: (point:Point3,tail:Point3)=>void;
}) {
  useUiTranslation();
  const [draft, setDraft] = useState<Point3[]>([]);
  const [, repaint] = useState(0);
  const gesture = useRef<{ id: number; y: number; points: Point3[]; last: [number, number] } | null>(null);
  const edit = useRef<{ pointer: number; mark: LocalMark; start: Point3; point?: number } | null>(null);
  const placingAnatomy = tool === 'anatomy' && anatomyLabel?.imageId === imageId;
  const active = ['scroll', 'arrow', 'pencil', 'cursor3d','anatomy-auto'].includes(tool) || placingAnatomy;
  const geometry = imageId ? getLocalizerGeometry(imageId) : null;
  useEffect(() => { gesture.current = null; edit.current = null; setDraft([]); }, [tool, viewport]);
  // A rendered slice is the result of scrolling, not the end of the gesture.
  useEffect(() => { edit.current = null; setDraft([]); }, [imageId]);
  useEffect(() => { if (tool !== 'scroll' && tool !== 'cursor3d') { gesture.current = null; setDraft([]); } }, [tool, imageId]);
  useEffect(() => {
    if (!element) return;
    const update = () => repaint(n => n + 1);
    const clear=()=>{gesture.current=null;setDraft([]);};
    element.addEventListener('radaz-clear-measurements',clear);
    element.addEventListener('CORNERSTONE_IMAGE_RENDERED', update);
    return () => {element.removeEventListener('radaz-clear-measurements',clear);element.removeEventListener('CORNERSTONE_IMAGE_RENDERED', update);};
  }, [element]);
  const world = (event: PointerEvent<SVGElement>) => {
    const rect = element!.getBoundingClientRect();
    return viewport!.canvasToWorld([event.clientX - rect.left, event.clientY - rect.top]) as Point3;
  };
  const updateGesture = (event: PointerEvent<SVGSVGElement>) => {
    const editing = edit.current;
    if (editing && editing.pointer === event.pointerId && viewport && element) {
      event.preventDefault(); event.stopPropagation();
      const current = world(event), delta = current.map((n, i) => n - editing.start[i]);
      onUpdate(editing.mark.id, {points: editing.mark.points.map((p, i) => editing.point === undefined
        ? p.map((n, axis) => n + delta[axis]) as Point3 : i === editing.point ? current : p)});
      return;
    }
    const current = gesture.current;
    if (!current || current.id !== event.pointerId || !viewport || !element) return;
    if (tool === 'scroll') {
      const steps = Math.trunc((event.clientY - current.y) / 14);
      if (steps) { navigate(steps, true); current.y += steps * 14; }
    } else if (tool === 'cursor3d') {
      if (geometry) onCursor({ world: world(event), geometry });
    } else if (tool !== 'anatomy' && tool !== 'anatomy-auto') {
      if (Math.hypot(event.clientX - current.last[0], event.clientY - current.last[1]) < 2) return;
      const point = world(event);
      current.points = tool === 'arrow' ? [current.points[0], point] : [...current.points, point];
      current.last = [event.clientX, event.clientY]; setDraft(current.points);
    }
  };
  const startEdit = (event: PointerEvent<SVGElement>, mark: LocalMark, point?: number) => {
    if (event.button !== 0 || !element) return;
    event.preventDefault(); event.stopPropagation(); onSelect();
    event.currentTarget.ownerSVGElement!.focus({preventScroll:true});
    if (tool === 'erase') { onRemove(mark.id); return; }
    onSelectMark?.(mark.id);
    edit.current = {pointer: event.pointerId, mark, start: world(event), point};
    event.currentTarget.ownerSVGElement!.setPointerCapture(event.pointerId);
  };
  const points = (values: Point3[]) => values.map(point => viewport!.worldToCanvas(point).join(',')).join(' ');
  const arrowHead = (values: Point3[]) => {
    const a = viewport!.worldToCanvas(values[0]), b = viewport!.worldToCanvas(values[values.length - 1]);
    const angle = Math.atan2(b[1] - a[1], b[0] - a[0]);
    return `${b[0] - 14 * Math.cos(angle - .45)},${b[1] - 14 * Math.sin(angle - .45)} ${b[0]},${b[1]} ${b[0] - 14 * Math.cos(angle + .45)},${b[1] - 14 * Math.sin(angle + .45)}`;
  };
  if (!viewport || !imageId) return null;
  const cursorPoint = cursor && geometry && sameCoordinateSpace(geometry, cursor.geometry) ? viewport.worldToCanvas(cursor.world) : null;
  return <>
    <svg tabIndex={-1} className={`drawing-overlay ${active ? 'drawing-active' : ''} ${tool === 'scroll' ? 'scroll-active' : ''}`} aria-label={tr('ui.touch_image_controls_0a9ab')}
      onClick={event => event.stopPropagation()}
      onWheel={event => { event.stopPropagation(); if (event.deltaY) navigate(Math.sign(event.deltaY), true); }}
      onDoubleClick={event => event.stopPropagation()}
      onPointerDown={event => {
        if (!active || event.button !== 0 || gesture.current || edit.current || !element) return;
        event.preventDefault(); event.stopPropagation(); onSelect();
        event.currentTarget.focus({preventScroll:true});
        event.currentTarget.setPointerCapture(event.pointerId);
        const point = world(event);
        gesture.current = { id: event.pointerId, y: event.clientY, points: [point], last: [event.clientX, event.clientY] };
        if (tool === 'cursor3d' && geometry) onCursor({ world: point, geometry });
        if (tool === 'arrow' || tool === 'pencil') setDraft([point]);
      }} onPointerMove={updateGesture} onPointerUp={event => {
        updateGesture(event);
        if (edit.current?.pointer === event.pointerId) {
          edit.current = null; event.currentTarget.releasePointerCapture(event.pointerId); return;
        }
        const current = gesture.current;
        if (!current || current.id !== event.pointerId) return;
        if(tool==='anatomy-auto'&&element&&Math.hypot(event.clientX-current.last[0],event.clientY-current.last[1])<6){
          const rect=element.getBoundingClientRect(),x=event.clientX-rect.left,y=event.clientY-rect.top;
          const tail=viewport.canvasToWorld([Math.max(12,Math.min(rect.width-280,x+55)),Math.max(12,y-65)]) as Point3;
          onRecognizeAnatomy?.(world(event),tail);
        }
        if (placingAnatomy && anatomyLabel && element && Math.hypot(event.clientX-current.last[0],event.clientY-current.last[1]) < 6) {
          const rect=element.getBoundingClientRect();
          const x=event.clientX-rect.left,y=event.clientY-rect.top;
          const tail=viewport.canvasToWorld([Math.max(12,Math.min(rect.width-280,x+55)),Math.max(12,y-65)]) as Point3;
          onAdd({id:`anatomy-${crypto.randomUUID()}`,imageId,kind:'arrow',points:[tail,world(event)],labelOffset:[0,0],comment:anatomyLabel.text,anatomyId:anatomyLabel.id});
        }
        if ((tool === 'arrow' || tool === 'pencil') && current.points.length > 1) {
          onAdd({ id: `draw-${`${Date.now()}-${Math.random().toString(36).slice(2)}`}`, imageId, kind: tool, points: current.points, labelOffset: [0, 0] });
        }
        gesture.current = null; setDraft([]);
        event.currentTarget.releasePointerCapture(event.pointerId);
      }} onPointerCancel={() => { edit.current = null; gesture.current = null; setDraft([]); }} onLostPointerCapture={() => { edit.current = null; gesture.current = null; setDraft([]); }}>
      {marks.filter(mark => mark.imageId === imageId && (mark.kind === 'arrow' || mark.kind === 'pencil')).map(mark => <g key={mark.id} data-drawing={mark.kind} data-mark-id={mark.id} data-anatomy-id={mark.anatomyId} className={selectedMarkId === mark.id ? 'selected-measurement' : undefined}
        onClick={event=>event.stopPropagation()} onDoubleClick={event=>{event.stopPropagation();if(mark.kind==='arrow')onEditArrow(mark.id);}}
        onPointerDown={event=>startEdit(event, mark)}>
        <polyline points={points(mark.points)} />
        {mark.kind === 'arrow' && <polyline points={arrowHead(mark.points)} />}
        <polyline className="drawing-hit" points={points(mark.points)} />
        {mark.kind === 'arrow' && [0, mark.points.length - 1].map(index => {
          const [cx, cy] = viewport.worldToCanvas(mark.points[index]);
          return <g key={index} className="drawing-anchor" onPointerDown={event => startEdit(event, mark, index)}>
            <circle className="drawing-anchor-hit" cx={cx} cy={cy} r={16}/><circle className="drawing-anchor-dot" cx={cx} cy={cy} r={4}/>
          </g>;
        })}
        {mark.kind==='arrow'&&mark.comment&&(()=>{
          const [x,y]=viewport.worldToCanvas(mark.points[0]);
          const lines=mark.comment.split('\n').flatMap(line=>line.match(/.{1,32}(?:\s|$)|.{1,32}/g)||['']);
          const width=Math.min(320,Math.max(80,...lines.map(line=>line.length*9))+16);
          return <g className="arrow-comment" transform={`translate(${x+12},${y+12})`}><rect width={width} height={lines.length*21+12} rx={4}/><text x={8} y={21}>{lines.map((line,i)=><tspan key={i} x={8} dy={i?21:0}>{line.trim()}</tspan>)}</text></g>;
        })()}
      </g>)}
      {draft.length > 1 && <g className="drawing-draft"><polyline points={points(draft)}/>{tool === 'arrow' && <polyline points={arrowHead(draft)}/>}</g>}
      {cursorPoint && <g className="world-cursor"><path d={`M ${cursorPoint[0]-18} ${cursorPoint[1]} h 36 M ${cursorPoint[0]} ${cursorPoint[1]-18} v 36`}/><circle cx={cursorPoint[0]} cy={cursorPoint[1]} r="6"/></g>}
    </svg>
    {count > 1 && <div className="vertical-stack-scroll" onPointerDown={event => { event.stopPropagation(); onSelect(); }} onClick={event => event.stopPropagation()} onDoubleClick={event => event.stopPropagation()}>
      <input type="range" min="0" max={count - 1} step="1" value={slice} aria-label={tr('ui.image_number_d4fa0')} aria-orientation="vertical" aria-valuetext={`${slice + 1} / ${count}`} title={`${slice + 1} / ${count}`} onChange={event => navigate(Number(event.currentTarget.value))}/>
    </div>}
    {tool === 'cursor3d' && <div className="cursor-readout">{!geometry ? 'Bu görüntüdə 3D məkan koordinatları yoxdur' : cursorPoint && cursor ? `LPS (mm): ${cursor.world.map(n => n.toFixed(1)).join(' / ')}` : '3D nöqtəni seçin · uyğun panellər həmin nöqtəyə keçir'}</div>}
  </>;
}
