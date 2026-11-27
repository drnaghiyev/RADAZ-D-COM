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
    const opened=p.waitForEvent('popup'),start=Date.now();
    await p.getByRole('button',{name:'3D həcm görüntüləmə',exact:true}).first().click();
    const child=await opened;child.on('pageerror',e=>rootErrors.push(e.message));
    const close=child.getByRole('button',{name:'3D pəncərəni bağla',exact:true});
    await close.waitFor();
    if(i!==2)await child.locator('.vr-raster[data-ready=true]').waitFor();
    assert.equal(await child.locator('[data-panel]').count(),0,'volume has no 2D stacks');
    const ready=Date.now(),closed=child.waitForEvent('close');
    if(i===4)await child.evaluate(()=>{window.dispatchEvent(new Event('radaz:request-child-close',{cancelable:true}));}).catch(e=>{if(!child.isClosed())throw e;});
    else await close.click().catch(e=>{if(!child.isClosed())throw e;});
    await closed;await p.bringToFront();
    await p.waitForFunction(()=>window.radazDetachedSources?.size===0);
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
