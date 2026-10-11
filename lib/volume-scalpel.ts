import {createScalpelBuffer} from './scalpel-buffer';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';
import vtkVolumeMapper from '@kitware/vtk.js/Rendering/Core/VolumeMapper';
import type {vtkVolume} from '@kitware/vtk.js/Rendering/Core/Volume';
import type {mat3} from 'gl-matrix';
import type {Types} from '@cornerstonejs/core';
type Point=[number,number];
type Vec=[number,number,number];
export function insidePolygon(x:number,y:number,polygon:Point[]){
 let inside=false;
 for(let i=0,j=polygon.length-1;i<polygon.length;j=i++){
  const a=polygon[i],b=polygon[j];
  if((a[1]>y)!==(b[1]>y)&&x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0])inside=!inside;
 }
 return inside;
}
/** A private mapper and scalar copy: never edit the shared DICOM volume/cache. */
export function createVolumeScalpel(viewport:Types.IVolumeViewport,source:{dimensions:Vec;spacing:Vec;origin:Vec;direction:number[];values:ArrayLike<number>},floor:number){
 const actor=viewport.getDefaultActor()!.actor as vtkVolume,original=actor.getMapper()!;
 const size=source.dimensions.reduce((a,b)=>a*b,1);
 if(!Number.isSafeInteger(size)||size<1||source.values.length!==size)throw Error('Həcm məlumatları uyğun deyil.');
 const buffer=createScalpelBuffer(source.values,floor),values=buffer.values;
 const image=vtkImageData.newInstance();image.setDimensions(source.dimensions);image.setSpacing(source.spacing);image.setOrigin(source.origin);image.setDirection(source.direction as mat3);
 const scalars=vtkDataArray.newInstance({name:'RADAZ private scalpel',numberOfComponents:1,values});image.getPointData().setScalars(scalars);
 const mapper=vtkVolumeMapper.newInstance();mapper.setInputData(image);actor.setMapper(mapper);
 let previous:Uint8Array|null=null,disposed=false,busy=false;
 const render=()=>{scalars.modified();image.modified();mapper.modified();viewport.render();};
 return {
  floor,
  async cut(polygon:Point[],removeInside=true){
   if(busy||disposed||polygon.length<3)return 0;
   if(!viewport.getCamera().parallelProjection)throw Error('Scalpel yalnız parallel 3D görünüşdə işləyir.');
   const changes=buffer.begin();busy=true;let removed=0;
   try{
    const at=(p:Vec)=>viewport.worldToCanvas(image.indexToWorld(p) as Vec);
    const zero=at([0,0,0]),axes=[at([1,0,0]),at([0,1,0]),at([0,0,1])].map(p=>[p[0]-zero[0],p[1]-zero[1]]);
    const [nx,ny,nz]=source.dimensions;
    const xs=polygon.map(p=>p[0]),ys=polygon.map(p=>p[1]),bounds=[Math.min(...xs),Math.max(...xs),Math.min(...ys),Math.max(...ys)];
    for(let z=0;z<nz;z++){
     if(disposed)return 0;
     for(let y=0;y<ny;y++)for(let x=0;x<nx;x++){
      const i=(z*ny+y)*nx+x;if(values[i]===floor)continue;
      const px=zero[0]+x*axes[0][0]+y*axes[1][0]+z*axes[2][0],py=zero[1]+x*axes[0][1]+y*axes[1][1]+z*axes[2][1];
      if(removeInside&&(px<bounds[0]||px>bounds[1]||py<bounds[2]||py>bounds[3]))continue;
      if(insidePolygon(px,py,polygon)===removeInside&&buffer.remove(i,changes))removed++;
     }
     if(z%8===0)await new Promise(resolve=>setTimeout(resolve,0));
    }
    if(removed){previous=changes;render();}return removed;
   }catch(error){buffer.restore(changes);if(!disposed)render();throw error;}finally{busy=false;}
  },
  undo(){if(previous&&!busy){buffer.restore(previous);previous=null;render();}},
  reset(){if(!busy){buffer.reset();previous=null;render();}},
  dispose(){disposed=true;actor.setMapper(original);mapper.delete();image.delete();scalars.delete();previous=null;},
 };
}
