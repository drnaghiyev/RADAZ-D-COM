import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';
import {readFileSync,readdirSync,mkdirSync} from 'node:fs';
import dicomParser from 'dicom-parser';
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'playwright');
const fixture=spawnSync('python',['tests/features-041-fixture.py'],{windowsHide:true,encoding:'utf8'});assert.equal(fixture.status,0,fixture.stderr);
const files=readdirSync('outputs/features-041-fixture').map(name=>{const body=readFileSync('outputs/features-041-fixture/'+name),ds=dicomParser.parseDicom(new Uint8Array(body));return {body,study:ds.string('x0020000d'),sop:ds.string('x00080018')};});
const base=process.env.RADAZ_TEST_URL||'http://localhost:5317',browser=await chromium.launch({channel:'msedge',headless:true});
const context=await browser.newContext({viewport:{width:1920,height:1080}});context.setDefaultTimeout(45000);
const errors=[],windowActions=[];context.on('page',p=>p.on('pageerror',error=>errors.push(error.stack)));
await context.route('**/local-archive-api/**',route=>{
  const u=new URL(route.request().url()),path=u.pathname;
  if(path.endsWith('/license'))return route.fulfill({json:{valid:true,required:true,kind:'owner'}});
  if(path.endsWith('/instances'))return route.fulfill({json:files.filter(f=>u.search.includes(f.study)).map(f=>({uid:f.sop}))});
  if(path.includes('/file/'))return route.fulfill({contentType:'application/dicom',body:files.find(f=>f.sop===decodeURIComponent(path.split('/').at(-1))).body});
  if(path.includes('/window/'))windowActions.push(path.split('/').at(-1));
  return route.fulfill({json:[]});
});
await context.route('**/product.json',route=>route.fulfill({contentType:'application/json',body:readFileSync('public/product.json')}));
const page=await context.newPage();mkdirSync('outputs/features-041-qa',{recursive:true});
const api=(p,fn,arg)=>p.evaluate(async({fn,arg})=>{
  const url=performance.getEntriesByType('resource').find(e=>e.name.includes('/lib/cornerstone.ts'))?.name;
  if(!url)throw Error('Development module URL unavailable');
  const module=await import(url),viewer=await module.getViewer();return new Function('viewer','module','arg',`return (${fn})(viewer,module,arg)`)(viewer,module,arg);
},{fn:fn.toString(),arg});

