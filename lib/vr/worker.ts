import {add,clamp,cross,dot,hideAirwayExterior,material,pointAt,unit,vrLighting,type Frame,type Style,type Volume,type V} from './scene';
import {airwayBodyRows} from './airway-envelope';
import {excludedVoxels} from './scalpel';
let airwayBounds:Int32Array|undefined;
let volume:Volume,mask:Uint8Array<ArrayBufferLike>=new Uint8Array(0);
function ramp(knots:number[][],n:number,k:number){
 let i=0;while(i+1<knots.length&&n>knots[i+1][0])i++;
 const a=knots[i],b=knots[Math.min(i+1,knots.length-1)],t=clamp((n-a[0])/(b[0]-a[0]||1),0,1);
 return a[k]+t*(b[k]-a[k]);
}
function trace(camera:Frame,s:Style,W:number,H:number,aspect:number,moving:boolean){
 const g=volume,{dimensions:d,spacing,values,range}=g,[nx,ny,nz]=d,slice=nx*ny,rgba=new Uint8ClampedArray(W*H*4);
 const body=hideAirwayExterior(s,g.modality)?(airwayBounds??=airwayBodyRows(values,d)):undefined;
 const map=material(s,range),lut=new Float32Array(4096*4),slope=4095/(range[1]-range[0]||1);
 for(let i=0;i<4096;i++){const n=range[0]+i/slope;for(let c=0;c<3;c++)lut[4*i+c]=ramp(map.rgb,n,c+1);lut[4*i+3]=ramp(map.alpha,n,1);}
 const dir=(v:V)=>[0,1,2].map(i=>(v[0]*g.direction[3*i]+v[1]*g.direction[3*i+1]+v[2]*g.direction[3*i+2])/spacing[i]) as V;
 const right=cross(camera.up,camera.normal);
 const start=dir(add(pointAt(camera,[.5,.5],W,H),g.origin,-1));
 // Canvas backing sizes preserve the same physical aspect, including non-square intermediate previews.
 const dx=dir(right).map(n=>n*2*camera.scale*aspect/W),dy=dir(camera.up).map(n=>-n*2*camera.scale/H);
 const ray=dir(camera.normal).map(n=>-n);
 // Gradients below are already expressed per millimetre along the DICOM axes.
 const localLight=(axis:V)=>dir(axis).map((x,i)=>x*spacing[i]) as V;
 const light=(r:number,u:number)=>unit(add(add(camera.normal,right,r),camera.up,u));
 const key=light(vrLighting.key.right,vrLighting.key.up),fill=light(vrLighting.fill.right,vrLighting.fill.up);
 const keyDir=localLight(key),fillDir=localLight(fill),half=localLight(unit(add(key,camera.normal)));
 const step=Math.max(.1,Math.min(...spacing)*(moving?2.2:.75)),palette:Record<number,number[]>={};
 for(const[k,hex]of Object.entries(g.colors)){const rgb=hex.match(/[0-9a-f]{2}/gi);if(rgb)palette[Number(k)]=rgb.map(n=>parseInt(n,16)/255);}
 const maximum=map.blend==='maximum',minimum=map.blend==='minimum';
 for(let y=0;y<H;y++)for(let x=0;x<W;x++){
   const o=[start[0]+x*dx[0]+y*dy[0],start[1]+x*dx[1]+y*dy[1],start[2]+x*dx[2]+y*dy[2]];
   let near=-Infinity,far=Infinity;
   for(let a=0;a<3;a++){if(Math.abs(ray[a])<1e-10){if(o[a]<-.5||o[a]>=d[a]-.5)far=-Infinity;}else{const t0=(-.5-o[a])/ray[a],t1=(d[a]-.5-o[a])/ray[a];near=Math.max(near,Math.min(t0,t1));far=Math.min(far,Math.max(t0,t1));}}
   let red=0,green=0,blue=0,alpha=0,best=minimum?Infinity:-Infinity;
   for(let t=near+step*.25;t<=far;t+=step){
     const ix=clamp(o[0]+t*ray[0],0,nx-1),iy=clamp(o[1]+t*ray[1],0,ny-1),iz=clamp(o[2]+t*ray[2],0,nz-1);
     const X=Math.round(ix),Y=Math.round(iy),Z=Math.round(iz),i=Z*slice+Y*nx+X;
     if(body){const row=2*(Z*ny+Y);if(X<body[row]||X>=body[row+1])continue;}
     if(mask[i])continue;const label=s.segments?g.mask[i]:0;if(!s.context&&!label)continue;
     let n=values[i];
     if(!moving){const x0=Math.floor(ix),y0=Math.floor(iy),z0=Math.floor(iz),a=ix-x0,b=iy-y0,c=iz-z0,at=z0*slice+y0*nx+x0;
       const u=x0+1<nx?1:0,v=y0+1<ny?nx:0,w=z0+1<nz?slice:0;
       const lerp=(base:number)=>(values[base]*(1-a)+values[base+u]*a)*(1-b)+(values[base+v]*(1-a)+values[base+v+u]*a)*b;
       n=lerp(at)*(1-c)+lerp(at+w)*c;
     }
     if((maximum||minimum)&&!label){best=minimum?Math.min(best,n):Math.max(best,n);continue;}
     const j=4*clamp(Math.round((n-range[0])*slope),0,4095),coverage=label?.85:lut[j+3];if(coverage<.0001)continue;
     let shade=1,shine=0;
     if(s.shading){const gx=(values[i+(X<nx-1?1:0)]-values[i-(X?1:0)])/spacing[0],gy=(values[i+(Y<ny-1?nx:0)]-values[i-(Y?nx:0)])/spacing[1],gz=(values[i+(Z<nz-1?slice:0)]-values[i-(Z?slice:0)])/spacing[2];
       const inv=1/(Math.hypot(gx,gy,gz)||1);
       const lit=(d:V)=>Math.max(0,-(gx*d[0]+gy*d[1]+gz*d[2])*inv);
       const keyAmount=lit(keyDir);
       shade=s.brightness+vrLighting.diffuse*(vrLighting.keyIntensity*keyAmount+vrLighting.fillIntensity*lit(fillDir));
       if(keyAmount>0)shine=vrLighting.specular*vrLighting.keyIntensity*Math.pow(lit(half),vrLighting.power);
     }
     const weight=(1-alpha)*(1-Math.pow(1-coverage,step)),col=palette[label]||[.20,.83,.68];
     red+=weight*(shade*(label?col[0]:lut[j])+shine);green+=weight*(shade*(label?col[1]:lut[j+1])+shine);blue+=weight*(shade*(label?col[2]:lut[j+2])+shine);alpha+=weight;if(alpha>.985)break;
   }
   if(Number.isFinite(best)){const j=4*clamp(Math.round((best-range[0])*slope),0,4095);red+=(1-alpha)*lut[j];green+=(1-alpha)*lut[j+1];blue+=(1-alpha)*lut[j+2];}
   const k=(y*W+x)*4;rgba[k]=red*255;rgba[k+1]=green*255;rgba[k+2]=blue*255;rgba[k+3]=255;
 }
 return rgba;
}
self.onmessage=({data})=>{try{
 if(data.type==='volume'){volume=data.volume;airwayBounds=undefined;return;}
 if(data.type==='cut'){mask=excludedVoxels(data.dimensions,data.cuts);const result=mask.slice();self.postMessage({type:'mask',id:data.id,mask:result}, {transfer:[result.buffer]});return;}
 if(data.type==='draw'){const pixels=trace(data.cam,data.style,data.width,data.height,data.aspect,data.moving);self.postMessage({type:'frame',id:data.id,width:data.width,height:data.height,pixels},{transfer:[pixels.buffer]});}
 }catch(e){self.postMessage({type:'error',id:data.id,message:String(e)});}
};
