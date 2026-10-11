import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';
import vtkMarchingCubes from '@kitware/vtk.js/Filters/General/ImageMarchingCubes';
// One worker owns the single corrected mask. Surface extraction never blocks UI.
self.onmessage=(event:MessageEvent)=>{
 const {mask,geometry,labels}=event.data as {mask:Uint8Array;geometry:{dimensions:number[];spacing:number[];origin:number[];direction:number[]};labels:number[]};
 try{
  const [nx,ny,nz]=geometry.dimensions;
  if(mask.length!==nx*ny*nz||mask.length>32000000||labels.length>12)throw Error('invalid_surface');
  for(const label of labels){
   const low=[nx,ny,nz],high=[-1,-1,-1];
   for(let i=0;i<mask.length;i++)if(mask[i]===label){const p=[i%nx,Math.floor(i/nx)%ny,Math.floor(i/(nx*ny))];for(let axis=0;axis<3;axis++){low[axis]=Math.min(low[axis],p[axis]);high[axis]=Math.max(high[axis],p[axis]);}}
   if(high[0]<0)continue;
   const dims=low.map((n,i)=>high[i]-n+3),binary=new Uint8Array(dims[0]*dims[1]*dims[2]);
   for(let z=low[2];z<=high[2];z++)for(let y=low[1];y<=high[1];y++)for(let x=low[0];x<=high[0];x++)if(mask[(z*ny+y)*nx+x]===label)binary[((z-low[2]+1)*dims[1]+y-low[1]+1)*dims[0]+x-low[0]+1]=1;
   const image=vtkImageData.newInstance();image.setDimensions(dims[0],dims[1],dims[2]);image.setSpacing([geometry.spacing[0],geometry.spacing[1],geometry.spacing[2]]);
   const scalars=vtkDataArray.newInstance({name:'mask',numberOfComponents:1,values:binary});image.getPointData().setScalars(scalars);
   const filter=vtkMarchingCubes.newInstance({contourValue:.5,computeNormals:true,mergePoints:true});filter.setInputData(image);filter.update();
   const mesh=filter.getOutputData(),points=new Float32Array(mesh.getPoints().getData()),normals=new Float32Array(mesh.getPointData().getNormals().getData()),polys=new Uint32Array(mesh.getPolys().getData());
   // vtk.js 36 ImageMarchingCubes ignores direction cosines. Transform both
   // vertices and physical-space normals explicitly to DICOM LPS.
   for(let i=0;i<points.length;i+=3){const p=[0,1,2].map(axis=>points[i+axis]+(low[axis]-1)*geometry.spacing[axis]),n=[normals[i],normals[i+1],normals[i+2]];
    for(let axis=0;axis<3;axis++){points[i+axis]=geometry.origin[axis]+p.reduce((sum,v,j)=>sum+v*geometry.direction[j*3+axis],0);normals[i+axis]=n.reduce((sum,v,j)=>sum+v*geometry.direction[j*3+axis],0);}
   }
   self.postMessage({label,points,normals,polys},{transfer:[points.buffer,normals.buffer,polys.buffer]});
   filter.delete();mesh.delete();scalars.delete();image.delete();
  }
  self.postMessage({done:true});
 }catch{self.postMessage({error:'surface_failed'});}
};