try {
 await page.goto(base+'/#archive-study=2.25.410',{timeout:120000});
 await page.locator('[data-panel="A"][data-has-image="true"]').waitFor();
 await page.getByRole('button',{name:'Panel düzülüşü',exact:true}).waitFor();
 await page.waitForFunction(()=>document.querySelectorAll('.series-card').length===2&&!document.querySelector('.series-work-progress progress'));
 const result=await api(page,async({engine,core})=>{
  const image=engine.getViewport('panel-A').getCurrentImageId();
  const hosts=[];
  for(let i=0;i<9;i++){
   const el=document.createElement('div');Object.assign(el.style,{position:'fixed',width:'300px',height:i===0?'600px':'300px',left:'0',top:'0'});document.body.append(el);hosts.push(el);
   engine.enableElement({viewportId:'qa-'+i,element:el,type:core.Enums.ViewportType.STACK});
   await engine.getViewport('qa-'+i).setStack([image]);
  }
  const vp=engine.getViewport('qa-7');
  const capture=async()=>{vp.render();await new Promise(r=>setTimeout(r,100));const d=vp.canvas.getContext('2d').getImageData(0,0,vp.canvas.width,vp.canvas.height).data;return Array.from(d).reduce((a,b)=>a+b,0);};
  const before=await capture();engine.disableElement('qa-0');const after=await capture();
  for(let i=1;i<9;i++)engine.disableElement('qa-'+i);hosts.forEach(h=>h.remove());return {before,after};
 });
 assert.equal(result.after,result.before,'removing a larger peer must preserve every image pixel');
 console.log('PASS context-pool removal pixels',result);

 const split=async(rows,columns)=>{await page.getByRole('button',{name:'Panel düzülüşü',exact:true}).click();await page.getByRole('gridcell',{name:`${columns} sütun, ${rows} sətir, ${rows*columns} panel`,exact:true}).click();};
 const drop=async(id,series)=>page.locator(`[data-panel="${id}"]`).evaluate((el,series)=>{const d=new DataTransfer();d.setData('application/x-series-id',series);el.dispatchEvent(new DragEvent('drop',{bubbles:true,dataTransfer:d}));},series);
 const state=id=>api(page,({engine},m,id)=>{const v=engine.getViewport('panel-'+id);const c=v.canvas,d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let sum=0,bright=0;for(let i=0;i<d.length;i+=4){sum+=d[i]+d[i+1]+d[i+2];if(d[i]>30)bright++;}return {sum,bright,zoom:v.getZoom(),pan:v.getPan(),voi:v.getProperties().voiRange,image:v.getCurrentImageId()};},id);
 await split(2,2);
 for(const id of ['A','B','C','D']){await drop(id,'2.25.410/2.25.410.1');await page.locator(`[data-panel="${id}"][data-has-image="true"]`).waitFor();}
 await page.waitForTimeout(300);
 await api(page,({engine})=>{window.testViewportB=engine.getViewport('panel-B');});
 for(let i=0;i<8;i++){await drop('B',i%2?'2.25.410/2.25.410.1':'2.25.410/2.25.410.2');}
 await page.waitForTimeout(800);
 assert.equal(await api(page,({engine})=>window.testViewportB===engine.getViewport('panel-B')),true,'series replacement reuses the viewport');
 for(const id of ['A','B','C','D'])assert.ok((await state(id)).bright>1000,`pane ${id} has actual pixels`);
 console.log('PASS split panes, rapid replacement and actual canvas pixels');
 // A completed Cobb angle is selected and removed using the real Delete handler.
 const pane=page.locator('[data-panel="B"]');await pane.click({position:{x:70,y:70}});
 await page.getByRole('button',{name:'Ölçmə alətləri',exact:true}).click();await page.getByRole('menuitem',{name:/Cobb/}).click();
 const r=await pane.boundingBox(),x=r.x+r.width*.45,y=r.y+r.height*.45;
 const drag=async(ax,ay,bx,by,button='left')=>{await page.mouse.move(ax,ay);await page.mouse.down({button});await page.mouse.move(bx,by,{steps:8});await page.mouse.up({button});await page.waitForTimeout(120);};
 await drag(x-60,y-50,x+60,y-40);await drag(x-60,y+45,x+60,y+20);
 const uid=await api(page,({tools})=>{const a=tools.annotation.state.getAllAnnotations().find(a=>a.metadata.toolName==='CobbAngle');if(!a)throw Error('Cobb drawing missing');tools.annotation.selection.setAnnotationSelected(a.annotationUID,true);return a.annotationUID;});
 await page.mouse.move(10,10);await page.waitForTimeout(200);const beforeDelete=await state('B');await page.keyboard.press('Delete');await page.waitForTimeout(250);
 assert.equal(await api(page,({tools},m,uid)=>!!tools.annotation.state.getAnnotation(uid),uid),false);
 assert.deepEqual(await state('B'),beforeDelete,'Delete changes annotations only, not image pixels/camera');
 console.log('PASS Cobb Delete preserves full image');
 await page.goto(base+'/?projection-test=1#archive-study=2.25.411',{waitUntil:'domcontentloaded'});
 await page.locator('[data-panel="A"][data-has-image="true"]').waitFor();await page.waitForFunction(()=>document.querySelector('[data-panel="A"] .top-right')?.textContent.includes('SYNTHETIC CR')&&!document.querySelector('.series-work-progress progress'));await split(1,2);await drop('B','2.25.411/2.25.411.3');
 await page.locator('[data-panel="B"][data-has-image="true"]').waitFor();await page.waitForTimeout(300);
 const b0=await state('B'),a=await page.locator('[data-panel="A"]').boundingBox(),ax=a.x+a.width*.55,ay=a.y+a.height*.55;
 await drag(ax,ay,ax+30,ay+25);await drag(ax,ay,ax+35,ay+30,'middle');await drag(ax,ay,ax,ay+35,'right');
 assert.deepEqual(await state('B'),b0,'XR WW/WL, zoom and pan stay in A');
 await drop('B','2.25.411/2.25.411.3');await page.waitForTimeout(250);assert.deepEqual(await state('B'),b0,'reopening same XR does not copy A presentation');
 await page.getByRole('button',{name:'Ölçmə alətləri',exact:true}).click();await page.getByRole('menuitem',{name:/Uzunluq/}).click();await drag(ax-80,ay-80,ax+80,ay-80);
 await page.waitForTimeout(200);
 assert.ok(await page.locator('[data-panel="A"] line[data-id*="-endpoint-"]').count()>0);
 assert.equal(await page.locator('[data-panel="B"] line[data-id*="-endpoint-"]').count(),0,'XR measurement must not appear in B');
 console.log('PASS projection tools and measurements isolated by pane');
 await page.getByRole('button',{name:'Alət panelini fərdiləşdir',exact:true}).click();await page.getByRole('textbox',{name:'Yeni qrupun adı'}).fill('Empty test');await page.getByRole('button',{name:'Qrup yarat',exact:true}).click();await page.getByRole('button',{name:'Təsdiq',exact:true}).click();
 const empty=page.locator('[data-toolbar-group]').filter({has:page.locator('[data-item-group^="custom-"]')}).last();
 const groupId=await empty.getAttribute('data-toolbar-group');await empty.click({button:'right'});await page.getByRole('menuitem',{name:'Boş qrupu sil',exact:true}).click();await page.reload({waitUntil:'domcontentloaded'});
 await page.waitForFunction(id=>document.querySelector(`[data-toolbar-group="${id}"]`)?.dataset.groupDeleted==='true',groupId);
 await page.locator('[data-toolbar-group="measure"]').click({button:'right',position:{x:5,y:5}});assert.equal(await page.getByRole('menuitem',{name:'Boş qrupu sil',exact:true}).count(),0,'nonempty group cannot be removed by empty-group menu');
 console.log('PASS empty group right-click deletion and persistence');
 assert.deepEqual(errors,[]);
}finally{console.log('BROWSER ERRORS',errors);await page.screenshot({path:'outputs/viewport-lifecycle.png'});await browser.close();}
