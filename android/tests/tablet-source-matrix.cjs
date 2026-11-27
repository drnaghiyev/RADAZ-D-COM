const assert = require('node:assert/strict');
const {withTablet} = require('../../tests/private-tablet-fixture.cjs');

withTablet(async ({p,errors})=>{
  const depth=Number(process.env.RADAZ_PHANTOM_DEPTH||463);
  await p.locator('input[type=file][accept*="zip"]').first().setInputFiles(process.env.RADAZ_PHANTOM_ZIP);
  await p.waitForFunction(n=>document.querySelector('[data-panel=A] .bottom-right')?.innerText.includes('/ '+n),depth,{timeout:180000});
  const before=Date.now();
  await p.getByRole('button',{name:'3D həcm görüntüləmə',exact:true}).first().click();
  const volume=p.locator('dialog .radaz-vr');
  await volume.locator('.vr-raster[data-ready=true]').waitFor({timeout:180000});
  const sample=await volume.evaluate((root)=>{
    for(let f=root[Object.keys(root).find(k=>k.startsWith('__reactFiber'))];f;f=f.return){
      const v=f.memoizedProps?.volume;if(!v?.values)continue;
      const [w,h,d]=v.dimensions,out=[];
      for(let z=0;z<d;z++){
        const off=z*w*h, at=off+191*w+247;
        out.push([v.values[at-1],v.values[at],v.values[at+1],v.values[at+2],v.values[off],v.values[off+w*h-1]]);
      }
      return {dims:v.dimensions,spacing:v.spacing,bytes:v.values.byteLength,format:v.values.constructor.name,out,backend:root.dataset.backend};
    }
    throw Error('missing active rendered volume');
  });
  assert.deepEqual(sample.dims,[512,512,depth]);
  assert.equal(sample.format,'Int16Array');
  assert.equal(sample.bytes,512*512*depth*2);
  for(let z=0;z<depth;z++)assert.deepEqual(sample.out[z],[650,1100+z,-200-z,650,-1024,-1024],'slice '+z);
  assert.deepEqual(sample.spacing,[.7,.8,1.25]);
  console.log(JSON.stringify({dims:sample.dims,bytes:sample.bytes,backend:sample.backend,readyMs:Date.now()-before,planesVerified:depth,first:sample.out[0],middle:sample.out[depth>>1],last:sample.out.at(-1)}));
  await volume.locator('.vr-close').click();
  await volume.waitFor({state:'detached'});
  const opening=p.waitForEvent('popup');
  await p.getByRole('button',{name:'Local arxiv',exact:true}).first().click();
  const records=await opening;await records.locator('.archive-shell').waitFor();
  await records.locator('.records-search input').fill('TEST512');
  await records.close();
  assert.deepEqual(errors,[]);
}).catch(error=>{console.error(error);process.exitCode=1;});

