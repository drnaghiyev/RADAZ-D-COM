const assert=require('node:assert/strict');

// Hold only synthetic resampling requests so close/upgrade races are reproducible on fast GPUs.
async function verifyDesktopLoading(home,context){
  await home.evaluate(()=>{
    const WorkerClass=window.Worker;
    window.volumeTest={hold:true,active:0,started:0,queued:[]};
    window.Worker=class extends WorkerClass {
      constructor(url,...args){
        super(url,...args);this.tracked=String(url).includes('display-plane.worker');
        if(this.tracked){window.volumeTest.active++;window.volumeTest.started++;}
      }
      postMessage(...args){
        const state=window.volumeTest;
        if(this.tracked && state.hold && args[0]?.planes){state.queued.push([this,()=>super.postMessage(...args)]);return;}
        return super.postMessage(...args);
      }
      terminate(){
        if(this.tracked){
          this.tracked=false;window.volumeTest.active--;
          window.volumeTest.queued=window.volumeTest.queued.filter(([w])=>w!==this);
        }
        return super.terminate();
      }
    };
  });
  const open=async()=>{
    const child=context.waitForEvent('page');
    await home.getByRole('button',{name:'3D həcm görüntüləmə',exact:true}).first().click();
    return child;
  };
  const close=async view=>{
    const closed=view.waitForEvent('close');
    await view.getByRole('button',{name:'3D pəncərəni bağla',exact:true}).click();
    await closed;await home.bringToFront();
  };
  const preview='[data-volume-preview] .vr-raster[data-ready="true"]';
  let v=await open();await v.locator(preview).waitFor();
  await home.waitForFunction(()=>window.volumeTest.queued.length>0);
  assert.equal(await v.locator('.vr-tools').evaluate(el=>el.inert),true);
  await close(v);await home.waitForFunction(()=>window.volumeTest.active===0&&window.volumeTest.queued.length===0);
  v=await open();await v.locator(preview).waitFor();
  await home.waitForFunction(()=>window.volumeTest.queued.length>0);
  const cube=()=>v.locator('.vr-orientation svg g').evaluateAll(groups=>Object.fromEntries(groups.map(g=>[
    g.querySelector('text').textContent,g.getAttribute('transform')
  ])));
  await v.locator('.vr-windowing').filter({hasText:/WL .*WW/}).waitFor();
  const stage=await v.locator('.vr-stage').boundingBox();
  const x=stage.x+stage.width*.45,y=stage.y+stage.height*.51;
  await v.mouse.move(x,y);await v.mouse.down();await v.mouse.move(x+84,y+52,{steps:6});await v.mouse.up();
  const oblique=await cube();assert.ok(Object.keys(oblique).length>=2,'calibrated preview responds to rotation');
  await v.locator('.vr-raster canvas').evaluate(c=>{window.previewCanvas=c;});
  await home.evaluate(()=>{const s=window.volumeTest;s.hold=false;for(const [,send] of s.queued.splice(0))send();});
  await v.locator('.radaz-vr:not([data-volume-preview]) .vr-raster[data-ready="true"]').waitFor();
  assert.equal(await v.locator('.vr-tools').evaluate(el=>el.inert),false);
  assert.deepEqual(await cube(),oblique,'camera preserved at full resolution');
  assert.equal(await v.locator('.vr-raster canvas').evaluate(c=>c===window.previewCanvas),true,'same rendering context');
  await close(v);
  const starts=await home.evaluate(()=>window.volumeTest.started);
  v=await open();
  await v.locator('.radaz-vr:not([data-volume-preview]) .vr-raster[data-ready="true"]').waitFor();
  assert.deepEqual(Object.keys(await cube()),['A'],'orientation returns with the fresh popup');
  await v.locator('.vr-windowing').filter({hasText:/WL .*WW/}).waitFor();
  assert.equal(await home.evaluate(()=>window.volumeTest.started),starts,'warm opening reuses full-resolution volume');
  await close(v);
  console.log('PASS 3D close during preparation, safe preview, camera-preserving promotion, worker cleanup and cached reopen');
}
module.exports={verifyDesktopLoading};
