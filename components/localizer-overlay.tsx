'use client';
import {useTranslation as useUiTranslation,translate as tr} from '@/lib/i18n';


import { useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import type * as Core from '@cornerstonejs/core';
import { getLocalizerGeometry } from '@/lib/cornerstone';
import { localizerSegment, intersectPlanes, type Point3 } from '@/lib/localizer';
import {localizerRotationHandles} from '@/lib/localizer-handles';

type Props = {
  element: HTMLDivElement | null;
  viewport: Core.Types.IStackViewport | null;
  imageId: string;
  otherImages: { panel: string; imageId: string }[];
  enabled: boolean;
  onMoveSource: (panel: string, world: Point3) => void;
  onMoveIntersection?: (world: Point3) => void;
  targetPanel?: string;
  onRotateSource?: (sourcePanel: string, targetPanel: string, angleRadians: number) => void;
  onRotateStart?: (sourcePanel: string, targetPanel: string) => void;
  onPreviewRotateSource?: (sourcePanel: string, targetPanel: string, angleRadians: number) => void;
};

export function LocalizerOverlay({ element, viewport, imageId, otherImages, enabled, onMoveSource, onMoveIntersection, targetPanel, onRotateSource, onRotateStart, onPreviewRotateSource }: Props) {
  useUiTranslation();
  const [, setRevision] = useState(0);
  const [rotation, setRotation] = useState<{ panel: string; origin: [number, number]; start: number; delta: number } | null>(null);
  const rotationRef = useRef<typeof rotation>(null);
  const [hover,setHover]=useState<{panel:string;point:[number,number]}|null>(null);
  useEffect(() => {
    if (!element || !viewport) return;
    const repaint = () => setRevision(value => value + 1);
    const observer = new ResizeObserver(repaint);
    observer.observe(element);
    element.addEventListener('CORNERSTONE_CAMERA_MODIFIED', repaint);
    return () => { observer.disconnect(); element.removeEventListener('CORNERSTONE_CAMERA_MODIFIED', repaint); };
  }, [element, viewport]);

  if (!enabled || !viewport || !imageId || !element) return null;
  const target = getLocalizerGeometry(imageId);
  if (!target) return null;
  const lines = otherImages.flatMap(({ panel, imageId: sourceId }) => {
    const source = getLocalizerGeometry(sourceId);
    const segment = source && localizerSegment(target, source);
    if (!segment) return [];
    const a = viewport.worldToCanvas(segment[0]) as [number, number];
    const b = viewport.worldToCanvas(segment[1]) as [number, number];
    if (![...a, ...b].every(Number.isFinite)) return [];
    return [{ panel, a, b, source }];
  });
  if (!lines.length) return null;
  const pivotWorld = lines.length > 1 ? intersectPlanes([target, lines[0].source!, lines[1].source!]) : null;
  const pivot = pivotWorld ? viewport.worldToCanvas(pivotWorld) as [number, number] : null;
  const pointerAngle = (event: ReactPointerEvent<SVGCircleElement>, origin: [number, number]) => {
    const rect = element.getBoundingClientRect();
    const world = viewport.canvasToWorld([event.clientX - rect.left, event.clientY - rect.top]);
    const center = viewport.canvasToWorld(origin);
    const delta = world.map((v, i) => v - center[i]);
    return Math.atan2(delta.reduce((sum,v,i) => sum + v * target.rowDirection[i], 0), delta.reduce((sum,v,i) => sum + v * target.columnDirection[i], 0));
  };
  const wrapAngle = (angle: number) => Math.atan2(Math.sin(angle), Math.cos(angle));
  const move = (event: ReactPointerEvent<SVGGElement>, panel: string) => {
    if (!element || !viewport) return;
    event.preventDefault(); event.stopPropagation();
    const rect = element.getBoundingClientRect();
    const world = viewport.canvasToWorld([event.clientX - rect.left, event.clientY - rect.top]) as Point3;
    onMoveSource(panel, world);
  };
  const moveCenter = (event: ReactPointerEvent<SVGCircleElement>) => {
    event.preventDefault(); event.stopPropagation();
    const rect = element.getBoundingClientRect();
    onMoveIntersection?.(viewport.canvasToWorld([event.clientX-rect.left, event.clientY-rect.top]) as Point3);
  };
  return <svg className="localizer-overlay" aria-label={tr('ui.localizer_lines_1e289')} data-world={pivotWorld?.join(',')}>
    {lines.map(({ panel, a, b }) => {
      const origin: [number, number] = pivot || [(a[0]+b[0])/2, (a[1]+b[1])/2];
      const handles=localizerRotationHandles(a,b,origin,element.clientWidth,element.clientHeight,hover?.panel===panel?hover.point:undefined);
      return <g key={panel} data-source={panel} className="localizer-line" onClick={event => event.stopPropagation()}
      onDoubleClick={event=>event.stopPropagation()} onPointerLeave={()=>{if(!rotationRef.current)setHover(null);}}
      onPointerDown={event => { if (event.button !== 0) return; event.currentTarget.setPointerCapture(event.pointerId); move(event, panel); }}
      onPointerMove={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) move(event, panel);
        else if(!event.buttons&&!(event.target as Element).closest('.localizer-rotate-hit')){const r=element.getBoundingClientRect();setHover({panel,point:[event.clientX-r.left,event.clientY-r.top]});} }}
      onPointerUp={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}
      transform={!onPreviewRotateSource && rotation?.panel === panel ? `rotate(${rotation.delta*180/Math.PI} ${origin[0]} ${origin[1]})` : undefined}>
      <line className="localizer-glow" x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]}/>
      <line className="localizer-stroke" x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]}/>
      <line className="localizer-hit" x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]}/>
      {onRotateSource && targetPanel && handles.map(({side,point:handle})=><g key={side} data-rotate-side={side}>
        <circle className="localizer-rotate-dot" cx={handle[0]} cy={handle[1]} r={6}/>
        <circle className="localizer-rotate-hit" cx={handle[0]} cy={handle[1]} r={13} role="button" tabIndex={0}
          aria-label={`${panel} rekonstruksiya müstəvisini fırlat · ${side<0?'birinci':'ikinci'} tərəf`} onClick={event => event.stopPropagation()}
          onKeyDown={event => { if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); onRotateSource(panel, targetPanel, (event.key === 'ArrowRight' ? 1 : -1) * Math.PI / 36); } }}
          onPointerDown={event => { if (event.button !== 0) return; event.preventDefault(); event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId);
            const start = { panel, origin, start: pointerAngle(event, origin), delta: 0 };
            rotationRef.current=start; setRotation(start); onRotateStart?.(panel, targetPanel); }}
          onPointerMove={event => { const active = rotationRef.current;
            if (event.currentTarget.hasPointerCapture(event.pointerId) && active?.panel === panel) {
              const delta = wrapAngle(pointerAngle(event, active.origin) - active.start);
              rotationRef.current={ ...active, delta }; setRotation(rotationRef.current);
              onPreviewRotateSource?.(panel, targetPanel, delta);
            } }}
          onPointerUp={event => { if (!event.currentTarget.hasPointerCapture(event.pointerId)) return; event.preventDefault(); event.stopPropagation();
            event.currentTarget.releasePointerCapture(event.pointerId);
            const active = rotationRef.current;
            const angle = active?.panel === panel ? wrapAngle(pointerAngle(event, active.origin) - active.start) : 0;
            rotationRef.current=null; setRotation(null); onRotateSource(panel, targetPanel, angle); }}
          onPointerCancel={() => { rotationRef.current=null; setRotation(null); }}/>
      </g>)}
      <text x={origin[0] + 7} y={origin[1] - 7}>{panel}</text>
    </g>})}
    {pivot && onMoveIntersection && <g className="localizer-center" onClick={event=>event.stopPropagation()} onDoubleClick={event=>event.stopPropagation()}>
      <circle className="localizer-center-dot" cx={pivot[0]} cy={pivot[1]} r={6}/>
      <circle className="localizer-center-hit" cx={pivot[0]} cy={pivot[1]} r={12} role="button" aria-label={tr('ui.move_localizer_intersection_33e2a')}
        onPointerDown={event => { if(event.button!==0)return; event.currentTarget.setPointerCapture(event.pointerId); moveCenter(event); }}
        onPointerMove={event => { if(event.currentTarget.hasPointerCapture(event.pointerId))moveCenter(event); }}
        onPointerUp={event => { event.preventDefault();event.stopPropagation(); if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId); }}/>
    </g>}
  </svg>;
}
