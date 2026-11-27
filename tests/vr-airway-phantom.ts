import assert from 'node:assert/strict';
import {airwayBodyRows, maskAirwayExterior} from '../lib/vr/airway-envelope';
import {hideAirwayExterior, initialStyle, material} from '../lib/vr/scene';
import type {AnatomyVolumeGeometry} from '../lib/anatomy-volume';

const geometry:AnatomyVolumeGeometry={modality:'CT',dimensions:[112,96,16],spacing:[1,1,1],origin:[0,0,0],direction:[1,0,0,0,1,0,0,0,1]};
const [w,h,d]=geometry.dimensions, source=new Float32Array(w*h*d);
for(let z=0;z<d;z++)for(let y=0;y<h;y++)for(let x=0;x<w;x++){
  let hu=-992;
  if(((x-56)/42)**2+((y-46)/33)**2<1)hu=35;
  if(((x-39)/14)**2+((y-48)/19)**2<1 || ((x-73)/14)**2+((y-48)/19)**2<1)hu=-906;
  if((x-56)**2+(y-41)**2<16)hu=-969;
  if(y>=88 && y<92)hu=450;
  if(x>=7&&x<=15&&y>9&&y<15)hu=-930;
  source[(z*h+y)*w+x]=hu;
}
const style=initialStyle(geometry,[-1024,1200],'airway');
assert.deepEqual([style.wl,style.ww],[129,279]);
assert.equal(hideAirwayExterior(style,'CT'),true);
assert.equal(hideAirwayExterior({...style,hideExterior:false},'CT'),false);
assert.equal(hideAirwayExterior(style,'MR'),false);
assert.equal(hideAirwayExterior({...style,preset:'bone-warm'},'CT'),false);
const {rgb,alpha}=material(style,[-1024,1200]);
const bronchus=rgb.find(k=>k[0]===-970)!,lung=rgb.find(k=>k[0]===-907)!;
assert.ok(bronchus[3]>bronchus[1]+.25 && Math.min(...lung.slice(1))>=.88);
assert.ok(alpha.find(k=>k[0]===-906)![1]>.25);
const original=source.slice(), bounds=airwayBodyRows(source,geometry.dimensions), display=source.slice(),clear=4096;
maskAirwayExterior(display,w,bounds,clear);
for(let z=0;z<d;z++){
  for(const [x,y,expected] of [[56,90,clear],[10,12,clear],[0,0,clear],[56,41,-969],[39,48,-906],[73,48,-906],[56,53,35]]){
    assert.equal(display[(z*h+y)*w+x],expected);
  }
}
assert.deepEqual(source,original);
const empty=source.slice().fill(-1024);
const unknown=airwayBodyRows(empty,geometry.dimensions);
maskAirwayExterior(empty,w,unknown,clear);
assert.ok(empty.every(x=>x===-1024));
console.log('Airway CT phantom: 16 slices, 2 simulated lungs and central airway retained; exterior, clothing and table hidden; original and low-confidence slices preserved.');

if(process.argv.includes('--full')){
  const width=485,height=485,slices=356,area=width*height;
  const phantom=new Float32Array(area*slices),pixels=new Float32Array(area);
  const lungEdges:number[]=[];
  // Make the lung reach within six pixels of the chest wall at the lateral extreme.
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const i=y*width+x;
    const body=((x-242)/195)**2+((y-235)/143)**2;
    const lung=Math.min(((x-150)/97)**2,((x-334)/97)**2)+((y-235)/100)**2;
    pixels[i]=body<1?35:-984;
    if(lung<1){pixels[i]=-906;if(lung>.96)lungEdges.push(i);}
    if((x-242)**2+(y-200)**2<180)pixels[i]=-969;
    if(y>425&&y<438)pixels[i]=440;
    if(x>30&&x<100&&y>30&&y<37)pixels[i]=-945;
  }
  for(let z=0;z<slices;z++)phantom.set(pixels,z*area);
  const t0=performance.now(), outline=airwayBodyRows(phantom,[width,height,slices]),t1=performance.now();
  const backing=phantom.slice();
  maskAirwayExterior(backing,width,outline,4096);
  const t2=performance.now();
  for(let z=0;z<slices;z++){
    const base=z*area;
    for(const i of lungEdges)assert.equal(backing[base+i],pixels[i]);
    assert.equal(backing[base+433*width+248],4096);
    assert.equal(backing[base+34*width+65],4096);
    assert.equal(phantom[base+433*width+248],440);
    assert.equal(phantom[base+34*width+65],-945);
  }
  console.log(JSON.stringify({dimensions:[width,height,slices],peripheralLungVoxelsVerified:lungEdges.length*slices,bodyOutlineMs:Math.round(t1-t0),displayCopyAndMaskMs:Math.round(t2-t1),compactBoundsMiB:+(outline.byteLength/1048576).toFixed(2),extraGpuDisplayCopyMiB:+(backing.byteLength/1048576).toFixed(1)}));
}
