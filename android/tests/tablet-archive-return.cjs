const assert=require('node:assert/strict');
const {withTablet,anchor}=require('../../tests/private-tablet-fixture.cjs');
withTablet(async({ctx,p,errors})=>{
  const legacy=process.env.RADAZ_COMPARE_OLD==='1';
  await p.evaluate(()=>new Promise((resolve,reject)=>{
    const open=indexedDB.open('radaz-local-archive',1);
    open.onupgradeneeded=()=>{const db=open.result;db.createObjectStore('studies',{keyPath:'uid'});db.createObjectStore('instances',{keyPath:'id'}).createIndex('studyUID','studyUID');};
    open.onsuccess=()=>{
      const db=open.result,tx=db.transaction('studies','readwrite'),now=new Date(),date=[now.getFullYear(),String(now.getMonth()+1).padStart(2,'0'),String(now.getDate()).padStart(2,'0')].join('');
      for(let i=0;i<1200;i++)tx.objectStore('studies').put({uid:'2.25.71.'+i,date,time:'120000',patient:'QA study '+i,patientId:'QA'+i,birth:'',modality:'CT',description:'Synthetic',accession:'',referring:'',series:[],imageCount:12,size:8192,addedAt:i,openedAt:null});
      tx.oncomplete=()=>{db.close();resolve();};tx.onerror=()=>reject(tx.error);
    };
  }));
  const initial=await anchor(p,'before 3D');
  for(let cycle=0;cycle<(legacy?1:3);cycle++){
    await p.getByRole('button',{name:'3D həcm görüntüləmə',exact:true}).first().tap();
    await p.locator('.vr-raster[data-ready=true]').waitFor();
    await p.locator('.vr-close').tap();
    const start=Date.now(),opened=legacy?p.waitForEvent('popup'):Promise.resolve(p);
    await p.getByRole('button',{name:'Local arxiv',exact:true}).first().tap();
    const archive=await opened,shell=archive.locator('.archive-shell');
    const rows=shell.locator('.records-upper tbody tr');
    await rows.first().waitFor({timeout:45000});
    const count=await rows.count();
    assert.equal(count,legacy?1200:64);
    console.log(JSON.stringify({build:legacy?'previous':'updated',cycle,readyMs:Date.now()-start,openPages:ctx.pages().length,visibleStudyRows:count}));
    if(!legacy){
      assert.equal(ctx.pages().length,1);
      await shell.getByRole('button',{name:'Növbəti səhifə'}).click();
      assert.match(await shell.locator('.tablet-archive-pages').innerText(),/2 \/ 19/);
    }
    const field=shell.locator('.records-search input');
    await field.fill('QA study 1199');
    await archive.waitForFunction(()=>document.querySelectorAll('.records-upper tbody tr').length===1);
    assert.match(await rows.innerText(),/QA study 1199/);
    if(legacy)await archive.close();else await shell.getByRole('button',{name:'Pəncərəni bağla',exact:true}).click();
    assert.deepEqual((await anchor(p,'returned to viewer')).expected,initial.expected);
  }
  assert.deepEqual(errors,[]);
}).catch(e=>{console.error(e);process.exitCode=1;});
