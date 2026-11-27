const assert=require('node:assert/strict');
const {withTablet,frame,anchor}=require('./private-tablet-fixture.cjs');

withTablet(async({ctx,p,pane,errors})=>{
  const dev=await ctx.newCDPSession(p);
  const rootErrors=errors;
  const baseline=await anchor(p,'before repeated windows');
  await p.evaluate(()=>{window.referenceCanvas=document.querySelector('[data-panel=A] .dicom-canvas canvas');});
  const counts=async()=>{
    await dev.send('HeapProfiler.collectGarbage');
    const [heap,dom]=await Promise.all([dev.send('Runtime.getHeapUsage'),dev.send('Memory.getDOMCounters')]);
    const active=await p.evaluate(()=>({sources:window.radazDetachedSources?.size||0,panes:document.querySelectorAll('[data-panel]').length,
      canvas:document.querySelector('[data-panel=A] .dicom-canvas canvas')===window.referenceCanvas}));
    assert.equal(active.sources,0,'released opener handoff');
    assert.ok(active.canvas,'same main image canvas');
    assert.equal(active.panes,1);
    return {heap:heap.usedSize,nodes:dom.nodes,listeners:dom.jsEventListeners,documents:dom.documents};
  };
  const samples=[];
  for(let i=0;i<6;i++){
    const start=Date.now();
    let token;
    const bridge=async dialog=>{
      if(dialog.message()==='radaz-tablet/volume-opened')token=dialog.defaultValue();
      await dialog.accept('ok');
    };
    p.on('dialog',bridge);
    await p.getByRole('button',{name:'3D həcm görüntüləmə',exact:true}).first().click();
    const volume=p.locator('dialog.tablet-volume-dialog:modal');
    const close=volume.getByRole('button',{name:'3D pəncərəni bağla',exact:true});
    await close.waitFor();
    if(i!==2)await volume.locator('.vr-raster[data-ready=true]').waitFor();
    assert.equal(ctx.pages().length,1,'no Android popup or second WebView is needed');
    const ready=Date.now();
    if(i===4)await p.evaluate(token=>dispatchEvent(new CustomEvent('radaz:volume-back',{detail:token,cancelable:true})),token);
    else await close.click();
    await volume.waitFor({state:'detached'});
    p.off('dialog',bridge);
    await frame(p);
    assert.equal(ctx.pages().length,1,'only main page survives');
    assert.equal(await pane.locator('.pane-error').count(),0);
    const landmark=await anchor(p,'return '+(i+1));
    assert.deepEqual(landmark.expected,baseline.expected);
    const sample=await counts();samples.push(sample);
    console.log(JSON.stringify({open:i+1,readyMs:ready-start,returnMs:Date.now()-ready,...sample}));
  }
  const warm=samples[1],last=samples.at(-1);
  assert.ok(last.heap<warm.heap+12*1024*1024,'unexpected sustained main-heap growth');
  assert.ok(last.listeners<=warm.listeners+30,'main event listeners accumulated');
  assert.ok(last.nodes<=warm.nodes+180,'main DOM nodes accumulated');
  assert.deepEqual(rootErrors,[]);
  console.log('PASS six 3D transitions including early close and native Back, stable image, handoffs, canvases, listeners and heap.');
}).catch(e=>{console.error(e);process.exitCode=1;});
