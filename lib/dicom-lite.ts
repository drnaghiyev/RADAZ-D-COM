/** Runs from a local CD without network access or a JavaScript package server. */
export const liteScript=String.raw`
const DATA=window.RADAZ_DATA;
let index=0,tool='pan',zoom=1,panX=0,panY=0,brightness=0,contrast=1,active=-1,drag=null,draft=[],hu=null;
const marks=DATA.images.map(()=>[]),image=document.getElementById('image'),stage=document.getElementById('stage'),canvas=document.getElementById('overlay'),ctx=canvas.getContext('2d'),info=document.getElementById('info'),hint=document.getElementById('hint');
function current(){return DATA.images[index]}
function fit(){const x=current();return Math.min(stage.clientWidth/x.columns,stage.clientHeight/x.rows)}
function rect(){const x=current(),s=fit()*zoom;return {x:(stage.clientWidth-x.columns*s)/2+panX,y:(stage.clientHeight-x.rows*s)/2+panY,s}}
function toPixel(e){const r=stage.getBoundingClientRect(),b=rect();return [(e.clientX-r.left-b.x)/b.s,(e.clientY-r.top-b.y)/b.s]}
function onImage(p){const x=current();return p[0]>=0&&p[1]>=0&&p[0]<x.columns&&p[1]<x.rows}
function screen(p){const b=rect();return [b.x+p[0]*b.s,b.y+p[1]*b.s]}
function store(){try{localStorage.setItem('radaz-lite:'+location.pathname+':'+index,JSON.stringify(marks[index]))}catch{}}
function restore(){try{const value=JSON.parse(localStorage.getItem('radaz-lite:'+location.pathname+':'+index)||'[]');if(Array.isArray(value))marks[index]=value.filter(x=>x&&Array.isArray(x.points))}catch{}}
function loadHU(){hu=null;window.__RADAZ_HU=null;const x=current();if(!x.hu){render();return}const script=document.createElement('script');script.src=x.hu;script.onload=()=>{const packet=window.__RADAZ_HU;if(packet&&packet.index===index){const raw=atob(packet.data),values=new Int16Array(raw.length/2);for(let k=0;k<values.length;k++)values[k]=raw.charCodeAt(k*2)|(raw.charCodeAt(k*2+1)<<8);hu=values}render();script.remove()};script.onerror=()=>{render();script.remove()};document.body.append(script)}
function render(){const x=current();if(!x)return;const b=rect();image.style.left=b.x+'px';image.style.top=b.y+'px';image.style.width=x.columns*b.s+'px';image.style.height=x.rows*b.s+'px';image.style.filter='brightness('+Math.max(.1,1+brightness)+') contrast('+Math.max(.1,contrast)+')';canvas.width=stage.clientWidth;canvas.height=stage.clientHeight;ctx.lineWidth=2;ctx.font='bold 13px Arial';ctx.lineJoin='round';
 const all=marks[index];all.forEach((m,j)=>paint(m,j===active));if(draft.length)paint({type:tool,points:draft},false,true);
 info.textContent=DATA.patient+'\n'+x.name+'\n'+(index+1)+' / '+DATA.images.length;
 hint.textContent=tool==='roi'?(x.hu?(hu?'HU: orijinal KT piksellərindən hesablanır':'HU məlumatı yüklənir…'):'Bu görüntüdə HU məlumatı yoxdur'):'Çarx: görüntülər · Delete: seçilmiş ölçünü sil';}
function line(a,b){ctx.beginPath();ctx.moveTo(a[0],a[1]);ctx.lineTo(b[0],b[1]);ctx.stroke()}
function angle(a,b,c){const u=Math.atan2(a[1]-b[1],a[0]-b[0]),v=Math.atan2(c[1]-b[1],c[0]-b[0]);let d=Math.abs((u-v)*180/Math.PI);return Math.round(d>180?360-d:d)}
function paint(m,selected,preview){const p=m.points.map(screen);if(!p.length)return;ctx.strokeStyle=selected?'#ffe070':'#46ec80';ctx.fillStyle=ctx.strokeStyle;
 if(m.type==='length'&&p.length>=2){line(p[0],p[1]);const s=current().spacing,dx=m.points[1][0]-m.points[0][0],dy=m.points[1][1]-m.points[0][1],d=s?Math.hypot(dx*s[1],dy*s[0]).toFixed(1)+' mm':Math.hypot(dx,dy).toFixed(0)+' px';ctx.fillText(d,p[1][0]+8,p[1][1]-8)}
 if(m.type==='angle'&&p.length>=2){line(p[0],p[1]);if(p.length>=3){line(p[1],p[2]);ctx.fillText(angle(...p.slice(0,3))+'°',p[1][0]+8,p[1][1]-8)}}
 if(m.type==='cobb'&&p.length>=2){line(p[0],p[1]);if(p.length>=4){line(p[2],p[3]);const d=Math.abs((Math.atan2(p[1][1]-p[0][1],p[1][0]-p[0][0])-Math.atan2(p[3][1]-p[2][1],p[3][0]-p[2][0]))*180/Math.PI);ctx.fillText(Math.round(d>90?180-d:d)+'°',p[3][0]+8,p[3][1]-8)}}
 if(m.type==='roi'&&p.length>=2){const x=Math.min(p[0][0],p[1][0]),y=Math.min(p[0][1],p[1][1]),w=Math.abs(p[1][0]-p[0][0]),h=Math.abs(p[1][1]-p[0][1]);ctx.strokeRect(x,y,w,h);if(!preview){const stats=roi(m);ctx.fillText(stats,p[1][0]+8,p[1][1]-8)}}
 if(selected)p.forEach(q=>{ctx.fillRect(q[0]-4,q[1]-4,8,8)})}
function roi(m){if(!hu)return 'HU yoxdur';const x=current(),a=m.points[0],b=m.points[1],x0=Math.max(0,Math.floor(Math.min(a[0],b[0]))),x1=Math.min(x.columns,Math.ceil(Math.max(a[0],b[0]))),y0=Math.max(0,Math.floor(Math.min(a[1],b[1]))),y1=Math.min(x.rows,Math.ceil(Math.max(a[1],b[1])));let sum=0,count=0;for(let y=y0;y<y1;y++)for(let col=x0;col<x1;col++){sum+=hu[y*x.columns+col];count++}return count?Math.round(sum/count)+' HU':'HU yoxdur'}
function near(p,a,b){const dx=b[0]-a[0],dy=b[1]-a[1],t=Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/(dx*dx+dy*dy||1)));return Math.hypot(p[0]-a[0]-t*dx,p[1]-a[1]-t*dy)}
function hit(p){const tolerance=10/rect().s;for(let j=marks[index].length-1;j>=0;j--){const m=marks[index][j];for(let k=0;k<m.points.length;k++)if(Math.hypot(p[0]-m.points[k][0],p[1]-m.points[k][1])<tolerance)return {j,k};for(let k=1;k<m.points.length;k++)if(near(p,m.points[k-1],m.points[k])<tolerance)return {j,k:-1};if(m.type==='roi'&&m.points.length===2){const a=m.points[0],b=m.points[1];if(p[0]>=Math.min(a[0],b[0])&&p[0]<=Math.max(a[0],b[0])&&p[1]>=Math.min(a[1],b[1])&&p[1]<=Math.max(a[1],b[1]))return {j,k:-1}}}return null}
function selectTool(value){tool=value;draft=[];document.querySelectorAll('[data-tool]').forEach(b=>b.classList.toggle('on',b.dataset.tool===value));render()}
document.querySelectorAll('[data-tool]').forEach(b=>b.onclick=()=>selectTool(b.dataset.tool));
document.getElementById('delete').onclick=()=>{if(active>=0){marks[index].splice(active,1);active=-1;store();render()}};
document.getElementById('reset').onclick=()=>{zoom=1;panX=panY=brightness=0;contrast=1;render()};
stage.onwheel=e=>{e.preventDefault();index=(index+(e.deltaY>0?1:-1)+DATA.images.length)%DATA.images.length;active=-1;draft=[];zoom=1;panX=panY=0;image.src=current().path;restore();loadHU();render()};
stage.onpointerdown=e=>{if(e.target.closest('button'))return;const p=toPixel(e),h=hit(p);active=h?h.j:-1;if(h){drag={mode:'mark',start:p,hit:h,points:marks[index][h.j].points.map(q=>q.slice())}}else if(tool==='pan'||tool==='zoom'||tool==='wl')drag={mode:tool,start:[e.clientX,e.clientY],panX,panY,zoom,brightness,contrast};else if(tool==='roi'&&onImage(p)){drag={mode:'roi',start:p};draft=[p,p]}else if(onImage(p)){draft.push(p);const size=tool==='length'?2:tool==='angle'?3:tool==='cobb'?4:0;if(size&&draft.length===size){marks[index].push({type:tool,points:draft});active=marks[index].length-1;draft=[];store()}}stage.setPointerCapture(e.pointerId);render()};
stage.onpointermove=e=>{if(!drag)return;const p=toPixel(e);if(drag.mode==='mark'){const m=marks[index][drag.hit.j];if(drag.hit.k>=0)m.points[drag.hit.k]=p;else m.points=drag.points.map(q=>[q[0]+p[0]-drag.start[0],q[1]+p[1]-drag.start[1]])}else if(drag.mode==='roi')draft=[drag.start,p];else if(drag.mode==='pan'){panX=drag.panX+e.clientX-drag.start[0];panY=drag.panY+e.clientY-drag.start[1]}else if(drag.mode==='zoom')zoom=Math.max(.1,drag.zoom*(1-(e.clientY-drag.start[1])/180));else if(drag.mode==='wl'){brightness=drag.brightness+(e.clientY-drag.start[1])/500;contrast=Math.max(.1,drag.contrast+(e.clientX-drag.start[0])/250)}render()};
stage.onpointerup=()=>{if(drag?.mode==='roi'&&draft.length===2&&Math.hypot(draft[1][0]-draft[0][0],draft[1][1]-draft[0][1])>2){marks[index].push({type:'roi',points:draft});active=marks[index].length-1;draft=[];store()}if(drag?.mode==='mark')store();drag=null;render()};
addEventListener('keydown',e=>{if((e.key==='Delete'||e.key==='Backspace')&&active>=0){marks[index].splice(active,1);active=-1;store();render()}});addEventListener('resize',render);
image.onload=render;if(DATA.images.length){image.src=current().path;restore();loadHU();selectTool('pan')}else info.textContent='Ön baxış yoxdur';
`;
