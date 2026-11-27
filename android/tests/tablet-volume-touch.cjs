const assert = require('node:assert/strict');
const {withTablet} = require('../../tests/private-tablet-fixture.cjs');

// Read the actual CPU canvas. A changed React camera alone does not prove a frame was presented.
function rasterSignature() {
  const c = document.querySelector('dialog .vr-raster canvas');
  const ctx = c?.getContext('2d');
  if (!ctx || !c.width || !c.height) return null;
  const rgba = ctx.getImageData(0, 0, c.width, c.height).data;
  let hash = 1, light = 0;
  for (let i = 0; i < rgba.length; i += 16) {
    hash = (Math.imul(hash,31) + rgba[i]) >>> 0;
    if (rgba[i] > 12) light++;
  }
  return light ? [c.width,c.height,hash].join('/') : null;
}
withTablet(async ({ctx,p,errors}) => {
  const depth=Number(process.env.RADAZ_PHANTOM_DEPTH);
  const hold=depth>128;
  await p.locator('input[type=file][accept*="zip"]').first().setInputFiles(process.env.RADAZ_PHANTOM_ZIP);
  await p.waitForFunction(n=>document.querySelector('[data-panel=A] .bottom-right')?.innerText.includes('/ '+n),depth,{timeout:120000});
  await p.evaluate(({hold,depth})=>{
    const prompt=window.prompt.bind(window);
    window.prompt=(key,...args)=>key==='radaz-tablet/volume-memory'
      ? JSON.stringify({totalMiB:4000,availableMiB:1600,heapMiB:192,reserveMiB:220,low:false})
      : prompt(key,...args);
    const getContext=HTMLCanvasElement.prototype.getContext;
    window.qaVolumeGl=0;
    HTMLCanvasElement.prototype.getContext=function(kind,...args){
      if(document.querySelector('dialog.tablet-volume-dialog') && ['webgl','webgl2'].includes(kind)){
        window.qaVolumeGl++;throw Error('Tablet 3D driver unavailable');
      }
      return getContext.call(this,kind,...args);
    };
    // Make the old source-worker dependency observable on a short series.
    const post=MessagePort.prototype.postMessage;
    let n=0;
    MessagePort.prototype.postMessage=function(msg,...args){
      if(msg?.frame?.pixels && msg.width){
        n++;
        if(!hold)throw Error('short stack used the volume reader worker');
        if(n===depth){window.qaRelease=()=>post.call(this,msg,...args);return;}
      }
      return post.call(this,msg,...args);
    };
  },{hold,depth});
  const cdp=await ctx.newCDPSession(p);
  async function drag(x,y){
    const box=await p.locator('dialog .vr-stage').boundingBox();
    const x0=box.x+box.width*.46,y0=box.y+box.height*.5;
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:x0,y:y0}]});
    for(let i=1;i<=4;i++)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x0+x*i/4,y:y0+y*i/4}]});
    await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  }
  await p.getByRole('button',{name:'3D həcm görüntüləmə',exact:true}).first().tap();
  const root=p.locator('dialog .radaz-vr'),final=p.locator('dialog .radaz-vr:not([data-volume-preview])');
  if(hold)await p.waitForFunction(()=>!!window.qaRelease,{},{timeout:90000});
  else await final.locator('.vr-raster[data-ready=true]').waitFor({timeout:90000});
  await p.waitForFunction(rasterSignature);
  const rotate=root.getByRole('button',{name:'Fırlat',exact:true});
  await rotate.tap();
  const before=await p.evaluate(rasterSignature);
  await drag(104,43);
  await p.waitForFunction(`(${rasterSignature})() && (${rasterSignature})()!==${JSON.stringify(before)}`);
  const orientation=()=>p.locator('dialog .vr-orientation svg').innerHTML();
  if(hold){
    const ori=await orientation();
    await p.evaluate(()=>window.qaRelease());
    await final.locator('.vr-raster[data-ready=true]').waitFor({timeout:90000});
    assert.equal(await orientation(),ori,'orientation survives preview replacement');
  }
  await final.getByRole('button',{name:'Yaxınlaşdır',exact:true}).tap();
  await p.waitForFunction(()=>document.querySelector('dialog .vr-stage')?.dataset.tool==='zoom',{},{timeout:3500});
  const zoomBefore=await p.evaluate(rasterSignature);
  await drag(0,73);
  await p.waitForFunction(`(${rasterSignature})() && (${rasterSignature})()!==${JSON.stringify(zoomBefore)}`);
  const presets=final.getByRole('button',{name:'3D rəng rejimləri',exact:true});
  await presets.tap();
  await final.locator('.vr-menu').waitFor();
  await presets.tap();
  await final.locator('.vr-menu').waitFor({state:'hidden'});
  assert.equal(await p.evaluate(()=>window.qaVolumeGl),0,'weak tablets stay independent of WebGL');
  await final.getByRole('button',{name:'Proyeksiyada uzunluq',exact:true}).tap();
  await p.waitForFunction(()=>document.querySelector('dialog .vr-stage')?.dataset.tool==='length',{},{timeout:3500});
  await drag(65,34);
  assert.equal(await final.getAttribute('data-volume-depth'),String(depth));
  await final.getByRole('button',{name:'3D pəncərəni bağla'}).tap();
  await p.getByRole('button',{name:'Local arxiv',exact:true}).first().tap();
  await p.locator('.tablet-archive-window').getByRole('button',{name:'Pəncərəni bağla'}).tap();
  assert.deepEqual(errors,[]);
  console.log('PASS',depth,'slices, visible rotated and zoomed frames, length tool, archive return',hold?'with interactive preview':'complete opening');
}).catch(error=>{console.error(error);process.exitCode=1;});
