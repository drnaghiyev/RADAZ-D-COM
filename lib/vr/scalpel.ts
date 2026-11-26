import type {Cut,P,V} from './scene';
/** Intersect each voxel row with the view-plane polygon. Only the disposable display mask is edited. */
export function excludedVoxels(dims:V,cuts:Cut[]){
 if(!cuts.length)return new Uint8Array(0);
 const [nx,ny,nz]=dims,mask=new Uint8Array(nx*ny*nz);
 for(const cut of cuts){
  const [u,v,w]=cut.axes,d=u[0]*u[0]+u[1]*u[1];
  const along=(x:number,y:number)=>(x*u[0]+y*u[1])/d;
  const across=(x:number,y:number)=>y*u[0]-x*u[1];
  const poly:P[]=d>1e-22?cut.polygon.map(([x,y])=>[along(x,y),across(x,y)]):cut.polygon;
  const intersections:number[]=[];
  for(let z=0;z<nz;z++)for(let y=0;y<ny;y++){
    const x0=cut.origin[0]+v[0]*y+w[0]*z,y0=cut.origin[1]+v[1]*y+w[1]*z;
    const offset=(z*ny+y)*nx;
    if(d<=1e-22){
      let inside=false;
      for(let i=0,j=poly.length-1;i<poly.length;j=i++){
        const a=poly[i],b=poly[j];if((a[1]>y0)!==(b[1]>y0)&&x0<(b[0]-a[0])*(y0-a[1])/(b[1]-a[1])+a[0])inside=!inside;
      }
      if(inside===cut.inside)mask.fill(1,offset,offset+nx);continue;
    }
    const base=along(x0,y0),line=across(x0,y0);intersections.length=0;
    for(let i=0,j=poly.length-1;i<poly.length;j=i++){
      const a=poly[i],b=poly[j];if((a[1]>line)===(b[1]>line))continue;
      intersections.push(Math.max(0,Math.min(nx,Math.ceil(a[0]+(b[0]-a[0])*(line-a[1])/(b[1]-a[1])-base))));
    }
    intersections.sort((a,b)=>a-b);let previous=0;
    for(let i=0;i+1<intersections.length;i+=2){
      const left=intersections[i],right=intersections[i+1];
      if(cut.inside)mask.fill(1,offset+left,offset+right);else mask.fill(1,offset+previous,offset+left);previous=right;
    }
    if(!cut.inside)mask.fill(1,offset+previous,offset+nx);
  }
 }
 return mask;
}
