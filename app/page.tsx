'use client';
import { VolumeRenderControls } from '@/components/volume-render-controls';
import { WorkProgress } from '@/components/work-progress';
import { type WorkProgress as LoadingProgress, yieldToBrowser } from '@/lib/work-progress';
import { measurementVariables } from '@/lib/measurement-theme';
import { RadazLogo } from '@/components/radaz-logo';
import { AppHelpMenu, useViewerLicense } from '@/components/app-product';
import { openRecordsWindow, registerViewer, requestedStudies } from '@/lib/viewer-session';
import {publishDetachedSource,readDetachedSource} from '@/lib/detached-viewer';
import {ViewportMouseControls} from '@/components/viewport-mouse-controls';
import {ArrowCommentEditor} from '@/components/arrow-comment-editor';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { ViewerInteractionOverlay, useStackNavigation, type CursorPosition } from '@/components/viewer-interaction-overlay';
import { ViewerDisplayControls } from '@/components/viewer-display-controls';
import { ViewerOutputControls } from '@/components/viewer-output-controls';
import { MeasurementOverlay, type LocalMark } from '@/components/measurement-overlay';
import { LocalizerOverlay } from '@/components/localizer-overlay';
import { VolumePreview, type VolumeRenderSettings } from '@/components/volume-preview';
import { volumeStyles, type VolumePreset, type VolumeQuality } from '@/lib/volume-presets';
import { ArrowUpRight, Pencil, MoveVertical, Eye, EyeOff, Download, PanelLeftClose, Activity, Box, ChevronDown, CircleDot, Crosshair, Database, Disc3, Eraser, FileArchive, FileText, Focus, Grid2X2, Hand, Layers3, MoveDiagonal2, RotateCcw, Ruler, ScanLine, ScanSearch, ServerCog, Settings2, SlidersHorizontal, Trash2, FolderOpen, Triangle, Waypoints } from 'lucide-react';
import { addLocalDicom, registerDiskDicom, getOriginalDicom, getDiskDicomSource, registerLocalDicom, shareLocalDicoms, borrowLocalDicoms, getSeriesVolume, createMprStacks, createObliqueMprStacks, getDefaultWindow, getLocalizerGeometry, getMprOrientations, getViewer, releaseLocalDicoms, rotateMprOrientation, thumbnailLocalDicom, type MprOrientations, type MprMode, type MprSettings } from '@/lib/cornerstone';
import { closestSlice, sameCoordinateSpace, normalOf, planeLabel, intersectPlanes, type Point3 } from '@/lib/localizer';
import { expandSources, filesFromDrop } from '@/lib/import-sources';
import { parseDicomFile } from '@/lib/dicom-file';
import { getArchiveFiles, saveArchiveFiles } from '@/lib/local-archive';
import { watchRemovableMedia, type MediaImage, type MediaProgress } from '@/lib/removable-media';
import { bindWindowing, connectWindowLevels, WindowLevels } from '@/lib/image-windowing';
import type * as Core from '@cornerstonejs/core';

type Tool = 'scroll' | 'arrow' | 'pencil' | 'cursor3d' | 'wl' | 'pan' | 'zoom' | 'length' | 'angle' | 'arch' | 'cobb' | 'ellipse' | 'hu' | 'deviation' | 'erase';
type Series = { id: string; studyId: string; name: string; modality: string; patient: string; patientId: string; birth: string; date: string; number: string; imageIds: string[]; initialImageId?:string; thumb?: string; mediaSession?: string; archived?: boolean; discovered?: number; loading?: boolean };
type Preset = { ww: number; wl: number; token: number; panel: string; seriesId: string; imageId: string } | null;
type ImportSource = { id: number; label: string; files: File[] };
type MprData = { sourceId: string; stacks: Record<'SAG' | 'COR' | 'AX', string[]>; planes: Series[]; owned: string[]; orientations: MprOrientations | null; pivot?: Point3 | null };
type DetachedMode = 'mpr' | '3d';
const formatDate = (s: string) => s?.length === 8 ? `${s.slice(6, 8)}.${s.slice(4, 6)}.${s.slice(0, 4)}` : '—';
const newMprSettings = (): MprSettings => ({ SAG: { mode: 'MPR', thickness: 1 }, COR: { mode: 'MPR', thickness: 1 }, AX: { mode: 'MPR', thickness: 1 } });
const panePlane = { MS: 'SAG', MC: 'COR', MA: 'AX' } as const;
const toolItems: { id: Tool; label: string; icon: typeof Ruler; hint: string }[] = [
  { id: 'scroll', label: 'Listələ', icon: MoveVertical, hint: 'S' },
  { id: 'arrow', label: 'Ox (Arrow)', icon: ArrowUpRight, hint: 'O' },
  { id: 'pencil', label: 'Qələm (Pencil)', icon: Pencil, hint: 'Q' },
  { id: 'cursor3d', label: '3D kursor', icon: Crosshair, hint: 'K' },
  { id: 'wl', label: 'WL / WW', icon: SlidersHorizontal, hint: 'W / Ü' },
  { id: 'pan', label: 'Pan', icon: Hand, hint: 'P' },
  { id: 'zoom', label: 'Zoom', icon: MoveDiagonal2, hint: 'Z' },
  { id: 'length', label: 'Uzunluq', icon: Ruler, hint: 'L' },
  { id: 'angle', label: 'Bucaq', icon: ScanLine, hint: 'A' },
  { id: 'arch', label: 'Tağ bucağı və hündürlük', icon: Triangle, hint: 'T' },
  { id: 'cobb', label: 'Cobb bucağı', icon: Waypoints, hint: 'C' },
  { id: 'ellipse', label: 'Ellips ROI', icon: CircleDot, hint: 'E' },
  { id: 'hu', label: 'HU nöqtəsi', icon: Focus, hint: 'H' },
  { id: 'deviation', label: 'Deviation', icon: Crosshair, hint: 'D' },
  { id: 'erase', label: 'Ölçməni sil', icon: Eraser, hint: 'X' },
];
const measureTools = toolItems.filter(t => ['arrow', 'pencil', 'cursor3d', 'length', 'angle', 'arch', 'cobb', 'ellipse', 'hu', 'deviation', 'erase'].includes(t.id));
const viewTools = toolItems.filter(t => ['scroll', 'wl', 'pan', 'zoom'].includes(t.id));
const presets = [
  { label: 'Abdomen', ww: 400, wl: 50 }, { label: 'Ağciyər', ww: 1500, wl: -600 },
  { label: 'Sümük', ww: 1800, wl: 400 }, { label: 'Beyin', ww: 80, wl: 40 },
];

const modalityLabel = (code: string) => ({ CT: 'KT', MR: 'MRT', DX: 'Rentgen', CR: 'Rentgen', DR: 'Rentgen', RG: 'Rentgen', XA: 'Rentgen', US: 'USM' }[code.toUpperCase()] || code.toUpperCase());
type ModalityGroup = { code: string; series: { item: Series; index: number }[] };
type StudyGroup = { id: string; date: string; modalities: ModalityGroup[] };
type PatientGroup = { id: string; name: string; patientId: string; studies: StudyGroup[] };
function groupSeries(series: Series[]): PatientGroup[] {
  const patients = new Map<string, PatientGroup>();
  series.forEach((item, index) => {
    const patientKey = item.patientId !== '—' ? `id:${item.patientId}` : `name:${item.patient.trim().toLowerCase()}|${item.birth}`;
    let patient = patients.get(patientKey);
    if (!patient) { patient = { id: patientKey, name: item.patient, patientId: item.patientId, studies: [] }; patients.set(patientKey, patient); }
    const studyKey = item.studyId || item.date || 'naməlum';
    let study = patient.studies.find(group => group.id === studyKey);
    if (!study) { study = { id: studyKey, date: item.date, modalities: [] }; patient.studies.push(study); }
    let modality = study.modalities.find(group => group.code === item.modality);
    if (!modality) { modality = { code: item.modality, series: [] }; study.modalities.push(modality); }
    modality.series.push({ item, index });
  });
  return [...patients.values()];
}
function mprIntersection(images: Record<string, string>): Point3 | null {
  const geometries = ['MS','MC','MA'].map(panel => getLocalizerGeometry(images[panel] || ''));
  if (geometries.some(geometry => !geometry)) return null;
  return intersectPlanes(geometries.map(geometry => geometry!));
}
function age(birth: string, study: string) {
  if (birth?.length !== 8 || study?.length !== 8) return '—';
  return `${+study.slice(0, 4) - +birth.slice(0, 4) - Number(study.slice(4) < birth.slice(4))} yaş`;
}

