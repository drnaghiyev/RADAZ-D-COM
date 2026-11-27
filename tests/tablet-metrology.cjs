const assert=require('node:assert/strict');

// The input coordinates are found optically in the displayed DICOM pixels.
// No call to the application's camera or distance conversion is used as an oracle.
async function verifyMetrology(page,panel,context){
  const points=await page.waitForFunction(()=>{
    const c=document.querySelector('[data-panel="A"] .dicom-canvas canvas');
    if(!c?.width)return false;
    const data=c.getContext('2d').getImageData(0,0,c.width,c.height).data;
    const bands=[];
    for(let y=0;y<c.height;y++){
      const runs=[];let x=0;
      while(x<c.width){
        if(data[4*(y*c.width+x)]<200){x++;continue;}
        const from=x;while(x<c.width&&data[4*(y*c.width+x)]>=200)x++;
        runs.push([from,x]);
      }
      if(!runs.length)continue;
      const last=bands.at(-1);
      if(last&&last.end===y-1){last.end=y;last.runs.push(runs);}
      else bands.push({start:y,end:y,runs:[runs]});
    }
    if(bands.length!==5 || bands.some((b,i)=>b.runs[0].length!==[1,2,1,2,1][i]))return false;
    const box=c.getBoundingClientRect();
    return bands.flatMap(({start,end,runs})=>runs[Math.floor(runs.length/2)].map(([from,to])=>({
      x:box.x+(from+to)*.5*box.width/c.width,y:box.y+(start+end+1)*.5*box.height/c.height
    })));
  }).then(h=>h.jsonValue());
  const [verticalStart,left,right,verticalEnd,armStart,vertex,armEnd]=points;
  const cdp=await context.newCDPSession(page);
  const touch=async(type,point)=>cdp.send('Input.dispatchTouchEvent',{type,touchPoints:point?[{...point,id:1}]:[]});
  const drag=async(a,b)=>{
    await touch('touchStart',a);
    for(let i=1;i<=8;i++)await touch('touchMove',{x:a.x+(b.x-a.x)*i/8,y:a.y+(b.y-a.y)*i/8});
    await touch('touchEnd');await page.waitForTimeout(300);
  };
  async function choose(pattern){
    await page.getByRole('button',{name:'Ölçmə alətləri',exact:true}).click();
    await page.getByRole('menuitem',{name:pattern}).click();
  }
  async function readLabels(unit,count){
    const list=panel.locator('.dicom-canvas svg text').filter({hasText:unit==='mm'?/\d\s*mm/:/°/});
    await list.nth(count-1).waitFor({timeout:6500});
    const labels=await list.allTextContents();
    return labels.map(text=>Number(text.replace(',','.').match(/-?\d+(?:\.\d+)?/)[0]));
  }
  await choose(/^Uzunluq/);
  await drag(left,right);const [horizontal]=await readLabels('mm',1);
  await drag(verticalStart,verticalEnd);const lengths=await readLabels('mm',2);
  await choose(/^Bucaq/);
  await drag(armStart,vertex);await drag(vertex,armEnd);
  const [degrees]=await readLabels('degrees',1);
  console.log(JSON.stringify({horizontal,vertical:lengths[1],degrees,fiducials:points,lengthToleranceMm:.25,angleToleranceDegrees:.5}));
  assert.ok(Math.abs(horizontal-20)<=.25 && Math.abs(lengths[1]-20)<=.25,'20 mm fiducials: 40 columns at 0.5 and 25 rows at 0.8 mm');
  assert.ok(Math.abs(degrees-90)<=.5,'orthogonal 90-degree fiducial');
}
module.exports={verifyMetrology};
