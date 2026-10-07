import test from 'node:test';
import assert from 'node:assert/strict';
import {bindWindowing, connectWindowLevels, windowingKey, WindowLevels} from '../lib/image-windowing.ts';
const events={PRE_STACK_NEW_IMAGE:'before',STACK_NEW_IMAGE:'shown',VOI_MODIFIED:'voi'};
const tick=()=>new Promise(resolve=>queueMicrotask(resolve));
function pane(panel,values,scope={modality:'CR',seriesId:'study/series'}){
 const element=new EventTarget();let image='',range={lower:0,upper:1};
 const viewport={element,getCurrentImageId:()=>image,getProperties:()=>({voiRange:range}),
  setProperties:({voiRange},silent=false)=>{range=voiRange;if(!silent)element.dispatchEvent(new Event('voi'));},render(){}};
 const stop=bindWindowing(viewport,panel,values,events,id=>({wl:id==='one'?100:200,ww:id==='one'?400:800}),()=>scope);
 return{stop,range:()=>({...range}),edit:r=>viewport.setProperties({voiRange:r}),
  begin(id){element.dispatchEvent(new Event('before'));image=id;},
  async show(){element.dispatchEvent(new Event('shown'));await tick();}};
}
test('projection images and panels retain their own window; loading events never overwrite it',async()=>{
 const values=new WindowLevels(),a=pane('A',values),b=pane('B',values);
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
 const a=pane('A',new WindowLevels());a.begin('one');const first=a.show();a.begin('two');await a.show();await first;
 assert.deepEqual(a.range(),{lower:-200,upper:600});a.stop();
});

for(const modality of ['CT','MR'])test(`${modality} shares edits across slices, panels and rebuilt MPR, but not another series`,async()=>{
 const values=new WindowLevels(),scope={modality,seriesId:'study/series'};
 const a=pane('A',values,scope),b=pane('B',values,scope),mpr=pane('MC',values,{...scope,mpr:true});
 const other=pane('C',values,{modality,seriesId:'study/other'});
 a.begin('one');b.begin('two');mpr.begin('coronal');other.begin('one');
 await Promise.all([a.show(),b.show(),mpr.show(),other.show()]);
 a.edit({lower:0,upper:160});
 assert.deepEqual(b.range(),{lower:0,upper:160});assert.deepEqual(mpr.range(),{lower:0,upper:160});
 assert.deepEqual(other.range(),{lower:-100,upper:300});
 a.begin('two');a.edit({lower:-200,upper:600});await a.show();assert.deepEqual(a.range(),{lower:0,upper:160});
 mpr.begin('rebuilt');const transition=mpr.show();b.edit({lower:10,upper:20});await transition;
 assert.deepEqual(mpr.range(),{lower:10,upper:20});assert.deepEqual(a.range(),{lower:10,upper:20});
 for(const p of [a,b,mpr,other])p.stop();
});

test('only CT/MR and MPR use shared keys; optical/archive identity is normalized',()=>{
 for(const modality of ['CR','DX','MG','RF','XA','',undefined])assert.notEqual(windowingKey('A','one',{modality,seriesId:'s'}),windowingKey('B','two',{modality,seriesId:'s'}));
 assert.equal(windowingKey('A','one',{modality:'CT',seriesId:'media:archive:study/series'}),windowingKey('MC','rebuilt',{mpr:true,seriesId:'study/series'}));
});

test('separate Viewer/MPR windows exchange series changes and initial state, never projection windows',async()=>{
 const name=`windowing-${crypto.randomUUID()}`,a=new WindowLevels(),b=new WindowLevels();
 const key=windowingKey('A','one',{modality:'MR',seriesId:'study/series'}),image=windowingKey('A','one',{modality:'DX',seriesId:'study/xray'});
 a.set(key,{lower:0,upper:160});a.set(image,{lower:5,upper:10});
 const received=(values,key)=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>{off();reject(Error('Windowing message timeout'));},3000);const off=values.subscribe(k=>{if(k===key){off();clearTimeout(timer);resolve();}});});
 const snapshot=received(b,key),stopA=connectWindowLevels(a,new BroadcastChannel(name)),stopB=connectWindowLevels(b,new BroadcastChannel(name));
 try{
  await snapshot;assert.deepEqual(b.get(key),{lower:0,upper:160});assert.equal(b.get(image),undefined);
  const changed=received(a,key);b.set(key,{lower:10,upper:30});await changed;assert.deepEqual(a.get(key),{lower:10,upper:30});
 }finally{stopA();stopB();}
});
