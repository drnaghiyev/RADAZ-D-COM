import {matrix3x3ToQuaternion,quaternionToMatrix3x3} from '@kitware/vtk.js/Common/Core/Math';
import type {Matrix3x3,Vector4} from '@kitware/vtk.js/types';
import type {AnatomyVolumeGeometry} from '../anatomy-volume';
import {volumePresetConfig,type VolumePreset} from '../volume-presets';
export type V=[number,number,number];
export type P=[number,number];
export type Frame={center:V;normal:V;up:V;scale:number};
export type VrPreset=VolumePreset|'bone-warm'|'bone-gray'|'skin-gray'|'bone-skin'|'bone-skin-soft'|'mip-inverse';
export type Style={preset:VrPreset;hideExterior?:boolean;relative?:boolean;mixFrom?:VrPreset;mixAmount?:number;ww:number;wl:number;shading:boolean;opacity:number;brightness:number;context:boolean;segments:boolean};
export type Cut={polygon:P[];origin:P;axes:[P,P,P];inside:boolean};
export type Mark={a:V;b:V;kind:'length'|'arrow';labelPoint?:V;text?:string;color?:string;lineWidth?:number;alpha?:number;head?:'filled'|'open'|'both'};
export type Snapshot={camera:Frame;style:Style;cuts:Cut[];marks:Mark[];duration:number};
export type Volume=AnatomyVolumeGeometry&{values:Float32Array;sourceSlices?:number;cpuOnly?:boolean;range:[number,number];mask:Uint8Array;colors:Record<number,string>;identity:string};
export const faces=[
  {key:'A',name:'Ön',normal:[0,-1,0],up:[0,0,1]}, {key:'P',name:'Arxa',normal:[0,1,0],up:[0,0,1]},
  {key:'L',name:'Sol',normal:[1,0,0],up:[0,0,1]}, {key:'R',name:'Sağ',normal:[-1,0,0],up:[0,0,1]},
  {key:'S',name:'Yuxarı',normal:[0,0,1],up:[0,-1,0]}, {key:'I',name:'Aşağı',normal:[0,0,-1],up:[0,1,0]}
] as {key:string;name:string;normal:V;up:V}[];
export const presets:Partial<Record<VrPreset,string>>={'bone-warm':'Sümük · fil sümüyü',angio:'Angioqrafiya',airway:'Tənəffüs yolları','bone-skin':'Sümük və dəri II','bone-skin-soft':'Sümük və dəri III','bone-gray':'Sümük · ağ-qara','skin-gray':'Dəri · ağ-qara',mip:'MIP','mip-inverse':'İnvers MIP',minip:'MinIP',vessel:'Damarlar',organ:'Orqanlar',lung:'Ağciyər',soft:'Yumşaq toxuma',transparent:'Şəffaf',mr:'MRT'};
export const dot=(a:ArrayLike<number>,b:ArrayLike<number>)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
export const add=(a:V,b:V,k=1):V=>[a[0]+b[0]*k,a[1]+b[1]*k,a[2]+b[2]*k];
export const cross=(a:V,b:V):V=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
export const unit=(a:V):V=>{const d=Math.hypot(...a)||1;return [a[0]/d,a[1]/d,a[2]/d];};
export const clamp=(x:number,lo:number,hi:number)=>Math.max(lo,Math.min(hi,x));
export function world(g:AnatomyVolumeGeometry,x:number,y:number,z:number):V{return g.origin.map((n,i)=>n+x*g.spacing[0]*g.direction[i]+y*g.spacing[1]*g.direction[3+i]+z*g.spacing[2]*g.direction[6+i]) as V;}
export function fit(g:AnatomyVolumeGeometry,aspect:number,view=faces[0]):Frame{
 const center=world(g,...g.dimensions.map(n=>(n-1)/2) as V),{up,normal}=view,right=cross(up,normal);
 let half=1;for(let i=0;i<8;i++){const off=add(world(g,...g.dimensions.map((n,d)=>(i&(1<<d))?n-.5:-.5) as V),center,-1);half=Math.max(half,Math.abs(dot(off,up)),Math.abs(dot(off,right))/Math.max(.05,aspect));}
 return {center,normal:[...normal],up:[...up],scale:half*1.025};
}
export function spin(v:V,axis:V,angle:number):V{
 const c=Math.cos(angle),s=Math.sin(angle),k=dot(axis,v)*(1-c),cr=cross(axis,v);
 return [v[0]*c+cr[0]*s+axis[0]*k,v[1]*c+cr[1]*s+axis[1]*k,v[2]*c+cr[2]*s+axis[2]*k];
}
export function turn(cam:Frame,dx:number,dy:number,roll=0):Frame{
 const side=unit(cross(cam.up,cam.normal)),yaw=spin(cam.normal,cam.up,dx),right=spin(side,cam.up,dx),normal=unit(spin(yaw,right,dy));
 const up=unit(spin(spin(cam.up,right,dy),normal,roll));return {...cam,normal,up};
}
/** Orbit the camera in the opposite direction to the grabbed front surface. */
export function orbitDrag(start:Frame,from:P,to:P,width:number,height:number):Frame {
  const radiansPerPixel=Math.PI/Math.max(1,Math.min(width,height)*.72);
  return turn(start,(from[0]-to[0])*radiansPerPixel,(from[1]-to[1])*radiansPerPixel);
}

