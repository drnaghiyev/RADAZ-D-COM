import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';
import vtkVolumeMapper from '@kitware/vtk.js/Rendering/Core/VolumeMapper';
/** Identical scalar upload and ray casting in both Smart Volume and main 3D. */
export function createVolumeRenderSource(data:{dimensions:number[];spacing:number[];origin:number[];direction:ArrayLike<number>;values:Int16Array|Float32Array;scalarRange?:{min:number;max:number}}){
 const image=vtkImageData.newInstance();image.setDimensions(...data.dimensions as [number,number,number]);image.setSpacing(data.spacing);image.setOrigin(data.origin as [number,number,number]);image.setDirection(new Float32Array(data.direction));
 const scalars=vtkDataArray.newInstance({name:'Source',numberOfComponents:1,values:data.values});if(data.scalarRange)scalars.setRange(data.scalarRange,0);image.getPointData().setScalars(scalars);
 const mapper=vtkVolumeMapper.newInstance();mapper.setInputData(image);mapper.setSampleDistance(Math.min(...data.spacing)*.5);mapper.setImageSampleDistance(1);mapper.setMaximumSamplesPerRay(4096);mapper.setAutoAdjustSampleDistances(false);
 return {image,scalars,mapper,dispose(){mapper.delete();image.delete();scalars.delete();}};
}
