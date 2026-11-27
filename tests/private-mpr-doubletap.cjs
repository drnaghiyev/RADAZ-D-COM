const assert=require('node:assert/strict');
const {withTablet,anchor,pixel,frame}=require('./private-tablet-fixture.cjs');
withTablet(async({ctx,p,pane,errors})=>{
 const [mpr]=await Promise.all([ctx.waitForEvent('page'),p.getByRole('button',{name:'MPR rekonstruksiya',exact:true}).first().tap()]);
 await mpr.waitForFunction(()=>document.querySelectorAll('[data-has-image=true]').length>=3 && !document.querySelector('.viewport-loading'),null,{timeout:60000});
 await mpr.keyboard.press('s');const panes=mpr.locator('[data-panel]');
 const ids=await panes.evaluateAll(rows=>rows.map(r=>r.dataset.panel));
 await mpr.evaluate(()=>window.testMprNodes=Array.from(document.querySelectorAll('[data-panel]')));
 for(const id of ids){const v=mpr.locator('[data-panel="'+id+'"]'),before=await v.locator('.localizer-overlay').getAttribute('data-world');
 async function twice(){const r=await v.boundingBox();for(let i=0;i<2;i++){await mpr.touchscreen.tap(r.x+r.width*.27,r.y+r.height*.72);await mpr.waitForTimeout(50);}}
 await twice();await mpr.waitForFunction(k=>document.querySelector('[data-panel="'+k+'"]').dataset.expanded==='true',id);
 await twice();await mpr.waitForFunction(()=>!document.querySelector('[data-expanded=true]'));
 assert.equal(await v.locator('.localizer-overlay').getAttribute('data-world'),before);assert.ok(await mpr.evaluate(()=>testMprNodes.every(n=>n.isConnected)));console.log('PASS MPR double tap and preserved intersection',id);}
 assert.deepEqual(errors,[]);
}).catch(e=>{console.error(e);process.exitCode=1});
