import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
const source=fs.readFileSync('desktop/main.cjs','utf8');
test('auxiliary and hosted Voice windows maximize without revealing a background main window',()=>{
 const make=()=>({maximized:0,webContents:{id:1,setWindowOpenHandler(){},on(){}},setMenuBarVisibility(){},maximize(){this.maximized++;},on(){}});
 const main=make(),context=vm.createContext({mainWindow:main,windows:new Set(),cloudWindows:new Set(),local:()=>true,cloudVoice:()=>true,external(){},path:{join:()=>''},runtime:'',URL});
 vm.runInContext(source.slice(source.indexOf('function configureCloud('),source.indexOf('const external='))+source.slice(source.indexOf('function configure(win)'),source.indexOf('async function waitForReady')),context);
 const child=make(),cloud=make();context.configure(main);context.configure(child);context.configureCloud(cloud);
 assert.equal(main.maximized,0);assert.equal(child.maximized,1);assert.equal(cloud.maximized,1);
});

test('verified shortcut handoff avoids duplicate launch; mismatches still use the controller',async()=>{
 const code=source.slice(source.indexOf(" const active=JSON.parse"),source.indexOf(' // Existing RADAZ receivers'));
 for(const match of [true,false]){
  let launched=0;
  const context=vm.createContext({runtime:'',installRoot:'root',origin:'http://localhost:5173',path:{join:(...p)=>p.join('/')},
   readFileSync:file=>JSON.stringify(file.endsWith('active.json')?{version:'0.2.58'}:{buildId:'expected'}),
   process:{argv:['--radaz-ready-build=expected']},AbortSignal,
   fetch:async()=>({ok:true,json:async()=>({buildId:match?'expected':'wrong',version:'0.2.58',ready:true})}),
   run:async()=>{launched++;},waitForReady:async()=>{}});
  await vm.runInContext('(async()=>{'+code+'})()',context);
  assert.equal(launched,match?0:1);
 }
});
