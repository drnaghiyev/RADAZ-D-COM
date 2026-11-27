import '@kitware/vtk.js/Rendering/Profiles/Geometry';
import '@kitware/vtk.js/Rendering/Profiles/Volume';
import type {vtkOpenGLRenderWindow} from '@kitware/vtk.js/Rendering/OpenGL/RenderWindow';
import vtkGenericRenderWindow from '@kitware/vtk.js/Rendering/Misc/GenericRenderWindow';
import vtkLight from '@kitware/vtk.js/Rendering/Core/Light';
import vtkVolume from '@kitware/vtk.js/Rendering/Core/Volume';
import vtkColor from '@kitware/vtk.js/Rendering/Core/ColorTransferFunction';
import vtkOpacity from '@kitware/vtk.js/Common/DataModel/PiecewiseFunction';
import vtkActor from '@kitware/vtk.js/Rendering/Core/Actor';
import vtkMapper from '@kitware/vtk.js/Rendering/Core/Mapper';
import vtkPolyData from '@kitware/vtk.js/Common/DataModel/PolyData';
import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';
import {createVolumeRenderSource} from '../volume-render-source';
import {add,cross,hideAirwayExterior,material,vrLighting,type Cut,type Frame,type Style,type Volume} from './scene';
import {airwayBodyRows,maskAirwayExterior} from './airway-envelope';
import workerUrl from './worker.ts?worker&url';
import meshUrl from '../anatomy-surface.worker.ts?worker&url';

