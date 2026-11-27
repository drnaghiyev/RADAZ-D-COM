const assert = require('node:assert/strict');
const {withTablet} = require('../../tests/private-tablet-fixture.cjs');

withTablet(async ({p,errors})=>{
  const depth=Number(process.env.RADAZ_PHANTOM_DEPTH||463);
  await p.locator('input[type=file][accept*="zip"]').first().setInputFiles(process.env.RADAZ_PHANTOM_ZIP);
  await p.waitForFunction(n=>document.querySelector('[data-panel=A] .bottom-right')?.innerText.includes('/ '+n),depth,{timeout:180000});
  const profile=process.env.RADAZ_TEST_QUALITY||'medium';
  const expected={low:128,medium:256,high:512,restart:128,allocation:128,upload:128,stall:128,compact:128,pressure:128,late:256,compressed:256,closing:256,unreadable:256}[profile];
  assert.ok(expected);
  await p.evaluate(({profile,depth})=>{
    const memory={
      low:{totalMiB:2800,availableMiB:950,heapMiB:128,reserveMiB:240,low:true},
      compact:{totalMiB:4100,availableMiB:1900,heapMiB:256,reserveMiB:250,low:false},
      medium:{totalMiB:5100,availableMiB:1900,heapMiB:256,reserveMiB:250,low:false},
      high:{totalMiB:12288,availableMiB:6500,heapMiB:512,reserveMiB:300,low:false}
    };
    if(profile==='restart')localStorage.setItem('radaz.tablet.vr.opening',JSON.stringify({matrix:256,time:Date.now()}));
    const prompt=window.prompt.bind(window);
    window.qaRequests=0;window.qaEncoded=0;
    const post=MessagePort.prototype.postMessage;
    MessagePort.prototype.postMessage=function(msg,...args){
      if(msg?.frame?.pixels && msg.width){
        window.qaRequests++;
        if(msg.frame.encoding?.compressed)window.qaEncoded++;
        if(profile==='unreadable' && window.qaRequests>=Math.round(depth*.967)){window.qaDropped=true;return;}
        if(['late','closing'].includes(profile) && window.qaRequests===Math.round(depth*.967)){window.qaDropped=true;return;}
      }
      return post.call(this,msg,...args);
    };
    window.prompt=(key,...args)=>{
      if(key!=='radaz-tablet/volume-memory')return prompt(key,...args);
      if(profile==='pressure' && window.qaRequests>=Math.floor(depth*.8)){
        window.qaLowered=true;
        return JSON.stringify({...memory.medium,availableMiB:430,low:true});
      }
      return JSON.stringify(memory[profile]||memory.medium);
    };
    if(profile==='high'){
      const original=WebGL2RenderingContext.prototype.getParameter;
      WebGL2RenderingContext.prototype.getParameter=function(k){return k===37446?'Adreno (TM) 750':original.call(this,k);};
      Object.defineProperty(navigator,'deviceMemory',{configurable:true,value:8});
    }
    if(profile==='allocation'){
      window.Float32Array=new Proxy(Float32Array,{construct(target,args,...rest){
        if(args[0]===256*256*depth){window.qaFailed=true;throw new RangeError('Synthetic allocation failed');}
        return Reflect.construct(target,args,...rest);
      }});
    }
    if(profile==='stall'){
      const raf=window.requestAnimationFrame.bind(window);
      window.requestAnimationFrame=cb=>{
        if(document.querySelector('.vr-raster') && JSON.parse(localStorage.getItem('radaz.tablet.vr.opening'))?.matrix===256){
          window.qaFailed=true;return raf(()=>{});
        }
        return raf(cb);
      };
    }
    if(profile==='upload'){
      const get=HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext=function(kind,...args){
        if(kind==='webgl2' && document.querySelector('.vr-raster') && !window.qaFailed){window.qaFailed=true;throw Error('Synthetic GPU allocation failed');}
        return get.call(this,kind,...args);
      };
    }
  },{profile,depth});
  const before=Date.now();
  await p.getByRole('button',{name:'3D həcm görüntüləmə',exact:true}).first().click();
  if(depth>48){
    const preview=p.locator('dialog .radaz-vr[data-volume-preview=true]');
    await preview.locator('.vr-raster[data-ready=true]').waitFor({timeout:90000});
    assert.ok(await p.locator('.tablet-volume-count').innerText());
    if(profile==='unreadable'){
      const alert=p.locator('dialog .shared-volume-loading [role=status]');
      await alert.filter({hasText:/3D kəsiyi [0-9]+\/[0-9]+ oxunmadı/}).waitFor({timeout:100000});
      assert.equal(await p.locator('dialog .radaz-vr:not([data-volume-preview])').count(),0);
      assert.equal(await p.evaluate(()=>window.qaRequests),Math.round(depth*.967)+1);
      await p.getByRole('button',{name:'3D pəncərəni bağla',exact:true}).click();
      assert.deepEqual(errors,[]);console.log('PASS unreadable late slice identified, no incomplete volume presented as final');return;
    }
    if(profile==='late'||profile==='closing'){
      await p.waitForFunction(()=>window.qaDropped,{},{timeout:90000});
      const before=await p.evaluate(()=>window.qaRequests);
      assert.equal(before,Math.round(depth*.967));
      const close=preview.getByRole('button',{name:'3D pəncərəni bağla',exact:true});
      if(profile==='closing'){
        await close.tap();await p.locator('dialog.tablet-volume-dialog').waitFor({state:'detached'});
        await p.getByRole('button',{name:'Local arxiv',exact:true}).first().tap();
        await p.locator('.tablet-archive-window').getByRole('button',{name:'Pəncərəni bağla'}).tap();
        assert.deepEqual(errors,[]);console.log('PASS closed during late read and archive reopened');return;
      }
      assert.ok(await close.isEnabled());
      await p.waitForFunction(()=>window.qaRequests>1+Math.round(Number(document.querySelector('.radaz-vr')?.dataset.sourceSlices)*.967),{},{timeout:35000});
    }
  }
  const volume=p.locator('dialog .radaz-vr:not([data-volume-preview])');
  await volume.locator('.vr-raster[data-ready=true]').waitFor({timeout:180000});
  const sample=await volume.evaluate((root)=>{
    for(let f=root[Object.keys(root).find(k=>k.startsWith('__reactFiber'))];f;f=f.return){
      const v=f.memoizedProps?.volume;if(!v?.values)continue;
      const [w,h,d]=v.dimensions,out=[];
      for(let z=0;z<d;z++){
        const ratio=512/w,off=z*w*h, at=off+Math.floor(191/ratio)*w+Math.floor(247/ratio);
        out.push([v.values[at-1],v.values[at],v.values[at+1],v.values[at+2],v.values[off],v.values[off+w*h-1]]);
      }
      return {dims:v.dimensions,spacing:v.spacing,bytes:v.values.byteLength,format:v.values.constructor.name,out,backend:root.dataset.backend};
    }
    throw Error('missing active rendered volume');
  });
  assert.deepEqual(sample.dims,[expected,expected,depth]);
  const native=expected===512, ratio=512/expected;
  assert.equal(await p.evaluate(()=>localStorage.getItem('radaz.tablet.vr.opening')),null,'first rendered frame clears startup marker');
  assert.equal(sample.format,native?'Int16Array':'Float32Array');
  assert.equal(sample.bytes,expected**2*depth*(native?2:4));
  for(let z=0;z<depth;z++){
    const area=ratio**2, average=value=>650+(value-650)/area;
    assert.deepEqual(sample.out[z],[650,average(1100+z),average(-200-z),650,-1024,-1024],'slice '+z);
  }
  if(['allocation','upload','stall'].includes(profile))assert.ok(await p.evaluate(()=>window.qaFailed),'failure was injected');
  const counts=await p.evaluate(()=>({requests:window.qaRequests,encoded:window.qaEncoded,lowered:window.qaLowered}));
  if(profile==='late')assert.equal(counts.requests,depth+1,'only the stalled plane was retried');
  if(profile==='pressure'){assert.ok(counts.lowered);assert.equal(counts.requests,depth,'no reread on memory pressure');}
  if(profile==='compressed')assert.ok(counts.encoded>0,'encapsulated frames decoded in the worker');
  assert.deepEqual(sample.spacing,[.7*ratio,.8*ratio,1.25]);
  console.log(JSON.stringify({profile,counts,dims:sample.dims,bytes:sample.bytes,backend:sample.backend,readyMs:Date.now()-before,planesVerified:depth,first:sample.out[0],middle:sample.out[depth>>1],last:sample.out.at(-1)}));
  await volume.locator('.vr-close').click();
  await volume.waitFor({state:'detached'});
  await p.getByRole('button',{name:'Local arxiv',exact:true}).first().click();
  const records=p.locator('.tablet-archive-window');await records.waitFor();
  await records.locator('.records-search input').fill('TEST512');
  await records.getByRole('button',{name:'Pəncərəni bağla',exact:true}).click();
  assert.deepEqual(errors,[]);
}).catch(error=>{console.error(error);process.exitCode=1;});

