import { normalOf, worldAt, type ImageGeometry } from './localizer.ts';

export const isProjection = (modality?: string) => ['CR','DX','DR','RG','XR','MG','XA','RF','PX','IO'].includes(modality?.trim().toUpperCase() || '');
const dot = (a: number[], b: number[]) => a.reduce((sum, n, i) => sum + n * b[i], 0);

/** Match physical planes, never slice indices. Refuse unrelated or oblique stacks. */
export function synchronizedSlice(source: ImageGeometry | null, targets: (ImageGeometry | null)[]): number | null {
  if (!source?.frameId || !source.studyId) return null;
  const normal = normalOf(source);
  if (Math.hypot(...normal) < .99) return null;
  const center = worldAt(source, (source.columns-1)/2, (source.rows-1)/2);
  const positions: {index:number; position:number}[] = [];
  for (const [index, g] of targets.entries()) {
    if (!g || g.studyId !== source.studyId || g.frameId !== source.frameId || Math.abs(dot(normal, normalOf(g))) < .996) return null;
    positions.push({index, position:dot(normal,g.origin)});
  }
  if (positions.length < 2) return null;
  positions.sort((a,b)=>a.position-b.position);
  const coordinate = dot(normal,center), first=positions[0], last=positions.at(-1)!;
  const lowTolerance=Math.abs(positions[1].position-first.position)/2+.01;
  const highTolerance=Math.abs(last.position-positions.at(-2)!.position)/2+.01;
  if (coordinate<first.position-lowTolerance || coordinate>last.position+highTolerance) return null;
  return positions.reduce((best,p)=>Math.abs(p.position-coordinate)<Math.abs(best.position-coordinate)?p:best).index;
}

export type ImagePresentation = {zoom:number;pan:[number,number]};
type ProjectionViewport = {
  element: HTMLElement; getCurrentImageId:()=>string|undefined;
  getZoom:()=>number; getPan:()=>[number,number]; setZoom:(zoom:number)=>void;
  setPan:(pan:[number,number])=>void; render:()=>void;
};
/** Store screen presentation by SOP UID; never carry an XR camera to the next image. */
export function bindProjectionPresentation(viewport: ProjectionViewport, values: Map<string,ImagePresentation>,
  events: {PRE_STACK_NEW_IMAGE:string;STACK_NEW_IMAGE:string;CAMERA_MODIFIED:string},
  identity: (id:string)=>string|undefined, enabled:()=>boolean) {
  let shown='', loading=false, revision=0, disposed=false;
  const remember=()=>{
    if(!enabled()||loading||!shown||identity(viewport.getCurrentImageId()||'')!==shown)return;
    const zoom=viewport.getZoom(),pan=viewport.getPan();
    if(Number.isFinite(zoom)&&zoom>0&&pan.every(Number.isFinite))values.set(shown,{zoom,pan:[...pan]});
  };
  const before=()=>{remember();loading=true;revision++;};
  const show=()=>{
    const key=identity(viewport.getCurrentImageId()||'')||'', token=++revision;
    shown=key;
    queueMicrotask(()=>{
      if(disposed||token!==revision)return;
      if(enabled()&&key){const value=values.get(key)||{zoom:1,pan:[0,0] as [number,number]};viewport.setZoom(value.zoom);viewport.setPan(value.pan);}
      loading=false;
      if(enabled())viewport.render();
    });
  };
  viewport.element.addEventListener(events.PRE_STACK_NEW_IMAGE,before);
  viewport.element.addEventListener(events.STACK_NEW_IMAGE,show);
  viewport.element.addEventListener(events.CAMERA_MODIFIED,remember);
  return()=>{remember();disposed=true;viewport.element.removeEventListener(events.PRE_STACK_NEW_IMAGE,before);viewport.element.removeEventListener(events.STACK_NEW_IMAGE,show);viewport.element.removeEventListener(events.CAMERA_MODIFIED,remember);};
}
