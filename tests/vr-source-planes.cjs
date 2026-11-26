const assert=require('node:assert/strict');

// Test fixture only. Read a single known voxel from each plane handed to the actual render backend.
async function observeSourcePlanes(context,count,limit=0){
  await context.addInitScript(({count,limit})=>{
    function instrument(win){
      if(win.__vrSourcePlanes)return;
      const reads=win.__vrSourcePlanes=[];
      const record=(backend,w,h,d,values)=>{
        if(d!==count || !ArrayBuffer.isView(values) || values.length!==w*h*d)return;
        const indices=Array.from({length:d},(_,z)=>values[(z*h+3)*w+3]);
        reads.push({backend,w,h,d,indices,type:values.constructor.name});
      };
      const gl=win.WebGL2RenderingContext?.prototype;
      if(gl){
        if(limit){
          const parameter=gl.getParameter;
          gl.getParameter=function(p){return p===this.MAX_3D_TEXTURE_SIZE?limit:parameter.call(this,p);};
        }
        for(const name of ['texImage3D','texSubImage3D']){
          const original=gl[name],sub=name==='texSubImage3D';
          gl[name]=function(...a){
            if(sub)record('GPU',a[5],a[6],a[7],a[10]);
            else record('GPU',a[3],a[4],a[5],a[9]);
            return original.apply(this,a);
          };
        }
      }
      const post=win.Worker.prototype.postMessage;
      win.Worker.prototype.postMessage=function(message,...rest){
        if(message?.type==='volume'){const v=message.volume;record('CPU',...v.dimensions,v.values);}
        return post.call(this,message,...rest);
      };
    }
    instrument(window);
    const open=window.open;
    window.open=function(...args){
      const child=open.apply(this,args);
      if(child){try{instrument(child);}catch{/* Non-viewer origins have no access. */}}
      return child;
    };
  },{count,limit});
}

async function assertSourcePlanes(home,view,count,backend){
  const ui=await view.locator('.radaz-vr').evaluate(e=>({...e.dataset}));
  assert.equal(+ui.sourceSlices,count);
  assert.equal(+ui.volumeDepth,count);
  assert.equal(ui.backend,backend);
  const reads=(await Promise.all([home,view].map(p=>p.evaluate(()=>window.__vrSourcePlanes||[])))).flat();
  const data=reads.find(r=>r.backend===backend);
  assert.ok(data,'full texture / worker source observed: '+JSON.stringify(reads.map(r=>[r.backend,r.w,r.h,r.d])));
  for(let z=0;z<count;z++){
    assert.ok(Math.abs(data.indices[z]-((128+z)*1.5-1024))<.01,
      'Plane '+z+' has the calibrated marker from its source DICOM ('+data.type+', found '+data.indices[z]+')');
  }
  console.log('PASS '+backend+' received '+count+'/'+count+' individually marked, ordered DICOM planes including both ends, '+data.w+'x'+data.h+'x'+data.d);
}
module.exports={observeSourcePlanes,assertSourcePlanes};
