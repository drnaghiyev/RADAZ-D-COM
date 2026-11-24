const assert=require('node:assert/strict');

async function contact(page,cdp,kind,a,b){
  if(kind==='touch'){
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...a,id:1}]});
    for(let i=1;i<=8;i++)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:a.x+(b.x-a.x)*i/8,y:a.y+(b.y-a.y)*i/8,id:1}]});
    await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  }else{
    const pointerType=kind==='pen'?'pen':'mouse';
    await cdp.send('Input.dispatchMouseEvent',{type:'mousePressed',...a,button:'left',buttons:1,clickCount:1,pointerType});
    for(let i=1;i<=8;i++)await cdp.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:a.x+(b.x-a.x)*i/8,y:a.y+(b.y-a.y)*i/8,button:'left',buttons:1,pointerType});
    await cdp.send('Input.dispatchMouseEvent',{type:'mouseReleased',...b,button:'left',buttons:0,clickCount:1,pointerType});
  }
  await page.waitForTimeout(180);
}
async function verifyEdits(page,pane,cdp){
  const point=async id=>{
    const node=pane.locator('line[data-id$="-endpoint-'+id+'"]').first();
    await node.waitFor();
    return node.evaluate(line=>{
      const p=line.ownerSVGElement.createSVGPoint();p.x=(line.x1.baseVal.value+line.x2.baseVal.value)/2;p.y=(line.y1.baseVal.value+line.y2.baseVal.value)/2;
      const q=p.matrixTransform(line.getScreenCTM());return {x:q.x,y:q.y};
    });
  };
  const dist=(p,q)=>Math.hypot(p.x-q.x,p.y-q.y);
  for(const [key,kind] of [['p','mouse'],['z','touch'],['s','pen']]){
    await page.locator('button.view-tool[title$=" · '+key.toUpperCase()+'"]').first().evaluate(b=>b.click());await page.waitForTimeout(150);
    const a=await point(0),b=await point(1),body={x:(a.x+b.x)/2,y:(a.y+b.y)/2};
    const frame=await pane.locator('.bottom-right').innerText();
    const cameraImage=()=>pane.locator('.dicom-canvas canvas').first().evaluate(async canvas=>{
      const blob=await new Promise(done=>canvas.toBlob(done));const hash=await crypto.subtle.digest('SHA-256',await blob.arrayBuffer());
      return Array.from(new Uint8Array(hash)).join(',');
    });
    const pixels=await cameraImage();
    const diagnostic=await page.evaluate(({x,y})=>({tool:document.querySelector('.view-tool[aria-pressed=true]')?.getAttribute('title'),hit:document.elementsFromPoint(x,y).slice(0,5).map(n=>n.tagName+'.'+(n.classList.value||''))}),body);
    await contact(page,cdp,kind,body,{x:body.x+10,y:body.y+13});
    const moved=await point(0),other=await point(1);
    assert.ok(dist(a,moved)>8 && dist(b,other)>8,key+' moves the entire annotation '+JSON.stringify({a,b,moved,other,body,diagnostic}));
    assert.ok(Math.abs(dist(a,b)-dist(moved,other))<2,key+' preserves length on body drag');
    await contact(page,cdp,kind,other,{x:other.x+14,y:other.y-9});
    assert.ok(dist(await point(1),other)>8 && dist(await point(0),moved)<2,key+' edits just the chosen endpoint');
    assert.equal(await pane.locator('.bottom-right').innerText(),frame,key+' does not scroll under the measurement');
    assert.equal(await cameraImage(),pixels,key+' holds the image camera still');
  }
}
module.exports={contact,verifyEdits};
