import {measurementCopies} from './measurement-copies';
import JSZip from 'jszip';
import type { ArchiveStudy } from './local-archive';
import { bytesToBase64, readDicomPixels } from './dicom-pixels';
import {parseDicomFile} from './dicom-file';

const safe = (value: string) => value.replace(/[^a-z0-9._-]+/gi, '_').replace(/^_+|_+$/g, '') || 'study';

export async function buildDicomCdPackage(study: ArchiveStudy, files: File[], progress?: (message: string) => void) {
  const zip = new JSZip();
  const dicom = zip.folder('DICOM')!;
  const viewerImages: Array<{ name: string; rows: number; columns: number; pixels: string }> = [];
  for (let index = 0; index < files.length; index++) {
    const file = files[index];
    dicom.file(`IMG${String(index + 1).padStart(6, '0')}.dcm`, file);
    try {
      const image = await readDicomPixels(file);
      if (image) viewerImages.push({ name: image.name, rows: image.rows, columns: image.columns, pixels: bytesToBase64(image.pixels) });
    } catch { /* DICOM file remains on the media even when Lite preview cannot decode it. */ }
    if (index % 10 === 0) progress?.(`CD paketi hazırlanır: ${index + 1} / ${files.length}`);
  }
  const savedCopies=await measurementCopies(study.uid);
  const included=new Set<string>();
  if(savedCopies.length)for(const file of files){try{const sop=parseDicomFile(new Uint8Array(await file.arrayBuffer())).string('x00080018');if(sop)included.add(sop);}catch{}}
  const copies=savedCopies.filter(copy=>included.has(copy.sop));
  for(const [i,copy] of copies.entries())zip.file(`MEASUREMENTS/IMAGE${String(i+1).padStart(6,'0')}.png`,copy.blob);
  if(copies.length)zip.file('MEASUREMENTS/index.html', '<!doctype html><meta charset="utf-8"><title>RADAZ ölçülü nüsxələr</title><h1>Ölçülü nüsxələr — orijinal DICOM deyil</h1>'+copies.map((_,i)=>`<p><img style="max-width:100%" src="IMAGE${String(i+1).padStart(6,'0')}.png"></p>`).join(''));
  zip.file('README.txt', `RADAZ DICOM media\r\nPatient: ${study.patient}\r\nPatient ID: ${study.patientId}\r\nStudy UID: ${study.uid}\r\nImages: ${files.length}\r\n\r\nSTART.html faylını Chrome və ya Edge ilə açın. Orijinal DICOM faylları DICOM qovluğundadır.${copies.length?' Ölçülü PNG nüsxələr MEASUREMENTS/index.html faylındadır.':''}\r\n`);
  zip.file('START.html', viewerHtml(study, viewerImages, copies.length));
  zip.file('MANIFEST.json', JSON.stringify({ profile: 'RADAZ-DICOM-MEDIA', study, files: files.map((file, index) => ({ path: `DICOM/IMG${String(index + 1).padStart(6, '0')}.dcm`, originalName: file.name })) }, null, 2));
  const blob = await zip.generateAsync({ type: 'blob', compression: 'STORE' }, value => progress?.(`CD faylı yaradılır: ${Math.round(value.percent)}%`));
  return { blob, previews: viewerImages.length };
}

export async function createDicomCdPackage(study: ArchiveStudy, files: File[], progress?: (message: string) => void) {
  const { blob, previews } = await buildDicomCdPackage(study, files, progress);
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob); link.download = `${safe(study.patient)}-${study.date || 'study'}-RADAZ-CD.zip`;
  link.click(); setTimeout(() => URL.revokeObjectURL(link.href), 30_000);
  return previews;
}

