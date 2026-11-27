const assert=require('node:assert/strict');
const {withTablet,frame}=require('./private-tablet-fixture.cjs');
const {contact}=require('./navigation-measurement.cjs');

withTablet(async({p,ctx,pane,errors})=>{
  await p.keyboard.press('2');await frame(p);
  const cdp=await ctx.newCDPSession(p);
  const touch=(type,values)=>cdp.send('Input.dispatchTouchEvent',{type,touchPoints:values});
  const handle=i=>pane.locator('line[data-id$="-endpoint-'+i+'"]').first();
  const endpoint=async i=>handle(i).evaluate(l=>{
    const pt=l.ownerSVGElement.createSVGPoint();
    pt.x=(l.x1.baseVal.value+l.x2.baseVal.value)/2;pt.y=(l.y1.baseVal.value+l.y2.baseVal.value)/2;
    const v=pt.matrixTransform(l.getScreenCTM());return {x:v.x,y:v.y};
  });
  async function state(){
    const a=await endpoint(0),b=await endpoint(1);
    return {a,b,body:{x:(a.x+b.x)/2,y:(a.y+b.y)/2},pixels:await p.evaluate(()=>window.testStackHash().hash),slice:await pane.locator('.bottom-right').innerText(),windowing:await pane.locator('.bottom-left').innerText()};
  }
  const menu=p.getByRole('menuitem',{name:'Sil',exact:true});
  async function layout(){
    assert.equal(await p.locator('[data-panel]:visible').count(),2);
    assert.equal(await p.locator('[data-expanded=true]').count(),0);
  }
  async function hold(pt){
    await touch('touchStart',[{...pt,id:1}]);await menu.waitFor({timeout:1800});
    await touch('touchEnd',[]);await menu.waitFor();
  }
  async function dismiss(){
    await p.touchscreen.tap(6,6);await menu.waitFor({state:'hidden'});await layout();
  }
  const box=await pane.locator('.dicom-canvas').boundingBox();
  const a={x:box.x+box.width*.28,y:box.y+box.height*.53},b={x:box.x+box.width*.62,y:box.y+box.height*.53};
  await p.keyboard.press('l');await frame(p);
  await contact(p,cdp,'touch',a,b);await handle(0).waitFor();
  for(const key of ['z','s']){
    await p.keyboard.press(key);await frame(p);
    assert.equal(await p.locator('button.view-tool[title$=" · '+key.toUpperCase()+'"]').first().getAttribute('aria-pressed'),'true');
    const before=await state(),body=before.body;
    // Finger lands next to the line inside the measurement hit area.
    await p.touchscreen.tap(body.x,body.y+3);await frame(p);
    await layout();assert.equal(await menu.count(),0);assert.deepEqual(await state(),before,'single tap changed the mark or image');
    await hold(body);await layout();assert.deepEqual(await state(),before,'long press changed line, window or slice');
    await dismiss();assert.deepEqual(await state(),before);
    console.log('PASS '+key+' navigation: single tap near mark and stationary long press preserve layout, endpoints, camera pixels, slice and window');
  }
  const before=await state();
  const x=before.body.x,y=before.body.y;
  await touch('touchStart',[{id:1,x,y}]);
  await touch('touchStart',[{id:1,x,y},{id:2,x:x+65,y}]);
  await touch('touchMove',[{id:1,x:x-20,y:y+6},{id:2,x:x+90,y:y+6}]);
  await p.waitForTimeout(700);assert.equal(await menu.count(),0,'pinch fired pending long press');
  await touch('touchEnd',[]);await frame(p);await layout();
  const zoomed=await state();assert.notEqual(before.pixels,zoomed.pixels,'pinch zoomed the actual image');assert.equal(zoomed.slice,before.slice);
  await hold(zoomed.body);await menu.tap();await handle(0).waitFor({state:'hidden'});await layout();
  assert.equal(await pane.locator('.bottom-right').innerText(),before.slice);assert.equal(await p.evaluate(()=>window.testStackHash().hash),zoomed.pixels);
  console.log('PASS pinch interrupted pending measurement hold, transformed image and mark together; touch hold and deletion retained the two-pane layout');
  assert.deepEqual(errors,[]);
}).catch(e=>{console.error(e);process.exitCode=1;});