function ViewportPane({ windowLevels, windowingSourceId, cursor, onCursor, hideText, id, series, initialImageId, selected, tool, preset, resetToken, clearToken, ready, marks, selectedMarkId, localizers, otherImages, reconstruction, viewAnchor, expanded, concealed, onImageChange, onMoveSource, onMoveIntersection, loadingProgress, onRotateSource, onRotateStart, onPreviewRotateSource, onAddMark, onUpdateMark, onRemoveMark, onSelectMark, onClearImage, onSelect, onToggleMaximize, onDropSeries }: {
  windowLevels: WindowLevels; windowingSourceId?: string;
  cursor: CursorPosition | null; onCursor: (position: CursorPosition) => void; hideText: boolean;
  id: string; series?: Series; selected: boolean; tool: Tool; preset: Preset; resetToken: number; ready: boolean;
  initialImageId?: string;
  clearToken: number; marks: LocalMark[]; selectedMarkId: string | null; localizers: boolean; otherImages: { panel: string; imageId: string }[];
  reconstruction?: { mode: MprMode; thickness: number };
  viewAnchor?: Point3 | null; expanded?: boolean; concealed?: boolean;
  onMoveIntersection?: (world: Point3) => void; loadingProgress?: LoadingProgress | null;
  onImageChange: (panel: string, imageId: string) => void; onMoveSource: (panel: string, world: Point3) => void;
  onRotateSource?: (sourcePanel: string, targetPanel: string, angleRadians: number) => void;
  onRotateStart?: (sourcePanel: string, targetPanel: string) => void;
  onPreviewRotateSource?: (sourcePanel: string, targetPanel: string, angleRadians: number) => void;
  onAddMark: (mark: LocalMark) => void; onUpdateMark: (id: string, patch: Partial<LocalMark>) => void;
  onRemoveMark: (id: string) => void; onClearImage: (imageId: string) => void;
  onSelectMark: (id: string) => void; onSelect: () => void; onToggleMaximize: () => void; onDropSeries: (id: string) => void;
}) {
  const {limited}=useViewerLicense();
  const limitedRef = useRef(limited);
  limitedRef.current = limited;
  const elementRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLElement>(null);
  const [editingArrow,setEditingArrow]=useState<string|null>(null);
  const groupRef = useRef<any>(null);
  const requestRef = useRef(0);
  const stackQueue = useRef<Promise<void>>(Promise.resolve());
  const stackSeries = useRef('');
  const [enabled, setEnabled] = useState(false);
  const [viewport, setViewport] = useState<Core.Types.IStackViewport | null>(null);
  const [imageId, setImageId] = useState('');
  const lastClear = useRef(clearToken);
  const lastReset = useRef(resetToken);
  const lastPreset = useRef<number | undefined>(undefined);
  const windowingScope = useRef({seriesId: windowingSourceId || series?.id, modality: series?.modality, mpr: !!reconstruction});
  windowingScope.current = {seriesId: windowingSourceId || series?.id, modality: series?.modality, mpr: !!reconstruction};
  useEffect(()=>setEditingArrow(null),[imageId]);
  const [slice, setSlice] = useState(0);
  const [ww, setWW] = useState<number | null>(null);
  const [wl, setWL] = useState<number | null>(null);
  const [orientation, setOrientation] = useState({left:'',right:'',top:'',bottom:''});
  const [error, setError] = useState('');
  const viewportId = `panel-${id}`;
  const navigate = useStackNavigation(viewport, imageId, setError);

  useEffect(() => {
    if (!ready || !elementRef.current) return;
    const element = elementRef.current;
    let disposed = false;
    let group: any;
    let viewer: Awaited<ReturnType<typeof getViewer>>;
    (async () => {
      viewer = await getViewer();
      if (disposed) return;
      viewer.engine.enableElement({ viewportId, element, type: viewer.core.Enums.ViewportType.STACK });
      group = viewer.tools.ToolGroupManager.createToolGroup(`group-${id}`);
      groupRef.current = group;
      [viewer.tools.WindowLevelTool, viewer.tools.PanTool, viewer.tools.ZoomTool, viewer.tools.LengthTool,
       viewer.tools.AngleTool, viewer.tools.EllipticalROITool, viewer.tools.EraserTool]
        .forEach(T => group.addTool(T.toolName));
      group.addTool(viewer.tools.CobbAngleTool.toolName, {
        getTextLines: (data: { cachedStats?: Record<string, { angle?: number }> }, targetId: string) => {
          const angle = data.cachedStats?.[targetId]?.angle;
          return Number.isFinite(angle) ? [`${Math.min(angle!, 180 - angle!).toFixed(2)}°`] : undefined;
        },
      });
      group.addViewport(viewportId, viewer.engine.id);
      const resizeObserver = new ResizeObserver(() => {
        if (viewer.engine.getViewport(viewportId)) viewer.engine.resize(true, true);
      });
      resizeObserver.observe(element);
      const stopWindowing = bindWindowing(viewer.engine.getViewport(viewportId) as Core.Types.IStackViewport,
        id, windowLevels, viewer.core.Enums.Events, getDefaultWindow, () => windowingScope.current);
      const sync = () => {
        const vp = viewer.engine.getViewport(viewportId) as Core.Types.IStackViewport;
        setSlice(vp.getCurrentImageIdIndex());
        const currentImageId = vp.getCurrentImageId() || '';
        setImageId(currentImageId); onImageChange(id, currentImageId);
        if (getLocalizerGeometry(currentImageId)) {
          const bounds = element.getBoundingClientRect();
          const center = vp.canvasToWorld([bounds.width / 2, bounds.height / 2]);
          const direction = (x: number, y: number) => {
            const point = vp.canvasToWorld([x,y]);
            const vector = point.map((value,i) => value - center[i]);
            const length = Math.hypot(...vector);
            return vector.map((value,i) => ({ magnitude: Math.abs(value) / (length || 1), letter: [['R','L'],['A','P'],['I','S']][i][value >= 0 ? 1 : 0] })).filter(item => item.magnitude > .2).sort((a,b) => b.magnitude-a.magnitude).map(item => item.letter).join('');
          };
          const next = {left:direction(0,bounds.height/2),right:direction(bounds.width,bounds.height/2),top:direction(bounds.width/2,0),bottom:direction(bounds.width/2,bounds.height)};
          setOrientation(current => JSON.stringify(current) === JSON.stringify(next) ? current : next);
        } else setOrientation(current => current.left ? {left:'',right:'',top:'',bottom:''} : current);
        const range = vp.getProperties().voiRange;
        if (range) { setWW(Math.round(range.upper - range.lower)); setWL(Math.round((range.upper + range.lower) / 2)); }
      };
      element.addEventListener(viewer.core.Enums.Events.STACK_NEW_IMAGE, sync);
      element.addEventListener(viewer.core.Enums.Events.VOI_MODIFIED, sync);
      element.addEventListener(viewer.core.Enums.Events.IMAGE_RENDERED, sync);
      const wheel = (ev: WheelEvent) => {
        ev.preventDefault();
        ev.stopPropagation();
        const vp = viewer.engine.getViewport(viewportId) as Core.Types.IStackViewport;
        const imageIds = vp?.getImageIds?.() || [];
        const direction = Math.sign(ev.deltaY);
        if (!imageIds.length || !direction) return;
        if (ev.ctrlKey) {
          if (!limitedRef.current) {
            const delta = ev.deltaY * (ev.deltaMode === 1 ? 16 : ev.deltaMode === 2 ? element.clientHeight : 1);
            vp.setZoom(Math.max(0.1, Math.min(20, vp.getZoom() * Math.exp(-Math.max(-200, Math.min(200, delta)) * 0.002))));
            vp.render();
          }
          return;
        }
        const next = (vp.getCurrentImageIdIndex() + direction + imageIds.length) % imageIds.length;
        void vp.setImageIdIndex(next);
      };
      // Capture on the whole panel so drawing/localizer overlays use the same controls.
      const panel = element.parentElement!;
      panel.addEventListener('wheel', wheel, { passive: false, capture: true });
      (element as any).__cleanup = () => {
        stopWindowing(); resizeObserver.disconnect();
        element.removeEventListener(viewer.core.Enums.Events.STACK_NEW_IMAGE, sync);
        element.removeEventListener(viewer.core.Enums.Events.VOI_MODIFIED, sync);
        element.removeEventListener(viewer.core.Enums.Events.IMAGE_RENDERED, sync);
        panel.removeEventListener('wheel', wheel, { capture: true });
      };
      setViewport(viewer.engine.getViewport(viewportId) as Core.Types.IStackViewport);
      setEnabled(true);
    })().catch(e => setError(`Görüntüləmə başladıla bilmədi: ${String(e)}`));
    return () => {
      disposed = true; requestRef.current++;
      (element as any).__cleanup?.();
      if (group) viewer.tools.ToolGroupManager.destroyToolGroup(`group-${id}`);
      if (viewer?.engine.getViewport(viewportId)) viewer.engine.disableElement(viewportId);
      groupRef.current = null; setEnabled(false); setViewport(null); setImageId('');
    };
  }, [ready, id, viewportId, onImageChange, windowLevels]);

  useEffect(() => {
    if (!enabled || !series?.imageIds.length) return;
    const token = ++requestRef.current;
    stackQueue.current = stackQueue.current.catch(() => {}).then(async () => {
      if (token !== requestRef.current) return;
      const { engine } = await getViewer();
      const vp = engine.getViewport(viewportId) as Core.Types.IStackViewport;
      if (!vp || token !== requestRef.current) return;
      const extending = stackSeries.current === series.id;
      const current = vp.getCurrentImageId();
      const initialIndex = series.imageIds.indexOf((series.initialImageId || (extending && current && series.imageIds.includes(current) ? current : initialImageId)) || '');
      const camera = extending ? vp.getCamera() : null;
      const presentation = extending && reconstruction ? vp.getViewPresentation() : null;
      const anchorCanvas = camera && viewAnchor ? vp.worldToCanvas(viewAnchor) : null;
      const properties = extending ? vp.getProperties() : null;
      await vp.setStack(series.imageIds, initialIndex >= 0 ? initialIndex : 0);
      if (token !== requestRef.current) return;
      stackSeries.current = series.id;
      if (properties) {
        const { voiRange: _previousImageWindow, ...presentationProperties } = properties;
        vp.setProperties(presentationProperties);
      }
      if (camera && presentation) {
        // Keep screen scale/pan while accepting the NEW reconstructed plane's
        // normal and view-up. Restoring the old world camera corrupts oblique MPR.
        vp.setViewPresentation(presentation);
        vp.setCamera({parallelScale:camera.parallelScale});
        if (anchorCanvas && viewAnchor) {
          const under = vp.canvasToWorld(anchorCanvas), nextCamera = vp.getCamera();
          const delta = viewAnchor.map((v,i)=>v-under[i]);
          vp.setCamera({position:nextCamera.position!.map((v,i)=>v+delta[i]) as Point3,
            focalPoint:nextCamera.focalPoint!.map((v,i)=>v+delta[i]) as Point3});
        }
      } else if (camera) vp.setCamera(camera);
      vp.render(); setSlice(vp.getCurrentImageIdIndex());
      const currentImageId = vp.getCurrentImageId() || '';
      setImageId(currentImageId); onImageChange(id, currentImageId); setError('');
      const range = vp.getProperties().voiRange;
      if (range) { setWW(Math.round(range.upper - range.lower)); setWL(Math.round((range.upper + range.lower) / 2)); }
    }).catch(e => { if (token === requestRef.current) setError(`Seriya açıla bilmədi: ${String(e)}`); });
    return () => { requestRef.current++; };
  // The starting image is read once when the stack changes; scrolling should not reset it.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, series, viewportId, id, onImageChange]);

  useEffect(() => {
    if (!enabled || !groupRef.current) return;
    void getViewer().then(({ tools }) => {
      const mapping: Record<Tool, string> = {
        scroll: '', arrow: '', pencil: '', cursor3d: '', wl: tools.WindowLevelTool.toolName, pan: tools.PanTool.toolName, zoom: tools.ZoomTool.toolName,
        length: tools.LengthTool.toolName, angle: tools.AngleTool.toolName, arch: '',
        cobb: tools.CobbAngleTool.toolName, ellipse: tools.EllipticalROITool.toolName,
        hu: '', deviation: '', erase: tools.EraserTool.toolName,
      };
      const group = groupRef.current;
      if (!group) return;
      Object.values(mapping).filter(Boolean).forEach(name => limited ? group.setToolDisabled(name) : group.setToolPassive(name));
      if (limited) return;
      if (mapping[tool]) group.setToolActive(mapping[tool], { bindings: [{ mouseButton: tools.Enums.MouseBindings.Primary }, { numTouchPoints: 1 }] });
      // Middle-button pan and secondary-button zoom are handled on the viewport
      // container so they work over both Cornerstone and SVG annotations.
    });
  }, [enabled, tool, limited]);

  useEffect(() => {
    if (!enabled || !selected || !series || !preset || preset.panel !== id || preset.seriesId !== series.id) return;
    if (lastPreset.current === preset.token) return;
    lastPreset.current = preset.token;
    void getViewer().then(({ engine }) => {
      const vp = engine.getViewport(viewportId) as Core.Types.IStackViewport;
      if (vp?.getCurrentImageId() !== preset.imageId) return;
      vp.setProperties({ voiRange: { lower: preset.wl - preset.ww / 2, upper: preset.wl + preset.ww / 2 } });
      vp.render(); setWW(preset.ww); setWL(preset.wl);
    });
  }, [enabled, selected, series, preset, viewportId, id]);

  useEffect(() => {
    if (!enabled || !resetToken || resetToken === lastReset.current) return;
    lastReset.current = resetToken;
    if (!selected || !series) return;
    void getViewer().then(({ engine }) => {
      const vp = engine.getViewport(viewportId) as Core.Types.IStackViewport;
      vp.resetCamera(); vp.render();
    });
  }, [enabled, selected, series, resetToken, viewportId]);

  useEffect(() => {
    if (!enabled || !clearToken || clearToken === lastClear.current) return;
    lastClear.current = clearToken;
    if (!selected) return;
    void getViewer().then(({ engine, tools }) => {
      const vp = engine.getViewport(viewportId) as Core.Types.IStackViewport;
      const currentImage = vp.getCurrentImageId();
      if (!currentImage) return;
      tools.cancelActiveManipulations(vp.element);
      vp.element.dispatchEvent(new Event('radaz-clear-measurements'));
      tools.annotation.state.getAllAnnotations()
        .filter(annotation => annotation.metadata?.referencedImageId === currentImage)
        .forEach(annotation => tools.annotation.state.removeAnnotation(annotation.annotationUID!));
      onClearImage(currentImage);
      vp.render();
    });
  }, [enabled, selected, clearToken, viewportId, onClearImage]);

  return <section ref={containerRef} data-has-image={!!imageId} data-panel={id} data-expanded={expanded || undefined} aria-hidden={concealed || undefined} className={`viewport ${selected ? 'active' : ''} ${hideText ? 'hide-image-text' : ''} ${tool === 'scroll' ? 'touch-scroll-mode' : ''}`} onClick={onSelect} onDoubleClick={event=>{
    if(limited||event.button!==0||event.defaultPrevented||performance.now()<Number(containerRef.current?.dataset.suppressMaximizeUntil||0))return;
    if(event.target instanceof Element&&event.target.closest('button,input,textarea,select,[role="menu"],[role="button"],.measurement-menu,.localizer-overlay,.measurement-overlay,.drawing-overlay'))return;
    onToggleMaximize?.();
  }}
    onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }}
    onDrop={e => { e.preventDefault(); const uid = e.dataTransfer.getData('application/x-series-id'); if (uid) onDropSeries(uid); }}
    aria-label={`Görüntü paneli ${id}`}>
    <div className="dicom-canvas" ref={elementRef} onContextMenu={e => e.preventDefault()} />
    {!limited && <MeasurementOverlay element={elementRef.current} viewport={viewport} imageId={imageId} modality={series?.modality} tool={tool} marks={marks} selectedMarkId={selectedMarkId}
      onAdd={onAddMark} onUpdate={onUpdateMark} onRemove={onRemoveMark} onSelectMark={onSelectMark}/>}
    {!limited && <LocalizerOverlay element={elementRef.current} viewport={viewport} imageId={imageId} otherImages={otherImages} enabled={localizers} onMoveSource={onMoveSource} onMoveIntersection={onMoveIntersection} targetPanel={id} onRotateSource={onRotateSource} onRotateStart={onRotateStart} onPreviewRotateSource={onPreviewRotateSource}/>}
    <ViewerInteractionOverlay viewport={viewport} element={elementRef.current} imageId={imageId} tool={tool} slice={slice} count={series?.imageIds.length || 0}
      marks={marks} selectedMarkId={selectedMarkId} onSelectMark={onSelectMark} cursor={cursor} onCursor={onCursor} onEditArrow={setEditingArrow} onUpdate={onUpdateMark} onAdd={mark=>{onAddMark(mark);if(mark.kind==='arrow')setEditingArrow(mark.id);}} onRemove={onRemoveMark} onSelect={onSelect} navigate={navigate}/>
    <ViewportMouseControls container={containerRef} element={elementRef.current} viewport={viewport} imageId={imageId} disabled={limited} marks={marks}
      onSelect={onSelect} onRemove={onRemoveMark} onClear={onClearImage} onEditArrow={setEditingArrow}/>
    {editingArrow&&marks.filter(mark=>mark.id===editingArrow&&mark.imageId===imageId&&mark.kind==='arrow').map(mark=><ArrowCommentEditor key={mark.id} mark={mark} onSave={comment=>onUpdateMark(mark.id,{comment})} onClose={()=>setEditingArrow(null)}/>)}
    {loadingProgress && <WorkProgress className="viewport-work-progress" progress={loadingProgress}/>}
    <div className="pane-badge">{id}</div>
    {series ? <>
      <div className="overlay top-left"><strong>{series.patient}</strong><span>{age(series.birth, series.date)}</span><span>{formatDate(series.birth)} doğum</span></div>
      <div className="overlay top-right"><strong>{series.modality} · {series.name}</strong><span>{formatDate(series.date)}</span><span>{reconstruction && `${reconstruction.mode} · ${reconstruction.thickness} mm`} · Seriya {series.number}</span></div>
      <div className="overlay bottom-left"><span>WL {wl ?? '—'} · WW {ww ?? '—'}</span>{orientation.left && <span>Sol: {orientation.left} · Sağ: {orientation.right}</span>}</div>
      <div className="overlay bottom-right"><span>İmage {slice + 1} / {series.imageIds.length}</span><span>{id === 'MS' ? 'SAG' : id === 'MC' ? 'COR' : id === 'MA' ? 'AX' : planeLabel(getLocalizerGeometry(imageId))} · {series.modality}</span></div>
      {id.startsWith('M') && id !== 'MA' && <><span className="mpr-orientation-top">{orientation.top}</span><span className="mpr-orientation-bottom">{orientation.bottom}</span></>}
      {error && <div className="pane-error" role="alert">{error}</div>}
    </> : <div className="drop-placeholder"><ScanSearch size={34} strokeWidth={1.2}/><strong>Panel {id}</strong><span>Seriyanı buraya sürükləyin və ya siyahıdan seçin</span></div>}
  </section>;
}

