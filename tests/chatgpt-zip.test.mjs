import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';

function harness(){
 let listener,opened=0;const state={},records=new Map(),replies=[];
 const indexedDB={open(){const req={};setTimeout(()=>{req.result={close(){},transaction(){const tx={objectStore:()=>({put:(v,k)=>records.set(k,v),get:k=>({result:records.get(k)}),clear:()=>records.clear()})};setTimeout(()=>tx.oncomplete?.(),0);return tx;}};req.onsuccess();},0);return req;}};
 const chrome={storage:{local:{get:async()=>({origin:'http://localhost:5173'})},session:{get:async()=>state,set:async d=>Object.assign(state,d),remove:async key=>delete state[key]}},alarms:{create:async()=>{},clear:async()=>{},onAlarm:{addListener:()=>{}}},tabs:{get:async()=>({url:'http://localhost:5173/report'}),create:async()=>({id:++opened}),update:async()=>{},sendMessage:async(_,msg)=>replies.push(msg)},runtime:{getManifest:()=>({version:'0.3.2'}),onMessage:{addListener:fn=>listener=fn}}};
 vm.runInNewContext(readFileSync(new URL('../extensions/chatgpt/background.js',import.meta.url),'utf8'),{chrome,indexedDB,URL,Date,Uint8Array,atob,console});
 return{call:(msg,sender)=>new Promise(resolve=>listener(msg,sender,resolve)),state,records,opened:()=>opened,replies};
}
const sender={url:'http://localhost:5173/report',tab:{id:99}},target={url:'https://chatgpt.com/',tab:{id:1}},request='a'.repeat(32);
async function packageData(){const zip=new JSZip();for(let i=1;i<=25;i++)zip.file(`RADAZ-image-${i}.jpg`,Buffer.from([255,216,255,217]));return zip.generateAsync({type:'nodebuffer'});}
async function begin(h,raw){return h.call({type:'ZIP_BEGIN',request,prompt:'Synthetic test; no patient data',name:'RADAZ-ChatGPT.zip',size:raw.length,count:Math.ceil(raw.length/524288)},sender);}
async function transfer(h,raw){assert.equal((await begin(h,raw)).ok,true);for(let index=0,offset=0;offset<raw.length;index++,offset+=524288)assert.equal((await h.call({type:'ZIP_CHUNK',request,index,data:raw.subarray(offset,offset+524288).toString('base64')},sender)).ok,true);assert.equal((await h.call({type:'ZIP_FINISH',request},sender)).ok,true);}
test('only configured origin may start ZIP transfer',async()=>{const h=harness();assert.equal((await h.call({type:'ZIP_BEGIN',request},{url:'https://other.invalid',tab:{id:2}})).ok,false);assert.equal(h.opened(),0);});
test('one ZIP carries 25 images; recipient bound; no duplicate delivery',async()=>{
 const h=harness(),raw=await packageData();await transfer(h,raw);
 assert.equal((await h.call({type:'COMPOSER_READY'},{...target,tab:{id:2}})).bundle,null);
 assert.equal((await h.call({type:'COMPOSER_READY'},target)).bundle.size,raw.length);
 assert.equal((await h.call({type:'COMPOSER_READY'},target)).bundle,null);
 const data=(await h.call({type:'COMPOSER_CHUNK',index:0},target)).data;
 const zip=await JSZip.loadAsync(data,{base64:true});assert.equal(Object.keys(zip.files).length,25);
 await h.call({type:'COMPOSER_RESULT',ok:true},target);
 assert.equal(h.state.pending,undefined);assert.equal(h.records.size,0);assert.equal(h.replies[0].request,request);assert.ok(h.state.reports[1]);
});
test('reject incomplete, reordered and non-ZIP transfers',async()=>{const h=harness(),raw=await packageData();await begin(h,raw);assert.equal((await h.call({type:'ZIP_FINISH',request},sender)).ok,false);assert.equal((await h.call({type:'ZIP_CHUNK',request,index:1,data:raw.toString('base64')},sender)).ok,false);raw[0]=0;assert.equal((await h.call({type:'ZIP_CHUNK',request,index:0,data:raw.toString('base64')},sender)).ok,false);assert.equal(h.opened(),0);});
test('multi-chunk ZIP reassembles exactly without session-storage payload',async()=>{const h=harness(),raw=Buffer.alloc(1048583,50);raw.set([80,75,3,4]);await transfer(h,raw);assert.equal(h.state.pending.count,3);const pieces=[];for(let index=0;index<3;index++)pieces.push(Buffer.from((await h.call({type:'COMPOSER_CHUNK',index},target)).data,'base64'));assert.deepEqual(Buffer.concat(pieces),raw);assert.ok(JSON.stringify(h.state).length<2000);});
test('answer returns only to linked report, refuses foreign or expired tabs',async()=>{const h=harness();await transfer(h,await packageData());await h.call({type:'COMPOSER_RESULT',ok:true},target);assert.equal((await h.call({type:'REPORT_ANSWER',text:'Synthetic report'},{...target,tab:{id:2}})).ok,false);assert.equal((await h.call({type:'REPORT_ANSWER',text:'Synthetic report'},target)).ok,true);assert.equal(h.replies.at(-1).text,'Synthetic report');assert.equal(h.replies.at(-1).request,request);h.state.reports[1].expires=0;assert.equal((await h.call({type:'REPORT_ANSWER',text:'stale'},target)).ok,false);});
test('expired ZIP cannot be read',async()=>{const h=harness();await transfer(h,await packageData());h.state.pending.expires=0;assert.equal((await h.call({type:'COMPOSER_READY'},target)).bundle,null);assert.equal((await h.call({type:'COMPOSER_CHUNK',index:0},target)).ok,false);});
test('protocol handshake and JPEG coverage survive transfer to the bound tab',async()=>{const h=harness(),raw=await packageData(),attachments={first:24,count:1,total:25,includeZip:false};assert.equal((await h.call({type:'BRIDGE_INFO'},sender)).protocol,3);assert.equal((await h.call({type:'BRIDGE_INFO'},target)).ok,false);assert.equal((await h.call({type:'ZIP_BEGIN',request,prompt:'test',name:'RADAZ-ChatGPT.zip',size:raw.length,count:1,attachments},sender)).ok,true);await h.call({type:'ZIP_CHUNK',request,index:0,data:raw.toString('base64')},sender);await h.call({type:'ZIP_FINISH',request},sender);assert.deepEqual((await h.call({type:'COMPOSER_READY'},target)).bundle.attachments,attachments);});
test('reject out-of-range JPEG coverage',async()=>{const h=harness(),raw=await packageData();for(const attachments of [{first:24,count:2,total:25,includeZip:true},{first:0,count:9,total:25,includeZip:true},{first:-1,count:1,total:25,includeZip:true}])assert.equal((await h.call({type:'ZIP_BEGIN',request,prompt:'test',name:'RADAZ-ChatGPT.zip',size:raw.length,count:1,attachments},sender)).ok,false);});

test('auto submit requires an explicit boolean and survives only its bound session',async()=>{
 const h=harness(),raw=await packageData();
 const start={type:'ZIP_BEGIN',request,prompt:'test',name:'RADAZ-ChatGPT.zip',size:raw.length,count:1};
 assert.equal((await h.call({...start,autoSubmit:'yes'},sender)).ok,false);
 assert.equal((await h.call({...start,autoSubmit:true},sender)).ok,true);
 await h.call({type:'ZIP_CHUNK',request,index:0,data:raw.toString('base64')},sender);
 await h.call({type:'ZIP_FINISH',request},sender);
 assert.equal((await h.call({type:'COMPOSER_READY'},target)).bundle.autoSubmit,true);
 await h.call({type:'COMPOSER_RESULT',ok:true,sent:true},target);
 assert.match(h.replies[0].message,/göndərildi/);
});
