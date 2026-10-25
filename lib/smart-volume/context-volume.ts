import type {Geometry,Vec3} from './geometry';
import {indexToWorld} from './navigation';
/** Context display only. Measurement and segmentation always retain source voxels. */
export function contextVolume(geometry:Geometry,source:ArrayLike<number>,maxDimension=192){
 const dimensions=geometry.dimensions.map((n,a)=>a===2?n:Math.min(n,maxDimension)) as Vec3,scale=geometry.dimensions.map((n,a)=>n/dimensions[a]);
 const spacing=geometry.spacing.map((n,a)=>n*scale[a]) as Vec3,origin=indexToWorld(geometry,scale.map(n=>(n-1)/2) as Vec3),values=new Float32Array(dimensions[0]*dimensions[1]*dimensions[2]);
 for(let z=0;z<dimensions[2];z++)for(let y=0;y<dimensions[1];y++)for(let x=0;x<dimensions[0];x++){
  const p=[x,y,z].map((n,a)=>Math.max(0,Math.min(geometry.dimensions[a]-1,(n+.5)*scale[a]-.5))),lo=p.map(Math.floor),f=p.map((n,a)=>n-lo[a]);let value=0;
  for(let c=0;c<8;c++){let weight=1;const q=lo.map((n,a)=>{const high=(c>>a)&1;weight*=high?f[a]:1-f[a];return Math.min(geometry.dimensions[a]-1,n+high);});value+=weight*source[(q[2]*geometry.dimensions[1]+q[1])*geometry.dimensions[0]+q[0]];}
  values[(z*dimensions[1]+y)*dimensions[0]+x]=value;
 }
 return {...geometry,dimensions,spacing,origin,values};
}
