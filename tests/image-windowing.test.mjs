import test from 'node:test';
import assert from 'node:assert/strict';
import {isolateImageWindowing} from '../lib/image-windowing.ts';
const events={PRE_STACK_NEW_IMAGE:'before',STACK_NEW_IMAGE:'shown',VOI_MODIFIED:'voi'};
const tick=()=>new Promise(resolve=>queueMicrotask(resolve));
function pane(panel,values){
 const element=new EventTarget();let image='',range={lower:0,upper:1};
 const viewport={element,getCurrentImageId:()=>image,getProperties:()=>({voiRange:range}),
  setProperties:({voiRange},silent=false)=>{range=voiRange;if(!silent)element.dispatchEvent(new Event('voi'));},render(){}};
 const stop=isolateImageWindowing(viewport,panel,values,events,id=>({wl:id==='one'?100:200,ww:id==='one'?400:800}));
 return{stop,range:()=>({...range}),edit:r=>viewport.setProperties({voiRange:r}),
  begin(id){element.dispatchEvent(new Event('before'));image=id;},
  async show(){element.dispatchEvent(new Event('shown'));await tick();}};
}
test('each slice and each panel retains its own window; loading events never overwrite it',async()=>{
 const values=new Map(),a=pane('A',values),b=pane('B',values);
 a.begin('one');await a.show();assert.deepEqual(a.range(),{lower:-100,upper:300});
 a.edit({lower:0,upper:160});a.begin('two');a.edit({lower:0,upper:160});await a.show();
 assert.deepEqual(a.range(),{lower:-200,upper:600});
 a.edit({lower:50,upper:150});a.begin('one');await a.show();assert.deepEqual(a.range(),{lower:0,upper:160});
 b.begin('one');await b.show();assert.deepEqual(b.range(),{lower:-100,upper:300});
 b.edit({lower:10,upper:20});assert.deepEqual(a.range(),{lower:0,upper:160});
 a.stop();const remounted=pane('A',values);remounted.begin('two');await remounted.show();
 assert.deepEqual(remounted.range(),{lower:50,upper:150});remounted.stop();b.stop();
});
test('a queued render cannot apply a previous image window after a newer navigation',async()=>{
 const a=pane('A',new Map());a.begin('one');const first=a.show();a.begin('two');await a.show();await first;
 assert.deepEqual(a.range(),{lower:-200,upper:600});a.stop();
});
