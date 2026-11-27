const assert=require('node:assert/strict');
const {withTablet}=require('../../tests/private-tablet-fixture.cjs');

withTablet(async({p,errors})=>{
  const depth=90;
  await p.locator('input[type=file][accept*="zip"]').first().setInputFiles(process.env.RADAZ_PHANTOM_ZIP);
  await p.waitForFunction(n=>document.querySelector('[data-panel=A] .bottom-right')?.innerText.includes('/ '+n),depth);
  await p.evaluate(()=>{
    const prompt=window.prompt.bind(window);
    window.qaAvailable=2400;
    window.prompt=(key,...args)=>key==='radaz-tablet/volume-memory'
      ?JSON.stringify({availableMiB:window.qaAvailable,totalMiB:4100,reserveMiB:240,heapMiB:256,low:false}):prompt(key,...args);
  });
  const open=()=>p.getByRole('button',{name:'3D həcm görüntüləmə',exact:true}).first().tap();
  const modal=p.locator('dialog');
  const select=modal.getByRole('combobox',{name:'3D kəsiyinin ölçüsü'});
  async function settings(){
    await modal.getByRole('button',{name:'3D görüntüləmə ayarları',exact:true}).tap();
    await select.waitFor();
    return select;
  }
  async function full(n){
    await p.waitForFunction(({n,depth})=>[...document.querySelectorAll('dialog .radaz-vr:not([data-volume-preview])')].some(v=>v.querySelector('.vr-raster[data-ready=true]') && v.innerText.includes(n+' × '+n+' × '+depth)),{n,depth},{timeout:90000});
    // Check every voxel array's true dimensions, independent of the displayed status.
    return modal.locator('.radaz-vr').evaluate(root=>{
      for(let f=root[Object.keys(root).find(k=>k.startsWith('__reactFiber'))];f;f=f.return){
        const v=f.memoizedProps?.volume;
        if(v?.values){
          const w=v.dimensions[0],ratio=512/w,idx=(Math.floor(191/ratio)*w+Math.floor(247/ratio));
          return {size:[...v.dimensions],landmark:v.values[idx]};
        }
      }
      throw Error('missing volume');
    });
  }
  await open();
  await full(256);
  const detail=[];
  for(const n of [64,128,256,512]){
    await settings();
    assert.deepEqual(await select.locator('option').evaluateAll(opts=>opts.map(o=>o.value)),['auto','64','128','256','512']);
    await select.selectOption(String(n));
    const current=await full(n);
    assert.deepEqual(current.size,[n,n,depth]);
    detail.push(current.landmark);
  }
  for(let i=1;i<detail.length;i++)assert.ok(detail[i]>detail[i-1]);
  await p.waitForFunction(()=>{const c=document.querySelector('dialog .vr-raster canvas');return c && Math.max(c.width,c.height)>=512;},{},{timeout:60000});
  await modal.getByRole('button',{name:'3D pəncərəni bağla'}).tap();
  await open();await full(512);
  await modal.getByRole('button',{name:'Proyeksiyada uzunluq',exact:true}).tap();
  const stage=await modal.locator('.vr-stage').boundingBox();
  await p.mouse.move(stage.x+stage.width*.4,stage.y+stage.height*.4);
  await p.mouse.down();
  await p.mouse.move(stage.x+stage.width*.6,stage.y+stage.height*.55,{steps:4});
  await p.mouse.up();
  await settings();await select.selectOption('256');
  await modal.getByRole('status').filter({hasText:'növbəti 3D açılışında'}).waitFor();
  await full(512);
  await modal.getByRole('button',{name:'3D pəncərəni bağla'}).tap();
  await open();await full(256);
  await settings();await select.selectOption('512');await full(512);
  await modal.getByRole('button',{name:'3D pəncərəni bağla'}).tap();
  await p.evaluate(()=>window.qaAvailable=345);
  await open();
  await modal.getByRole('status').filter({hasText:'512 px üçün boş yaddaş çatmır'}).waitFor();
  await select.selectOption('auto');
  await full(192);
  await modal.getByRole('button',{name:'3D pəncərəni bağla'}).tap();
  await p.getByRole('button',{name:'Local arxiv',exact:true}).first().tap();
  await p.locator('.tablet-archive-window').getByRole('button',{name:'Pəncərəni bağla'}).tap();
  assert.deepEqual(errors,[]);
  console.log('PASS: 64,128,256,512,auto; true source detail',detail,'; saved choice, memory refusal, full idle raster, archive return');
}).catch(e=>{console.error(e);process.exitCode=1;});
