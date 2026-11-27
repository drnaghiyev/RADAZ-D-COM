const assert=require('node:assert/strict');
const {withTablet,frame}=require('../../tests/private-tablet-fixture.cjs');

withTablet(async({ctx,p,errors})=>{
  const popup=p.waitForEvent('popup');await p.getByRole('button',{name:'Smart Volume',exact:true}).tap();
  const smart=await popup;smart.on('pageerror',e=>errors.push(e.message));
  const work=smart.locator('.sv-workspace');await work.getByRole('button',{name:'Brush',exact:true}).waitFor();
  const axial=work.locator('[data-axis="2"]'), title=axial.locator('.sv-plane-title small');
  await smart.waitForFunction(()=>document.querySelector('.sv-plane[data-axis="2"] .sv-plane-title small')?.innerText.endsWith('/ 24'));
  const cdp=await ctx.newCDPSession(smart);
  const send=(type,points)=>cdp.send('Input.dispatchTouchEvent',{type,touchPoints:points.map(([x,y],id)=>({x,y,id:id+1}))});
  const state=()=>axial.evaluate(el=>{
    for(let f=el[Object.keys(el).find(k=>k.startsWith('__reactFiber'))];f;f=f.return){
      for(let h=f.memoizedState;h;h=h.next){
        const s=h.memoizedState?.current;
        if(s?.engine?.getViewport&&s?.views&&s?.mask){
          const vp=s.engine.getViewport(s.views[2]);
          return {camera:vp.getCamera(),volume:s.mask.reduce((n,v)=>n+Number(v!==0),0),slice:el.querySelector('small').innerText};
        }
      }
    }
    throw Error('missing Smart Volume session');
  });
  const box=await axial.boundingBox(),x=box.x+box.width*.52,y=box.y+box.height*.49;
  await work.getByRole('button',{name:'Listələ',exact:true}).tap();
  const initial=await state();
  await send('touchStart',[[x,y-35]]);await send('touchMove',[[x,y+7]]);await send('touchEnd',[]);
  await frame(smart);
  const scrolled=await state();assert.equal(parseInt(scrolled.slice),parseInt(initial.slice)+3);assert.equal(scrolled.camera.parallelScale,initial.camera.parallelScale);
  async function pinch(shift=0){
    await send('touchStart',[[x-26,y],[x+26,y]]);await send('touchMove',[[x-44+shift,y+14],[x+44+shift,y+14]]);
    await send('touchEnd',[]);await frame(smart);
  }
  await pinch(20);
  const zoomed=await state();
  assert.ok(Math.abs(zoomed.camera.parallelScale/scrolled.camera.parallelScale-52/88)<.02);assert.notDeepEqual(zoomed.camera.focalPoint,scrolled.camera.focalPoint);
  assert.equal(zoomed.slice,scrolled.slice);
  await send('touchStart',[[x-30,y],[x+30,y]]);await send('touchMove',[[x-19,y+22],[x+41,y+22]]);
  await send('touchEnd',[]);await frame(smart);
  const panned=await state();assert.equal(panned.camera.parallelScale,zoomed.camera.parallelScale);assert.notDeepEqual(panned.camera.focalPoint,zoomed.camera.focalPoint);
  await work.getByRole('button',{name:'Brush',exact:true}).tap();
  await pinch();assert.equal((await state()).volume,0,'pinch must not stamp an empty mask');
  await send('touchStart',[[x,y]]);await send('touchEnd',[]);await frame(smart);
  assert.ok((await state()).volume>0,'single-finger brush remains usable');
  await work.getByRole('button',{name:'Listələ',exact:true}).tap();
  const prior=await title.innerText();
  await send('touchStart',[[x,y]]);await send('touchCancel',[]);
  assert.equal(await title.innerText(),prior);
  assert.deepEqual(errors,[]);
  console.log('PASS single-finger slice scroll, anchored pinch and two-finger pan, unchanged slice, brush tap and pinch ownership, pointer cancellation');
}).catch(e=>{console.error(e);process.exitCode=1;});
