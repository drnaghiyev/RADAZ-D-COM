'use client';
import {useTranslation as useUiTranslation,translate as tr} from '@/lib/i18n';

import {useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {VolumeOrientation} from './volume-orientation';
import {createVolumeScalpel} from '@/lib/volume-scalpel';
import {Box,Scissors,RotateCcw,Undo2,Rotate3D} from 'lucide-react';
import {getViewer,getSeriesVolume} from '@/lib/cornerstone';
import {gpuCapabilities} from '@/lib/gpu-capabilities';
import {qualityProfiles,resolvedVolumeSettings,volumePresetConfig,volumeLights,type VolumePreset,type VolumeRenderSettings} from '@/lib/volume-presets';
import {viewerPerformance,performanceSnapshot,instrumentVolumeUpload} from '@/lib/viewer-performance';
import {WorkProgress} from './work-progress';
import type {WorkProgress as LoadingProgress} from '@/lib/work-progress';
import vtkPlane from '@kitware/vtk.js/Common/DataModel/Plane';
import {cropPlanes,transferArrays} from '@/lib/transfer-function';
import {createAnatomySurfaces} from '@/lib/anatomy-surfaces';
import type {AnatomyVolumeResult} from '@/lib/anatomy-volume';
import type {AnatomyAppearance} from '@/lib/anatomy-editing';
import {useTranslation} from '@/lib/i18n';
export type {VolumeRenderSettings} from '@/lib/volume-presets';
type Props={focusPoint?:[number,number,number]|null;anatomy?:AnatomyVolumeResult|null;anatomyAppearance?:AnatomyAppearance;series?:{id:string;imageIds:string[];name:string;modality:string;loading?:boolean};sourceProgress?:LoadingProgress|null;
 preset:VolumePreset;threshold:number;opacity:number;settings:VolumeRenderSettings;resetToken:number;
 onThresholdChange:(v:number)=>void;onOpacityChange:(v:number)=>void;onSettingsChange:(v:VolumeRenderSettings)=>void};
type Profile=keyof typeof qualityProfiles;
const clamp=(v:number,a:number,b:number)=>Math.max(a,Math.min(b,v));
const serialize=(values:number[][])=>{const flat=values.flat();return [flat.length,...flat].join(' ');};
export function VolumePreview(props:Props){
  useUiTranslation();
 const {t}=useTranslation();
 const [showVolume,setShowVolume]=useState(true);
 const [toolbarTarget,setToolbarTarget]=useState<HTMLElement|null>(null);
 useEffect(()=>{const update=()=>setToolbarTarget(document.getElementById('volume-edit-toolbar'));update();const observer=new MutationObserver(update);observer.observe(document.body,{childList:true,subtree:true});return()=>observer.disconnect();},[]);
 const [scalpel,setScalpel]=useState(false),[cutting,setCutting]=useState(false),[cutError,setCutError]=useState(''),[polygon,setPolygon]=useState<[number,number][]>([]);
 const cutRef=useRef<ReturnType<typeof createVolumeScalpel>|null>(null),drawing=useRef(false),points=useRef<[number,number][]>([]);
 const cut=async()=>{if(points.current.length<3)return;setCutting(true);setCutError('');try{const viewport=viewportRef.current,current=volumeRef.current;if(!viewport||!current)return;if(!current.volume.loadStatus?.loaded)throw Error('Bütün kəsiklərin yüklənməsini gözləyin.');
 if(!cutRef.current){const volume=current.volume;cutRef.current=createVolumeScalpel(viewport,{dimensions:[...volume.dimensions],spacing:[...volume.spacing],origin:[...volume.origin],direction:[...volume.direction],values:volume.voxelManager!.getCompleteScalarDataArray!()},Math.min(-4096,current.range[0]-1));applyRef.current();}
 await cutRef.current.cut(points.current);applyRef.current();}catch(error){setCutError(error instanceof Error?error.message:String(error));}finally{setCutting(false);setPolygon([]);points.current=[];}};
 const [surfaces,setSurfaces]=useState(false),[surfaceStatus,setSurfaceState]=useState('');
 const surfaceState=props.anatomy&&Object.keys(props.anatomy.classes).filter(id=>!props.anatomyAppearance?.hidden.has(+id)).length>12?'limit':surfaceStatus;
 const surfaceRef=useRef<ReturnType<typeof createAnatomySurfaces>|null>(null);
 const {series:inputSeries,sourceProgress,preset,threshold,opacity,settings,resetToken,onThresholdChange,onOpacityChange}=props;
 const [series,setSeries]=useState(inputSeries);
 const hostRef=useRef<HTMLDivElement>(null),viewportRef=useRef<any>(null);
 const volumeRef=useRef<Awaited<ReturnType<typeof getSeriesVolume>>|null>(null);
 const clippingRef=useRef<ReturnType<typeof vtkPlane.newInstance>[]>([]);
 const propsRef=useRef(props);propsRef.current=props;
 useEffect(()=>{
  setSeries(propsRef.current.series);
  if(!inputSeries?.loading)return;
  const timer=setInterval(()=>setSeries(propsRef.current.series),750);
  return()=>clearInterval(timer);
 },[inputSeries?.id,inputSeries?.loading]);
 const interacting=useRef(false),lastFrame=useRef(0),finishTimer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
 const adjust=useRef<{mode:"zoom"|"tissue"|"width";x:number;y:number;scale:number;threshold:number;opacity:number;width:number}|null>(null);
 const autoProfile=useRef<Profile>('balanced'),applyRef=useRef<()=>void>(()=>{});
 const [ready,setReady]=useState(false),[error,setError]=useState(''),[note,setNote]=useState('');
 const [effectiveQuality,setEffectiveQuality]=useState<Profile>('balanced');
 const [progress,setProgress]=useState<LoadingProgress|null>(null),[diagnostics,setDiagnostics]=useState<ReturnType<typeof performanceSnapshot>|null>(null);
 const ids=useRef({viewport:`RADAZ-3D-${crypto.randomUUID()}`,tools:`RADAZ-3D-TOOLS-${crypto.randomUUID()}`});
 const applyQuality=()=>{
  const viewport=viewportRef.current;if(!viewport)return;
  const caps=gpuCapabilities(),currentSettings=resolvedVolumeSettings(propsRef.current.preset,propsRef.current.settings),requested=currentSettings.quality;
  let selected:Profile=requested==='auto'?autoProfile.current:requested;
  if(caps.tier==='low'&&interacting.current)selected='performance';
  if(caps.tier==='medium'&&selected==='ultra')selected='high';
  const config=qualityProfiles[selected],actor=viewport.getDefaultActor()?.actor,mapper=actor?.getMapper();
  const spacing=volumeRef.current?.volume.spacing||[1,1,1];
  const preview=interacting.current||!(volumeRef.current?.volume as any)?.loadStatus?.loaded;
  mapper?.setSampleDistance(Math.min(...spacing)*.7*(preview?config.interaction:config.sample*Math.max(caps.tier==='low'?1:.5,currentSettings.sampling)));
  mapper?.setImageSampleDistance(preview?Math.max(3,config.imageSample):config.imageSample);
  const definition=volumePresetConfig[propsRef.current.preset];
  const property=actor?.getProperty();
  property?.setShade(definition.shade&&currentSettings.lighting!=='flat'); // Keep anatomy legible while dragging, too.
  property?.setUseGradientOpacity(0,currentSettings.gradient);
  const shadows=definition.shade&&currentSettings.lighting!=='flat'&&!preview&&caps.tier!=='low'&&selected!=='performance';
  property?.setLocalAmbientOcclusion(shadows&&currentSettings.shading==='occlusion');
  property?.setLAOKernelSize(Math.min(currentSettings.occlusionSamples,selected==='balanced'?16:32));
  property?.setLAOKernelRadius(Math.min(currentSettings.occlusionRadius,selected==='balanced'?3:8));
  property?.setVolumetricScatteringBlending(shadows&&currentSettings.shading==='scattering'?currentSettings.scattering:0);
  property?.setGlobalIlluminationReach(Math.min(currentSettings.shadowReach,selected==='balanced'?.15:.5));
  mapper?.setInteractionSampleDistanceFactor(1);mapper?.setInitialInteractionScale(1);
  // Our explicit drag/final profiles own sampling. VTK auto-scaling can leave
  // a stationary image blurred after a slow frame, even after mouse-up.
  mapper?.setAutoAdjustSampleDistances(false);mapper?.setMaximumSamplesPerRay(caps.tier==='low'?1536:4096);
  hostRef.current?.setAttribute('data-lighting',currentSettings.lighting);hostRef.current?.setAttribute('data-quality',selected);hostRef.current?.setAttribute('data-interacting',String(interacting.current));
  setEffectiveQuality(selected);
  elementMaterialState();
 };
 const elementMaterialState=()=>{
  const property=viewportRef.current?.getDefaultActor()?.actor?.getProperty();
  hostRef.current?.setAttribute('data-shaded',String(!!property?.getShade()));
  hostRef.current?.setAttribute('data-occlusion',String(!!property?.getLocalAmbientOcclusion()));
 };
 applyRef.current=()=>{
  const viewport=viewportRef.current,current=volumeRef.current;if(!viewport||!current)return;
  const {preset,threshold,opacity,settings,series}=propsRef.current,definition=volumePresetConfig[preset];
  const shift=threshold-definition.threshold,range=current.range,ct=series?.modality==='CT';
  const options=resolvedVolumeSettings(preset,settings);
  const coordinate=(value:number)=>{const scalar=(value-definition.threshold)*options.transferWidth+definition.threshold+shift;return ct?scalar:range[0]+(scalar+1024)/4095*Math.max(1,range[1]-range[0]);};
  const custom=settings.customTransfer&&settings.customTransfer.domain===(ct?'ct-hu':'relative')?transferArrays(settings.customTransfer,range,opacity):null;
  viewport.setPreset({name:`RADAZ-${preset}`,scalarOpacity:serialize(custom?.scalar??definition.scalar.map(([x,y])=>[coordinate(x),clamp(y*opacity,0,1)])),
   colorTransfer:serialize(custom?.color??definition.color.map(([x,...rgb])=>[coordinate(x),...rgb])),gradientOpacity:serialize([definition.gradient[0],definition.gradient.at(-1)!]),
   shade:definition.shade?'1':'0',ambient:String(settings.ambient),diffuse:String(settings.diffuse),specular:String(settings.specular),
   specularPower:String(settings.specularPower),interpolation:String(definition.interpolation)},current.volumeId,true);
  const actor=viewport.getDefaultActor()?.actor,mapper=actor?.getMapper(),property=actor?.getProperty();
  if(cutRef.current)property?.getScalarOpacity(0).addPoint(cutRef.current.floor,0);
  mapper?.removeAllClippingPlanes();clippingRef.current.forEach(plane=>plane.delete());clippingRef.current=[];
  if(settings.crop?.enabled){for(const config of cropPlanes(settings.crop,{origin:Array.from(current.volume.origin),spacing:Array.from(current.volume.spacing),direction:Array.from(current.volume.direction),dimensions:Array.from(current.volume.dimensions)})){
   const plane=vtkPlane.newInstance();plane.setNormal(config.normal[0],config.normal[1],config.normal[2]);plane.setOrigin(config.origin[0],config.origin[1],config.origin[2]);
   mapper?.addClippingPlane(plane);clippingRef.current.push(plane);
  }}
  property?.setScalarOpacityUnitDistance(0,options.opacityDistance);
  property?.setComputeNormalFromOpacity(options.normalFromOpacity);
  property?.setGradientOpacityMinimumValue(0,options.gradientMin);
  property?.setGradientOpacityMaximumValue(0,Math.max(options.gradientMin+1,options.gradientMax));
  property?.setGradientOpacityMinimumOpacity(0,0);
  property?.setGradientOpacityMaximumOpacity(0,1);
  if(options.interpolation==='nearest')property?.setInterpolationTypeToNearest();else property?.setInterpolationTypeToLinear();
  viewport.getRenderer().getLights().forEach((light:any,i:number)=>{const config=volumeLights(options.lighting)[i];if(config){light.setPosition(...config.position);light.setColor(...config.color);light.setIntensity(config.intensity*options.lightIntensity);}});
  if(definition.blend==='maximum')mapper?.setBlendModeToMaximumIntensity();
  else if(definition.blend==='minimum')mapper?.setBlendModeToMinimumIntensity();else mapper?.setBlendModeToComposite();
  applyQuality();viewport.render();
 };
 useEffect(()=>{
  const element=hostRef.current;if(!element||!series){setReady(false);setProgress(null);setError('');return;}
  const controller=new AbortController();let disposed=false,viewer:Awaited<ReturnType<typeof getViewer>>|undefined,resize:ResizeObserver|undefined;const lights:any[]=[];
  const opened=performance.now();setReady(false);setError('');setNote('');setProgress({label:'3D hazırlanır',done:0,total:0,phase:'Ortaq volume hazırlanır'});
  (async()=>{
   const caps=gpuCapabilities();viewer=await getViewer();if(disposed)return;
   element.style.maxWidth=`${Math.floor(caps.maxTextureSize/Math.max(1,devicePixelRatio))}px`;
   element.style.maxHeight=`${Math.floor(caps.maxTextureSize/Math.max(1,devicePixelRatio))}px`;
   const {core,tools,engine}=viewer;
   const current=await getSeriesVolume(series.imageIds,{maxDimension:caps.max3DTextureSize,budgetBytes:caps.budgetBytes});
   if(disposed)return;
   volumeRef.current=current;viewerPerformance.estimatedGpuBytes=current.bytes;
   const notices:string[]=[];
   element.setAttribute('data-source-slices',String(current.sourceSliceCount));
   element.setAttribute('data-volume-slices',String(current.imageIds.length));
   if(current.reduced)notices.push(`${current.sourceSliceCount} kəsitin hamısı istifadə olunur. GPU üçün həcm ${current.volume.dimensions.join(' × ')} ölçüsünə uyğunlaşdırılıb.`);
   if(series.modality!=='CT')notices.push(`${series.modality} siqnalı göstərilir. CT sümük rekonstruksiyası üçün CT seriyası tələb olunur.`);
   else if(Math.max(...current.volume.spacing)>Math.min(...current.volume.spacing)*3)notices.push('Qalın kəsitlər səthdə pillələnmə yarada bilər. Daha incə CT rekonstruksiyasını seçin.');
   setNote(notices.join(' '));
   const {viewport:viewportId,tools:toolGroupId}=ids.current;
   engine.enableElement({viewportId,element,type:core.Enums.ViewportType.VOLUME_3D,defaultOptions:{background:[0,0,0]}});
   const gl=(engine.getOffscreenMultiRenderWindow(viewportId).getOpenGLRenderWindow() as any).get3DContext() as WebGL2RenderingContext;
   if(gl)instrumentVolumeUpload(gl);
   const uploadStart=performance.now();await core.setVolumesForViewports(engine,[{volumeId:current.volumeId}],[viewportId],false);
   if(disposed)return;
   const viewport=engine.getViewport(viewportId) as any;viewportRef.current=viewport;
   const renderer=viewport.getRenderer();renderer.removeAllLights();renderer.setAutomaticLightCreation(false);
   for(const config of volumeLights(propsRef.current.settings.lighting)){const light=renderer.makeLight();light.setLightTypeToCameraLight();light.setPosition(...config.position);light.setFocalPoint(0,0,0);light.setIntensity(config.intensity);light.setColor(...config.color);renderer.addLight(light);lights.push(light);}
   element.setAttribute('data-volume-id',current.volumeId);element.setAttribute('data-volume-dimensions',current.volume.dimensions.join(','));
   const modified=(event:Event)=>{const detail=(event as CustomEvent).detail;if(detail.volumeId!==current.volumeId)return;
    const done=detail.framesProcessed??0,total=current.imageIds.length;setProgress(done<total?{label:'3D kəsitləri yüklənir',done,total}:null);};
   core.eventTarget.addEventListener(core.Enums.Events.IMAGE_VOLUME_MODIFIED,modified);
   controller.signal.addEventListener('abort',()=>core.eventTarget.removeEventListener(core.Enums.Events.IMAGE_VOLUME_MODIFIED,modified),{once:true});
   const completed=(event:Event)=>{if((event as CustomEvent).detail.volumeId===current.volumeId){setProgress(null);applyRef.current();}};
   core.eventTarget.addEventListener(core.Enums.Events.IMAGE_VOLUME_LOADING_COMPLETED,completed);
   controller.signal.addEventListener('abort',()=>core.eventTarget.removeEventListener(core.Enums.Events.IMAGE_VOLUME_LOADING_COMPLETED,completed),{once:true});
   let first=true;
   element.addEventListener(core.Enums.Events.IMAGE_RENDERED,()=>{
    const now=performance.now();
    if(first){first=false;viewerPerformance.gpuUploadAndFirstRenderMs=now-uploadStart;viewerPerformance.first3DFrameMs=now-opened;setReady(true);if((current.volume as any).loadStatus.loaded)setProgress(null);}
    if(interacting.current&&lastFrame.current){
     viewerPerformance.frameTimes.push(now-lastFrame.current);if(viewerPerformance.frameTimes.length>240)viewerPerformance.frameTimes.shift();
     if(propsRef.current.settings.quality==='auto'&&viewerPerformance.frameTimes.length%12===0){
      const recent=viewerPerformance.frameTimes.slice(-12),ms=recent.reduce((a,b)=>a+b,0)/recent.length;
      const next:Profile=ms>55?'performance':ms>30?'balanced':caps.tier==='high'?'high':'balanced';
      if(next!==autoProfile.current){autoProfile.current=next;applyQuality();}
     }
    }
    lastFrame.current=interacting.current?now:0;
   },{signal:controller.signal});
   gl?.canvas.addEventListener('webglcontextlost',()=>{setError('GPU yaddaşı əlçatan deyil. Daha kiçik seriya açın və ya Performance seçin.');setReady(false);},{signal:controller.signal});
   // Anatomical anterior view (DICOM LPS), superior up, instead of the axial default.
   viewport.setCamera({viewPlaneNormal:[0,-1,0],viewUp:[0,0,1]});
   applyRef.current();viewport.resetCamera({resetPan:true,resetZoom:true});viewport.render();
   const group=tools.ToolGroupManager.createToolGroup(toolGroupId);group?.addTool(tools.TrackballRotateTool.toolName);group?.addTool(tools.PanTool.toolName);
   group?.setToolActive(tools.TrackballRotateTool.toolName,{bindings:[{mouseButton:tools.Enums.MouseBindings.Primary}]});
   group?.setToolActive(tools.PanTool.toolName,{bindings:[{mouseButton:tools.Enums.MouseBindings.Auxiliary}]});group?.addViewport(viewportId,engine.id);
   resize=new ResizeObserver(()=>{if(!disposed){engine.resize(true,true);viewport.render();}});resize.observe(element);
   window.addEventListener('pointerup',finishInteraction,{signal:controller.signal});
   window.addEventListener('blur',finishInteraction,{signal:controller.signal});
  })().catch(cause=>{if(!disposed){setError(cause instanceof Error?cause.message:String(cause));setProgress(null);}});
  return()=>{disposed=true;controller.abort();resize?.disconnect();clearTimeout(finishTimer.current);interacting.current=false;surfaceRef.current?.dispose();surfaceRef.current=null;cutRef.current?.dispose();cutRef.current=null;viewportRef.current=null;volumeRef.current=null;adjust.current=null;
   if(viewer){viewer.tools.ToolGroupManager.destroyToolGroup(ids.current.tools);if(viewer.engine.getViewport(ids.current.viewport))viewer.engine.disableElement(ids.current.viewport);}
   lights.forEach(light=>light.delete());clippingRef.current.forEach(plane=>plane.delete());clippingRef.current=[];
   // Shared volume remains cached until its source study closes.
  };
 },[series?.id,series?.imageIds.length]);
 useEffect(()=>{const viewport=viewportRef.current;if(ready&&viewport){viewport.getDefaultActor()?.actor.setVisibility(showVolume);viewport.render();}},[showVolume,ready]);
 useEffect(()=>{if(ready)applyRef.current();},[preset,threshold,opacity,settings,ready]);
 useEffect(()=>{
  const viewport=viewportRef.current;if(!ready||!viewport||!surfaces||!props.anatomy||!props.anatomyAppearance)return;
  const count=Object.keys(props.anatomy.classes).filter(id=>!props.anatomyAppearance!.hidden.has(+id)).length;
  if(count>12)return;
  let disposed=false,resources:ReturnType<typeof createAnatomySurfaces>|undefined;
  const anatomy=props.anatomy,appearance=props.anatomyAppearance;
  // Worker startup is asynchronous and can be cancelled before it allocates a mask.
  queueMicrotask(()=>{if(disposed)return;try{resources=createAnatomySurfaces(viewport,anatomy,appearance,state=>{if(!disposed)setSurfaceState(state);});surfaceRef.current=resources;}catch{if(!disposed)setSurfaceState('error');}});
  return()=>{disposed=true;resources?.dispose();surfaceRef.current=null;};
 },[ready,surfaces,props.anatomy,props.anatomyAppearance,series?.id]);
 useEffect(()=>{const viewport=viewportRef.current,point=props.focusPoint;if(!ready||!viewport||!point)return;const camera=viewport.getCamera();viewport.setCamera({focalPoint:point,position:camera.position.map((n:number,i:number)=>n+point[i]-camera.focalPoint[i]) as [number,number,number]});viewport.render();},[props.focusPoint,ready]);
 useEffect(()=>{if(ready){viewportRef.current?.resetCamera({resetPan:true,resetZoom:true});viewportRef.current?.render();}},[resetToken,ready]);
 const startInteraction=()=>{clearTimeout(finishTimer.current);if(!interacting.current){interacting.current=true;lastFrame.current=performance.now();applyQuality();}};
 const finishInteraction=()=>{adjust.current=null;clearTimeout(finishTimer.current);finishTimer.current=setTimeout(()=>{interacting.current=false;lastFrame.current=0;applyQuality();viewportRef.current?.render();},120);};
 return <section className="volume-workspace" aria-label={tr('ui.3d_volume_view_a64d6')}><div className="volume-stage cornerstone-volume-stage" data-ready={ready} onContextMenu={e=>e.preventDefault()}
   onDoubleClick={()=>{viewportRef.current?.resetCamera({resetPan:true,resetZoom:true});viewportRef.current?.render();}}
   onPointerDownCapture={e=>{
    if((e.target as HTMLElement).closest('button,input,select,summary,.volume-orientation,.volume-scalpel-overlay'))return;
    startInteraction();const options=resolvedVolumeSettings(preset,settings);
    const mode=e.button===2?'zoom':e.button===0&&(e.ctrlKey||e.metaKey)?'width':e.button===0&&(e.shiftKey||options.mouseMode==='tissue')?'tissue':null;
    if(mode){e.preventDefault();e.stopPropagation();adjust.current={mode,x:e.clientX,y:e.clientY,scale:viewportRef.current?.getCamera()?.parallelScale||1,threshold,opacity,width:options.transferWidth};e.currentTarget.setPointerCapture(e.pointerId);}
   }}
   onPointerMoveCapture={e=>{const drag=adjust.current;if(!drag)return;e.preventDefault();e.stopPropagation();
    if(drag.mode==='zoom'){viewportRef.current?.setCamera({parallelScale:clamp(drag.scale*Math.exp((e.clientY-drag.y)*.008),.00001,1e8)});viewportRef.current?.render();}
    else if(drag.mode==='width')propsRef.current.onSettingsChange({...propsRef.current.settings,transferWidth:clamp(drag.width*Math.exp((e.clientX-drag.x)*.006),.25,3)});
    else{onThresholdChange(Math.round(clamp(drag.threshold+(e.clientX-drag.x)*2,-1000,1400)));onOpacityChange(clamp(drag.opacity-(e.clientY-drag.y)*.006,.2,2));}
   }}
   onPointerUpCapture={finishInteraction} onPointerCancelCapture={finishInteraction} onPointerLeave={e=>{if(!e.buttons)finishInteraction();}}
   onWheel={e=>{e.preventDefault();startInteraction();const viewport=viewportRef.current,camera=viewport?.getCamera();if(camera?.parallelScale)viewport.setCamera({parallelScale:camera.parallelScale*(e.deltaY>0?1.1:.9)});viewport?.render();finishInteraction();}}>
   {series&&<div key={series.id} ref={hostRef} className="cornerstone-volume-host" aria-label={tr('ui.3d_dicom_rendering_2202f')}/>}
   {ready&&props.anatomy&&<div className="anatomy-surface-controls" data-state={surfaceState}><label><input type="checkbox" checked={surfaces} onChange={e=>setSurfaces(e.target.checked)}/>{t('anatomy.surface')}</label><label><input type="checkbox" checked={showVolume} onChange={e=>setShowVolume(e.target.checked)}/>{t('anatomy.sourceVolume')}</label>{surfaces&&surfaceState==='ready'&&<button onClick={()=>{if(!surfaceRef.current)return;const url=URL.createObjectURL(surfaceRef.current.export()),a=document.createElement('a');a.href=url;a.download='RADAZ-anatomy-LPS.ply';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}}>{t('common.export')} PLY</button>}{surfaces&&surfaceState==='building'&&<span role="status">{t('anatomy.surfaceBuilding')}</span>}{surfaces&&surfaceState==='limit'&&<span role="status">{t('anatomy.surfaceLimit')}</span>}{surfaces&&surfaceState==='error'&&<span role="alert">{t('anatomy.inference_failed')}</span>}</div>}
   {ready&&!error&&toolbarTarget&&createPortal(<div className="volume-direct-tools" onPointerDown={e=>e.stopPropagation()}><button title="3D rotate" aria-label="3D rotate" aria-pressed={!scalpel} disabled={cutting} onClick={()=>{setScalpel(false);propsRef.current.onSettingsChange({...settings,mouseMode:'rotate'});}}><Rotate3D size={21}/></button><button title="Scalpel" aria-label="Scalpel" aria-pressed={scalpel} disabled={cutting||preset==='mip'||preset==='minip'||surfaces} onClick={()=>setScalpel(v=>!v)}><Scissors size={21}/></button><button title="Kəsimi geri al" aria-label="Kəsimi geri al" disabled={cutting} onClick={()=>cutRef.current?.undo()}><Undo2 size={21}/></button><button title="Kəsimləri sıfırla" aria-label="Kəsimləri sıfırla" disabled={cutting} onClick={()=>cutRef.current?.reset()}><RotateCcw size={21}/></button></div>,toolbarTarget)}
   {ready&&scalpel&&!surfaces&&preset!=='mip'&&preset!=='minip'&&<svg className="volume-scalpel-overlay" aria-label="Scalpel konturu" onPointerDown={e=>{if(cutting||e.button!==0)return;e.stopPropagation();e.preventDefault();e.currentTarget.setPointerCapture(e.pointerId);const box=hostRef.current!.getBoundingClientRect();points.current=[[e.clientX-box.left,e.clientY-box.top]];setPolygon(points.current);drawing.current=true;}} onPointerMove={e=>{if(!drawing.current||cutting)return;const box=hostRef.current!.getBoundingClientRect(),point:[number,number]=[e.clientX-box.left,e.clientY-box.top],last=points.current.at(-1)!;if(Math.hypot(point[0]-last[0],point[1]-last[1])>5){points.current=[...points.current,point];setPolygon(points.current);}}} onPointerUp={e=>{if(!drawing.current)return;e.stopPropagation();drawing.current=false;void cut();}} onPointerCancel={()=>{drawing.current=false;points.current=[];setPolygon([]);}}><polygon points={polygon.map(p=>p.join(',')).join(' ')} fill="#ef715433" stroke="#ffbb76" strokeWidth="2"/></svg>}
   {ready&&scalpel&&!surfaces&&preset!=='mip'&&preset!=='minip'&&<div className="volume-scalpel-status" role="status">{cutting?'Kəsim hazırlanır…':cutError||'Silmək istədiyiniz sahəni sol düymə ilə əhatələyin. Kəsim baxış boyunca bütün dərinliyə tətbiq olunur.'}</div>}
   {ready&&!error&&<VolumeOrientation viewport={viewportRef.current}/>}
   {ready&&!error&&<details className="volume-help-disclosure"><summary aria-label="3D navigation">?</summary><div className="volume-help"><span><b>{tr('ui.left_mouse_4d6e2')}</b> {settings.mouseMode==='tissue'?tr('ui.intensity_opacity_f5c66'):'fırlat'}</span><span><b>{tr('ui.shift_left_3ddde')}</b> {tr('ui.intensity_opacity_f5c66')}</span><span><b>{tr('ui.middle_mouse_670de')}</b> {tr('ui.pan_74f44')}</span><span><b>{tr('ui.right_mouse_d9bb9')}</b> {tr('ui.zoom_d21bb')}</span><span><b>{tr('ui.wheel_53597')}</b> {tr('ui.zoom_d21bb')}</span><span>{settings.quality==='auto'?'Auto · ':''}{effectiveQuality[0].toUpperCase()+effectiveQuality.slice(1)}</span><button onClick={()=>setDiagnostics(performanceSnapshot())}>{tr('ui.performance_559b7')}</button>{note&&<span>{note}</span>}</div></details>}
   {ready&&(progress||sourceProgress)&&<WorkProgress className="volume-stream-progress" progress={progress||sourceProgress||null}/>}
   {diagnostics&&<div className="volume-diagnostics" role="status"><button onClick={()=>setDiagnostics(null)}>{tr('ui.close_c1cf9')}</button><span>{tr('ui.decode_2c390')}{diagnostics.decodeMs.toFixed(0)} ms · {diagnostics.decodeCount} {tr('ui.slices_36ad1')}</span><span>{tr('ui.volume_b2c7c')}{diagnostics.volumeBuildMs.toFixed(0)} ms · {diagnostics.volumeBuildCount} {tr('ui.builds_309fe')}{diagnostics.volumeCacheHits} {tr('ui.reuse_d9c0d')}</span><span>{tr('ui.first_3d_frame_085ea')}{diagnostics.first3DFrameMs.toFixed(0)} ms</span><span>{tr('ui.gpu_transfer_cpu_974aa')}{diagnostics.gpuUploadCpuMs.toFixed(0)} ms · GPU {diagnostics.gpuTimerMs===null?'ölçülmür':diagnostics.gpuTimerMs.toFixed(1)+' ms'}</span><span>{tr('ui.gpu_transfer_first_render_1ace6')}{diagnostics.gpuUploadAndFirstRenderMs.toFixed(0)} ms</span><span>{tr('ui.rotation_27e3a')}{diagnostics.interactionFps?.toFixed(1)||'—'} FPS · JS: {diagnostics.jsHeapBytes?Math.round(diagnostics.jsHeapBytes/1048576)+' MB':'ölçülmür'}</span><span>{tr('ui.estimated_gpu_volume_memory_5ce3e')}{Math.round(diagnostics.estimatedGpuBytes/1048576)} MB</span></div>}
   {(!ready||error)&&<div className="volume-cover"><Box size={34}/>{error?<><strong>{tr('ui.could_not_open_3d_volume_20d89')}</strong><span>{error}</span></>:progress||sourceProgress?<WorkProgress progress={progress||sourceProgress||null}/>:<strong>{tr('ui.select_a_dicom_series_for_3d_389bb')}</strong>}</div>}
  </div></section>;
}