function viewerHtml(study: ArchiveStudy, images: Array<{ name: string; rows: number; columns: number; pixels: string }>, measurementCount=0) {
  const payload = JSON.stringify({ patient: study.patient, description: study.description, images }).replace(/</g, '\\u003c');
  return `<!doctype html><html lang="az"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>RADAZ DICOM Lite</title><style>
*{box-sizing:border-box}html,body{margin:0;height:100%;overflow:hidden;background:#05090d;color:#eaf7ff;font:14px Arial}.bar{height:58px;display:flex;align-items:center;gap:10px;padding:8px 14px;background:#102331;border-bottom:1px solid #315269}.brand{font-size:19px;font-weight:800;letter-spacing:.08em;margin-right:auto}.brand small{display:block;color:#7bc9eb;font-size:9px}.bar button{border:1px solid #385d73;background:#17364a;color:#eaf7ff;border-radius:5px;padding:8px 11px;font-weight:700}.bar button.on{background:#1686b9}.meta{color:#a9cad9}.stage{height:calc(100% - 58px);position:relative;display:grid;place-items:center;overflow:hidden}.stage canvas{background:#000;image-rendering:auto;transform-origin:center}.info{position:absolute;left:12px;top:10px;color:#bce7f8;text-shadow:0 1px 2px #000;white-space:pre-line}.measure{position:absolute;inset:0;pointer-events:none}.hint{position:absolute;right:12px;bottom:10px;color:#86aebe}</style></head><body>
<div class="bar"><div class="brand">RADAZ<small>DICOM LITE</small></div><span class="meta">${escapeHtml(study.patient)} · ${escapeHtml(study.description || '')}</span>${measurementCount?'<a href="MEASUREMENTS/index.html" style="color:#8ee6fa">Ölçülü nüsxələr</a>':''}<button data-tool="pan">Pan</button><button data-tool="zoom">Zoom</button><button data-tool="wl">WL / WW</button><button data-tool="measure">Ölçü</button><button id="reset">Sıfırla</button></div><div class="stage" id="stage"><canvas id="image"></canvas><canvas class="measure" id="overlay"></canvas><div class="info" id="info"></div><div class="hint">Mouse çarxı: görüntülər · Aktiv alət: sürükləyin</div></div>
<script>const DATA=${payload};let i=0,tool='pan',scale=1,tx=0,ty=0,level=127,width=255,start=null,line=null;const c=document.querySelector('#image'),ctx=c.getContext('2d'),o=document.querySelector('#overlay'),ox=o.getContext('2d'),stage=document.querySelector('#stage'),info=document.querySelector('#info');function draw(){const im=DATA.images[i];if(!im){info.textContent='Lite viewer üçün açılan sıxılmamış görüntü yoxdur. DICOM qovluğundakı faylları tam viewer-də açın.';return}c.width=im.columns;c.height=im.rows;const raw=Uint8Array.from(atob(im.pixels),x=>x.charCodeAt(0)),id=ctx.createImageData(im.columns,im.rows);for(let p=0;p<raw.length;p++){let v=Math.max(0,Math.min(255,(raw[p]-level+width/2)*255/width));id.data[p*4]=id.data[p*4+1]=id.data[p*4+2]=v;id.data[p*4+3]=255}ctx.putImageData(id,0,0);c.style.transform='translate('+tx+'px,'+ty+'px) scale('+scale+')';info.textContent=DATA.patient+'\\n'+(i+1)+' / '+DATA.images.length+'\\nWL '+Math.round(level)+' / WW '+Math.round(width);overlay()}function overlay(){o.width=stage.clientWidth;o.height=stage.clientHeight;ox.strokeStyle='#39ff72';ox.lineWidth=2;if(line){ox.beginPath();ox.moveTo(line[0],line[1]);ox.lineTo(line[2],line[3]);ox.stroke();const d=Math.hypot(line[2]-line[0],line[3]-line[1]);ox.fillStyle='#ffe24a';ox.fillText(Math.round(d)+' px',line[2]+8,line[3]-8)}}document.querySelectorAll('[data-tool]').forEach(b=>b.onclick=()=>{tool=b.dataset.tool;document.querySelectorAll('[data-tool]').forEach(x=>x.classList.toggle('on',x===b))});stage.onwheel=e=>{e.preventDefault();i=(i+(e.deltaY>0?1:-1)+DATA.images.length)%DATA.images.length;draw()};stage.onpointerdown=e=>{start=[e.clientX,e.clientY,tx,ty,scale,level,width];stage.setPointerCapture(e.pointerId)};stage.onpointermove=e=>{if(!start)return;const dx=e.clientX-start[0],dy=e.clientY-start[1];if(tool==='pan'){tx=start[2]+dx;ty=start[3]+dy}else if(tool==='zoom')scale=Math.max(.15,start[4]*(1-dy/180));else if(tool==='wl'){level=start[5]+dy;width=Math.max(1,start[6]+dx*2)}else line=[start[0],start[1],e.clientX,e.clientY];draw()};stage.onpointerup=()=>start=null;document.querySelector('#reset').onclick=()=>{scale=1;tx=ty=0;level=127;width=255;line=null;draw()};addEventListener('resize',draw);document.querySelector('[data-tool="pan"]').classList.add('on');draw();</script></body></html>`;
}

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char]!));
