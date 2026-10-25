import type {Geometry,Vec3} from './geometry';
export function indexToWorld(g:Geometry,index:Vec3):Vec3{return [0,1,2].map(a=>g.origin[a]+index.reduce((sum,n,j)=>sum+n*g.spacing[j]*g.direction[j*3+a],0)) as Vec3;}
/** Source-aligned radiological views: patient right on the left in axial/coronal. */
export function radiologicalOrientation(g:Geometry,axis:number){
 const direction=g.direction,normal=direction.slice(axis*3,axis*3+3) as Vec3;
 const dominant=normal.map(Math.abs).indexOf(Math.max(...normal.map(Math.abs)));
 const sign=dominant===0?(normal[0]>=0?1:-1):(normal[dominant]>=0?-1:1);
 const upPatientAxis=dominant===2?1:2;
 const upAxis=[0,1,2].filter(a=>a!==axis).sort((a,b)=>Math.abs(direction[b*3+upPatientAxis])-Math.abs(direction[a*3+upPatientAxis]))[0];
 const up=direction.slice(upAxis*3,upAxis*3+3) as Vec3;
 const upSign=(up[upPatientAxis]>=0?1:-1)*(dominant===2?-1:1);
 return {viewPlaneNormal:normal.map(n=>n*sign) as Vec3,viewUp:up.map(n=>n*upSign) as Vec3};
}
export function orientationLetter(v:number[]){const axis=v.map(Math.abs).indexOf(Math.max(...v.map(Math.abs)));return (v[axis]>=0?['L','P','S']:['R','A','I'])[axis];}
