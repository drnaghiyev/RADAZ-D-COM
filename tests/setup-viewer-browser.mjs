// Production build, synthetic DICOM and an isolated browser profile.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {spawn,spawnSync} from 'node:child_process';
import {createWriteStream,mkdirSync,readFileSync} from 'node:fs';
import http from 'node:http';
import {setTimeout as delay} from 'node:timers/promises';
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'playwright');
const free=()=>new Promise(resolve=>{const server=http.createServer();server.listen(0,'127.0.0.1',()=>{const port=server.address().port;server.close(()=>resolve(port));});});
const port=await free(),worker=await free(),archive=await free(),base=`http://127.0.0.1:${port}`;
mkdirSync('outputs/setup-viewer',{recursive:true});
const server=spawn(process.execPath,['scripts/start-release.mjs'],{windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,RADAZ_PORT:String(port),RADAZ_WORKER_PORT:String(worker),RADAZ_ARCHIVE_PORT:String(archive)}});
const log=createWriteStream('outputs/setup-viewer/server.log');server.stdout.pipe(log);server.stderr.pipe(log);
let browser,page;
try{
 for(let i=0;i<150;i++){try{if((await fetch(base+'/radaz-health.json')).ok)break;}catch{}await delay(200);}
 browser=await chromium.launch({headless:true,channel:'msedge'});
 const context=await browser.newContext({viewport:{width:1440,height:1000}});context.setDefaultTimeout(20000);
 const errors=[];context.on('page',p=>p.on('pageerror',e=>errors.push(e.message)));
 const files=[1,2].map(n=>readFileSync(`tests/fixtures/demo/thorax-${n}.dcm`));
 await context.route('**/local-archive-api/**',route=>{
  const path=new URL(route.request().url()).pathname;
  if(path.endsWith('/license'))return route.fulfill({json:{valid:true,required:true,kind:'owner',deviceId:'SYNTHETIC',message:'Test'}});
  if(path.endsWith('/instances'))return route.fulfill({json:files.map((_,i)=>({uid:String(i)}))});
  if(path.includes('/file/'))return route.fulfill({contentType:'application/dicom',body:files[Number(path.split('/').pop())]});
  return route.fulfill({json:[]});
 });
 page=await context.newPage();await page.goto(base+'/#archive-study=2.25.702');
 await page.waitForFunction(()=>document.querySelector('.statusbar')?.textContent.includes('DICOM görüntüsü yükləndi'));
 const pane=page.locator('[data-panel="A"]'),box=await pane.locator('.dicom-canvas').boundingBox();
 await page.getByRole('button',{name:'Ölçmə alətləri',exact:true}).click();await page.getByRole('menuitem',{name:/Deviation/}).click();
 await page.mouse.click(box.x+box.width*.30,box.y+box.height*.30);
 await page.mouse.click(box.x+box.width*.64,box.y+box.height*.59);
 const mark=pane.locator('[data-kind="deviation"]'),triangle=mark.locator('.deviation-interior');await triangle.waitFor();
 const shape=async()=> (await triangle.getAttribute('points')).trim().split(' ').map(p=>p.split(',').map(Number));
 const drag=async(x,y,dx,dy)=>{await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+dx,y+dy,{steps:10});await page.mouse.up();await delay(100);};
 const checkMove=async(dx,dy)=>{
  const before=await shape(),label=await mark.locator('.mark-label text').textContent();
  const centroid=[0,1].map(axis=>before.reduce((sum,p)=>sum+p[axis],0)/3);
  const x=box.x+centroid[0],y=box.y+centroid[1];
  await page.mouse.move(x,y);
  assert.equal(await triangle.evaluate(e=>getComputedStyle(e).cursor),'move');
  assert.equal(await page.evaluate(({x,y})=>document.elementFromPoint(x,y)?.classList.contains('deviation-interior'),{x,y}),true,'The interior receives the pointer');
  await drag(x,y,dx,dy);
  const after=await shape();
  assert.ok(after.every((p,i)=>Math.abs(p[0]-before[i][0]-dx)<1&&Math.abs(p[1]-before[i][1]-dy)<1),'Every triangle corner translates without distortion');
  assert.equal(await mark.locator('.mark-label text').textContent(),label,'Height and angle stay unchanged');
  assert.equal(await mark.count(),1,'Dragging does not create another measurement');
 };
 await checkMove(42,31);
 await page.keyboard.press('w');
 await page.getByRole('button',{name:'90° sağa fırlat',exact:true}).click();await delay(150);
 await checkMove(-28,24);
 await page.getByRole('button',{name:'Üfüqi çevir',exact:true}).click();await delay(150);
 await checkMove(20,-26);
 const beforeHandle=await shape(),endpoint=beforeHandle[2];
 await drag(box.x+endpoint[0],box.y+endpoint[1],24,-18);
 const afterHandle=await shape();
 assert.ok(Math.abs(afterHandle[2][0]-endpoint[0]-24)<1&&Math.abs(afterHandle[2][1]-endpoint[1]+18)<1,'The endpoint can still be adjusted separately');
 assert.deepEqual(afterHandle[0],beforeHandle[0],'Endpoint adjustment leaves the other anchor fixed');
 await page.screenshot({path:'outputs/setup-viewer/deviation.png'});
 await page.getByRole('button',{name:'Yardım və lisenziya',exact:true}).click();
 assert.equal(await page.getByRole('menuitem',{name:/Aylıq ödəniş/}).count(),0);
 await page.getByRole('menuitem',{name:/Proqram haqqında/}).click();
 const about=page.getByRole('dialog',{name:'RADAZ haqqında',exact:true});
 assert.match(await about.innerText(),/Radioloq Rövşən Nağıyev tərəfindən hazırlanmışdır/);
 assert.match(await about.innerText(),/MPR · 3D/);
 assert.doesNotMatch(await about.innerText(),/Chat\s?GPT|GitHub|buraxılışlar/i);
 await page.screenshot({path:'outputs/setup-viewer/about.png'});
 await about.getByRole('button',{name:'Bağla',exact:true}).last().click();
 await page.getByRole('button',{name:'Yardım və lisenziya',exact:true}).click();
 await page.getByRole('menuitem',{name:'Lisenziya açarını daxil et',exact:true}).click();
 const license=page.getByRole('dialog',{name:'Lisenziyanı aktivləşdir',exact:true});
 assert.doesNotMatch(await license.innerText(),/Aylıq|Ödəniş|checkout/i);
 assert.deepEqual(errors,[]);
 await browser.close();browser=null;
 assert.equal((await fetch(base+'/radaz-health.json')).ok,true,'Closing the Viewer leaves localhost running');
 console.log('PASS: production deviation interior drag, rotated/flipped drag, stable measurements, editable endpoint, About and payment-free menus');
}catch(error){if(page)await page.screenshot({path:'outputs/setup-viewer/failure.png'}).catch(()=>{});throw error;}
finally{
 if(browser)await browser.close();
 if(process.platform==='win32')spawnSync('taskkill',['/PID',String(server.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});else server.kill();
 log.end();
}
