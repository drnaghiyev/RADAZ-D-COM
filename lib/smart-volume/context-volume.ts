import type {Geometry,Vec3} from './geometry';
import {indexToWorld} from './navigation';
/** Context display only. Measurement and segmentation always retain source voxels. */
export function contextVolume(geometry:Geometry,source:ArrayLike<number>,maxDimension=192){
 const dimensions=geometry.dimensions.map((n,a)=>a===2?n:Math.min(n,maxDimension)) as Vec3,scale=geometry.dimensions.map((n,a)=>n/dimensions[a]);
 const spacing=geometry.spacing.map((n,a)=>n*scale[a]) as Vec3,origin=indexToWorld(geometry,scale.map(n=>(n-1)/2) as Vec3),values=new Float32Array(dimensions[0]*dimensions[1]*dimensions[2]);
 // Z is unchanged: bilinear X/Y is exactly the previous trilinear result.
 // Precompute coordinates, avoiding millions of temporary arrays per volume.
 const axis=(a:number)=>Array.from({length:dimensions[a]},(_,i)=>{
  const p=Math.max(0,Math.min(geometry.dimensions[a]-1,(i+.5)*scale[a]-.5)),lo=Math.floor(p);
  return {lo,hi:Math.min(geometry.dimensions[a]-1,lo+1),f:p-lo};
 });
 const xs=axis(0),ys=axis(1),[nx,ny]=geometry.dimensions;let output=0;
 for(let z=0;z<dimensions[2];z++)for(const y of ys){
  const row0=(z*ny+y.lo)*nx,row1=(z*ny+y.hi)*nx;
  for(const x of xs)values[output++]=
   (source[row0+x.lo]*(1-x.f)+source[row0+x.hi]*x.f)*(1-y.f)+
   (source[row1+x.lo]*(1-x.f)+source[row1+x.hi]*x.f)*y.f;
 }
 return {...geometry,dimensions,spacing,origin,values};
}
