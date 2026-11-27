const assert=require('node:assert/strict');

async function observeTabletCanvas(context){
  await context.addInitScript(()=>{
    const getContext=HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext=function(type,...args){
      if(window.testDenyNewGL && ['webgl','webgl2','experimental-webgl'].includes(type)){
        window.testDeniedContexts++;
        return null;
      }
      return getContext.call(this,type,...args);
    };
    const draw=CanvasRenderingContext2D.prototype.drawImage;
    CanvasRenderingContext2D.prototype.drawImage=function(source,...args){
      const result=draw.call(this,source,...args);
      if(this.canvas.closest('[data-panel="A"] .dicom-canvas') && source instanceof HTMLCanvasElement && source.getContext('webgl2')){
        window.testStackOffscreen=source;
        window.testLastStackCanvas=this.canvas;
      }
      return result;
    };
    window.testStackHash=()=>{
      const canvas=document.querySelector('[data-panel="A"] .dicom-canvas canvas');
      if(!canvas)return null;
      const data=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;
      let hash=2166136261,lit=0;
      for(let p=0;p<data.length;p+=148){hash=Math.imul(hash^data[p],16777619);if(data[p]>20)lit++;}
      return {hash,lit};
    };
  });
}

async function rememberTabletFrame(home){
  await home.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  await home.evaluate(()=>{
    window.testOriginalFrame={...window.testStackHash(),
      slice:document.querySelector('[data-panel="A"] .bottom-right').innerText,
      windowing:document.querySelector('[data-panel="A"] .bottom-left').innerText};
  });
  assert.ok(await home.evaluate(()=>window.testOriginalFrame.lit>100),'a real 2D image is visible before opening');
}

async function discardCoveredCanvas(home,loseContext){
  return home.evaluate(lose=>{
    const canvas=window.testLastStackCanvas,gl=window.testStackOffscreen?.getContext('webgl2');
    if(!canvas?.isConnected)throw Error('3D detached the active 2D stack.');
    if(!gl)throw Error('Missing the independent stack WebGL context');
    if(lose)canvas.getContext('2d').clearRect(0,0,canvas.width,canvas.height);
    window.testForcedLoss=lose;
    window.testOldStackGpu=gl;window.testOldStackCanvas=canvas;
    if(lose && !gl.isContextLost())gl.getExtension('WEBGL_lose_context').loseContext();
    return lose;
  },loseContext);
}

async function checkTabletReturn(home,checkScroll,denied=false){
  if(denied){
    await home.waitForFunction(()=>window.testDeniedContexts>0 && window.testStackHash()?.lit>100,{}, {timeout:12000});
    assert.equal(await home.locator('[data-panel="A"] .pane-error').count(),0);
  }else{
    await home.waitForFunction(()=>window.testStackHash()?.hash===window.testOriginalFrame.hash,{}, {timeout:12000});
    assert.ok(await home.evaluate(()=>{
      const gl=window.testStackOffscreen?.getContext('webgl2');
      return gl && !gl.isContextLost() && (window.testForcedLoss?gl!==window.testOldStackGpu:gl===window.testOldStackGpu) && (window.testForcedLoss?window.testOldStackCanvas!==window.testLastStackCanvas:window.testOldStackCanvas===window.testLastStackCanvas);
    }),'retains the visible stack normally and recreates it only after genuine GPU loss');
  }
  const panel=home.locator('[data-panel="A"]');
  const expected=await home.evaluate(()=>window.testOriginalFrame);
  assert.equal(await panel.locator('.bottom-right').innerText(),expected.slice);
  assert.equal(await panel.locator('.bottom-left').innerText(),expected.windowing);
  if(checkScroll){
    const restoredHash=await home.evaluate(()=>window.testStackHash().hash);
    await panel.hover();await home.mouse.wheel(0,120);
    await home.waitForFunction(original=>document.querySelector('[data-panel="A"] .bottom-right').innerText!==original,expected.slice);
    await home.waitForFunction(()=>window.testStackHash()?.lit>100);
    await home.mouse.wheel(0,-120);
    await home.waitForFunction(hash=>document.querySelector('[data-panel="A"] .bottom-right').innerText===window.testOriginalFrame.slice && window.testStackHash()?.hash===hash,restoredHash, {timeout:12000});
  }
}
module.exports={observeTabletCanvas,rememberTabletFrame,discardCoveredCanvas,checkTabletReturn};
