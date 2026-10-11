import type {AnatomyVolumeResult} from './anatomy-volume';
import {volumeIndex} from './anatomy-volume';
import type {Point3} from './localizer';
export type Correction=Map<number,number>;
export type AnatomyAppearance={hidden:Set<number>;colors:Record<number,string>;opacities:Record<number,number>;selected:number;contoursOnly:boolean};
export const initialAppearance=():AnatomyAppearance=>({hidden:new Set(),colors:{},opacities:{},selected:0,contoursOnly:false});
export function labelColor(id:number){const angle=id*2.399963;return [0,2.1,4.2].map(offset=>Math.round(150+95*Math.sin(angle+offset)));}
export function labelHex(id:number){return '#'+labelColor(id).map(n=>n.toString(16).padStart(2,'0')).join('');}
export function correctedValue(result:AnatomyVolumeResult,index:number){return result.corrections?.get(index)??result.mask[index];}
/** A physical disc in the current image plane, not an axial-only voxel brush. */
export function brushIndices(result:AnatomyVolumeResult,center:Point3,normal:Point3,radius:number){
 if(!Number.isFinite(radius)||radius<.5||radius>30||normal.some(n=>!Number.isFinite(n)))throw Error('invalid_brush');
 const length=Math.hypot(...normal);if(length<.99||length>1.01)throw Error('invalid_plane');
 const voxel=volumeIndex(result,center),{dimensions,spacing,direction,origin}=result;
 const projection=[0,1,2].map(axis=>normal.reduce((sum,n,i)=>sum+n*direction[axis*3+i],0));
 const half=.5/Math.hypot(...projection.map((n,i)=>n/spacing[i]));
 const reach=spacing.map(s=>Math.ceil((radius+half)/s));
 const ranges=dimensions.map((n,i)=>[Math.max(0,Math.floor(voxel[i]-reach[i])),Math.min(n-1,Math.ceil(voxel[i]+reach[i]))]);
 const indices:number[]=[];
 for(let z=ranges[2][0];z<=ranges[2][1];z++)for(let y=ranges[1][0];y<=ranges[1][1];y++)for(let x=ranges[0][0];x<=ranges[0][1];x++){
  const delta=origin.map((n,i)=>n-center[i]+x*spacing[0]*direction[i]+y*spacing[1]*direction[3+i]+z*spacing[2]*direction[6+i]);
  const distance=delta.reduce((sum,n,i)=>sum+n*normal[i],0);
  if(Math.abs(distance)<=half+1e-6&&delta.reduce((sum,n)=>sum+n*n,0)-distance*distance<=radius*radius)indices.push((z*dimensions[1]+y)*dimensions[0]+x);
 }
 return indices;
}
export function correct(result:AnatomyVolumeResult,indices:number[],label:number){
 if(!Number.isInteger(label)||label<0||label>255||label!==0&&!result.classes[String(label)])throw Error('invalid_label');
 const next=new Map(result.corrections);
 for(const index of indices){if(!Number.isInteger(index)||index<0||index>=result.mask.length)throw Error('invalid_index');if(result.mask[index]===label)next.delete(index);else next.set(index,label);}
 if(next.size>1000000)throw Error('correction_limit');
 return next;
}
export function structureCenter(result:AnatomyVolumeResult,label:number):Point3|null{
 const sum=[0,0,0];let count=0;const [nx,ny]=result.dimensions;
 for(let i=0;i<result.mask.length;i++)if(correctedValue(result,i)===label){sum[0]+=i%nx;sum[1]+=Math.floor(i/nx)%ny;sum[2]+=Math.floor(i/(nx*ny));count++;}
 if(!count)return null;
 return result.origin.map((n,i)=>n+sum.reduce((total,value,axis)=>total+value/count*result.spacing[axis]*result.direction[axis*3+i],0)) as Point3;
}