export type Quality='speed'|'balanced'|'detail';
export type Engine='auto'|'cpu'|'gpu';
type Render={cam:Frame;style:Style;moving:boolean;quality:Quality;provisional?:boolean};
function gpuView(host:HTMLElement,v:Volume,tablet:boolean,onFallback:()=>void){
 const view=vtkGenericRenderWindow.newInstance({background:[0,0,0],listenWindowResize:false});
 let ready=false;
 const interactor=view.getInteractor(),window3d=view.getRenderWindow(),renderer=view.getRenderer();
 let lose:WEBGL_lose_context|null=null;
 const disposeView=()=>{
   try{view.delete();interactor.delete();window3d.delete();renderer.delete();}
   finally{lose?.loseContext();}
 };
 try{
 view.setContainer(host);view.getInteractor().unbindEvents();
 const api=view.getApiSpecificRenderWindow() as vtkOpenGLRenderWindow,canvas=api.getCanvas()!,camera=renderer.getActiveCamera();
 const gl=api.get3DContext({});
 if(!gl)throw Error('WebGL yoxdur');
 lose=gl.getExtension('WEBGL_lose_context');
 renderer.setAutomaticLightCreation(false);
 renderer.removeAllLights();
 canvas.addEventListener('webglcontextlost',onFallback);
 const source=createVolumeRenderSource({...v,scalarRange:{min:v.range[0],max:v.range[1]}});
 const actor=vtkVolume.newInstance(),rgb=vtkColor.newInstance(),opacity=vtkOpacity.newInstance(),p=actor.getProperty();
 actor.setMapper(source.mapper);p.setRGBTransferFunction(0,rgb);p.setScalarOpacity(0,opacity);p.setInterpolationTypeToLinear();p.setScalarOpacityUnitDistance(0,1);p.setDiffuse(vrLighting.diffuse);p.setSpecular(vrLighting.specular);p.setSpecularPower(vrLighting.power);
 renderer.addVolume(actor);camera.setParallelProjection(true);
 const keyLight=vtkLight.newInstance(),fillLight=vtkLight.newInstance();
 for(const light of [keyLight,fillLight]){light.setLightTypeToSceneLight();light.setPositional(false);renderer.addLight(light);}
 keyLight.setColor(1,.987,.967);keyLight.setIntensity(vrLighting.keyIntensity);
 fillLight.setColor(.95,.975,1);fillLight.setIntensity(vrLighting.fillIntensity);
 let distance=Math.hypot(...v.dimensions.map((n,i)=>n*v.spacing[i]))*2+1;
 let airwayBounds:Int32Array|undefined,wasAirway=false;
 let applied:Style|undefined,excluded:Uint8Array<ArrayBufferLike>=new Uint8Array(0),oldMask:Uint8Array<ArrayBufferLike>=excluded,oldMinimum=false,meshWorker:Worker|null=null;
 const meshes:{actor:ReturnType<typeof vtkActor.newInstance>;mapper:ReturnType<typeof vtkMapper.newInstance>;mesh:ReturnType<typeof vtkPolyData.newInstance>}[]=[];
 let last:Render|undefined,disposed=false;
 function clearMeshes(){meshWorker?.terminate();meshWorker=null;for(const m of meshes){renderer.removeActor(m.actor);m.actor.delete();m.mapper.delete();m.mesh.delete();}meshes.length=0;}
 function mesh(){
   clearMeshes();if(!v.mask.length)return;
   const labels=Array.from(new Set(v.mask)).filter(Boolean);if(!labels.length)return;
   const mask=v.mask.slice();if(excluded.length)for(let i=0;i<mask.length;i++)if(excluded[i])mask[i]=0;
   const worker=new Worker(new URL(meshUrl,location.origin),{type:'module'});meshWorker=worker;
   worker.onmessage=({data})=>{if(disposed||worker!==meshWorker)return;if(data.done||data.error){worker.terminate();meshWorker=null;return;}
     const m=vtkPolyData.newInstance();m.getPoints().setData(data.points,3);m.getPolys().setData(data.polys);m.getPointData().setNormals(vtkDataArray.newInstance({name:'Normals',numberOfComponents:3,values:data.normals}));
     const mapper=vtkMapper.newInstance(),a=vtkActor.newInstance();mapper.setInputData(m);mapper.setScalarVisibility(false);a.setMapper(mapper);
     const c=(v.colors[data.label]||'#42d6b0').slice(1).match(/../g)!.map(n=>parseInt(n,16)/255) as [number,number,number];a.getProperty().setColor(...c);a.getProperty().setInterpolationToPhong();renderer.addActor(a);meshes.push({actor:a,mapper,mesh:m});if(last)draw(last);
   };
   worker.postMessage({mask,geometry:{dimensions:v.dimensions,spacing:v.spacing,origin:v.origin,direction:v.direction},labels,smooth:true},[mask.buffer]);
 }
 mesh();const {mapper}=source;let lastW=0,lastH=0,baseStep=Math.min(...v.spacing);
 function draw(r:Render){
   last=r;const {cam,style:s,quality:q,moving}=r,min=s.preset==='minip';
   const airway=hideAirwayExterior(s,v.modality),masked=airway||!!excluded.length;
   if(oldMask!==excluded||wasAirway!==airway||(excluded.length&&oldMinimum!==min)){
     const floor=min?v.range[1]+Math.max(1,v.range[1]-v.range[0]):v.range[0]-Math.max(1,v.range[1]-v.range[0]);
     let values=v.values;
     if(masked){
       values=v.values.slice();
       if(airway){
         airwayBounds??=airwayBodyRows(v.values,v.dimensions);
         maskAirwayExterior(values,v.dimensions[0],airwayBounds,v.range[1]+Math.max(1,v.range[1]-v.range[0]));
       }
       for(let i=0;i<excluded.length;i++)if(excluded[i])values[i]=floor;}
     source.scalars.setData(values,1);source.scalars.setRange({min:excluded.length?Math.min(floor,v.range[0]):v.range[0],max:airway?v.range[1]+Math.max(1,v.range[1]-v.range[0]):excluded.length?Math.max(floor,v.range[1]):v.range[1]},0);source.image.modified();oldMinimum=min;oldMask=excluded;wasAirway=airway;applied=undefined;
   }
   if(applied!==s){
     const m=material(s,v.range);rgb.removeAllPoints();opacity.removeAllPoints();
     for(const [x,red,green,blue]of m.rgb)rgb.addRGBPoint(x,red,green,blue);
     for(const [x,a]of m.alpha)opacity.addPoint(x,a);
     const span=Math.max(1,v.range[1]-v.range[0]);
     if(airway){const bound=v.range[1]+span;opacity.addPoint(bound,0);rgb.addRGBPoint(bound,0,0,0);}
     if(excluded.length){const bound=min?v.range[1]+span:v.range[0]-span;opacity.addPoint(bound,0);rgb.addRGBPoint(bound,0,0,0);}
     if(m.blend==='maximum')mapper.setBlendModeToMaximumIntensity();else if(min)mapper.setBlendModeToMinimumIntensity();else mapper.setBlendModeToComposite();
     p.setShade(m.blend==='composite'&&s.shading);p.setAmbient(s.brightness);actor.setVisibility(s.context);applied=s;
   }
   for(const m of meshes){m.actor.setVisibility(s.segments);m.actor.getProperty().setOpacity(s.opacity);m.actor.getProperty().setAmbient(s.brightness);}
   const width=host.clientWidth,height=host.clientHeight;
   let density=moving?(q==='speed'?.45:q==='balanced'?.60:.85):Math.min(1.5,host.ownerDocument.defaultView?.devicePixelRatio||1);
   if(r.provisional)density=Math.min(density,560/Math.max(1,width,height));
   if(tablet){
     const edge=moving?(q==='speed'?320:q==='detail'?620:440):(q==='detail'?1536:q==='speed'?840:1120);
     density=Math.min(density,edge/Math.max(1,width,height));
   }
   const w=Math.max(2,Math.round(width*density)),h=Math.max(2,Math.round(height*density));
   if(w!==lastW||h!==lastH){api.setSize(w,h);lastW=w;lastH=h;}
   mapper.setSampleDistance(baseStep*(moving?(tablet?(q==='detail'?1.6:2.5):q==='speed'?2.5:q==='balanced'?1.75:1):q==='detail'?.40:.65));
   camera.setFocalPoint(...cam.center);camera.setPosition(...add(cam.center,cam.normal,distance));camera.setViewUp(...cam.up);camera.setParallelScale(cam.scale);
   const right=cross(cam.up,cam.normal);
   keyLight.setPosition(...add(add(add(cam.center,cam.normal,distance),right,distance*vrLighting.key.right),cam.up,distance*vrLighting.key.up));
   keyLight.setFocalPoint(...cam.center);fillLight.setPosition(...add(add(add(cam.center,cam.normal,distance),right,distance*vrLighting.fill.right),cam.up,distance*vrLighting.fill.up));fillLight.setFocalPoint(...cam.center);
   camera.setClippingRange(.01,distance*3);view.getRenderWindow().render();
 }
 ready=true;
 return {canvas,draw,replaceVolume(next:Volume){
   v=next;wasAirway=false;airwayBounds=undefined;last=undefined;applied=undefined;excluded=new Uint8Array(0);oldMask=excluded;
   baseStep=Math.min(...next.spacing);distance=Math.hypot(...next.dimensions.map((n,i)=>n*next.spacing[i]))*2+1;
   source.image.setDimensions(...next.dimensions);source.image.setSpacing(next.spacing);source.image.setOrigin(next.origin);
   source.image.setDirection(new Float32Array(next.direction));
   source.scalars.setData(next.values,1);source.scalars.setRange({min:next.range[0],max:next.range[1]},0);
   source.image.modified();mesh();
 },mask(mask:Uint8Array<ArrayBufferLike>){excluded=mask;mesh();},dispose(){
   disposed=true;canvas.removeEventListener('webglcontextlost',onFallback);clearMeshes();renderer.removeVolume(actor);for(const l of [keyLight,fillLight]){renderer.removeLight(l);l.delete();}actor.delete();rgb.delete();opacity.delete();source.dispose();disposeView();
 }};
 }finally{if(!ready)disposeView();}
}
export function createVrRenderer(host:HTMLElement,v:Volume,requested:Engine,onFrame:(mode:string)=>void,onError:(message:string)=>void){
  const win=host.ownerDocument.defaultView!;
  const tablet=win.location.origin==='https://appassets.androidplatform.net';
  let gpu:ReturnType<typeof gpuView>|null=null,cpu:HTMLCanvasElement|null=null,worker:Worker|null=null;
  let latest:Render|null=null,dead=false,waitingCpu=false,frame=0,refinement=0;
  let revision=0,complete=-1,cutId=0,appliedCut=0,lastGesture=0,firstFrame=true;
  let cpuTicket=0,cpuCut=0,cpuPreview=false;
  const waiters=new Set<{resolve:()=>void;reject:(error:Error)=>void}>();

  function finish(id:number,preview:boolean){
    if(dead || appliedCut!==cutId)return;
    onFrame(gpu?'GPU':'CPU');
    if(id!==revision || preview)return;
    complete=id;
    for(const waiter of waiters)waiter.resolve();
    waiters.clear();
  }
  function fail(message:string){
    if(dead)return;
    onError(message);
    for(const waiter of waiters)waiter.reject(Error(message));
    waiters.clear();
  }
  function getWorker(){
    if(worker)return worker;
    worker=new Worker(new URL(workerUrl,location.origin),{type:'module'});
    worker.onerror=e=>fail(e.message||'Həcm hesablana bilmədi.');
    worker.onmessage=({data})=>{
      if(dead)return;
      if(data.type==='error'){waitingCpu=false;fail(data.message);return;}
      if(data.type==='mask'){
        if(data.id!==cutId)return;
        appliedCut=cutId;gpu?.mask(data.mask);schedule();return;
      }
      if(data.type!=='frame'||!cpu)return;
      waitingCpu=false;
      if(cpuCut===cutId && appliedCut===cutId){
        if(cpu.width!==data.width)cpu.width=data.width;
        if(cpu.height!==data.height)cpu.height=data.height;
        cpu.getContext('2d')!.putImageData(new ImageData(data.pixels,data.width,data.height),0,0);
        finish(cpuTicket,cpuPreview);
      }
      if(cpuTicket!==revision || cpuCut!==cutId || (cpuPreview && (waiters.size>0 || win.performance.now()-lastGesture>=140)))schedule();
    };
    return worker;
  }
  function fallback(){
    if(dead||cpu)return;
    gpu?.dispose();gpu=null;
    cpu=host.ownerDocument.createElement('canvas');host.appendChild(cpu);
    getWorker().postMessage({type:'volume',volume:v});
    if(latest)schedule();
  }
  function schedule(){
    if(!dead && !frame)frame=win.requestAnimationFrame(()=>{frame=0;paint();});
  }
  function paint(forceDetail=false){
    if(dead||!latest||appliedCut!==cutId||(!gpu&&waitingCpu))return;
    const now=win.performance.now();
    if(firstFrame){firstFrame=false;lastGesture=now;}
    const delay=140-(now-lastGesture);
    const preview=tablet && !forceDetail && !waiters.size && !latest.moving && delay>0;
    const moving=forceDetail?false:latest.moving||preview;
    const request=moving===latest.moving?latest:{...latest,moving};
    if(preview){
      win.clearTimeout(refinement);
      refinement=win.setTimeout(schedule,Math.ceil(delay)+1);
    }
    if(gpu){
      try{gpu.draw(request);finish(revision,preview);}
      catch{fallback();}
      return;
    }
    if(!cpu)return;
    const {cam,style,quality}=request;
    const width=host.clientWidth,height=host.clientHeight;
    const cap=moving?(quality==='speed'||tablet?144:220):(quality==='detail'?(tablet?800:960):(tablet?512:640));
    const ratio=Math.min(1,cap/Math.max(1,width,height));
    cpuTicket=revision;cpuCut=cutId;cpuPreview=preview;waitingCpu=true;
    getWorker().postMessage({type:'draw',id:cpuTicket,cam,style,moving,aspect:width/Math.max(1,height),
      width:Math.max(2,Math.round(width*ratio)),height:Math.max(2,Math.round(height*ratio))});
  }
  if(requested!=='cpu' && !v.cpuOnly){
    try{gpu=gpuView(host,v,tablet,()=>{queueMicrotask(fallback);});}
    catch{fallback();}
  }else fallback();
  return {
    replacePreview(next:Volume){
      // This transition is only used before editing tools become available.
      if(dead)return;
      v=next;latest=null;firstFrame=false;complete=-1;revision++;
      win.clearTimeout(refinement);
      if(gpu){
        try{if(next.cpuOnly)fallback();else gpu.replaceVolume(next);}catch{fallback();}
      }else {
        if(worker){worker.onmessage=null;worker.terminate();worker=null;}
        waitingCpu=false;getWorker().postMessage({type:'volume',volume:next});
      }
    },
    draw(r:Render){
      if(dead)return;
      latest=r;revision++;
      if(r.moving)lastGesture=win.performance.now();
      schedule();
    },
    cut(cuts:Cut[]){
      if(dead)return;
      getWorker().postMessage({type:'cut',id:++cutId,dimensions:v.dimensions,cuts});
    },
    async capture(){
      if(dead||!latest)throw Error('3D bağlanıb.');
      if(complete!==revision || appliedCut!==cutId){
        await new Promise<void>((resolve,reject)=>{waiters.add({resolve,reject});paint(true);});
      }
      if(dead)throw Error('3D bağlanıb.');
      // The default WebGL framebuffer can be discarded between presented frames.
      if(gpu)gpu.draw({...latest,moving:false});
      return (gpu?.canvas||cpu)!;
    },
    dispose(){
      if(dead)return;
      dead=true;win.cancelAnimationFrame(frame);win.clearTimeout(refinement);
      worker?.terminate();cpu?.remove();
      for(const waiter of waiters)waiter.reject(Error('3D bağlanıb.'));
      waiters.clear();latest=null;gpu?.dispose();gpu=null;
    }
  };
}
