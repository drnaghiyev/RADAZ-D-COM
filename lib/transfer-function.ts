export type TransferPoint={x:number;opacity:number;color:string};
export type TransferFunction={schema:1;domain:'ct-hu'|'relative';points:TransferPoint[]};
export type VolumeCrop={enabled:boolean;bounds:[number,number,number,number,number,number]};
export const fullVolumeCrop=():VolumeCrop=>({enabled:false,bounds:[0,1,0,1,0,1]});
export function validateTransfer(value:unknown,domain?:TransferFunction['domain']):TransferFunction{
 if(!value||typeof value!=='object')throw Error('invalid_transfer');
 const v=value as TransferFunction;
 if(v.schema!==1||!['ct-hu','relative'].includes(v.domain)||domain&&v.domain!==domain||!Array.isArray(v.points)||v.points.length<2||v.points.length>32)throw Error('invalid_transfer');
 const [min,max]=v.domain==='ct-hu'?[-4096,65535]:[0,1];
 const points=v.points.map(p=>{
  if(!p||!Number.isFinite(p.x)||p.x<min||p.x>max||!Number.isFinite(p.opacity)||p.opacity<0||p.opacity>1||!/^#[0-9a-f]{6}$/i.test(p.color))throw Error('invalid_transfer');
  return {x:p.x,opacity:p.opacity,color:p.color};
 }).sort((a,b)=>a.x-b.x);
 if(points.some((p,i)=>i>0&&p.x<=points[i-1].x))throw Error('invalid_transfer');
 return {schema:1,domain:v.domain,points};
}
export function transferArrays(value:TransferFunction,range:[number,number],opacity=1){
 const transfer=validateTransfer(value);
 if(!range.every(Number.isFinite)||range[1]<range[0]||!Number.isFinite(opacity))throw Error('invalid_range');
 return {
  scalar:transfer.points.map(p=>[transfer.domain==='ct-hu'?p.x:range[0]+p.x*(range[1]-range[0]),Math.max(0,Math.min(1,p.opacity*opacity))]),
  color:transfer.points.map(p=>[transfer.domain==='ct-hu'?p.x:range[0]+p.x*(range[1]-range[0]),...p.color.slice(1).match(/../g)!.map(h=>parseInt(h,16)/255)]),
 };
}
export function validateCrop(crop:VolumeCrop){
 if(!crop||typeof crop.enabled!=='boolean'||!Array.isArray(crop.bounds)||crop.bounds.length!==6||crop.bounds.some(n=>!Number.isFinite(n)||n<0||n>1)||[0,2,4].some(i=>crop.bounds[i]>=crop.bounds[i+1]))throw Error('invalid_crop');
 return crop;
}
/** Inward normals in physical LPS, including oblique acquisitions. Bounds use
 * voxel face positions so 0..1 retains the complete first and last voxels. */
export function cropPlanes(crop:VolumeCrop,geometry:{origin:number[];spacing:number[];direction:number[];dimensions:number[]}){
 validateCrop(crop);if(!crop.enabled)return [];
 const {origin,spacing,direction,dimensions}=geometry;
 if(origin.length!==3||spacing.length!==3||dimensions.length!==3||direction.length!==9||[...origin,...spacing,...direction,...dimensions].some(n=>!Number.isFinite(n))||spacing.some(n=>n<=0)||dimensions.some(n=>!Number.isInteger(n)||n<1))throw Error('invalid_geometry');
 return crop.bounds.map((bound,index)=>{
  const axis=Math.floor(index/2),basis=direction.slice(axis*3,axis*3+3),sign=index%2===0?1:-1;
  return {normal:basis.map(n=>n*sign),origin:origin.map((n,i)=>n+basis[i]*(bound*dimensions[axis]-.5)*spacing[axis])};
 });
}
