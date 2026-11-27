const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {withTablet} = require('./private-tablet-fixture.cjs');

withTablet(async ({p,errors})=>{
  const directory=process.env.VR_CT_DIR;
  const files=fs.readdirSync(directory).filter(name=>name.endsWith('.dcm')).map(n=>path.join(directory,n));
  await p.evaluate(()=>{
    const status=document.querySelector('.statusbar');
    window.progressSamples=[];
    const observer=new MutationObserver(()=>{
      const node=status.querySelector('.status-job-progress progress');
      const previous=window.progressSamples.at(-1);
      if(node && (previous?.value!==node.value || previous?.max!==node.max)){
        window.progressSamples.push({value:node.value,max:node.max,position:node.position,visible:node.getBoundingClientRect().width>0});
      }
    });
    observer.observe(status,{subtree:true,childList:true,attributes:true,characterData:true});
    window.stopProgressObservation=()=>observer.disconnect();
  });
  await p.locator('input[type=file][multiple]:not([webkitdirectory])').first().setInputFiles(files);
  await p.waitForFunction(n=>{
    const main=document.querySelector('[data-panel=A] .bottom-right')?.innerText;
    return main?.includes('/ '+n) && !document.querySelector('.status-job-progress');
  },files.length);
  const samples=await p.evaluate(()=>{window.stopProgressObservation();return window.progressSamples;});
  const partial=samples.filter(o=>o.visible && o.position>0 && o.position<1);
  console.log(JSON.stringify({files:files.length,progress:samples}));
  assert.ok(partial.length,'at least one visible intermediate progress value during DICOM file import');
  assert.deepEqual(errors,[]);
  console.log('PASS tablet file import displays intermediate progress and closes it when the full stack is loaded.');
}).catch(e=>{console.error(e);process.exitCode=1;});
