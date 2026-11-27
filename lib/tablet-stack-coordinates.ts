import type {Types} from '@cornerstonejs/core';

// StackViewport's CPU raster uses clientWidth/clientHeight as its backing size,
// whereas its public canvas transforms expect device pixels. Scale at the API
// boundary so Cornerstone tools, camera calibration and RADAZ overlays agree.
export function calibrateSoftwareStack(vp:Types.IStackViewport) {
  const toWorld=vp.canvasToWorld.bind(vp), toCanvas=vp.worldToCanvas.bind(vp);
  const factor=()=> {
    const {canvas}=vp, rect=canvas.getBoundingClientRect();
    const dpr=canvas.ownerDocument.defaultView?.devicePixelRatio||1;
    return [rect.width?canvas.width/rect.width/dpr:1,rect.height?canvas.height/rect.height/dpr:1];
  };
  vp.canvasToWorld=(point,...rest)=>{
    const [x,y]=factor();
    return toWorld([point[0]*x,point[1]*y],...rest);
  };
  vp.worldToCanvas=point=>{
    const [x,y]=factor(),result=toCanvas(point);
    return [result[0]/x,result[1]/y];
  };
}
