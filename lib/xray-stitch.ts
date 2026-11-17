/** Pixel-space geometry for two projection radiographs. Source files stay untouched. */
export type Crop={left:number;right:number;top:number;bottom:number};
export type StitchRaster={width:number;height:number;pixels:Uint8Array};
export type StitchOptions={crops:[Crop,Crop];offsetX:number;offsetY:number;lowerScale:number;brightness:[number,number];contrast:[number,number];feather:boolean};
export type StitchRect={x:number;y:number;width:number;height:number};
export const emptyCrop=():Crop=>({left:0,right:0,top:0,bottom:0});
const clamp=(x:number,min:number,max:number)=>Math.max(min,Math.min(max,x));

export function sanitizeCrop(crop:Crop,raster:StitchRaster):Crop{
 const left=clamp(Math.round(crop.left),0,Math.max(0,raster.width-16));
 const right=clamp(Math.round(crop.right),0,Math.max(0,raster.width-left-16));
 const top=clamp(Math.round(crop.top),0,Math.max(0,raster.height-16));
 const bottom=clamp(Math.round(crop.bottom),0,Math.max(0,raster.height-top-16));
 return {left,right,top,bottom};
}
export function stitchLayout(rasters:[StitchRaster,StitchRaster],options:StitchOptions){
 const [a,b]=rasters,c1=sanitizeCrop(options.crops[0],a),c2=sanitizeCrop(options.crops[1],b),s=clamp(options.lowerScale,.25,4);
 const top:StitchRect={x:c1.left,y:c1.top,width:a.width-c1.left-c1.right,height:a.height-c1.top-c1.bottom};
 const bottom:StitchRect={x:options.offsetX+c2.left*s,y:options.offsetY+c2.top*s,width:(b.width-c2.left-c2.right)*s,height:(b.height-c2.top-c2.bottom)*s};
 const left=Math.floor(Math.min(top.x,bottom.x)),up=Math.floor(Math.min(top.y,bottom.y));
 const right=Math.ceil(Math.max(top.x+top.width,bottom.x+bottom.width)),down=Math.ceil(Math.max(top.y+top.height,bottom.y+bottom.height));
 return {left,topEdge:up,width:right-left,height:down-up,rects:[top,bottom] as [StitchRect,StitchRect],crops:[c1,c2] as [Crop,Crop]};
}
export function makeStitchCanvas(raster:StitchRaster){
 const canvas=document.createElement('canvas');canvas.width=raster.width;canvas.height=raster.height;
 const ctx=canvas.getContext('2d');if(!ctx)throw Error('Rentgen ön baxışı hazırlana bilmədi');
 const image=ctx.createImageData(raster.width,raster.height);
 for(let i=0;i<raster.pixels.length;i++){const p=i*4,v=raster.pixels[i];image.data[p]=image.data[p+1]=image.data[p+2]=v;image.data[p+3]=255;}
 ctx.putImageData(image,0,0);return canvas;
}
export function drawStitch(ctx:CanvasRenderingContext2D,rasters:[StitchRaster,StitchRaster],layers:[HTMLCanvasElement,HTMLCanvasElement],options:StitchOptions){
 const layout=stitchLayout(rasters,options);
 const draw=(i:0|1)=>{const crop=layout.crops[i],rect=layout.rects[i];ctx.save();ctx.filter=`brightness(${1+options.brightness[i]/100}) contrast(${options.contrast[i]})`;
  ctx.drawImage(layers[i],crop.left,crop.top,rasters[i].width-crop.left-crop.right,rasters[i].height-crop.top-crop.bottom,rect.x,rect.y,rect.width,rect.height);ctx.restore();};
 draw(0);draw(1);
 if(options.feather){const a=layout.rects[0],b=layout.rects[1],start=Math.max(a.y,b.y),end=Math.min(a.y+a.height,b.y+b.height),span=end-start;
  if(span>1){const strips=Math.min(64,Math.max(8,Math.ceil(span/8)));
   for(let i=0;i<strips;i++){const y=start+span*i/strips,y2=start+span*(i+1)/strips;ctx.save();ctx.beginPath();ctx.rect(a.x,y,a.width,y2-y+.01);ctx.clip();ctx.globalAlpha=1-(i+.5)/strips;draw(0);ctx.restore();}
  }}
 return layout;
}
export function renderStitch(rasters:[StitchRaster,StitchRaster],layers:[HTMLCanvasElement,HTMLCanvasElement],options:StitchOptions){
 const layout=stitchLayout(rasters,options);
 if(layout.width<1||layout.height<1||layout.width>8192||layout.height>8192||layout.width*layout.height>60_000_000)throw Error('Birləşmiş görüntü çox böyükdür');
 const canvas=document.createElement('canvas');canvas.width=layout.width;canvas.height=layout.height;
 const ctx=canvas.getContext('2d');if(!ctx)throw Error('Birləşmiş görüntü yaradıla bilmədi');
 ctx.fillStyle='#000';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.translate(-layout.left,-layout.topEdge);drawStitch(ctx,rasters,layers,options);
 return canvas;
}
