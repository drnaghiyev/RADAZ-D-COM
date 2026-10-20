export type Vec3 = [number,number,number];
export type VolumeFrame = { id: string; sopUID?: string; studyId: string; frameId: string; origin: Vec3; columnDirection: Vec3; rowDirection: Vec3;
  rowSpacing: number; columnSpacing: number; rows: number; columns: number; sliceThickness?: number; spacingBetweenSlices?: number };
const dot = (a: Vec3,b: Vec3) => a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const sub = (a: Vec3,b: Vec3): Vec3 => [a[0]-b[0],a[1]-b[1],a[2]-b[2]];
export function describeVolume(frames: VolumeFrame[]) {
  // Reopened/imported instances may have distinct local handles. Only identical
  // DICOM instance identities can be collapsed; coincident phases remain invalid.
  const unique=new Map<string,VolumeFrame>();
  for(const frame of frames){
    const key=frame.sopUID?`sop:${frame.sopUID}`:`id:${frame.id}`;
    const previous=unique.get(key);
    if(previous){
      const geometry=({id,sopUID,...rest}:VolumeFrame)=>JSON.stringify(rest);
      if(geometry(previous)!==geometry(frame))throw Error('Eyni DICOM instansiyasının məkan məlumatları uyğun deyil');
    }else unique.set(key,frame);
  }
  frames=[...unique.values()];
  if(frames.length<3)throw Error('Volume üçün ən azı 3 məkan koordinatlı kəsit lazımdır');
  const base=frames[0],u=base.columnDirection,v=base.rowDirection;
  if([...u,...v,...base.origin,base.rowSpacing,base.columnSpacing].some(x=>!Number.isFinite(x)) ||
    Math.abs(Math.hypot(...u)-1)>.001||Math.abs(Math.hypot(...v)-1)>.001||Math.abs(dot(u,v))>.001||Math.min(base.rowSpacing,base.columnSpacing)<=0)
    throw Error('DICOM istiqaməti və ya PixelSpacing düzgün deyil');
  const normal: Vec3=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]];
  const ordered=[...frames].sort((a,b)=>dot(a.origin,normal)-dot(b.origin,normal));
  const origin=ordered[0].origin;
  const gaps=ordered.slice(1).map((f,i)=>dot(sub(f.origin,ordered[i].origin),normal));
  const gap=[...gaps].sort((a,b)=>a-b)[Math.floor(gaps.length/2)];
  if(!Number.isFinite(gap)||gap<.01)throw Error('Volume-da təkrarlanan və ya etibarsız kəsit koordinatları var');
  for(const [index,frame] of ordered.entries()) {
    const delta=sub(frame.origin,origin);
    if(frame.studyId!==base.studyId||frame.frameId!==base.frameId||frame.rows!==base.rows||frame.columns!==base.columns||
      [...frame.origin,...frame.columnDirection,...frame.rowDirection,frame.rowSpacing,frame.columnSpacing].some(x=>!Number.isFinite(x))||
      Math.abs(dot(frame.columnDirection,u)-1)>.001||Math.abs(dot(frame.rowDirection,v)-1)>.001||
      Math.abs(frame.rowSpacing-base.rowSpacing)>.001||Math.abs(frame.columnSpacing-base.columnSpacing)>.001||
      Math.abs(dot(delta,u))>.1||Math.abs(dot(delta,v))>.1||Math.abs(dot(delta,normal)-index*gap)>Math.max(.05,gap*.05))
      throw Error('Volume üçün eyni FrameOfReference, paralel və bərabər aralıqlı kəsitlər tələb olunur');
  }
  // Physical positions are authoritative. Thickness describes the acquisition,
  // and is not substituted for centre-to-centre spacing when positions exist.
  return {imageIds:ordered.map(f=>f.id),origin,dimensions:[base.columns,base.rows,frames.length] as Vec3,
    spacing:[base.columnSpacing,base.rowSpacing,gap] as Vec3,direction:[...u,...v,...normal],
    frameId:base.frameId||base.studyId,sliceThickness:base.sliceThickness,spacingBetweenSlices:base.spacingBetweenSlices};
}