export const vrLighting={
  ambient:.25, diffuse:.95, specular:.13, power:26,
  key:{right:-.30,up:.38}, fill:{right:.83,up:.12},
  keyIntensity:.98, fillIntensity:.15,
};

export function pointAt(c:Frame,p:P,w:number,h:number):V{
 const factor=2*c.scale/h;return add(add(c.center,cross(c.up,c.normal),(p[0]-w/2)*factor),c.up,(h/2-p[1])*factor);
}
export function project(c:Frame,v:V,w:number,h:number):P{
 const delta=add(v,c.center,-1),f=h/(2*c.scale);return [w/2+f*dot(delta,cross(c.up,c.normal)),h/2-f*dot(delta,c.up)];
}
export function panZoom(c:Frame,from:P,to:P,factor:number,w:number,h:number):Frame{
 const anchor=pointAt(c,from,w,h),next={...c,scale:clamp(c.scale*factor,.025,100000)};
 return {...next,center:add(next.center,add(anchor,pointAt(next,to,w,h),-1))};
}
export function cutPlane(g:AnatomyVolumeGeometry,cam:Frame,polygon:P[],w:number,h:number,inside:boolean):Cut{
 const normalized=(v:V):P=>{const [x,y]=project(cam,v,w,h);return [x/w,y/h];};
 const p0=normalized(g.origin);const axes=([world(g,1,0,0),world(g,0,1,0),world(g,0,0,1)]).map(v=>{const p=normalized(v);return [p[0]-p0[0],p[1]-p0[1]];}) as [P,P,P];
 return {origin:p0,axes,polygon:polygon.map(([x,y])=>[x/w,y/h]),inside};
}
function presetWindow(preset:VrPreset,relative:boolean,range:[number,number]){
 if(relative)return {wl:(range[0]+range[1])/2,ww:Math.max(1,range[1]-range[0])};
 return preset==='airway'?{wl:129,ww:279}:{wl:287,ww:332};
}
export function initialStyle(geometry:AnatomyVolumeGeometry,range:[number,number],preset:VrPreset=geometry.modality==='MR'?'mr':'bone-warm'):Style{
 const relative=geometry.modality==='MR';
 return {relative,preset,...presetWindow(preset,relative,range),shading:true,opacity:1,brightness:vrLighting.ambient,segments:true,context:true};
}
export function hideAirwayExterior(s:Style,modality:string){
 return modality==='CT'&&s.preset==='airway'&&s.hideExterior!==false;
}
function baseMaterial(s:Style,range:[number,number]){
 const base:VolumePreset=({'bone-warm':'bone','bone-gray':'bone','skin-gray':'skin','bone-skin':'bone','bone-skin-soft':'skin','mip-inverse':'mip'} as Partial<Record<VrPreset,VolumePreset>>)[s.preset]||s.preset as VolumePreset;
 const p=volumePresetConfig[base];let colors:number[][]=p.color,alpha:number[][]=p.scalar;
 if(s.preset==='bone-warm'||s.preset==='bone-skin'||s.preset==='bone-skin-soft'){
   colors=[[-1000,.10,.025,.013],[50,.31,.080,.041],[130,.50,.16,.075],[205,.68,.32,.16],[285,.86,.67,.47],[380,.96,.87,.73],[620,.985,.954,.88],[1450,.99,.97,.93]];
   const skin=s.preset==='bone-skin-soft'?.12:s.preset==='bone-skin'?.035:0;
   alpha=[[-1050,0],[-350,0],[-120,skin],[40,skin*.7],[105,0],[150,.003],[210,.06],[280,.34],[365,.77],[640,.98],[1600,1]];
 }
 if(s.preset==='airway'){
   colors=[[-1024,.33,.54,.68],[-970,.54,.76,.88],[-944,.71,.86,.93],[-907,.89,.91,.90],[-845,.96,.95,.92],[-760,.99,.98,.96]];
   alpha=[[-1200,0],[-1024,0],[-997,.015],[-965,.085],[-939,.22],[-906,.36],[-868,.20],[-817,.055],[-755,.008],[-690,0],[3071,0]];
 }
 if(s.preset==='mr'){
   colors=[[range[0],.05,.07,.09],[(range[0]+range[1])/2,.57,.62,.66],[range[1],.98,.98,1]];
   alpha=[[range[0],0],[(range[0]+range[1])/2,.025],[range[1],.8]];
 }
 if(s.relative&&p.blend!=='composite'){colors=[[range[0],0,0,0],[range[1],1,1,1]];alpha=[[range[0],1],[range[1],1]];}
 const reference=presetWindow(s.preset,!!s.relative||s.preset==='mr',range);
 const pos=(n:number)=>s.wl+(n-reference.wl)*s.ww/reference.ww;
 const gray=s.preset==='bone-gray'||s.preset==='skin-gray';
 const rgb=colors.map(([x,r,g,b])=>{const l=.299*r+.587*g+.114*b;return [pos(x),...(gray?[l,l,l]:s.preset==='mip-inverse'?[1-r,1-g,1-b]:[r,g,b])];});
 return {rgb,alpha:alpha.map(([x,a])=>[pos(x),clamp(a*s.opacity,0,1)]),blend:p.blend};
}
export function material(s:Style,range:[number,number]){
 const current=baseMaterial(s,range);if(!s.mixFrom||s.mixFrom===s.preset||s.mixAmount===undefined)return current;
 const previous=baseMaterial({...s,preset:s.mixFrom},range),t=clamp(s.mixAmount,0,1);
 function blend(a:number[][],b:number[][]){
   const sample=(p:number[][],x:number,k:number)=>{let i=0;while(i+1<p.length&&p[i+1][0]<x)i++;
     const l=p[i],r=p[Math.min(i+1,p.length-1)],f=clamp((x-l[0])/(r[0]-l[0]||1),0,1);return l[k]+f*(r[k]-l[k]);};
   return [...new Set([...a,...b].map(row=>row[0]))].sort((x,y)=>x-y).map(x=>[x,...a[0].slice(1).map((_,i)=>sample(a,x,i+1)*(1-t)+sample(b,x,i+1)*t)]);
 }
 return {rgb:blend(previous.rgb,current.rgb),alpha:blend(previous.alpha,current.alpha),blend:t<.5?previous.blend:current.blend};
}
export function mixCamera(a:Frame,b:Frame,t:number):Frame{
 const rotation=(c:Frame)=>{const q:Vector4=[1,0,0,0];matrix3x3ToQuaternion([...cross(c.up,c.normal),...c.up,...c.normal],q);return q;};
 const qa=rotation(a),qb=rotation(b);let cos=qa.reduce((sum,n,i)=>sum+n*qb[i],0);const sign=cos<0?-1:1;cos=clamp(Math.abs(cos),0,1);
 const angle=Math.acos(cos),sin=Math.sin(angle),u=sin<.0001?1-t:Math.sin((1-t)*angle)/sin,k=sin<.0001?t:Math.sin(t*angle)/sin;
 const q=qa.map((n,i)=>n*u+qb[i]*k*sign) as Vector4,m:Matrix3x3=[1,0,0,0,1,0,0,0,1];quaternionToMatrix3x3(q,m);
 return {center:a.center.map((n,i)=>n*(1-t)+b.center[i]*t) as V,normal:[m[6],m[7],m[8]],up:[m[3],m[4],m[5]],scale:a.scale*(1-t)+b.scale*t};
}
export function snapshotValid(s:Snapshot){
 const vec=(v:unknown,n:number)=>Array.isArray(v)&&v.length===n&&v.every(x=>typeof x==='number'&&Number.isFinite(x)&&Math.abs(x)<1e8);
 const c=s?.camera,st=s?.style;
 return c&&vec(c.center,3)&&vec(c.normal,3)&&vec(c.up,3)&&Math.abs(dot(c.normal,c.up))<.005&&Math.abs(dot(c.up,c.up)-1)<.005&&Math.abs(dot(c.normal,c.normal)-1)<.005
 &&Number.isFinite(c.scale)&&c.scale>0&&c.scale<=1e5&&st&&Object.hasOwn(presets,st.preset)&&(!st.mixFrom||Object.hasOwn(presets,st.mixFrom))&&(st.mixAmount===undefined||Number.isFinite(st.mixAmount)&&st.mixAmount>=0&&st.mixAmount<=1)&&[st.ww,st.wl,st.opacity,st.brightness,s.duration].every(Number.isFinite)&&st.ww>0&&st.ww<=1e7&&s.duration>=.1&&s.duration<=300
 &&[st.shading,st.segments,st.context].every(v=>typeof v==='boolean')&&Array.isArray(s.marks)&&s.marks.length<=512&&s.marks.every(m=>m&&['length','arrow'].includes(m.kind)&&vec(m.a,3)&&vec(m.b,3)&&(!m.labelPoint||vec(m.labelPoint,3))&&(!m.text||typeof m.text==='string'&&m.text.length<=160)&&(!m.color||/^#[a-f0-9]{6}$/i.test(m.color))&&(!m.lineWidth||m.lineWidth>=1&&m.lineWidth<=8)&&(!m.alpha||m.alpha>=0&&m.alpha<=1))
 &&Array.isArray(s.cuts)&&s.cuts.length<=128&&s.cuts.every(k=>k&&typeof k.inside==='boolean'&&vec(k.origin,2)&&Array.isArray(k.axes)&&k.axes.length===3&&k.axes.every(a=>vec(a,2))&&Array.isArray(k.polygon)&&k.polygon.length>=3&&k.polygon.length<=4096&&k.polygon.every(p=>vec(p,2)));
}
