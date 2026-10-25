import {validateGeometry,type Geometry} from './geometry';
export type Contour = {axis:0|1|2;slice:number;points:[number,number][]};
export function rasterizeContour(g:Geometry,c:Contour):number[]{
  validateGeometry(g);
  if(![0,1,2].includes(c.axis)||!Number.isInteger(c.slice)||c.slice<0||c.slice>=g.dimensions[c.axis]||c.points.length<3||c.points.some(p=>p.length!==2||p.some(v=>!Number.isFinite(v))))throw Error('Invalid contour');
  const axes=([0,1,2] as const).filter(a=>a!==c.axis),[u,v]=axes,indices:number[]=[];
  const xmin=Math.max(0,Math.ceil(Math.min(...c.points.map(p=>p[0])))),xmax=Math.min(g.dimensions[u]-1,Math.floor(Math.max(...c.points.map(p=>p[0]))));
  const ymin=Math.max(0,Math.ceil(Math.min(...c.points.map(p=>p[1])))),ymax=Math.min(g.dimensions[v]-1,Math.floor(Math.max(...c.points.map(p=>p[1]))));
  for(let y=ymin;y<=ymax;y++)for(let x=xmin;x<=xmax;x++){
    let inside=false;
    for(let i=0,j=c.points.length-1;i<c.points.length;j=i++){
      const a=c.points[i],b=c.points[j];
      if((a[1]>y)!==(b[1]>y)&&x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0])inside=!inside;
    }
    if(inside){const p=[0,0,0];p[c.axis]=c.slice;p[u]=x;p[v]=y;indices.push((p[2]*g.dimensions[1]+p[1])*g.dimensions[0]+p[0]);}
  }return indices;
}
/** Explicit geometric interpolation. Never model inference. Matching vertices required. */
export function interpolateContours(a:Contour,b:Contour):Contour[]{
  if(a.axis!==b.axis||a.slice>=b.slice||a.points.length!==b.points.length||a.points.length<3)throw Error('Matching ordered contours required');
  const result:Contour[]=[];
  for(let slice=a.slice+1;slice<b.slice;slice++){
    const t=(slice-a.slice)/(b.slice-a.slice);
    result.push({axis:a.axis,slice,points:a.points.map((p,i)=>[p[0]*(1-t)+b.points[i][0]*t,p[1]*(1-t)+b.points[i][1]*t])});
  }return result;
}
