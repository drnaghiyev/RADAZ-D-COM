const assert=require('node:assert/strict');
const {withTablet,anchor,pixel,frame}=require('./private-tablet-fixture.cjs');
withTablet(async({ctx,p,pane,errors})=>{
 const cdp=await ctx.newCDPSession(p);const metrics=[];
 for(let i=0;i<4;i++){await p.getByRole('button',{name:'3D həcm görüntüləmə',exact:true}).first().tap();
 await p.locator('.vr-raster[data-ready=true]').waitFor();
 if(i===0){
 const k=p.locator('.radaz-vr [data-direct-item]:visible:not(:disabled)'),first=k.nth(0),last=k.nth(3);
 await last.waitFor();const label=await first.getAttribute('data-direct-item'),a=await first.boundingBox(),b=await last.boundingBox();
 const touch=(type,touchPoints)=>cdp.send('Input.dispatchTouchEvent',{type,touchPoints});
 await touch('touchStart',[{x:a.x+a.width*.5,y:a.y+a.height*.5,id:1}]);await p.waitForTimeout(550);
 await touch('touchMove',[{x:b.x+b.width*.8,y:b.y+b.height*.5,id:1}]);await touch('touchEnd',[]);
 await p.waitForFunction(id=>JSON.parse(localStorage.getItem('radaz:toolbar-dividers:vr:order')||'[]').indexOf(id)>0,label);
 console.log('PASS long press in the 3D toolbar');}
 await p.evaluate(()=>dispatchEvent(new Event('radaz:close-volume')));await p.locator('.radaz-vr').waitFor({state:'detached'});
 await pane.locator('.bottom-right').filter({hasText:'/ 24'}).waitFor();await frame(p);assert.ok((await pixel(p)).error<3);
 await cdp.send('HeapProfiler.collectGarbage');const dom=await cdp.send('Memory.getDOMCounters'),heap=await cdp.send('Runtime.getHeapUsage');
 metrics.push({listeners:dom.jsEventListeners,canvas:await pane.locator('canvas').count(),mb:Math.round(heap.usedSize/1048576)});}
 console.log('Four return cycles:',metrics);assert.ok(metrics.every(m=>m.canvas===metrics[0].canvas));
 assert.ok(metrics[3].listeners-metrics[1].listeners<30);assert.ok(metrics[3].mb-metrics[1].mb<12);
 assert.deepEqual(errors,[]);
}).catch(e=>{console.error(e);process.exitCode=1});
