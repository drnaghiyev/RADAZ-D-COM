const assert=require('node:assert/strict');
const {withTablet,anchor,pixel,frame}=require('./private-tablet-fixture.cjs');
withTablet(async({ctx,p,pane,errors})=>{
 const before=await anchor(p,'GPU');
 const cdp=await ctx.newCDPSession(p),clicks=async(points)=>{for(const pt of points)await p.mouse.click(...pt);};
 const canvas=pane.locator('.dicom-canvas'),box=await canvas.boundingBox(),at=(x,y)=>[box.x+box.width*x,box.y+box.height*y];
 await p.keyboard.press('a');await frame(p);await p.mouse.move(...at(.3,.45));await p.mouse.down();await p.mouse.move(...at(.43,.42),{steps:8});await p.mouse.up();await p.mouse.move(...at(.48,.51),{steps:6});await p.mouse.click(...at(.48,.51));await frame(p);await p.waitForTimeout(600);
 await p.keyboard.press('c');await frame(p);for(const [a,b] of [[at(.55,.55),at(.68,.55)],[at(.55,.61),at(.65,.66)]]){await p.mouse.move(...a);await p.mouse.down();await p.mouse.move(...b,{steps:8});await p.mouse.up();await p.waitForTimeout(500);}
 await p.keyboard.press('e');await frame(p);await p.mouse.move(...at(.32,.62));await p.mouse.down();await p.mouse.move(...at(.38,.69),{steps:6});await p.mouse.up();await p.waitForTimeout(500);
 await p.keyboard.press('h');await clicks([at(.68,.43)]);
 for(const [key,points] of [['d',[at(.24,.63),at(.25,.72)]],['t',[at(.38,.81),at(.63,.81),at(.54,.67)]]]){await p.keyboard.press(key);await frame(p);for(const pt of points){await p.mouse.click(...pt);await frame(p);}}
 for(const [key,off] of [['o',0],['q',.08]]){await p.keyboard.press(key);const a=at(.58,.23+off),b=at(.66,.25+off);await p.mouse.move(...a);await p.mouse.down();await p.mouse.move(...b,{steps:6});await p.mouse.up();if(key==='o')await p.keyboard.press('Escape');}
 await p.keyboard.press('l');await frame(p);await p.mouse.move(...at(.22,.18));await p.mouse.down();await p.mouse.move(...at(.37,.18),{steps:8});await p.mouse.up();await frame(p);
 await p.keyboard.press('w');await frame(p);
 async function geometry(){return pane.evaluate(el=>{
   let f=el[Object.keys(el).find(k=>k.startsWith('__reactFiber'))];while(f && !Array.isArray(f.memoizedProps?.marks))f=f.return;
   if(f?.alternate){let tree=f;while(tree.return)tree=tree.return;if(tree.stateNode?.current!==tree)f=f.alternate;}const local=f?.memoizedProps?.marks||[];let tools;
   const find=n=>{if(!n||tools)return;for(let h=n.memoizedState;h;h=h.next){const v=h.memoizedState?.current;if(v?.tools?.annotation){tools=v.tools;break;}}find(n.child);find(n.sibling);};
   find(f?.child);
   const native=tools?.annotation.state.getAllAnnotations()||[];
   return [...local.map(m=>[m.kind,m.id,m.points]),...native.map(a=>[a.metadata.toolName,a.annotationUID,a.data.handles.points])].sort((a,b)=>a[0].localeCompare(b[0]));
 });}
 const annotations=await geometry();console.log('Measured tool types',annotations.map(a=>a[0]));
 for(const tool of ['Length','Angle','CobbAngle','EllipticalROI','hu','deviation','arch','arrow','pencil'])assert.ok(annotations.some(a=>a[0]===tool),'missing '+tool);
 const count=()=>pane.locator('svg [data-id]').count();const initial=await count();assert.ok(initial>0,'created annotations');
 await p.getByRole('button',{name:'3D həcm görüntüləmə',exact:true}).first().click();
 await p.locator('.vr-raster[data-ready=true]').waitFor();await p.evaluate(()=>{window.testDenyNewGL=true;dispatchEvent(new Event('radaz:close-volume'));});
 await p.locator('.radaz-vr').waitFor({state:'detached'});await pane.locator('.bottom-right').filter({hasText:'/ 24'}).waitFor();await frame(p);
 await anchor(p,'returned CPU');assert.ok(await count()>=initial,'annotations restored');
 async function pair(scale,dx,dy){const box=await canvas.boundingBox(),x=box.x+box.width/2,y=box.y+box.height/2;
 const send=(type,pts)=>cdp.send('Input.dispatchTouchEvent',{type,touchPoints:pts});
 await send('touchStart',[{x:x-45,y,id:1}]);await send('touchStart',[{x:x-45,y,id:1},{x:x+45,y,id:2}]);
 for(let j=1;j<=5;j++){let k=j/5,s=45*(1+(scale-1)*k);await send('touchMove',[{x:x+dx*k-s,y:y+dy*k,id:1},{x:x+dx*k+s,y:y+dy*k,id:2}]);}
 await send('touchEnd',[]);await frame(p);}
 await p.keyboard.press('l');await frame(p);await pair(1.4,35,18);assert.deepEqual(await geometry(),annotations,'second contact cancels only the draft');await p.keyboard.press('w');const zoomed=await anchor(p,'combined pinch and pan');assert.ok(zoomed.scale<before.scale*.88);
 await pair(.8,-18,0);await anchor(p,'pinch out');
 await p.setViewportSize({width:800,height:1200});await frame(p);await anchor(p,'portrait');
 await p.keyboard.press('2');await frame(p);
 async function tapTwice(pane){let b=await pane.boundingBox();for(let i=0;i<2;i++){await p.touchscreen.tap(b.x+b.width*.8,b.y+b.height*.75);await p.waitForTimeout(65);}}
 await tapTwice(pane);await pane.locator('xpath=self::*[@data-expanded="true"]').waitFor();
 await tapTwice(pane);await p.waitForFunction(()=>!document.querySelector('[data-panel=A][data-expanded=true]'));await anchor(p,'split restored');assert.deepEqual(await geometry(),annotations,'all measurement world geometry preserved');
 assert.deepEqual(errors,[]);console.log('PASS DPR2 world and pixel coordinates, annotations, compound gestures, resize and double tap');
}).catch(e=>{console.error(e);process.exitCode=1});
