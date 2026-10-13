import type {DicomPixelImage} from './dicom-pixels';

export type PrintAdjustment={zoom:number;brightness:number;contrast:number};
export const defaultPrintAdjustment:PrintAdjustment={zoom:1,brightness:0,contrast:1};

/** Fit first, then zoom about the center. Used by preview, PDF and DICOM print. */
export function renderPrintImage(image:DicomPixelImage,adjustment:PrintAdjustment,ratio:number):HTMLCanvasElement {
  const source=document.createElement('canvas');source.width=image.columns;source.height=image.rows;
  const ctx=source.getContext('2d')!,raster=ctx.createImageData(source.width,source.height);
  for(let i=0;i<image.pixels.length;i++){
    const value=Math.max(0,Math.min(255,Math.round((image.pixels[i]-127.5)*adjustment.contrast+127.5+adjustment.brightness)));
    raster.data[i*4]=raster.data[i*4+1]=raster.data[i*4+2]=value;raster.data[i*4+3]=255;
  }
  ctx.putImageData(raster,0,0);
  const canvas=document.createElement('canvas');
  // A bounded print raster with the exact cell shape avoids intrinsic canvas overflow.
  const longest=Math.min(4096,Math.max(1024,image.columns,image.rows));
  canvas.width=Math.max(1,Math.round(ratio>=1?longest:longest*ratio));
  canvas.height=Math.max(1,Math.round(ratio>=1?longest/ratio:longest));
  const target=canvas.getContext('2d')!;
  target.fillStyle='#000';target.fillRect(0,0,canvas.width,canvas.height);
  target.imageSmoothingEnabled=true;target.imageSmoothingQuality='high';
  const scale=Math.min(canvas.width/image.columns,canvas.height/image.rows)*adjustment.zoom;
  const width=image.columns*scale,height=image.rows*scale;
  target.drawImage(source,(canvas.width-width)/2,(canvas.height-height)/2,width,height);
  if (image.overlay) {
    const fit = Math.min(canvas.width / image.columns, canvas.height / image.rows);
    const w = image.columns * fit, h = image.rows * fit;
    target.drawImage(image.overlay, (canvas.width-w)/2, (canvas.height-h)/2, w, h);
  }
  return canvas;
}

export function printImagePixels(canvas:HTMLCanvasElement){
  const rgba=canvas.getContext('2d')!.getImageData(0,0,canvas.width,canvas.height).data;
  const pixels=new Uint8Array(canvas.width*canvas.height);
  for(let i=0;i<pixels.length;i++)pixels[i]=rgba[i*4];
  return {rows:canvas.height,columns:canvas.width,pixels};
}
