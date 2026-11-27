const assert=require('node:assert/strict');
const fs=require('node:fs'),ts=require('typescript'),vm=require('node:vm');
const api={};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(require('node:path').join(__dirname,'../tablet-volume-quality.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{exports:api});
const choose=api.chooseTabletMatrix;
let last=0,steps=new Set();
for(let availableMiB=270;availableMiB<=2400;availableMiB+=5){
 const m={totalMiB:4100,availableMiB,reserveMiB:240,heapMiB:256,low:false};
 let n;try{n=choose([512,512,1000],m,2048,false,512,true)}catch{continue}
 assert(n>=last && n%32===0 && n>=64 && n<=512);
 const cost=k=>(k*k*1000*9+512*512*12)/1024**2+8;
 const budget=Math.min((availableMiB-240)*.49,4100*.21,256*3,1536);
 assert(cost(n)<=budget);
 if(n<512)assert(cost(n+32)>budget);
 last=n;steps.add(n);
}
assert(steps.has(96)&&steps.has(160)&&steps.has(288));
for(const n of [64,128,256,512]){
 const m={totalMiB:8192,availableMiB:6000,reserveMiB:240,heapMiB:512,low:false};
 assert.equal(choose([512,512,90],m,2048,false,512,true,n),n);
}
assert.equal(api.smallerTabletMatrix(96),64);
console.log('PASS 32px steps, maximum fitting budget, explicit choices, recovery', [...steps]);
