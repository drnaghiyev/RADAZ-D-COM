import {worldToIndex,type Geometry,type Vec3} from './geometry';
import {indexToWorld} from './navigation';
import {rasterizeContour,type Contour} from './contours';
import type {ImageGeometry} from '../localizer';
export function sourcePlane(g:Geometry,slice:number,studyId:string,frameId:string):ImageGeometry{
 return {studyId,frameId,origin:indexToWorld(g,[0,0,slice]),columnDirection:g.direction.slice(0,3) as Vec3,rowDirection:g.direction.slice(3,6) as Vec3,columnSpacing:g.spacing[0],rowSpacing:g.spacing[1],columns:g.dimensions[0],rows:g.dimensions[1]};
}
/** Native MRI series share LPS coordinates only when their reference frame agrees.
 * This is coordinate mapping, not motion correction or image registration. */
export function mapContour(c:Contour,source:Geometry,target:Geometry):Contour{
 const normal=source.direction.slice(c.axis*3,c.axis*3+3);
 const dots=[0,1,2].map(a=>Math.abs(normal.reduce((sum,n,k)=>sum+n*target.direction[a*3+k],0)));
 const axis=dots.indexOf(Math.max(...dots)) as 0|1|2;
 if(dots[axis]<.999)throw Error('Seriyalar oblique istiqamətdə uyğunsuzdur; əvvəl qeydiyyat/uyğunlaşdırma tələb olunur.');
 const from=([0,1,2] as const).filter(a=>a!==c.axis),to=([0,1,2] as const).filter(a=>a!==axis);
 const indices=c.points.map(p=>{const q=[0,0,0] as Vec3;q[c.axis]=c.slice;q[from[0]]=p[0];q[from[1]]=p[1];return worldToIndex(target,indexToWorld(source,q));});
 if(indices.some(p=>p.some((n,a)=>n<-.5||n>target.dimensions[a]-.5)))throw Error('Kontur aktiv seriyanın həcmindən kənardadır. Daha geniş örtüklü seriyanı aktiv edin.');
 const slice=Math.round(indices.reduce((sum,p)=>sum+p[axis],0)/indices.length);
 const mapped={axis,slice,points:indices.map(p=>[p[to[0]],p[to[1]]] as [number,number])};
 if(!rasterizeContour(target,mapped).length)throw Error('Kontur aktiv seriyanın həllində çox kiçikdir.');
 return mapped;
}
