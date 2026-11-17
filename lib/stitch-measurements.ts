/** Stitch annotations use the same pixel coordinates as the exported Secondary Capture. */
export type StitchPoint={x:number;y:number};
export type StitchMeasureKind='length'|'angle'|'cobb'|'ellipse';
export type StitchMeasure={id:string;kind:StitchMeasureKind;points:StitchPoint[]};
export const measurePointCount:Record<StitchMeasureKind,number>={length:2,angle:3,cobb:4,ellipse:2};
const distance=(a:StitchPoint,b:StitchPoint)=>Math.hypot(a.x-b.x,a.y-b.y);
const angle=(a:StitchPoint,b:StitchPoint,c:StitchPoint)=>{
 const u=Math.atan2(a.y-b.y,a.x-b.x),v=Math.atan2(c.y-b.y,c.x-b.x);
 return Math.min(180,Math.abs((u-v)*180/Math.PI+360)%360,360-(Math.abs((u-v)*180/Math.PI+360)%360));
};
export function measurementLabel(mark:StitchMeasure,spacing?:[number,number]){
 const p=mark.points;if(p.length<measurePointCount[mark.kind])return '';
 if(mark.kind==='length'){const dx=(p[1].x-p[0].x)*(spacing?.[1]||1),dy=(p[1].y-p[0].y)*(spacing?.[0]||1);return `${Math.hypot(dx,dy).toFixed(1)} ${spacing?'mm':'px'}`;}
 if(mark.kind==='angle')return `${angle(p[0],p[1],p[2]).toFixed(1)}°`;
 if(mark.kind==='cobb'){
  const a=Math.atan2(p[1].y-p[0].y,p[1].x-p[0].x),b=Math.atan2(p[3].y-p[2].y,p[3].x-p[2].x);
  const diff=Math.abs((a-b)*180/Math.PI)%180;return `Cobb ${Math.min(diff,180-diff).toFixed(1)}°`;
 }
 const rx=Math.abs(p[1].x-p[0].x)/2,ry=Math.abs(p[1].y-p[0].y)/2;
 return `${(Math.PI*rx*ry*(spacing?.[0]||1)*(spacing?.[1]||1)).toFixed(1)} ${spacing?'mm²':'px²'}`;
}
export function drawStitchMeasures(ctx:CanvasRenderingContext2D,marks:StitchMeasure[],spacing?:[number,number],selectedId?:string,visualScale=1){
 ctx.save();ctx.lineWidth=2/visualScale;ctx.font=`${16/visualScale}px Arial`;ctx.textBaseline='middle';
 for(const mark of marks){const p=mark.points;if(!p.length)continue;ctx.strokeStyle=mark.id===selectedId?'#54efff':'#f5dd54';ctx.fillStyle=ctx.strokeStyle;ctx.beginPath();
  if(mark.kind==='ellipse'&&p.length>=2){const x=(p[0].x+p[1].x)/2,y=(p[0].y+p[1].y)/2;ctx.ellipse(x,y,Math.max(1,Math.abs(p[1].x-p[0].x)/2),Math.max(1,Math.abs(p[1].y-p[0].y)/2),0,0,Math.PI*2);}
  else{ctx.moveTo(p[0].x,p[0].y);for(let i=1;i<p.length;i++){if(mark.kind==='angle'&&i===2)ctx.moveTo(p[1].x,p[1].y);else if(mark.kind==='cobb'&&i===2)ctx.moveTo(p[2].x,p[2].y);ctx.lineTo(p[i].x,p[i].y);}}
  ctx.stroke();for(const point of p){ctx.beginPath();ctx.arc(point.x,point.y,4/visualScale,0,Math.PI*2);ctx.fill();}
  const label=measurementLabel(mark,spacing);if(label){const anchor=p.at(-1)!;ctx.lineWidth=3/visualScale;ctx.strokeStyle='#000';ctx.strokeText(label,anchor.x+8/visualScale,anchor.y-12/visualScale);ctx.fillText(label,anchor.x+8/visualScale,anchor.y-12/visualScale);ctx.lineWidth=2/visualScale;}
 }ctx.restore();
}
export function nearestStitchMark(marks:StitchMeasure[],point:StitchPoint,tolerance:number){
 for(let i=marks.length-1;i>=0;i--){const mark=marks[i];for(let j=0;j<mark.points.length;j++)if(distance(mark.points[j],point)<tolerance)return {id:mark.id,point:j};
  const p=mark.points;if(p.length>=2&&mark.kind!=='ellipse')for(let j=1;j<p.length;j++){if(mark.kind==='cobb'&&j===2)continue;
   const a=p[j-1],b=p[j],len=(b.x-a.x)**2+(b.y-a.y)**2||1,t=Math.max(0,Math.min(1,((point.x-a.x)*(b.x-a.x)+(point.y-a.y)*(b.y-a.y))/len));
   if(distance(point,{x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t})<tolerance)return {id:mark.id,point:-1};
  }
 }return null;
}
