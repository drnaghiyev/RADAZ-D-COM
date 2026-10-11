'use client';
import {useEffect,useState} from 'react';
type Vector=[number,number,number];
type Camera={viewUp:Vector;viewPlaneNormal:Vector};
type Viewport={element:HTMLElement;getCamera:()=>Camera;setCamera:(camera:Partial<Camera>)=>void;render:()=>void};
const dot=(a:Vector,b:Vector)=>a.reduce((sum,n,i)=>sum+n*b[i],0);
const cross=(a:Vector,b:Vector):Vector=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const faces:{name:string;normal:Vector;up:Vector;color:string}[]=[
 {name:'L',normal:[1,0,0],up:[0,0,1],color:'#497ac1'},
 {name:'R',normal:[-1,0,0],up:[0,0,1],color:'#497ac1'},
 {name:'P',normal:[0,1,0],up:[0,0,1],color:'#a95048'},
 {name:'A',normal:[0,-1,0],up:[0,0,1],color:'#a95048'},
 {name:'S',normal:[0,0,1],up:[0,-1,0],color:'#46865a'},
 {name:'I',normal:[0,0,-1],up:[0,1,0],color:'#46865a'},
];
/** Patient LPS axes, projected with the live volume camera, not screen-fixed labels. */
export function VolumeOrientation({viewport}:{viewport:Viewport}){
 const [camera,setCamera]=useState(()=>viewport.getCamera());
 useEffect(()=>{const update=()=>setCamera(viewport.getCamera());viewport.element.addEventListener('CORNERSTONE_CAMERA_MODIFIED',update);return()=>viewport.element.removeEventListener('CORNERSTONE_CAMERA_MODIFIED',update);},[viewport]);
 const right=cross(camera.viewUp,camera.viewPlaneNormal);
 const project=(p:Vector)=>[50+dot(p,right)*23,50-dot(p,camera.viewUp)*23];
 const visible=faces.filter(face=>dot(face.normal,camera.viewPlaneNormal)>.001);
 return <div className="volume-orientation" onPointerDown={e=>e.stopPropagation()} onDoubleClick={e=>e.stopPropagation()}>
  <svg viewBox="0 0 100 100" aria-label="DICOM LPS" role="group">{visible.map(face=>{
   const side=cross(face.up,face.normal);
   const corners=[[-1,-1],[1,-1],[1,1],[-1,1]].map(([a,b])=>project(face.normal.map((n,i)=>n+a*side[i]+b*face.up[i]) as Vector).join(','));
   const center=project(face.normal);
   const activate=()=>{viewport.setCamera({viewPlaneNormal:face.normal,viewUp:face.up});viewport.render();};
   return <g key={face.name} role="button" tabIndex={0} aria-label={`LPS ${face.name}`} onClick={activate} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();activate();}}}><polygon points={corners.join(' ')} fill={face.color}/><text x={center[0]} y={center[1]}>{face.name}</text></g>;
  })}</svg>
  <div className="volume-axis-views">{faces.map(face=><button key={face.name} title={`LPS ${face.name}`} aria-label={`LPS ${face.name} view`} onClick={()=>{viewport.setCamera({viewPlaneNormal:face.normal,viewUp:face.up});viewport.render();}}>{face.name}</button>)}</div>
 </div>;
}