export default function Home({ detachedMode }: { detachedMode?: DetachedMode }) {
  const {limited,label:licenseStatus}=useViewerLicense();
  const [ready, setReady] = useState(false);
  const [seriesList, setSeriesList] = useState<Series[]>([]);
  const [assigned, setAssigned] = useState<Record<string, string>>({});
  const [active, setActive] = useState('A');
  const [layout, setLayout] = useState({ rows: 1, columns: 1 });
  const [layoutHover, setLayoutHover] = useState({ rows: 1, columns: 1 });
  const [layoutOpen, setLayoutOpen] = useState(false);
  const [tool, setTool] = useState<Tool>('wl');
  const [hideText, setHideText] = useState(false);
  const [railHidden, setRailHidden] = useState(false);
  const [cursor, setCursor] = useState<CursorPosition | null>(null);
  useEffect(() => { if (matchMedia('(pointer: coarse)').matches) setTool('scroll'); }, []);
  const [localizers, setLocalizers] = useState(true);
  const [currentImages, setCurrentImages] = useState<Record<string, string>>({});
  const [preset, setPreset] = useState<Preset>(null);
  const windowLevels = useRef(new WindowLevels()).current;
  useEffect(() => connectWindowLevels(windowLevels, new BroadcastChannel('radaz-series-windowing')), [windowLevels]);
  const [resetToken, setResetToken] = useState(0);
  const [clearToken, setClearToken] = useState(0);
  const [marks, setMarks] = useState<LocalMark[]>([]);
  const [selectedMarkId, setSelectedMarkId] = useState<string | null>(null);
  const [maximizedPane, setMaximizedPane] = useState<string | null>(null);
  const [maximizedMprPane, setMaximizedMprPane] = useState<string | null>(null);
  const [datasetVersion, setDatasetVersion] = useState(0);
  const [workspace, setWorkspace] = useState<'viewer' | 'mpr' | '3d'>(detachedMode || 'viewer');
  useEffect(()=>{if(limited){setTool('scroll');setLayout({rows:1,columns:1});setActive('A');setMaximizedPane(null);setLocalizers(false);setSelectedMarkId(null);setWorkspace('viewer');}},[limited]);
  const [mprSettings, setMprSettings] = useState<MprSettings>(newMprSettings);
  const [mprData, setMprData] = useState<MprData | null>(null);
  const mprDataRef = useRef<MprData | null>(null);
  const gestureRef = useRef<{ sourcePanel: string; targetPanel: string; base: MprOrientations; axis: Point3; pivot: Point3; source: Series; last: number } | null>(null);
  const [mprActive, setMprActive] = useState('MA');
  const [volumePreset, setVolumePreset] = useState<VolumePreset>('bone');
  const [volumeThreshold, setVolumeThreshold] = useState(volumeStyles[0].threshold);
  const [volumeOpacity, setVolumeOpacity] = useState(volumeStyles[0].opacity);
  const [volumeSettings, setVolumeSettings] = useState<VolumeRenderSettings>(volumeStyles[0].lighting);
  const [volumeResetToken, setVolumeResetToken] = useState(0);
  const [mprError, setMprError] = useState('');
  const [importOpen, setImportOpen] = useState(false);
  const [importBusy, setImportBusy] = useState(false);
  const [importQueue, setImportQueue] = useState<ImportSource[]>([]);
  const [status, setStatus] = useState('DICOM faylı, CD/DVD və ya arxiv müayinəsi açın');
  const fileRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);
  const zipRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<Series[]>([]);
  const importEpoch = useRef(0);
  const sourceSerial = useRef(0);
  const openedFiles = useRef<File[]>([]);
  const mediaFiles = useRef(new Set<string>());
  const mediaSeries = useRef(new Map<string, Series>());
  const mergeMedia = (items: Series[]) => {
    const copies = [...mediaSeries.current.values()];
    return [...items.filter(item => !copies.some(copy => copy.id === item.id || copy.id.replace(/^media:[^:]+:/, '') === item.id)), ...copies];
  };
  const mediaOrder = useRef(new Map<string, { id: string; n: number; sop: string }[]>());
  const preferredMediaSeries = useRef<string | undefined>(undefined);
  // Disc watching belongs to this Viewer; archive/PACS tabs must start with it off.
  const [mediaEnabled, setMediaEnabled] = useState(false);
  const [mediaFilter, setMediaFilter] = useState<string[] | undefined>();
  const [mediaProgress, setMediaProgress] = useState<MediaProgress | null>(null);
  const [loadProgress, setLoadProgress] = useState<LoadingProgress | null>(null);
  const [mprProgress, setMprProgress] = useState<LoadingProgress | null>(null);
  const mprBuildEpoch = useRef(0);
  const mediaId = (session: string, item: MediaImage) => `media:${item.archived ? "archive" : session}:${item.studyId}/${item.seriesUID}`;
  const channels = useRef<Map<DetachedMode | 'report', BroadcastChannel>>(new Map());
  const detachedWindows=useRef(new Map<DetachedMode,Window>());
  const detachedSources=useRef(new Map<DetachedMode,()=>void>());
  const selectedIdRef = useRef<string | undefined>(undefined);
  selectedIdRef.current=assigned[active];
  const connectHandoff = (mode: DetachedMode | 'report', token: string) => {
    if(mode!=='report'){
      detachedSources.current.get(mode)?.();
      detachedSources.current.set(mode,publishDetachedSource(token,()=>{
        const selected=listRef.current.find(s=>s.id===selectedIdRef.current)||listRef.current[0];
        return {revision:selected?`${selected.id}:${selected.imageIds.join(',')}:${selected.loading}`:'empty',
          series:selected?[{...selected,images:shareLocalDicoms(selected.imageIds)}]:[],preferredSeriesId:selected?.id};
      }));
    }
    channels.current.get(mode)?.close();
    const channel = new BroadcastChannel(`radaz-${token}`);
    // Capture the selected series at the moment the Report button is pressed.
    const selected = listRef.current.find(s => s.id === selectedIdRef.current);
    const reportIds = selected ? [...selected.imageIds] : [];
    const preferredSeriesId = selected?.id.replace(/^media:[^:]+:/, '');
    channel.onmessage = event => {
      if (event.data?.kind !== 'READY') return;
      if (mode !== 'report') { channel.postMessage({kind:'SHARED_READY'}); return; }
      void (async () => {
        const diskSources = reportIds.map(getDiskDicomSource);
        if (diskSources.length && diskSources.every(Boolean)) {
          channel.postMessage({kind:'MEDIA_REPORT', sources:diskSources, preferredSeriesId, mediaSessions:selected?.mediaSession && !selected.archived ? [selected.mediaSession] : []}); return;
        }
        const files: File[] = [];
        for (const id of reportIds) {
          const bytes = await getOriginalDicom(id);
          if (bytes) files.push(new File([bytes as BlobPart], `${id.replace(':','-')}.dcm`, {type:'application/dicom'}));
        }
        channel.postMessage({kind:'LOAD', files, preferredSeriesId, mediaSessions:selected?.mediaSession && !selected.archived ? [selected.mediaSession] : []});
      })().catch(() => setStatus('Hesabat üçün seçilmiş seriya oxunmadı; mənbə diski yoxlayın.'));
    };
    channels.current.set(mode,channel);
    return channel;
  };
  const onAddMark = useCallback((mark: LocalMark) => setMarks(current => [...current, mark]), []);
  const onUpdateMark = useCallback((id: string, patch: Partial<LocalMark>) => setMarks(current => current.map(mark => mark.id === id ? { ...mark, ...patch } : mark)), []);
  const onRemoveMark = useCallback((id: string) => { setMarks(current => current.filter(mark => mark.id !== id)); setSelectedMarkId(current => current === id ? null : current); }, []);
  const onClearImage = useCallback((imageId: string) => setMarks(current => current.filter(mark => mark.imageId !== imageId)), []);
  const onImageChange = useCallback((panel: string, imageId: string) => {
    setCurrentImages(current => current[panel] === imageId ? current : { ...current, [panel]: imageId });
    const source = listRef.current.find(s => s.mediaSession && !s.thumb && s.imageIds.includes(imageId));
    const thumb = source && thumbnailLocalDicom(imageId);
    if (source && thumb) {
      const updated = {...source, thumb};
      if (mediaSeries.current.has(source.id)) mediaSeries.current.set(source.id, updated);
      const next = listRef.current.map(s => s.id === source.id ? updated : s); listRef.current=next; setSeriesList(next);
    }
  }, []);

  useEffect(() => {
    // The directory picker returns every file under the chosen folder, including nested folders.
    for (const input of [folderRef.current]) {
      input?.setAttribute('webkitdirectory', '');
      input?.setAttribute('directory', '');
    }
  }, []);

  useEffect(() => {
    if (!ready || !mediaEnabled) return;
    const selectionEpoch = importEpoch.current, initialSelection = selectedIdRef.current;
    return watchRemovableMedia({
      discovered(session, images) {
        const first = !mediaFiles.current.has(session);
        // A slow first disc read must not replace a study opened after import began.
        const showDisc = first && importEpoch.current === selectionEpoch && selectedIdRef.current === initialSelection;
        if (first) mediaFiles.current.add(session);
        if (showDisc) {
          setLayout({ rows: 1, columns: 1 }); setLayoutOpen(false); setMaximizedPane(null); setMaximizedMprPane(null);
          setActive('A'); setCurrentImages({}); setSelectedMarkId(null); setPreset(null);
          setWorkspace(detachedMode || 'viewer'); setDatasetVersion(v => v + 1);
        }
        let next = [...mediaSeries.current.values()];
        for (const item of images) {
          const id = mediaId(session, item), existing = next.find(s => s.id === id);
          if (existing) next = next.map(s => s.id === id ? { ...s, mediaSession: session, discovered: (s.mediaSession === session ? s.discovered || 0 : 0) + 1, loading: true } : s);
          else next.push({ ...item, id, imageIds: [], mediaSession: session, discovered: 1, loading: true });
        }
        mediaSeries.current = new Map(next.map(s => [s.id, s]));
        next = mergeMedia(listRef.current);
        listRef.current = next; setSeriesList(next);
        setAssigned(current => {
          const preferred = next.find(s => s.id === preferredMediaSeries.current);
          if (preferred) { preferredMediaSeries.current = undefined; return { A: preferred.id }; }
          if (showDisc && images.length) return { A: mediaId(session, images[0]) };
          return next.some(s => s.id === current.A) ? current : next[0] ? { A: next[0].id } : {};
        });

      },
      async image(session, item, url, signal) {
        const imageId = registerDiskDicom(item.tags, url, item.archived ? new AbortController().signal : signal);
        if (signal.aborted) { releaseLocalDicoms([imageId]); return; }
        const id = mediaId(session, item);
        if (!mediaSeries.current.has(id)) { releaseLocalDicoms([imageId]); return; }
        const existing = mediaSeries.current.get(id)!;
        const ordered = (mediaOrder.current.get(id) || []).filter(i => existing.imageIds.includes(i.id));
        if (ordered.some(i => i.sop === item.sopUID)) { releaseLocalDicoms([imageId]); return; }
        ordered.push({ id: imageId, n: item.instance, sop: item.sopUID }); ordered.sort((a, b) => a.n - b.n);
        mediaOrder.current.set(id, ordered);
        mediaSeries.current.set(id, { ...existing, imageIds: ordered.map(i => i.id), thumb: existing.thumb || thumbnailLocalDicom(imageId) });
        const next = mergeMedia(listRef.current);
        listRef.current = next; setSeriesList(next);

      },
      removed(session) {
        const removed = listRef.current.filter(s => s.mediaSession === session && !s.archived);
        const ids = new Set(removed.flatMap(s => s.imageIds));
        const next = listRef.current.filter(s => s.mediaSession !== session || s.archived).map(s => s.mediaSession === session ? {...s, mediaSession: undefined, discovered: s.imageIds.length, loading: false} : s);
        for (const [id, s] of mediaSeries.current) if (s.mediaSession === session) {
          if (s.archived) mediaSeries.current.set(id, {...s, mediaSession: undefined, discovered: s.imageIds.length, loading: false});
          else mediaSeries.current.delete(id);
        }
        removed.forEach(s => mediaOrder.current.delete(s.id)); mediaFiles.current.delete(session);
        listRef.current = next; setSeriesList(next);
        setStatus('CD/DVD izləməsi bitdi. Köçürülmüş görüntülər Local arxivdə saxlanıldı.');
        if (!removed.length) return;
        mprBuildEpoch.current++; setMprProgress(null);
        setAssigned(current => Object.fromEntries(Object.entries(current).filter(([, id]) => next.some(s => s.id === id))));
        setCurrentImages(current => Object.fromEntries(Object.entries(current).filter(([, id]) => !ids.has(id))));
        setMarks(current => current.filter(mark => !ids.has(mark.imageId))); setSelectedMarkId(null);
        const mpr = mprDataRef.current;
        if (mpr && removed.some(s => s.id === mpr.sourceId)) {
          mpr.owned.forEach(id => ids.add(id)); mprDataRef.current = null; setMprData(null); gestureRef.current = null;
        }
        setDatasetVersion(v => v + 1);
        void getViewer().then(({ tools }) => {
          tools.annotation.state.getAllAnnotations().filter(a => ids.has(a.metadata?.referencedImageId || ''))
            .forEach(a => tools.annotation.state.removeAnnotation(a.annotationUID!));
        });
        // React first detaches viewports/volumes; then release only this session's records.
        window.setTimeout(() => releaseLocalDicoms([...ids]), 100);
      },
      progress(progress) {
        setMediaProgress(progress);
        if (progress.sessions && (!selectedIdRef.current || mediaSeries.current.has(selectedIdRef.current))) setStatus(`CD/DVD · ${progress.loaded} / ${progress.discovered} görüntü${progress.scanning ? ' · Local arxivə köçürülür…' : progress.loaded + progress.skipped < progress.discovered ? ' · yüklənir…' : ' · Local arxivdən oxunur'}${progress.skipped ? ` · ${progress.skipped} oxunmadı` : ''}`);
        if (!progress.scanning && progress.loaded + progress.skipped >= progress.discovered) {
          let changed = false;
          for (const [id, s] of mediaSeries.current) if (s.loading && s.discovered === s.imageIds.length) {
            mediaSeries.current.set(id, {...s, loading: false}); changed = true;
          }
          if (changed) { const next = mergeMedia(listRef.current); listRef.current = next; setSeriesList(next); }
        }
      },
    }, mediaFilter);
  }, [ready, mediaEnabled, mediaFilter]);

  const importFiles = useCallback(async (files: File[], request = ++importEpoch.current, preferredSeriesId?: string): Promise<boolean> => {
    setLoadProgress({label: 'DICOM yüklənir', done: 0, total: files.length});
    const viewer = await getViewer();
    if (request !== importEpoch.current) return false;
    const found = new Map<string, Series & { ordered: { id: string; n: number }[]; sopUIDs: Set<string> }>();
    const createdIds: string[] = [];
    const acceptedFiles: File[] = [];
    const filesById = new Map<string,File>();
    const invalidIds = new Set<string>();
    let decoded = 0;
    let rejected = 0;
    let ignored = 0;
    let firstError = '';
    let published = false;
    let finished = false;
    const discardUnpublished = () => {
      const visible = new Set(listRef.current.flatMap(s => s.imageIds));
      releaseLocalDicoms(createdIds.filter(id => !visible.has(id)));
    };
    const publish = () => {
      const imported = [...found.values()].map(({ ordered, sopUIDs, ...s }) => {
        const imageIds = ordered.sort((a, b) => a.n - b.n).map(o => o.id);
        return { ...s, imageIds, loading: !finished, thumb: s.thumb || thumbnailLocalDicom(imageIds[0]) };
      });
      if (!imported.length) return;
      if (!published) {
        mprBuildEpoch.current++; setMprProgress(null);
        const previousIds = listRef.current.filter(s => !mediaSeries.current.has(s.id)).flatMap(s => s.imageIds);
        viewer.tools.annotation.state.removeAllAnnotations();
        setMarks([]); setSelectedMarkId(null); setMaximizedPane(null); setMaximizedMprPane(null);
        setLayout({ rows: 1, columns: 1 }); setLayoutOpen(false);
        const chosen = imported.find(item => item.id === preferredSeriesId) || imported[0];
        const preferred = [...mediaSeries.current.values()].find(item => item.id.replace(/^media:[^:]+:/, '') === chosen.id) || chosen;
        setAssigned({ A: preferred.id }); setCurrentImages({}); setActive('A'); setPreset(null);
        const oldMpr = mprDataRef.current;
        if (oldMpr?.owned.length) window.setTimeout(() => releaseLocalDicoms(oldMpr.owned), 100);
        mprDataRef.current = null; setMprData(null);
        setWorkspace(detachedMode || 'viewer'); setMprError('');
        setDatasetVersion(version => version + 1);
        if (previousIds.length) window.setTimeout(() => releaseLocalDicoms(previousIds), 100);
        published = true;
      }
      const combined = mergeMedia(imported);
      listRef.current = combined; setSeriesList(combined); openedFiles.current = [...acceptedFiles];
      setLoadProgress({label: 'DICOM yüklənir', done: decoded, total: acceptedFiles.length || files.length});
      if (!detachedMode) document.title = `${imported[0].patient} · RADAZ Viewer`;
      setStatus(`${imported.length} seriya · ${acceptedFiles.length} / ${files.length} görüntü oxunur…`);
    };
    for (const file of files) {
      if (request !== importEpoch.current) { discardUnpublished(); return false; }
      if (file.name.split('/').pop()?.toUpperCase() === 'DICOMDIR') { ignored++; continue; }
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        if (request !== importEpoch.current) { discardUnpublished(); return false; }
        const ds = parseDicomFile(bytes);
        const get = (tag: string) => ds.string(tag)?.trim() || '';
        const studyId = get('x0020000d');
        const uid = `${studyId}/${get('x0020000e') || file.name}`;
        const sopUID = get('x00080018');
        if (sopUID && found.get(uid)?.sopUIDs.has(sopUID)) { ignored++; continue; }
        const imageId = registerLocalDicom(bytes, ds);
        createdIds.push(imageId);
        filesById.set(imageId,file);
        if (request !== importEpoch.current) { discardUnpublished(); return false; }
        acceptedFiles.push(file);
        const record = found.get(uid) || {
          id: uid, studyId, name: get('x0008103e') || 'Adsız seriya', modality: get('x00080060') || 'DICOM',
          patient: (get('x00100010') || 'Naməlum pasiyent').replaceAll('^', ' '),
          patientId: get('x00100020') || '—', birth: get('x00100030'), date: get('x00080020'),
          number: get('x00200011') || '—', imageIds: [], ordered: [], sopUIDs: new Set<string>(),
          thumb: undefined,
        };
        record.ordered.push({ id: imageId, n: Number(get('x00200013')) || 0 });
        if (sopUID) record.sopUIDs.add(sopUID);
        found.set(uid, record);
        if (acceptedFiles.length === 1 || acceptedFiles.length % 8 === 0 || record.ordered.length === 1) {
          await yieldToBrowser();
        }
      } catch (err) { rejected++; firstError ||= err instanceof Error ? err.message : String(err); }
    }
    if (request !== importEpoch.current) { discardUnpublished(); return false; }
    const rejectImage=(imageId:string,error:unknown)=>{
      rejected++; firstError ||= String(error); invalidIds.add(imageId);
      const index=acceptedFiles.indexOf(filesById.get(imageId)!);if(index>=0)acceptedFiles.splice(index,1);
      for(const [key,record] of found){record.ordered=record.ordered.filter(item=>item.id!==imageId);if(!record.ordered.length)found.delete(key);}
      releaseLocalDicoms([imageId]);
    };
    // Keep the previous examination if none of the new files can be decoded.
    for(const imageId of createdIds){
      try{await viewer.core.imageLoader.loadAndCacheImage(imageId);break;}
      catch(error){rejectImage(imageId,error);}
      if(request!==importEpoch.current){discardUnpublished();return false;}
    }
    if(request!==importEpoch.current){discardUnpublished();return false;}
    publish();
    for (const imageId of createdIds) {
      if(invalidIds.has(imageId))continue;
      if (request !== importEpoch.current) { discardUnpublished(); return false; }
      try { await viewer.core.imageLoader.loadAndCacheImage(imageId); decoded++; }
      catch (err) {
        rejectImage(imageId,err);
      }
      if (decoded % 8 === 0 || decoded === 1) { publish(); await yieldToBrowser(); }
    }
    if (request !== importEpoch.current) { discardUnpublished(); return false; }
    finished = true; publish(); discardUnpublished(); setLoadProgress(null);
    if (published) {
      if (!detachedMode) channels.current.forEach((channel, mode) => { if (mode === 'report') return; try { channel.postMessage({ kind: 'SHARED_READY' }); } catch { /* Closed tabs reconnect on demand. */ } });
      setStatus(`${found.size} seriya · ${files.length - rejected - ignored} DICOM görüntüsü yükləndi${rejected ? ` · ${rejected} fayl keçildi` : ''}`);
      return true;
    }
    releaseLocalDicoms(createdIds);
    setStatus(`Uyğun DICOM görüntüsü tapılmadı${firstError && !firstError.startsWith('dicomParser.') ? `: ${firstError}` : ''}. Əvvəlki müayinə saxlanıldı.`);
    return false;
  }, [detachedMode]);

  useEffect(() => {
    if (!detachedMode) return;
    const handoff = new URLSearchParams(window.location.search).get('handoff');
    if (!handoff) return;
    const channel = new BroadcastChannel(`radaz-${handoff}`);
    let revision='',wasConnected=false,cancelled=false;
    const sync=()=>{
      if(cancelled)return;
      let snapshot=readDetachedSource(handoff);
      if(!snapshot){
        if(!listRef.current.some(series=>series.mediaSession && !series.archived)){
          if(wasConnected)setStatus('Mənbə Viewer bağlıdır. Açılmış görüntü yaddaşda saxlanılır.');
          return;
        }
        // Removable-media tabs must not retain an unmonitored CD after its source closes.
        snapshot={revision:'source-closed',series:[]};
      }
      wasConnected=true;if(snapshot.revision===revision)return;revision=snapshot.revision;
      const previous=listRef.current,oldIds=previous.flatMap(s=>s.imageIds);
      const next:Series[]=snapshot.series.map(({images,...series})=>({...series,imageIds:borrowLocalDicoms(images)}));
      const selected=next.find(s=>s.id===snapshot.preferredSeriesId)||next[0];
      const replacement=previous[0]?.id!==selected?.id||!!previous[0]?.imageIds.length&&previous[0].imageIds[0]!==selected?.imageIds[0];
      if(replacement||!selected){
        mprBuildEpoch.current++;setMprProgress(null);setMprError('');
        const mpr=mprDataRef.current;mprDataRef.current=null;setMprData(null);
        if(mpr)oldIds.push(...mpr.owned);
        setCurrentImages({});setMarks([]);setDatasetVersion(v=>v+1);
        void getViewer().then(v=>v.tools.annotation.state.removeAllAnnotations());
      }
      listRef.current=next;setSeriesList(next);setAssigned(selected?{A:selected.id}:{});
      setLoadProgress(selected?.loading?{label:'Mənbə Viewer-dən yüklənir',done:selected.imageIds.length,total:selected.discovered||0}:null);
      const retained=new Set(next.flatMap(s=>s.imageIds));
      window.setTimeout(()=>releaseLocalDicoms(oldIds.filter(id=>!retained.has(id))),100);
      setStatus(selected?`${selected.name} · ${selected.imageIds.length} kəsit · ortaq DICOM yaddaşı`:'Mənbə Viewer-də seriya seçin');
    };
    channel.onmessage=()=>sync();sync();
    const timer=setInterval(sync,750);
    channel.postMessage({ kind: 'READY' });
    document.title = `RADAZ ${detachedMode.toUpperCase()}`;
    return () => {cancelled=true;clearInterval(timer);channel.close();};
  }, [detachedMode, importFiles]);

  useEffect(() => {
    if (!detachedMode) for (const mode of ['mpr','3d','report'] as const) {
      const token=sessionStorage.getItem(`radaz-${mode}-handoff`);
      if(token) connectHandoff(mode,token);
    }
    return () => { channels.current.forEach(channel => channel.close()); channels.current.clear();detachedSources.current.forEach(dispose=>dispose());detachedSources.current.clear(); };
  // Restore existing handoffs if the parent browser tab reloads.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detachedMode]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await getViewer(); if (cancelled) return; setReady(true);
        if (detachedMode && new URLSearchParams(window.location.search).has('handoff')) {
          if(!listRef.current.length)setStatus('Açıq müayinə gözlənilir…'); return;
        }
        const archivedStudies = detachedMode?[]:requestedStudies(window.location.hash);
        if (archivedStudies.length) {
          setStatus('Local arxivdən müayinə açılır…');
          setLoadProgress({label: 'Local arxiv yüklənir', done: 0, total: 0});
          const files:File[]=[];
          for(const [index,uid] of archivedStudies.entries()){
            if(cancelled)return;
            const studyFiles=await getArchiveFiles(uid,(done,total)=>{if(!cancelled)setLoadProgress({label:`Local arxiv ${index+1}/${archivedStudies.length}`,done,total});});
            if(!studyFiles.length)throw Error(`Seçilmiş müayinə arxivdə tapılmadı (${index+1}/${archivedStudies.length})`);
            files.push(...studyFiles);
          }
          if (!cancelled && files.length) await importFiles(files, 0);
          else if (!cancelled) setStatus('Arxiv müayinəsi tapılmadı');
          return;
        }
        if (new URLSearchParams(window.location.search).get('pending') === 'pacs') setLoadProgress({label:'PACS yüklənir',done:0,total:0});
      } catch (err) { if (!cancelled && importEpoch.current === 0) { setStatus(`Müayinə açıla bilmədi: ${String(err)}`); setLoadProgress(null); }; }
    })();
    return () => { cancelled = true; };
  // Start with an empty production workspace or the explicitly requested study.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detachedMode]);

  useEffect(() => {
    if (detachedMode || typeof BroadcastChannel === 'undefined') return;
    const load = async (uids: string[]) => {
      const request = ++importEpoch.current;
      setStatus('Local arxivdən müayinə açılır…');
      try {
        const files:File[]=[];
        for(const [index,uid] of uids.entries()){
          const found=await getArchiveFiles(uid,(done,total)=>{if(request===importEpoch.current)setLoadProgress({label:`Local arxiv ${index+1}/${uids.length}`,done,total});});
          if(request!==importEpoch.current)return;
          if(!found.length)throw new Error('Seçilmiş müayinə arxivdə tapılmadı');
          files.push(...found);
        }
        if(await importFiles(files,request))history.replaceState(null,'',`/#archive-studies=${encodeURIComponent(uids.join(','))}`);
      } catch (error) { if (request === importEpoch.current) setStatus(String(error)); }
    };
    return registerViewer(load, (progress,error) => { setLoadProgress(progress); if(error)setStatus(error); });
  }, [detachedMode, importFiles]);

  const openDetached = (mode: DetachedMode) => {
    const existing=detachedWindows.current.get(mode);
    if(existing&&!existing.closed){existing.focus();return;}
    const token=sessionStorage.getItem(`radaz-${mode}-handoff`)||crypto.randomUUID();
    connectHandoff(mode,token);sessionStorage.setItem(`radaz-${mode}-handoff`,token);
    const tab=window.open(`/${mode}?handoff=${encodeURIComponent(token)}`,`radaz-${mode}-${token}`);
    if(tab){detachedWindows.current.set(mode,tab);tab.focus();}
    else setStatus(`${mode.toUpperCase()} səhifəsi bloklandı. Brauzerdə RADAZ üçün yeni vərəqələrə icazə verin.`);
  };

  const openReport = () => {
    const handoff = Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('');
    const channel = connectHandoff('report', handoff);
    sessionStorage.setItem('radaz-report-handoff', handoff);
    const tab = window.open(`/report?handoff=${encodeURIComponent(handoff)}`, '_blank');
    if (!tab) { channel.close(); channels.current.delete('report'); sessionStorage.removeItem('radaz-report-handoff'); setStatus('Hesabat vərəqəsi açıla bilmədi'); }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if(limited)return;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement).tagName) || document.querySelector('[role=dialog], dialog[open]') || (e.target as HTMLElement).isContentEditable) return;
      if(e.ctrlKey&&!e.altKey&&!e.shiftKey&&e.code==='KeyD'){
        e.preventDefault();
        if(workspace!=='3d'&&currentImages[workspace==='mpr'?mprActive:active])setClearToken(value=>value+1);
        return;
      }
      if(e.altKey||e.ctrlKey||e.metaKey)return;
      if (e.key === 'Delete') {
        const panel = workspace === 'mpr' ? mprActive : active;
        const imageId = currentImages[panel];
        if (workspace === '3d' || !imageId) return;
        e.preventDefault();
        const selectedMark = marks.find(mark => mark.id === selectedMarkId && mark.imageId === imageId);
        if (selectedMark) { onRemoveMark(selectedMark.id); return; }
        void getViewer().then(({ tools, engine }) => {
          const selected = tools.annotation.selection.getAnnotationsSelected();
          selected.forEach(uid => {
            const annotation = tools.annotation.state.getAnnotation(uid);
            if (annotation?.metadata?.referencedImageId === imageId) tools.annotation.state.removeAnnotation(uid);
          });
          engine.getViewport(`panel-${panel}`)?.render();
        });
        return;
      }
      const match = e.key.toLowerCase() === 'w' || e.key.toLowerCase() === 'ü' ? toolItems.find(t => t.id === 'wl') : toolItems.find(t => t.hint.toLowerCase() === e.key.toLowerCase());
      if (match) { e.preventDefault(); setTool(match.id); }
      if (e.key === '1') { setLayout({ rows: 1, columns: 1 }); setActive('A'); setMaximizedPane(null); }
      if (e.key === '2') { setLayout({ rows: 1, columns: 2 }); setMaximizedPane(null); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [workspace, active, mprActive, currentImages, marks, selectedMarkId, onRemoveMark, limited]);

  useEffect(() => {
    type Context = { registerTool: (tool: { name: string; title: string; description: string; inputSchema: object; annotations: object; execute: (input: any) => Promise<object> }, options: { signal: AbortSignal }) => void | Promise<void> };
    const context = (document as Document & { modelContext?: Context }).modelContext;
    if (limited || !context?.registerTool) return;
    const controller = new AbortController();
    const register = (tool: Parameters<Context['registerTool']>[0]) => {
      void Promise.resolve(context.registerTool(tool, { signal: controller.signal })).catch(() => {});
    };
    register({ name: 'set_viewer_layout', title: 'Panel düzülüşünü dəyiş',
      description: 'DICOM viewer görüntü panellərini 1–5 sətir və 1–5 sütun üzrə düz.',
      inputSchema: { type: 'object', properties: { rows: { type: 'integer', minimum: 1, maximum: 5 }, columns: { type: 'integer', minimum: 1, maximum: 5 } }, required: ['rows', 'columns'], additionalProperties: false },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      async execute(input) {
        if (![input?.rows, input?.columns].every(n => Number.isInteger(n) && n >= 1 && n <= 5)) throw new Error('Sətir və sütun sayı 1–5 olmalıdır');
        setLayout({ rows: input.rows, columns: input.columns });
        setMaximizedPane(null);
        setActive(current => current.charCodeAt(0) - 65 < input.rows * input.columns ? current : 'A');
        await new Promise(resolve => requestAnimationFrame(resolve));
        return { rows: input.rows, columns: input.columns, panes: input.rows * input.columns };
      } });
    register({ name: 'set_active_series', title: 'Seriyanı panelə yerləşdir',
      description: 'Siyahıdakı DICOM seriyasını seçilmiş görüntü panelində aç.',
      inputSchema: { type: 'object', properties: { seriesId: { type: 'string' }, panel: { type: 'string', description: 'A–Y arası açıq panel hərfi' } }, required: ['seriesId', 'panel'], additionalProperties: false },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      async execute(input) {
        if (typeof input?.panel !== 'string' || !/^[A-Y]$/.test(input.panel)) throw new Error('Panel A–Y arası olmalıdır');
        const match = seriesList.find(s => s.id === input.seriesId);
        if (!match) throw new Error('Seriya tapılmadı');
        const index = input.panel.charCodeAt(0) - 65;
        if (index >= layout.rows * layout.columns) throw new Error('Bu panel cari düzülüşdə açıq deyil');
        setAssigned(current => ({ ...current, [input.panel]: match.id }));
        setCurrentImages(current => ({ ...current, [input.panel]: '' }));
        setActive(input.panel);
        await new Promise(resolve => requestAnimationFrame(resolve));
        return { panel: input.panel, seriesId: match.id, series: match.name };
      } });
    return () => controller.abort();
  }, [seriesList, layout, limited]);
  const place = (seriesId: string, panel: string) => {
    const next = seriesList.find(series => series.id === seriesId);
    const previous = seriesList.find(series => series.id === assigned[active]) || seriesList.find(series => series.id === assigned.A);
    const changedStudy = !!next && next.studyId !== previous?.studyId;
    const target = changedStudy || workspace !== 'viewer' ? 'A' : panel;
    if (changedStudy) {
      setLayout({ rows: 1, columns: 1 }); setLayoutOpen(false); setMaximizedPane(null); setMaximizedMprPane(null);
      setSelectedMarkId(null); setDatasetVersion(v => v + 1);
    }
    setAssigned(current => ({ ...(changedStudy ? {} : current), [target]: seriesId }));
    setCurrentImages(current => ({ ...(changedStudy ? {} : current), [target]: '' }));
    setActive(target); setPreset(null); setWorkspace('viewer');
  };
  const onMoveSource = useCallback((panel: string, world: Point3) => {
    const source = seriesList.find(item => item.id === assigned[panel]);
    if (!source) return;
    const index = closestSlice(source.imageIds, world, getLocalizerGeometry);
    if (index === null) return;
    void getViewer().then(({ engine }) => {
      const viewport = engine.getViewport(`panel-${panel}`) as Core.Types.IStackViewport | undefined;
      if (viewport && viewport.getCurrentImageIdIndex() !== index) void viewport.setImageIdIndex(index);
    });
  }, [assigned, seriesList]);
  const queueFiles = (files: File[], kind: 'Qovluq' | 'ZIP') => {
    if (!files.length) return;
    if (kind === 'ZIP') {
      setImportQueue(current => [...current, ...files.map(file => ({ id: ++sourceSerial.current, label: file.name, files: [file] }))]);
      return;
    }
    const root = files[0].webkitRelativePath?.split('/')[0] || files[0].name;
    setImportQueue(current => [...current, { id: ++sourceSerial.current, label: `${kind}: ${root}`, files }]);
  };
  const openSources = async (sources: File[]) => {
    if (!sources.length) return;
    const request = ++importEpoch.current;
    setImportBusy(true);
    try {
      setStatus(`${sources.length} mənbə faylı hazırlanır…`);
      const expanded = await expandSources(sources, message => { if (request === importEpoch.current) setStatus(message); });
      if (request !== importEpoch.current) return;
      if (!expanded.length) { setStatus('Seçilən mənbədə fayl yoxdur. Əvvəlki müayinə saxlanıldı.'); return; }
      if (await importFiles(expanded, request)) {
        setImportQueue([]); setImportOpen(false);
        try {
          const count = await saveArchiveFiles(expanded);
          if (request === importEpoch.current && count) setStatus(current => `${current} · ${count} müayinə local arxivdə saxlanıldı`);
        } catch (error) {
          if (request === importEpoch.current) setStatus(current => `${current} · Arxivə saxlamaq alınmadı: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    } catch (err) {
      if (request === importEpoch.current) setStatus(`İdxal alınmadı: ${err instanceof Error ? err.message : String(err)}. Əvvəlki müayinə saxlanıldı.`);
    } finally {
      if (request === importEpoch.current) setImportBusy(false);
    }
  };
  const dropSources = async (items: DataTransferItemList, fallback: FileList) => {
    try { await openSources(await filesFromDrop(items, fallback)); }
    catch (err) { setStatus(`Qovluqlar oxuna bilmədi: ${String(err)}`); }
  };
  const currentSeries = seriesList.find(s => s.id === assigned[active]);
  const volumeSeries = currentSeries?.imageIds.length && currentSeries.imageIds.length >= 3
    ? currentSeries
    : seriesList.filter(s => s.studyId === currentSeries?.studyId && s.imageIds.length >= 3)
      .sort((a, b) => b.imageIds.length - a.imageIds.length)[0];
  const grouped = groupSeries(seriesList);
  const ctVolume = volumeSeries?.modality === 'CT';
  const availableVolumeStyles = volumeStyles.filter(style => ctVolume ? style.key !== 'mr' : ['mr','mip','minip'].includes(style.key));
  useEffect(() => {
    if (!volumeSeries) return;
    const style = volumeStyles.find(item => item.key === (volumeSeries.modality === 'CT' ? 'bone' : 'mr'))!;
    setVolumePreset(style.key); setVolumeThreshold(style.threshold); setVolumeOpacity(style.opacity);
    setVolumeSettings(current => ({...style.lighting, quality:current.quality}));
  }, [volumeSeries?.modality]);
  const buildMpr = async (source: Series, settings: MprSettings, orientations: MprOrientations | null, pivot: Point3 | null, center = false, onlyPlane?: 'SAG'|'COR'|'AX') => {
    const epoch = ++mprBuildEpoch.current;
    const previousData = mprDataRef.current;
    const previous = previousData?.sourceId === source.id ? previousData : null;
    let stacks = previous ? { ...previous.stacks } : { SAG: [] as string[], COR: [] as string[], AX: [] as string[] };
    const created: string[] = [];
    const requested = onlyPlane ? [onlyPlane] : ['AX','COR','SAG'] as const;
    if (!onlyPlane) setMprProgress({label:'MPR hazırlanır',done:0,total:requested.length,unit:'müstəvi',phase:'Aksial görüntü açılır'});
    setMprError(''); setWorkspace('mpr');
    try {
      const { core } = await getViewer();
      await getSeriesVolume(source.imageIds);
      // Do not launch hundreds of optical fetches outside the streaming pool.
      for (let start=0; start<source.imageIds.length; start+=4) {
        if (epoch !== mprBuildEpoch.current) return;
        await Promise.all(source.imageIds.slice(start,start+4).map(id => core.imageLoader.loadAndCacheImage(id)));
      }
      if (epoch !== mprBuildEpoch.current) return;
      for (const [index, plane] of requested.entries()) {
        await yieldToBrowser();
        if (epoch !== mprBuildEpoch.current) break;
        const result = orientations && pivot ? createObliqueMprStacks(source.imageIds,settings,orientations,pivot,[plane]) : createMprStacks(source.imageIds,settings,[plane]);
        created.push(...result[plane].filter(id => !source.imageIds.includes(id)));
        stacks = { ...stacks, [plane]: result[plane] };
        const focus = pivot ? closestSlice(stacks[plane],pivot,getLocalizerGeometry) : null;
        const oldIndex = center ? -1 : previous?.stacks[plane].indexOf(currentImages[{SAG:'MS',COR:'MC',AX:'MA'}[plane]]);
        const position = focus ?? (oldIndex !== undefined && oldIndex >= 0 ? Math.min(oldIndex,stacks[plane].length-1) : Math.floor(stacks[plane].length/2));
        const firstImage = stacks[plane][position];
        await core.imageLoader.loadAndCacheImage(firstImage);
        if (epoch !== mprBuildEpoch.current) break;
        const displayed = mprDataRef.current?.sourceId === source.id ? mprDataRef.current : null;
        const planes = (['SAG','COR','AX'] as const).map((key, number) => displayed?.stacks[key] === stacks[key] ? displayed.planes[number] : ({...source,id:`${source.id}/mpr/${key}`,name:{SAG:'Sagital',COR:'Koronal',AX:'Aksial'}[key],imageIds:stacks[key],initialImageId:key===plane?firstImage:undefined,number:String(number+1),loading:false}));
        const owned = [...stacks.SAG,...stacks.COR,...stacks.AX].filter(id => !source.imageIds.includes(id));
        const next = {sourceId:source.id,stacks,planes,owned,orientations,pivot};
        mprDataRef.current=next;setMprData(next);
        const panel={SAG:'MS',COR:'MC',AX:'MA'}[plane];
        setCurrentImages(images=>({...images,[panel]:firstImage}));
        if(!onlyPlane)setMprProgress({label:'MPR hazırlanır',done:index+1,total:requested.length,unit:'müstəvi',phase:`${planes.find(p=>p.imageIds===stacks[plane])?.name || plane} hazırdır`});
      }
      if(epoch===mprBuildEpoch.current)setMprProgress(null);
    } catch(error) {
      if(epoch===mprBuildEpoch.current){setMprError(error instanceof Error?error.message:String(error));setMprProgress(null);}
    } finally {
      const retained=new Set(mprDataRef.current?.owned || []);
      const obsolete=[...(previousData?.owned || []),...created].filter(id=>!retained.has(id));
      if(obsolete.length)window.setTimeout(()=>releaseLocalDicoms(obsolete),300);
    }
  };
  const openMpr = () => {
    const source = currentSeries?.imageIds.length && currentSeries.imageIds.length >= 3 ? currentSeries : volumeSeries;
    if (!source) { setMprError('MPR üçün əvvəlcə seriya seçin'); setWorkspace('mpr'); return; }
    if(source.loading){setWorkspace('mpr');return;}
    if (mprDataRef.current?.sourceId === source.id) { setWorkspace('mpr'); return; }
    try {
      const keepOrientation = mprDataRef.current?.sourceId === source.id && mprDataRef.current.orientations;
      buildMpr(source, mprSettings, keepOrientation || null, keepOrientation ? mprIntersection(currentImages) : null);
      setMprActive('MA');
    } catch (err) { setMprError(err instanceof Error ? err.message : String(err)); setWorkspace('mpr'); }
  };
  const changeMprSetting = (setting: Partial<MprSettings['SAG']>) => {
    const plane = panePlane[mprActive as keyof typeof panePlane] || 'AX';
    const next = { ...mprSettings, [plane]: { ...mprSettings[plane], ...setting } };
    setMprSettings(next);
    const source = seriesList.find(item => item.id === mprDataRef.current?.sourceId);
    if (!source) return;
    try { buildMpr(source, next, mprDataRef.current?.orientations || null, mprIntersection(currentImages), false, plane); }
    catch (err) { setMprError(err instanceof Error ? err.message : String(err)); }
  };
  const resetMprLines = () => {
    const source = seriesList.find(item => item.id === mprDataRef.current?.sourceId);
    if (!source) return;
    try { buildMpr(source, mprSettings, null, null, true); }
    catch (err) { setMprError(err instanceof Error ? err.message : String(err)); }
  };
  const beginMprRotation = (sourcePanel: string, targetPanel: string) => {
    const data = mprDataRef.current;
    if (!data || sourcePanel === targetPanel) return;
    const source = seriesList.find(item => item.id === data.sourceId);
    const targetGeometry = getLocalizerGeometry(currentImages[targetPanel] || '');
    const pivot = mprIntersection(currentImages);
    if (!source || !targetGeometry || !pivot) return;
    const base = data.orientations || getMprOrientations(source.imageIds[0]);
    if (!base) return;
    gestureRef.current = { sourcePanel, targetPanel, base, axis: normalOf(targetGeometry), pivot, source, last: 0 };
  };
  const updateMprRotation = (sourcePanel: string, targetPanel: string, angleRadians: number, final = false) => {
    if (!Number.isFinite(angleRadians)) return;
    if (!gestureRef.current || gestureRef.current.sourcePanel !== sourcePanel || gestureRef.current.targetPanel !== targetPanel) beginMprRotation(sourcePanel, targetPanel);
    const gesture = gestureRef.current;
    if (!gesture) return;
    if (!final && Math.abs(angleRadians) < .008) return;
    if (!final && performance.now() - gesture.last < 110) return;
    gesture.last = performance.now();
    const sourcePlane = panePlane[sourcePanel as keyof typeof panePlane];
    if (!sourcePlane) return;
    const orientations = { ...gesture.base, [sourcePlane]: rotateMprOrientation(gesture.base[sourcePlane], gesture.axis, angleRadians) };
    try { void buildMpr(gesture.source, mprSettings, orientations, gesture.pivot, false, sourcePlane); }
    catch (err) { setMprError(err instanceof Error ? err.message : String(err)); }
    if (final) gestureRef.current = null;
  };
  const rotateMprSource = (source: string, target: string, radians: number) => updateMprRotation(source, target, radians, true);

  useEffect(() => {
    if (workspace === 'mpr' && ready && !mprData && !mprError && !mprProgress && volumeSeries && !volumeSeries.loading) openMpr();
  // Load the reconstructed planes once the handoff series is available.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspace, ready, mprData, mprError, !!mprProgress, volumeSeries?.id, volumeSeries?.loading]);
  const moveMprSource = (panel: string, world: Point3) => {
    const stack = mprData?.stacks[panel === 'MS' ? 'SAG' : panel === 'MC' ? 'COR' : 'AX'];
    if (!stack) return;
    const index = closestSlice(stack, world, getLocalizerGeometry);
    if (index === null) return;
    void getViewer().then(({ engine }) => {
      const pane = engine.getViewport(`panel-${panel}`) as Core.Types.IStackViewport | undefined;
      if (pane && pane.getCurrentImageIdIndex() !== index) void pane.setImageIdIndex(index);
    });
  };

  const moveMprIntersection = (world: Point3) => {
    for(const panel of ['MS','MC','MA'])moveMprSource(panel,world);
  };

  const onCursor = (position: CursorPosition) => {
    setCursor(position);
    const panels = workspace === 'mpr' && mprData
      ? mprData.planes.map((series, index) => ({ panel: ['MS','MC','MA'][index], series }))
      : Object.entries(assigned).map(([panel, uid]) => ({ panel, series: seriesList.find(item => item.id === uid) }));
    void getViewer().then(({ engine }) => {
      for (const { panel, series } of panels) {
        if (!series) continue;
        const index = closestSlice(series.imageIds, position.world, imageId => {
          const geometry = getLocalizerGeometry(imageId);
          return geometry && sameCoordinateSpace(geometry, position.geometry) ? geometry : null;
        });
        const viewport = engine.getViewport(`panel-${panel}`) as Core.Types.IStackViewport | undefined;
        if (index !== null && viewport && viewport.getCurrentImageIdIndex() !== index) void viewport.setImageIdIndex(index).catch(error => setStatus(String(error)));
      }
    });
  };

  const mprPreview = currentSeries?.imageIds.length && ['CT','MR'].includes(currentSeries.modality) ? currentSeries : seriesList.find(item=>item.imageIds.length && ['CT','MR'].includes(item.modality));
  const sourceLoading: LoadingProgress | null = loadProgress || (mediaProgress?.sessions && (mediaProgress.scanning || mediaProgress.loaded + mediaProgress.skipped < mediaProgress.discovered) ? {label:detachedMode === '3d'?'3D görüntü hazırlanır':'MPR hazırlanır',done:mediaProgress.loaded,total:mediaProgress.discovered,indeterminate:mediaProgress.scanning,phase:'DICOM görüntüləri oxunur'} : null);
  return <main className={`workstation grouped-workstation ${railHidden ? 'rail-hidden' : ''} ${detachedMode ? 'detached' : ''}`} data-mode={detachedMode || 'viewer'} style={measurementVariables as React.CSSProperties}
    onDragOverCapture={event => { if (event.dataTransfer.types.includes('Files')) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; } }}
    onDropCapture={event => {
      if (!event.dataTransfer.types.includes('Files') || (event.target as HTMLElement).closest('.source-list')) return;
      event.preventDefault(); event.stopPropagation();
      if (!limited) void dropSources(event.dataTransfer.items, event.dataTransfer.files);
    }}>
    <header className="topbar">
      {!detachedMode && <div className="brand"><RadazLogo size={34}/><span><strong>RADAZ</strong><small>RADIOLOGY, CONNECTED</small></span></div>}
      <div className="primary-command-row">
        {!detachedMode && <div className="toolbar-group import-command" role="group" aria-label="DICOM idxalı"><DropdownMenu><DropdownMenuTrigger asChild><Button variant="outline" className="header-control" title="DICOM import" aria-label="DICOM import" disabled={importBusy || limited}><FolderOpen size={17}/><span>DICOM import</span><ChevronDown size={14}/></Button></DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="header-menu">
            <DropdownMenuItem onSelect={() => { setImportOpen(true); folderRef.current?.click(); }}><FolderOpen size={16}/> Qovluq aç</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => { setImportOpen(true); zipRef.current?.click(); }}><FileArchive size={16}/> ZIP / RAR aç</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => fileRef.current?.click()}><ScanSearch size={16}/> DICOM faylları</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setImportOpen(true)}><Grid2X2 size={16}/> Bir neçə mənbə seç</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu></div>}
        {!detachedMode && <Button variant="outline" className={`header-control cd-import-command ${mediaEnabled ? 'active' : ''}`} aria-label="CD/DVD import" aria-pressed={mediaEnabled}
          title={mediaEnabled ? 'CD/DVD importunu dayandır; köçürülmüş görüntülər arxivdə qalır' : 'CD/DVD-ni avtomatik aşkar et və aç'} disabled={limited}
          onClick={() => { setMediaEnabled(enabled => !enabled); setRailHidden(false); }}>
          <Disc3 size={18}/><span>CD/DVD import</span>{mediaEnabled && <span className="status-led"/>}
        </Button>}
      {!detachedMode && <div className="workspace-launch toolbar-group" role="group" aria-label="Görüntü rejimi">
        <button type="button" aria-label="2D Viewer" onClick={() => setWorkspace('viewer')}><b>2D</b></button>
        <button type="button" disabled={limited} title="MPR rekonstruksiya" aria-label="MPR rekonstruksiya" onClick={() => openDetached('mpr')}><b className="mode-letter-icon">MPR</b></button>
        <button type="button" disabled={limited} title="3D həcm görüntüləmə" aria-label="3D həcm görüntüləmə" onClick={() => openDetached('3d')}><b className="mode-letter-icon">3D</b></button>
        <button type="button" disabled={limited} title="Radioloji hesabat" aria-label="Radioloji hesabat" onClick={openReport}><FileText size={18}/><span>Hesabat</span></button>
        <button type="button" title="Local arxiv" aria-label="Local arxiv" onClick={async () => { if (!await openRecordsWindow('archive')) setStatus('Local arxiv vərəqəsi açıla bilmədi'); }}><Database size={18}/><span>Local arxiv</span></button>
        <button type="button" title="PACS müayinələri" aria-label="PACS müayinələri" onClick={async () => { if (!await openRecordsWindow('pacs')) setStatus('PACS vərəqəsi açıla bilmədi'); }}><ServerCog size={18}/><span>PACS</span></button>
      </div>}
        {!limited && detachedMode !== '3d' && <ViewerOutputControls panes={Object.entries(currentImages).map(([panel, imageId]) => ({ panel, imageId, series: [...seriesList, ...(mprData?.planes || [])].find(item => item.imageIds.includes(imageId)) }))} panel={workspace === 'mpr' ? mprActive : active} imageId={currentImages[workspace === 'mpr' ? mprActive : active]} series={workspace === 'mpr' ? mprData?.planes.find(item => item.imageIds.includes(currentImages[mprActive])) : currentSeries} allSeries={seriesList} datasetVersion={datasetVersion} onStatus={setStatus}/>}
      </div>
      {workspace === 'mpr' && <>
        <div className="mode-identity" title="MPR rekonstruksiya"><strong><Layers3 size={17}/><span>MPR rekonstruksiya</span></strong><span title={seriesList.find(s => s.id === mprData?.sourceId)?.name || ''}>{seriesList.find(s => s.id === mprData?.sourceId)?.name || currentSeries?.name || 'Seriya seçin'}</span></div>
        <div className="mode-controls mpr-header-controls">
          <div className="mpr-modes" role="group" aria-label="Aktiv MPR panelinin rejimi">{(['MPR','MIP','MinIP','Avg'] as const).map(mode => <button key={mode} type="button" className={mprSettings[panePlane[mprActive as keyof typeof panePlane] || 'AX'].mode === mode ? 'current' : ''} onClick={() => changeMprSetting({ mode })}>{mode}</button>)}</div>
          <label className="mpr-thickness"><span>Qalınlıq</span><input type="range" min="1" max="50" step="1" aria-label="Aktiv MPR panelinin qalınlığı" value={mprSettings[panePlane[mprActive as keyof typeof panePlane] || 'AX'].thickness} onChange={e => changeMprSetting({ thickness: Number(e.currentTarget.value) })}/><output>{mprSettings[panePlane[mprActive as keyof typeof panePlane] || 'AX'].thickness} mm</output></label>
          <button className="mpr-reset" type="button" onClick={resetMprLines} title="MPR xətlərini başlanğıc vəziyyətinə qaytar" aria-label="MPR xətlərini sıfırla"><RotateCcw size={15}/><span>Xətləri sıfırla</span></button>
        </div>
      </>}
      {workspace === '3d' && <>
        <div className="mode-identity"><strong><Box size={17}/> 3D VR</strong><span title={volumeSeries?.name || ''}>{volumeSeries ? `${volumeSeries.name} · ${volumeSeries.imageIds.length} kəsit` : 'Seriya seçin'}</span></div>
        <div className="mode-controls volume-header-controls">
          <DropdownMenu><DropdownMenuTrigger asChild><Button variant="outline" className="header-control volume-preset-trigger" title={`3D preset: ${volumeStyles.find(style => style.key === volumePreset)?.title}`} aria-label="3D göstərmə presetləri"><SlidersHorizontal size={18}/><ChevronDown size={13}/></Button></DropdownMenuTrigger><DropdownMenuContent align="start" className="header-menu volume-preset-menu"><div className="volume-menu-heading">KLİNİK 3D PRESETLƏR</div>{availableVolumeStyles.map(style => <DropdownMenuItem key={style.key} className={volumePreset === style.key ? 'menu-selected' : ''} onSelect={() => { setVolumePreset(style.key); setVolumeThreshold(style.threshold); setVolumeOpacity(style.opacity); setVolumeSettings(current => ({...style.lighting,quality:current.quality})); }}><span className="volume-preset-swatch" style={{ background: style.tone }}/><span className="volume-preset-copy"><strong>{style.title}</strong><small>{style.subtitle}</small></span></DropdownMenuItem>)}</DropdownMenuContent></DropdownMenu>
          <label className="volume-parameter">{ctVolume ? 'HU həddi' : 'İntensivlik'} <input aria-label={ctVolume ? '3D HU həddi' : '3D intensivlik həddi'} type="range" min="-1000" max="1400" step="10" value={volumeThreshold} onChange={event => setVolumeThreshold(+event.currentTarget.value)}/><output>{ctVolume ? volumeThreshold : `${Math.round(volumeThreshold/40.95)}%`}</output></label>
          <label className="volume-parameter">Şəffaflıq <input aria-label="3D şəffaflıq" type="range" min="0.2" max="2" step="0.1" value={volumeOpacity} onChange={event => setVolumeOpacity(+event.currentTarget.value)}/><output>{Math.round(volumeOpacity * 100)}%</output></label>
          <DropdownMenu><DropdownMenuTrigger asChild><Button variant="outline" className="header-control volume-preset-trigger" title="Professional işıq və keyfiyyət ayarları" aria-label="Professional 3D ayarları"><Settings2 size={18}/></Button></DropdownMenuTrigger><DropdownMenuContent align="end" className="header-menu volume-settings-menu"><div className="volume-menu-heading">İŞIQ VƏ RENDER</div><VolumeRenderControls preset={volumePreset} settings={volumeSettings} onChange={setVolumeSettings}/></DropdownMenuContent></DropdownMenu>
          <button className="mpr-reset volume-reset" type="button" onClick={() => setVolumeResetToken(value => value+1)} title="3D görünüşün bucaq, zoom və mövqeyini sıfırla" aria-label="3D görünüşü sıfırla"><RotateCcw size={15}/><span>Görünüşü sıfırla</span></button>
        </div>
      </>}
      <div className="top-actions">

        {!limited && detachedMode !== '3d' && <div className="toolbar-group" role="group" aria-label="Görüntünün görünüşü">
          <Button variant="ghost" className="header-control" aria-label="Yazıları gizlət" aria-pressed={hideText} title={hideText ? 'Yazıları göstər' : 'Yazıları gizlət'} onClick={() => setHideText(value => !value)}>{hideText ? <EyeOff size={18}/> : <Eye size={18}/>}<span>Yazılar</span></Button>
          <ViewerDisplayControls panel={workspace === 'mpr' ? mprActive : active} imageId={currentImages[workspace === 'mpr' ? mprActive : active]} onStatus={setStatus}/>

        </div>}
        {!limited && detachedMode !== '3d' && <div className="toolbar-group" role="group" aria-label="Naviqasiya və ölçmə">{viewTools.map(t => <Button key={t.id} variant="ghost" className={`header-control view-tool ${tool === t.id ? 'selected-tool' : ''}`} aria-pressed={tool === t.id} title={`${t.label} · ${t.hint}`} onClick={() => setTool(t.id)}><t.icon size={17}/><span>{t.label}</span></Button>)}
        <DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" className="header-control" title="Ölçmə alətləri" aria-label="Ölçmə alətləri"><Ruler size={17}/><span>Ölçmə</span><ChevronDown size={14}/></Button></DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="header-menu">{measureTools.map(t => <DropdownMenuItem key={t.id} onSelect={() => setTool(t.id)} className={tool === t.id ? 'menu-selected' : ''}><t.icon size={16}/>{t.label}<kbd>{t.hint}</kbd></DropdownMenuItem>)}<div className="menu-separator"/><DropdownMenuItem onSelect={() => setClearToken(x => x + 1)}><Trash2 size={16}/> Cari kəsitdə hamısını sil<kbd>Ctrl+D</kbd></DropdownMenuItem><div className="menu-hint">Ölçünü seçin · Delete ilə silin</div></DropdownMenuContent>
        </DropdownMenu>
        </div>}
        {!limited && detachedMode !== '3d' && <div className="toolbar-group" role="group" aria-label="Pəncərə və lokayzer">
        <DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" className="header-control" title="Window preset" aria-label="WINDOW PRESET menyusu"><SlidersHorizontal size={17}/><span>Window preset</span><ChevronDown size={14}/></Button></DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="header-menu preset-menu">{presets.map(p => <DropdownMenuItem key={p.label} onSelect={() => { if (workspace === 'mpr' && mprData) { const plane = mprData.planes[{ MS:0, MC:1, MA:2 }[mprActive as 'MS'|'MC'|'MA'] || 0]; setPreset({ ...p, token: Date.now(), panel: mprActive, seriesId: plane.id, imageId: currentImages[mprActive] || '' }); } else if (assigned[active]) setPreset({ ...p, token: Date.now(), panel: active, seriesId: assigned[active], imageId: currentImages[active] || '' }); }}><span>{p.label}</span><small>WL {p.wl} · WW {p.ww}</small></DropdownMenuItem>)}</DropdownMenuContent>
        </DropdownMenu>
        <Button variant="ghost" className={`header-control localizer-toggle ${localizers ? 'is-on' : ''}`} aria-label="Lokayzer xətləri" aria-pressed={localizers} title="Uyğun müstəvilərdəki seriyalar arasında lokayzer xətlərini göstər" onClick={() => setLocalizers(value => !value)}><Crosshair size={17}/><span>Lokayzer</span></Button></div>}
        {!limited && detachedMode !== '3d' && <div className="toolbar-group" role="group" aria-label="Panel düzülüşü və ölçüsü">
        {workspace === 'viewer' && <DropdownMenu open={layoutOpen} onOpenChange={setLayoutOpen}><DropdownMenuTrigger asChild><Button variant="outline" className="header-control layout-trigger" title={`${layout.columns}×${layout.rows} panel düzülüşü`} aria-label="Panel düzülüşü"><Grid2X2 size={18}/><span>{layout.columns}×{layout.rows}</span><ChevronDown size={14}/></Button></DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="layout-menu" onMouseLeave={() => setLayoutHover(layout)}><div className="layout-caption">Panel düzülüşü <strong>{layoutHover.columns} × {layoutHover.rows}</strong></div><div className="layout-matrix" role="grid" aria-label="1-dən 5-ə qədər sətir və sütun seçin">
            {Array.from({ length: 25 }, (_, index) => { const rows = Math.floor(index / 5) + 1, columns = index % 5 + 1; return <button key={index} type="button" role="gridcell" aria-label={`${columns} sütun, ${rows} sətir, ${columns * rows} panel`} aria-selected={layout.rows === rows && layout.columns === columns} className={rows <= layoutHover.rows && columns <= layoutHover.columns ? 'highlighted' : ''} onMouseEnter={() => setLayoutHover({ rows, columns })} onFocus={() => setLayoutHover({ rows, columns })} onClick={() => { setLayout({ rows, columns }); setMaximizedPane(null); setActive(current => current.charCodeAt(0) - 65 < rows * columns ? current : 'A'); setLayoutOpen(false); }}/> })}
          </div></DropdownMenuContent>
        </DropdownMenu>}
        <Button variant="ghost" className="header-control fit-button" onClick={() => setResetToken(x => x + 1)} title="Ekrana sığdır"><Focus size={17}/><span>Ekrana sığdır</span></Button>
        </div>}
        {limited&&<div className="toolbar-group limited-viewer-tools" title="Lisenziyanı aktivləşdirin"><span>Yalnız listələmə</span>{['Pəncərə','Yaxınlaşdır','Ölçmə','Çap','İxrac'].map(label=><Button key={label} disabled className="header-control">{label}</Button>)}</div>}
        <input hidden ref={fileRef} type="file" multiple onChange={e => { const files = Array.from(e.currentTarget.files || []); e.currentTarget.value = ''; void openSources(files); }}/>
        <input hidden ref={folderRef} type="file" multiple onChange={e => { const files = Array.from(e.currentTarget.files || []); e.currentTarget.value = ''; queueFiles(files, 'Qovluq'); }}/>
        <input hidden ref={zipRef} type="file" multiple accept=".zip,.rar,application/vnd.rar,application/x-rar-compressed,application/zip,application/x-zip-compressed" onChange={e => { const files = Array.from(e.currentTarget.files || []); e.currentTarget.value = ''; queueFiles(files, 'ZIP'); }}/>
      </div>
      <div className="toolbar-group help-command"><AppHelpMenu/></div>
    </header>
    <Dialog open={importOpen} onOpenChange={open => { if (!importBusy) setImportOpen(open); }}>
      <DialogContent className="import-dialog" showCloseButton={false}>
        <DialogHeader><DialogTitle>Qovluq və ZIP / RAR import</DialogTitle><DialogDescription>Bir neçə mənbə seçin və hamısını birlikdə açın. Uğurlu idxal əvvəlki seriyaları və ölçmələri əvəz edir.</DialogDescription></DialogHeader>
        <div className="source-buttons">
          <Button variant="outline" disabled={importBusy} onClick={() => folderRef.current?.click()}><FolderOpen size={16}/> Qovluq seç</Button>
          <Button variant="outline" disabled={importBusy} onClick={() => zipRef.current?.click()}><FileArchive size={16}/> ZIP / RAR seç</Button>
        </div>
        <div className="source-list" aria-live="polite" onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }} onDrop={e => { e.preventDefault(); void (async () => { const files = await filesFromDrop(e.dataTransfer.items, e.dataTransfer.files); if (files.length) setImportQueue(current => [...current, { id: ++sourceSerial.current, label: `${files.length} əlavə fayl`, files }]); })().catch(err => setStatus(`Mənbə oxuna bilmədi: ${String(err)}`)); }}>
          {importQueue.length ? importQueue.map(source => <div className="source-row" key={source.id}><span><strong>{source.label}</strong><small>{source.files.length} fayl</small></span><button aria-label={`${source.label} siyahıdan sil`} disabled={importBusy} onClick={() => setImportQueue(current => current.filter(item => item.id !== source.id))}><Trash2 size={15}/></button></div>)
            : <p>Seçilmiş mənbə yoxdur. Hər qovluğu ayrıca seçib bir idxalda aça bilərsiniz.</p>}
        </div>
        <DialogFooter><Button variant="outline" disabled={importBusy} onClick={() => setImportOpen(false)}>Bağla</Button><Button disabled={importBusy || !importQueue.length} onClick={() => { void openSources(importQueue.flatMap(source => source.files)); }}>{importBusy ? 'Açılır…' : `${importQueue.length} mənbəni aç`}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
    <div className="body-grid">
      {!detachedMode && <button type="button" className="series-rail-toggle" aria-label={railHidden ? 'Seriya siyahısını göstər' : 'Seriya siyahısını gizlət'} aria-expanded={!railHidden} aria-controls="series-sidebar" title={railHidden ? 'Seriya siyahısını göstər' : 'Seriya siyahısını gizlət'} onClick={() => setRailHidden(value => !value)}><PanelLeftClose size={17} style={{ transform: railHidden ? 'rotate(180deg)' : undefined }}/></button>}
      {!detachedMode && <aside id="series-sidebar" className="series-rail" onDragOver={e => { if (!e.dataTransfer.types.includes('application/x-series-id')) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } }} onDrop={e => { if (!e.dataTransfer.types.includes('application/x-series-id')) { e.preventDefault(); void dropSources(e.dataTransfer.items, e.dataTransfer.files); } }}>
        <div className="rail-heading"><div><span className="eyebrow">PASİYENT VƏ SERİYA SİYAHISI</span><h2>Müayinələr <em>{grouped.reduce((count, p) => count + p.studies.length, 0)}</em></h2></div></div>
        <div className="series-list" role="region" aria-label="Pasiyent və müayinə üzrə seriyalar" tabIndex={0}>
          {grouped.map(patient => <section className="patient-group" key={patient.id}>
            <div className="patient-group-heading"><span className="group-heading-label">AD SOYAD</span><h3>{patient.name}</h3>
              {patient.studies.map(study => <div className="patient-study-summary" key={study.id}><span><span className="group-heading-label">MÜAYİNƏ TARİXİ</span><strong>{formatDate(study.date)}</strong></span><div className="study-modality-summary">{study.modalities.map(modality => <span key={modality.code}><b>{modalityLabel(modality.code)}</b><small>{modality.series.length} seriya</small></span>)}</div></div>)}
            </div>
            {patient.studies.map(study => <div className="study-group" key={study.id}>
              {patient.studies.length > 1 && <div className="study-group-heading"><strong>{formatDate(study.date)}</strong></div>}
              {study.modalities.map(modality => <div className="modality-group" key={modality.code}>
                {modality.series.map(({ item: s, index }) => <button key={s.id} draggable onDragStart={e => e.dataTransfer.setData('application/x-series-id', s.id)}
                  className={`series-card ${assigned[active] === s.id ? 'chosen' : ''}`} onClick={() => place(s.id, active)} title={`${s.name} — panel ${active}`}>
                  <div className="series-thumb">{s.thumb ? <img src={s.thumb} alt=""/> : <ScanSearch size={30} strokeWidth={1}/>}<span>{String(index + 1).padStart(2, '0')}</span></div>
                  <div className="series-info"><strong>{s.name}</strong><span>{s.imageIds.length}{s.discovered && s.discovered > s.imageIds.length ? ` / ${s.discovered}` : ''} görüntü</span><span>{s.archived ? 'Local arxiv · CD/DVD' : s.mediaSession ? 'CD/DVD · müvəqqəti' : `Seriya ${s.number}`}</span></div><span className="drag-handle" aria-hidden="true">⋮⋮</span>
                </button>)}
              </div>)}
            </div>)}
          </section>)}
          {!seriesList.length && <div className="rail-empty">{status}</div>}
        </div>
        <WorkProgress className="series-work-progress" progress={loadProgress}/>
        {mediaEnabled && <div className="media-import-progress">
          {mediaProgress?.error ? <small role="alert">{mediaProgress.error} <a href="/RADAZ-Qurasdirma.html" target="_blank" rel="noreferrer">Quraşdırma təlimatı</a></small> : !mediaProgress?.sessions ? <small>CD/DVD gözlənilir…</small> : null}
          <WorkProgress progress={mediaProgress && (mediaProgress.scanning || mediaProgress.loaded + mediaProgress.skipped < mediaProgress.discovered) && !mediaProgress.error ? {
            label:'CD/DVD yüklənir',done:mediaProgress.loaded,total:mediaProgress.discovered,indeterminate:mediaProgress.scanning,
            phase:mediaProgress.scanning?'Müvəqqəti diskə köçürülür; hazır görüntülərə baxa bilərsiniz':mediaProgress.skipped ? `${mediaProgress.skipped} görüntü oxunmadı` : undefined,
          } : null}/>
        </div>}
      </aside>}
      <section className="main-area">
        {workspace === 'viewer' && <div className="viewport-grid" style={{ gridTemplateColumns: `repeat(${maximizedPane ? 1 : layout.columns}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${maximizedPane ? 1 : layout.rows}, minmax(0, 1fr))` }}>
          {Array.from({ length: layout.rows * layout.columns }, (_, index) => String.fromCharCode(65 + index)).filter(id => !maximizedPane || id === maximizedPane).map(id => { const otherImages = id !== active && assigned[active] && currentImages[active] ? [{ panel: active, imageId: currentImages[active] }] : []; return <ViewportPane windowLevels={windowLevels} key={`${id}-${datasetVersion}-${assigned[id] || "empty"}`} id={id} initialImageId={currentImages[id]} series={seriesList.find(s => s.id === assigned[id])} selected={active === id} tool={limited ? 'scroll' : tool} cursor={cursor} onCursor={onCursor} hideText={hideText} preset={preset} resetToken={resetToken} clearToken={clearToken} ready={ready} marks={marks} selectedMarkId={selectedMarkId} localizers={localizers && id !== active} otherImages={otherImages} onImageChange={onImageChange} onMoveSource={onMoveSource} onAddMark={onAddMark} onUpdateMark={onUpdateMark} onRemoveMark={onRemoveMark} onSelectMark={markId => { setActive(id); setSelectedMarkId(markId); }} onClearImage={onClearImage} onSelect={() => { setActive(id); setSelectedMarkId(null); }} onToggleMaximize={() => { setActive(id); setMaximizedPane(current => current === id ? null : id); }} onDropSeries={sid => place(sid, id)}/>; })}
        </div>}
        {workspace === 'mpr' && <>
          {mprError && <div className="mpr-error-notice" role="alert">{mprError}</div>}
          <div className={`mpr-grid ${maximizedMprPane ? 'maximized' : ''}`}>
            {(['SAG','COR','AX'] as const).map((plane,index)=>({plane,index,id:['MS','MC','MA'][index]})).map(({plane,index,id})=>{
              const shown=mprData?.planes[index] || (plane==='AX'?mprPreview:undefined);
              const progress=!shown?.imageIds.length ? mprProgress || sourceLoading : null;
              return <ViewportPane windowLevels={windowLevels} windowingSourceId={mprData?.sourceId || mprPreview?.id} key={`${id}-${mprData?.sourceId || mprPreview?.id || 'waiting'}`} id={id} initialImageId={currentImages[id]} series={shown} loadingProgress={progress} reconstruction={mprSettings[plane]} viewAnchor={mprData?.pivot} expanded={maximizedMprPane===id} concealed={!!maximizedMprPane&&maximizedMprPane!==id} selected={mprActive===id} tool={limited?'scroll':tool} cursor={cursor} onCursor={onCursor} hideText={hideText} preset={preset} resetToken={resetToken} clearToken={clearToken} ready={ready} marks={marks} selectedMarkId={selectedMarkId} localizers={localizers}
                otherImages={(['MS','MC','MA']).filter(other=>other!==id).map(other=>({panel:other,imageId:currentImages[other] || ''})).filter(item=>item.imageId)}
                onImageChange={onImageChange} onMoveSource={moveMprSource} onMoveIntersection={moveMprIntersection} onRotateSource={rotateMprSource} onRotateStart={beginMprRotation} onPreviewRotateSource={(source,target,radians)=>updateMprRotation(source,target,radians)}
                onAddMark={onAddMark} onUpdateMark={onUpdateMark} onRemoveMark={onRemoveMark} onClearImage={onClearImage} onSelectMark={markId=>{setMprActive(id);setSelectedMarkId(markId);}} onSelect={()=>{setMprActive(id);setSelectedMarkId(null);}} onToggleMaximize={()=>{setMprActive(id);setMaximizedMprPane(current=>current===id?null:id);}} onDropSeries={sid=>place(sid,'A')}/>;
            })}
          </div>
        </>}
        {workspace === '3d' && <VolumePreview series={volumeSeries} sourceProgress={sourceLoading} preset={volumePreset} threshold={volumeThreshold} opacity={volumeOpacity} settings={volumeSettings} resetToken={volumeResetToken} onThresholdChange={setVolumeThreshold} onOpacityChange={setVolumeOpacity} onSettingsChange={setVolumeSettings} />}
        <footer className="statusbar"><div><span className="status-led"/> {ready ? 'Cornerstone3D hazırdır' : 'Görüntüləmə hazırlanır'} <span className="status-sep">/</span> <span>{workspace === 'mpr' ? `MPR · ${mprSettings[panePlane[mprActive as keyof typeof panePlane] || 'AX'].mode}` : workspace === '3d' ? '3D görünüş' : `Aktiv panel ${active}`}</span><span className="status-sep">/</span>{status}<span className="status-sep">/</span><span aria-label="Lisenziya statusu">{licenseStatus}</span></div></footer>
      </section>
    </div>
  </main>;
}
