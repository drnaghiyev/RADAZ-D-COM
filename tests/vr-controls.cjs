const assert=require('node:assert/strict');

async function verifyVrControls({home,view,vr,stage,tablet,context}){
  const button=name=>vr.getByRole('button',{name,exact:true});
  if(!tablet)await view.locator('.radaz-vr:not([data-volume-preview]) .vr-raster[data-ready="true"]').waitFor();
  const cube=vr.locator('.vr-orientation svg');
  const faceData=()=>cube.locator('g').evaluateAll(groups=>Object.fromEntries(groups.map(g=>{
    const text=g.querySelector('text'),{a,b,c,d}=g.transform.baseVal.getItem(0).matrix;
    return [text.textContent,{a,b,c,d,fill:getComputedStyle(text).fill}];
  })));
  await view.keyboard.press('1');
  await cube.getByText('A',{exact:true}).waitFor();
  const front=(await faceData()).A;
  assert.ok(front.a>.99 && front.d>.99,'anterior face text is upright');
  const bounds=await stage.boundingBox(),x=bounds.x+bounds.width/2,y=bounds.y+bounds.height/2;
  const cdp=tablet?await context.newCDPSession(view):null;
  for(const [sign,wantSide,wantTop] of [[1,'R','S'],[-1,'L','I']]){
    await view.keyboard.press('1');
    if(cdp){
      for(const [type,points] of [['touchStart',[{id:1,x,y}]],['touchMove',[{id:1,x:x+sign*55,y:y+sign*40}]],['touchEnd',[]]]){
        await cdp.send('Input.dispatchTouchEvent',{type,touchPoints:points});
      }
    }else{
      await view.mouse.move(x,y);await view.mouse.down();
      await view.mouse.move(x+sign*55,y+sign*40,{steps:6});await view.mouse.up();
    }
    await Promise.all([wantSide,wantTop].map(label=>cube.getByText(label,{exact:true}).waitFor()));
    const faces=await faceData();
    for(const face of [wantSide,wantTop]){
      const {a,b,c,d}=faces[face],area=a*d-b*c;
      assert.ok(area>0 && area<.9,'oblique letter is foreshortened on '+face);
    }
    assert.equal(new Set([faces.A.fill,faces[wantSide].fill,faces[wantTop].fill]).size,1,'all letters use white ink');
  }
  if(!tablet){
    await vr.locator('.vr-raster[data-ready="true"]').waitFor();
    const toggle=button('Yazılar və istiqamət kubu · F12'),hud=vr.locator('.vr-orientation');
    const regions=await Promise.all([cube,hud.locator('.vr-windowing')].map(el=>el.boundingBox()));
    const pixels=()=>Promise.all(regions.map(clip=>view.screenshot({clip})));
    const visible=await pixels();
    await toggle.click();await hud.waitFor({state:'detached'});
    const hidden=await pixels();
    for(let i=0;i<regions.length;i++)assert.notDeepEqual(visible[i],hidden[i],'overlay is visible in the composed 3D window');
    await toggle.click();await hud.waitFor();
    console.log('PASS composed cube and window labels, visibility toggle and mouse orbit');return;
  }
  const open=home.getByRole('button',{name:'3D həcm görüntüləmə',exact:true}).first();
  const timings=[];
  for(let cycle=0;cycle<4;cycle++){
    await vr.locator('.vr-raster[data-ready="true"]').waitFor();
    await home.evaluate(()=>{window.vrOldGL=document.querySelector('.vr-raster canvas').getContext('webgl2');});
    const lost=process.env.VR_TABLET_RETURN_TEST && await require('./vr-tablet-return.cjs').discardCoveredCanvas(home,cycle===2);
    const denied=process.env.VR_TABLET_GPU_DENIAL && cycle===3;
    if(denied)await home.evaluate(()=>{window.testDeniedContexts=0;window.testDenyNewGL=true;});
    const start=Date.now();
    if(cycle%2===0)await button('3D pəncərəni bağla').tap();
    else await home.evaluate(()=>window.dispatchEvent(new Event('radaz:close-volume')));
    await vr.waitFor({state:'detached',timeout:5000});
    assert.equal(await home.locator('main.workstation').evaluate(e=>e.inert),false);
    await home.waitForFunction(()=>!window.vrOldGL||window.vrOldGL.isContextLost());
    if(process.env.VR_TABLET_RETURN_TEST)await require('./vr-tablet-return.cjs').checkTabletReturn(home,lost||denied,denied);
    if(denied){
      await home.evaluate(()=>{window.testDenyNewGL=false;});
      console.log('PASS incoming 2D stack denial of all WebGL contexts: software rendering, windowing and slice navigation');
    }
    const closed=Date.now()-start,next=Date.now();
    if(process.env.VR_TABLET_RETURN_TEST && cycle===1){
      await home.getByRole('button',{name:'3D açılış seçimləri',exact:true}).first().tap();
      await home.getByRole('menuitem',{name:'Əsas viewer-də aç',exact:true}).tap();
    }else await open.tap();
    await vr.locator('.vr-raster[data-ready="true"]').waitFor();
    timings.push({closed,reopened:Date.now()-next});
  }
  await cdp.detach();
  console.log('PASS touch orbit, cube face text, native Back, close, GL disposal and repeated opening',JSON.stringify(timings));
}
module.exports={verifyVrControls};
