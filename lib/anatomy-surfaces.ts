import type {Types} from '@cornerstonejs/core';
import vtkActor from '@kitware/vtk.js/Rendering/Core/Actor';
import vtkMapper from '@kitware/vtk.js/Rendering/Core/Mapper';
import vtkPolyData from '@kitware/vtk.js/Common/DataModel/PolyData';
import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';
import type {AnatomyVolumeResult} from './anatomy-volume';
import {labelHex,type AnatomyAppearance} from './anatomy-editing';
import surfaceWorkerUrl from './anatomy-surface.worker.ts?worker&url';
import {surfacesToPly} from './surface-export';
export function createAnatomySurfaces(viewport:Types.IVolumeViewport,result:AnatomyVolumeResult,appearance:AnatomyAppearance,onState:(state:'building'|'ready'|'error')=>void){
 const labels=Object.keys(result.classes).map(Number).filter(id=>!appearance.hidden.has(id));
 if(labels.length>12)throw Error('surface_limit');
 const worker=new Worker(new URL(surfaceWorkerUrl,window.location.origin),{type:'module'});
 const resources:{actor:ReturnType<typeof vtkActor.newInstance>;mapper:ReturnType<typeof vtkMapper.newInstance>;mesh:ReturnType<typeof vtkPolyData.newInstance>;normals:ReturnType<typeof vtkDataArray.newInstance>}[]=[];
 let disposed=false;const renderer=viewport.getRenderer();
 const mask=result.mask.slice();for(const [index,value]of result.corrections??[])mask[index]=value;
 const {dimensions,spacing,origin,direction}=result;onState('building');
 worker.onmessage=event=>{if(disposed)return;const data=event.data;if(data.error){onState('error');return;}if(data.done){onState('ready');return;}
  const mesh=vtkPolyData.newInstance();mesh.getPoints().setData(data.points,3);mesh.getPolys().setData(data.polys);const normals=vtkDataArray.newInstance({name:'Normals',numberOfComponents:3,values:data.normals});mesh.getPointData().setNormals(normals);
  const mapper=vtkMapper.newInstance();mapper.setInputData(mesh);mapper.setScalarVisibility(false);const actor=vtkActor.newInstance();actor.setMapper(mapper);
  const color=(appearance.colors[data.label]??labelHex(data.label)).slice(1).match(/../g)!.map(h=>parseInt(h,16)/255);actor.getProperty().setColor(color[0],color[1],color[2]);actor.getProperty().setOpacity(appearance.opacities[data.label]??1);
  actor.getProperty().setAmbient(.25);actor.getProperty().setDiffuse(.75);resources.push({actor,mapper,mesh,normals});renderer.addActor(actor);viewport.render();
 };
 worker.onerror=()=>{if(!disposed)onState('error');};worker.postMessage({mask,geometry:{dimensions,spacing,origin,direction},labels},[mask.buffer]);
 return {
  export:()=>surfacesToPly(resources.map(({mesh,actor})=>({points:mesh.getPoints().getData(),polys:mesh.getPolys().getData(),color:Array.from(actor.getProperty().getColor())}))),
  dispose:()=>{if(disposed)return;disposed=true;worker.terminate();for(const {actor,mapper,mesh,normals}of resources){renderer.removeActor(actor);actor.delete();mapper.delete();mesh.delete();normals.delete();}viewport.render();},
 };
}
