import {getRenderingEngine,getShouldUseCPURendering,type RenderingEngine,type Types} from '@cornerstonejs/core';
import {enableReturningTabletStack} from './cornerstone';

type StackState={
  image:string;
  camera:ReturnType<Types.IStackViewport['getCamera']>;
  properties:ReturnType<Types.IStackViewport['getProperties']>;
  presentation:ReturnType<Types.IStackViewport['getViewPresentation']>;
};
export type TabletStackRecovery={enable:(input:Types.PublicViewportInput)=>RenderingEngine;views:Map<string,StackState>};

export function restoreStackProperties(viewport:Types.IStackViewport,properties:StackState['properties']){
  if(getShouldUseCPURendering()){
    // The software stack implements linear windowing but rejects the GPU LUT setter.
    const {voiRange,invert,interpolationType}=properties;
    viewport.setProperties({voiRange,invert,interpolationType});
  }else viewport.setProperties(properties);
}

/** The tablet uses one GPU workspace at a time. The DICOM sources and world-space
 * measurements stay in the main Viewer while the 3D surface owns the screen. */
export function captureTabletStacks(onReturn:(recovery:TabletStackRecovery)=>void){
  const engine=getRenderingEngine('radiology-viewer');
  if(!engine || engine.hasBeenDestroyed)return;
  const views=new Map<string,StackState>();
  const contexts=new Set<WebGL2RenderingContext>();
  for(const candidate of engine.getViewports()){
    if(!('setStack' in candidate))continue;
    const vp=candidate as Types.IStackViewport,image=vp.getCurrentImageId();
    if(!image)continue;
    views.set(vp.id,{image,camera:vp.getCamera(),properties:vp.getProperties(),presentation:vp.getViewPresentation()});
    try{
      const canvas:HTMLCanvasElement=engine.getOffscreenMultiRenderWindow(vp.id).getOpenGLRenderWindow().getCanvas();
      const gl=canvas.getContext('webgl2');if(gl)contexts.add(gl);
    }catch{/* A CPU stack has no shared GPU context. */}
  }
  let done=false;
  return {
    hasLostContext(){return engine.hasBeenDestroyed || [...contexts].some(gl=>gl.isContextLost());},
    repaint(){if(!engine.hasBeenDestroyed)engine.render();},
    suspend(){
      // Pane cleanup has detached the renderers before this passive effect runs.
      if(done || engine.hasBeenDestroyed || engine.getViewports().length)return;
      for(const gl of contexts)if(!gl.isContextLost())gl.getExtension('WEBGL_lose_context')?.loseContext();
      contexts.clear();
    },
    dispose(){done=true;contexts.clear();},
    restore(){
      if(done)return;
      done=true;contexts.clear();
      let previous:typeof engine|undefined=engine;
      onReturn({views,enable(input){
        const restored=enableReturningTabletStack(previous,input);
        previous=undefined;
        return restored;
      }});
    },
  };
}
