import {indexToWorld,radiologicalOrientation} from './navigation';
import {worldToIndex,type Geometry,type Vec3} from './geometry';
const dot=(a:number[],b:number[])=>a.reduce((sum,n,i)=>sum+n*b[i],0);
type Camera={focalPoint:Vec3;position:Vec3;viewUp:Vec3;viewPlaneNormal:Vec3;parallelScale:number};
/** Exact source-plane slices. Only the displayed plane is rasterized: a large
 * segmentation workspace must not allocate full-volume GPU textures or reset
 * the main viewer's GPU context. DICOM geometry is retained for every gesture. */
export class SmartSliceViewport{
 readonly canvas:HTMLCanvasElement;private pixels=document.createElement('canvas');private camera:Camera;
 private voi={lower:-160,upper:240};private horizontal:number;private vertical:number;private right:Vec3;private signs:number[];
 constructor(readonly id:string,readonly axis:number,readonly element:HTMLDivElement,private owner:SmartSliceEngine){
  const g=owner.geometry,{viewUp:u,viewPlaneNormal:n}=radiologicalOrientation(g,axis);this.right=[u[1]*n[2]-u[2]*n[1],u[2]*n[0]-u[0]*n[2],u[0]*n[1]-u[1]*n[0]];
  const others=[0,1,2].filter(a=>a!==axis);this.horizontal=others.sort((a,b)=>Math.abs(dot(g.direction.slice(b*3,b*3+3),this.right))-Math.abs(dot(g.direction.slice(a*3,a*3+3),this.right)))[0];this.vertical=others.find(a=>a!==this.horizontal)!;
  this.signs=[Math.sign(dot(g.direction.slice(this.horizontal*3,this.horizontal*3+3),this.right)),Math.sign(dot(g.direction.slice(this.vertical*3,this.vertical*3+3),u))];
  const center=indexToWorld(g,g.dimensions.map(n=>(n-1)/2) as Vec3);this.camera={focalPoint:center,position:center.map((v,i)=>v+n[i]*1000) as Vec3,viewUp:u,viewPlaneNormal:n,parallelScale:g.dimensions[this.vertical]*g.spacing[this.vertical]/2};
  this.canvas=document.createElement('canvas');this.canvas.style.cssText='position:absolute;inset:0;width:100%;height:100%';element.appendChild(this.canvas);this.resize(false);
 }
 getCamera(){return {...this.camera,focalPoint:[...this.camera.focalPoint] as Vec3,position:[...this.camera.position] as Vec3};}
 setCamera(camera:Partial<Camera>){this.camera={...this.camera,...camera};}
 setProperties(properties:{voiRange:{lower:number;upper:number}}){this.voi=properties.voiRange;}
 getProperties(){return {voiRange:this.voi};}
 worldToCanvas(point:Vec3):[number,number]{const scale=this.element.clientHeight/(2*this.camera.parallelScale),delta=point.map((n,i)=>n-this.camera.focalPoint[i]);return [this.element.clientWidth/2+dot(delta,this.right)*scale,this.element.clientHeight/2-dot(delta,this.camera.viewUp)*scale];}
 canvasToWorld(point:number[]):Vec3{const scale=this.element.clientHeight/(2*this.camera.parallelScale)||1,x=(point[0]-this.element.clientWidth/2)/scale,y=(this.element.clientHeight/2-point[1])/scale;return this.camera.focalPoint.map((n,i)=>n+this.right[i]*x+this.camera.viewUp[i]*y) as Vec3;}
 resize(keep=true){const dpr=Math.min(this.element.ownerDocument.defaultView?.devicePixelRatio||1,2);const width=Math.max(1,Math.round(this.element.clientWidth*dpr)),height=Math.max(1,Math.round(this.element.clientHeight*dpr));if(this.canvas.width!==width)this.canvas.width=width;if(this.canvas.height!==height)this.canvas.height=height;if(!keep){const g=this.owner.geometry;this.camera.parallelScale=Math.max(g.dimensions[this.vertical]*g.spacing[this.vertical],g.dimensions[this.horizontal]*g.spacing[this.horizontal]*this.element.clientHeight/Math.max(1,this.element.clientWidth))*.52;}}
 render(){this.owner.render();}
 draw(){this.resize(true);const g=this.owner.geometry,u=this.horizontal,v=this.vertical,w=g.dimensions[u],h=g.dimensions[v],slice=Math.max(0,Math.min(g.dimensions[this.axis]-1,Math.round(worldToIndex(g,this.camera.focalPoint)[this.axis])));this.pixels.width=w;this.pixels.height=h;const context=this.pixels.getContext('2d')!,image=context.createImageData(w,h),span=Math.max(1,this.voi.upper-this.voi.lower),index=[0,0,0];index[this.axis]=slice;
  for(let y=0;y<h;y++){index[v]=this.signs[1]>0?h-1-y:y;for(let x=0;x<w;x++){index[u]=this.signs[0]>0?x:w-1-x;const i=(index[2]*g.dimensions[1]+index[1])*g.dimensions[0]+index[0],p=(y*w+x)*4,gray=Math.max(0,Math.min(255,(this.owner.scalars[i]-this.voi.lower)*255/span)),color=this.owner.colors.get(this.owner.mask[i]);for(let c=0;c<3;c++)image.data[p+c]=color?gray*(1-this.owner.opacity)+color[c]*this.owner.opacity:gray;image.data[p+3]=255;}}
  context.putImageData(image,0,0);const out=this.canvas.getContext('2d')!,dpr=this.canvas.width/Math.max(1,this.element.clientWidth);out.setTransform(1,0,0,1,0,0);out.clearRect(0,0,this.canvas.width,this.canvas.height);out.fillStyle='#000';out.fillRect(0,0,this.canvas.width,this.canvas.height);out.setTransform(dpr,0,0,this.canvas.height/Math.max(1,this.element.clientHeight),0,0);const corner=[...index] as Vec3;corner[u]=this.signs[0]>0?-.5:w-.5;corner[v]=this.signs[1]>0?h-.5:-.5;const p=this.worldToCanvas(indexToWorld(g,corner)),scale=this.element.clientHeight/(2*this.camera.parallelScale);out.imageSmoothingEnabled=true;out.drawImage(this.pixels,p[0],p[1],w*g.spacing[u]*scale,h*g.spacing[v]*scale);this.element.dispatchEvent(new CustomEvent('CORNERSTONE_IMAGE_RENDERED'));
 }
 destroy(){this.canvas.remove();this.pixels.width=0;this.pixels.height=0;}
}
export class SmartSliceEngine{
 private observer?:ResizeObserver;private ownerWindow:Window;private viewports:SmartSliceViewport[];private frame=0;private disposed=false;colors=new Map<number,number[]>();opacity=.35;
 constructor(readonly geometry:Geometry,readonly scalars:Float32Array,public mask:Uint8Array,hosts:HTMLDivElement[],ids:string[]){this.ownerWindow=hosts[0].ownerDocument.defaultView||window;this.viewports=hosts.map((el,a)=>new SmartSliceViewport(ids[a],a,el,this));const Observer=(this.ownerWindow as Window & typeof globalThis).ResizeObserver;if(Observer){this.observer=new Observer(()=>this.resize(true,true));hosts.forEach(el=>this.observer!.observe(el));}}
 getViewport(id:string){const viewport=this.viewports.find(v=>v.id===id);if(!viewport)throw Error('Smart Volume viewport closed');return viewport;}
 getViewports(){return this.viewports;}
 setMask(mask:Uint8Array){this.mask=mask;}
 setColors(items:{id:number;color:string}[],opacity:number){this.colors=new Map(items.map(s=>[s.id,s.color.slice(1).match(/../g)!.map(v=>parseInt(v,16))]));this.opacity=opacity;}
 render(){if(this.disposed||this.frame)return;this.frame=this.ownerWindow.requestAnimationFrame(()=>{this.frame=0;if(!this.disposed)this.viewports.forEach(v=>v.draw());});}
 resize(_immediate=true,keep=true){this.viewports.forEach(v=>v.resize(keep));this.render();}
 destroy(){this.observer?.disconnect();this.disposed=true;this.ownerWindow.cancelAnimationFrame(this.frame);this.viewports.forEach(v=>v.destroy());this.viewports=[];}
}


