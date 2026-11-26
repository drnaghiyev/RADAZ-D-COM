import {add,cross,dot,faces,project,type Frame,type Mark,type P,type Style,type V} from './scene';
function direction(v:V){const axes=[['R','L'],['A','P'],['I','S']];return [0,1,2].sort((a,b)=>Math.abs(v[b])-Math.abs(v[a])).filter(i=>Math.abs(v[i])>.26).map(i=>axes[i][v[i]>0?1:0]).join('');}
const cubeColors:Record<string,string>={
  A:'#17786f', P:'#115651', R:'#a25629', L:'#88421f', S:'#7163a5', I:'#55477e',
};

// Shared LPS face transforms keep screen and exported orientation in agreement.
export function orientationFaces(cam:Frame,size:number,cx:number,cy:number){
  const right=cross(cam.up,cam.normal);
  return faces.filter(face=>dot(face.normal,cam.normal)>.002).map(face=>{
    const side=cross(face.up,face.normal);
    const matrix:[number,number,number,number,number,number]=[
      dot(side,right),-dot(side,cam.up),-dot(face.up,right),dot(face.up,cam.up),
      cx+dot(face.normal,right)*size,cy-dot(face.normal,cam.up)*size,
    ];
    return {key:face.key,color:cubeColors[face.key],matrix};
  });
}
export function orientationText(cam:Frame,style:Style){
  const right=cross(cam.up,cam.normal);
  const opposite=(axis:V)=>direction(axis.map(n=>-n) as V);
  return {top:direction(cam.up),bottom:opposite(cam.up),right:direction(right),left:opposite(right),
    windowing:'WL '+Math.round(style.wl)+'   WW '+Math.round(style.ww)};
}
export function drawOrientationCube(ctx:CanvasRenderingContext2D,w:number,h:number,cam:Frame){
  const size=Math.min(23,w/20,h/14),padding=Math.ceil(size*1.75)+6;
  for(const face of orientationFaces(cam,size,w-padding,padding)){
    ctx.save();ctx.transform(...face.matrix);
    ctx.beginPath();ctx.rect(-size,-size,size*2,size*2);
    ctx.fillStyle=face.color;ctx.fill();
    ctx.strokeStyle='#bbc8c9';ctx.lineWidth=1;ctx.stroke();ctx.clip();
    ctx.fillStyle='#fff';ctx.textAlign='center';ctx.textBaseline='middle';
    ctx.font='bold '+Math.round(size*1.35)+'px system-ui, sans-serif';
    ctx.fillText(face.key,0,0);ctx.restore();
  }
}
export function drawOrientation(ctx:CanvasRenderingContext2D,w:number,h:number,cam:Frame,style:Style){
  const labels=orientationText(cam,style);
  ctx.save();ctx.font='14px system-ui, sans-serif';ctx.textBaseline='middle';ctx.fillStyle='#f4f4eb';ctx.textAlign='center';
  ctx.fillText(labels.top,w/2,15);ctx.fillText(labels.bottom,w/2,h-16);
  ctx.fillText(labels.right,w-18,h/2);ctx.fillText(labels.left,18,h/2);
  ctx.textAlign='left';ctx.fillText(labels.windowing,12,h-16);
  drawOrientationCube(ctx,w,h,cam);ctx.restore();
}
export function drawMarks(ctx:CanvasRenderingContext2D,w:number,h:number,cam:Frame,marks:Mark[],show:boolean,selected=-1,path:P[]=[]){
 ctx.save();ctx.lineWidth=2;ctx.lineJoin='round';ctx.font='14px system-ui, sans-serif';ctx.textBaseline='middle';
 if(show){
   marks.forEach((m,i)=>{
     const a=project(cam,m.a,w,h),b=project(cam,m.b,w,h),theta=Math.atan2(b[1]-a[1],b[0]-a[0]);
     ctx.globalAlpha=m.alpha??1;ctx.strokeStyle=ctx.fillStyle=i===selected?'#ffd577':m.color||'#66e2e3';ctx.lineWidth=m.lineWidth??2;ctx.beginPath();ctx.moveTo(...a);ctx.lineTo(...b);ctx.stroke();
     if(m.kind==='arrow'){const arrow=(tip:P,angle:number)=>{const length=11+(m.lineWidth??2)*1.5;ctx.beginPath();ctx.moveTo(tip[0]-length*Math.cos(angle-.4),tip[1]-length*Math.sin(angle-.4));ctx.lineTo(...tip);ctx.lineTo(tip[0]-length*Math.cos(angle+.4),tip[1]-length*Math.sin(angle+.4));if(m.head==='open')ctx.stroke();else{ctx.closePath();ctx.fill();}};arrow(b,theta);if(m.head==='both')arrow(a,theta+Math.PI);}
     const label=m.kind==='length'?Math.hypot(...add(m.a,m.b,-1)).toFixed(1)+' mm':m.text;
     if(label){const p=m.labelPoint?project(cam,m.labelPoint,w,h):[(a[0]+b[0])/2+5,(a[1]+b[1])/2-10];ctx.textAlign='left';ctx.fillText(label,p[0],p[1]);}
     ctx.globalAlpha=1;if(i===selected)for(const p of [a,b]){ctx.beginPath();ctx.arc(...p,4,0,2*Math.PI);ctx.fill();}
   });
 }
 if(path.length){ctx.strokeStyle='#ffce61';ctx.fillStyle='rgba(255,194,51,.09)';ctx.beginPath();path.forEach((p,i)=>i?ctx.lineTo(...p):ctx.moveTo(...p));ctx.fill();ctx.stroke();}
 ctx.restore();
}
export function hitMark(cam:Frame,marks:Mark[],p:P,w:number,h:number,tolerance:number){
 for(let i=marks.length-1;i>=0;i--){
   const a=project(cam,marks[i].a,w,h),b=project(cam,marks[i].b,w,h);
   if(Math.hypot(p[0]-a[0],p[1]-a[1])<=tolerance)return {i,part:'a'} as const;
   if(Math.hypot(p[0]-b[0],p[1]-b[1])<=tolerance)return {i,part:'b'} as const;
   const m=marks[i];if(m.kind==='length'||m.text){const l=m.labelPoint?project(cam,m.labelPoint,w,h):[(a[0]+b[0])/2+5,(a[1]+b[1])/2-10];if(p[0]>=l[0]&&p[0]<=l[0]+(m.text?.length||7)*7.5&&Math.abs(p[1]-l[1])<=Math.min(tolerance,10))return {i,part:'label'} as const;}
   const dx=b[0]-a[0],dy=b[1]-a[1],t=Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/(dx*dx+dy*dy||1)));
   if(Math.hypot(p[0]-a[0]-t*dx,p[1]-a[1]-t*dy)<=tolerance)return {i,part:'body'} as const;
 }
 return null;
}
export function download(doc:Document,blob:Blob,name:string){
 const a=doc.createElement('a'),url=URL.createObjectURL(blob);a.href=url;a.download=name;doc.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
}
export const imageBlob=(canvas:HTMLCanvasElement,mime:string)=>new Promise<Blob>((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(Error('Görüntü saxlanılmadı.')),mime,.96));
export function bitmapBlob(canvas:HTMLCanvasElement){
 const {width:w,height:h}=canvas,pixels=canvas.getContext('2d')!.getImageData(0,0,w,h).data,stride=(3*w+3)&~3;
 const bytes=new Uint8Array(54+stride*h),header=new DataView(bytes.buffer);bytes.set([66,77]);header.setUint32(2,bytes.length,true);header.setUint32(10,54,true);header.setUint32(14,40,true);header.setInt32(18,w,true);header.setInt32(22,h,true);header.setUint16(26,1,true);header.setUint16(28,24,true);
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){const i=(y*w+x)*4,k=54+(h-1-y)*stride+x*3;bytes[k]=pixels[i+2];bytes[k+1]=pixels[i+1];bytes[k+2]=pixels[i];}
 return new Blob([bytes],{type:'image/bmp'});
}
