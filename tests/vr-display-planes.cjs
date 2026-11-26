// Run the same worker messages used by detached desktop 3D and compare calibrated voxels to area averaging.
const assert=require('node:assert/strict');
const {buildSync}=require(require.resolve('esbuild',{paths:[require.resolve('vite/package.json')]}));
const vm=require('node:vm');
function compiled(entry){
  return buildSync({entryPoints:[entry],bundle:true,format:'cjs',platform:'node',write:false}).outputFiles[0].text;
}
const reference={module:{exports:{}}};
vm.runInNewContext(compiled('lib/volume-resampling.ts'),reference);
const {resamplePlane,areaWeights,desktopDisplayDimensions}=reference.module.exports;
for(const [limit,budgetMB] of [[256,24],[384,48],[512,64],[1536,320]]){
  const [w,h,d]=desktopDisplayDimensions([512,512,463],limit,budgetMB*1024**2);
  assert.equal(d,463); assert.ok(w<=limit && h<=limit && w*h*d*4<=budgetMB*1024**2);
}
let response;
const worker={self:{postMessage(message){response=message;}}};
vm.runInNewContext(compiled('lib/vr/display-plane.worker.ts'),worker);
for(const [columns,rows,w,h] of [[512,512,308,308],[257,225,144,129],[20,15,20,15],[19,16,7,5]]){
  worker.self.onmessage({data:{shape:[columns,rows,w,h]}});
  for(const Type of [Int16Array,Float32Array,Uint8Array]){
    const planes=[0,1,2].map(z=>Type.from({length:columns*rows},(_,i)=>(i*17%3901-1030)*1.5+z/4));
    const original=planes.map(p=>p.slice());
    worker.self.onmessage({data:{planes}});
    let min=Infinity,max=-Infinity;
    for(let z=0;z<planes.length;z++){
      const exact=resamplePlane(planes[z],columns,areaWeights(columns,w),areaWeights(rows,h));
      for(let p=0;p<exact.length;p++){
        assert.ok(Math.abs(response.block[z*w*h+p]-exact[p])<.0003,'calibrated voxel and slice order');
        min=Math.min(min,exact[p]);max=Math.max(max,exact[p]);
      }
      assert.deepEqual(planes[z],original[z],'source pixels remain intact');
    }
    assert.ok(Math.abs(response.min-min)<.0003 && Math.abs(response.max-max)<.0003,'full output range');
  }
}
console.log('PASS calibrated CT/MR planes, range, order and source buffers across 12 typed/geometry combinations');
