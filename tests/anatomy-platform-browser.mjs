import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync,readdirSync,mkdirSync,writeFileSync} from 'node:fs';
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'playwright');
const base='http://127.0.0.1:5297',out='outputs/anatomy-platform';mkdirSync(out,{recursive:true});
const files=readdirSync('outputs/desktop-fixture').filter(f=>f.endsWith('.dcm')).sort().map(f=>readFileSync('outputs/desktop-fixture/'+f));
const browser=await chromium.launch({headless:true,channel:'msedge'});let page;
try{
 const context=await browser.newContext({viewport:{width:1600,height:1100}});context.setDefaultTimeout(20000);
 let workerUrl;context.on('request',request=>{if(request.url().includes('anatomy-surface.worker-'))workerUrl=request.url();});
 const errors=[];context.on('page',p=>{p.on('pageerror',e=>{errors.push(e.message);writeFileSync(out+'/errors.json',JSON.stringify(errors));});p.on('console',m=>{if(m.type()==='error')writeFileSync(out+'/console-all.txt',m.text()+'\n',{flag:'a'});});});
 await context.route('**/local-archive-api/**',route=>{const p=new URL(route.request().url()).pathname;if(p.endsWith('/license'))return route.fulfill({json:{valid:true,required:true,kind:'owner',deviceId:'SYNTHETIC-TEST',message:'Test'}});if(p.endsWith('/instances'))return route.fulfill({json:files.map((_,i)=>({uid:String(i)}))});if(p.includes('/file/'))return route.fulfill({contentType:'application/dicom',body:files[Number(p.split('/').pop())]});return route.fulfill({json:[]});});
 let meta,mask;const job='11111111-1111-4111-8111-111111111111';
 // Synthetic mask tests rendering/editing only. No inference accuracy claim.
 await context.route('**/anatomy-volume/jobs**',route=>{const req=route.request(),p=new URL(req.url()).pathname;
  if(p.endsWith('/jobs')&&req.method()==='POST'){meta=JSON.parse(req.postData());const [nx,ny,nz]=meta.dimensions;mask=Buffer.alloc(nx*ny*nz);for(let z=2;z<nz-2;z++)for(let y=Math.floor(ny*.3);y<ny*.7;y++)for(let x=Math.floor(nx*.3);x<nx*.7;x++)mask[(z*ny+y)*nx+x]=x<nx/2?1:2;return route.fulfill({json:{id:job}});}
  if(p.endsWith('/result'))return route.fulfill({json:{...meta,classes:{1:'liver',2:'spleen'},device:'test',task:'total',seconds:0,modelSpacingMm:3,experimental:true}});
  if(p.endsWith('/mask'))return route.fulfill({contentType:'application/octet-stream',body:mask});
  return route.fulfill({json:{state:'ready'}});
 });
 page=await context.newPage();await page.goto(base+'/#archive-study=2.25.702');await page.waitForFunction(()=>document.querySelector('.statusbar')?.textContent.includes('40 DICOM'));
 await page.getByRole('button',{name:'KT və MRT anatomiyası',exact:true}).click();const panel=page.locator('.anatomy-volume-panel');await panel.getByRole('button',{name:'Seriyanı analiz et',exact:true}).click();await panel.locator('[role=status]').filter({hasText:'Anatomik xəritə hazırdır'}).waitFor();
 assert.equal(await panel.locator('.anatomy-structure-list>div').count(),2);
 await panel.getByRole('button',{name:'Qaraciyər',exact:true}).click();await panel.getByRole('button',{name:'Fırça',exact:true}).click();
 const canvas=page.locator('[data-panel="A"] .dicom-canvas'),box=await canvas.boundingBox();await page.mouse.click(box.x+box.width*.5,box.y+box.height*.5);await panel.getByRole('button',{name:'Geri al',exact:true}).waitFor();assert.ok(await panel.getByRole('button',{name:'Geri al',exact:true}).isEnabled());await panel.getByRole('button',{name:'Geri al',exact:true}).click();assert.ok(await panel.getByRole('button',{name:'Təkrar et',exact:true}).isEnabled());
 await page.keyboard.press('Escape');
 const saved=page.waitForEvent('download');await panel.getByRole('button',{name:'Xəritəni saxla',exact:true}).click();const f=await saved;await f.saveAs(out+'/synthetic.radazseg');
 await page.screenshot({path:out+'/anatomy-controls.png'});
 const mprOpened=context.waitForEvent('page');await page.getByRole('button',{name:'MPR rekonstruksiya',exact:true}).click();const mpr=await mprOpened;await mpr.waitForFunction(()=>document.querySelectorAll('.anatomy-volume-overlay').length===3);await mpr.screenshot({path:out+'/mpr-anatomy.png'});await mpr.close();
 const opened=context.waitForEvent('page');await page.getByRole('button',{name:'3D həcm görüntüləmə',exact:true}).click();const volume=await opened;await volume.locator('.cornerstone-volume-stage[data-ready=true]').waitFor();
 writeFileSync(out+'/step.txt','before surfaces');await volume.getByRole('checkbox',{name:'3D səthlər',exact:true}).click({noWaitAfter:true});writeFileSync(out+'/step.txt','after surfaces');await volume.locator('.anatomy-surface-controls[data-state=ready]').waitFor();assert.equal(await volume.locator('.anatomy-surface-controls [role=alert]').count(),0);
 assert.ok(workerUrl,'surface worker URL observed');
 const physicalBounds=await volume.evaluate(url=>new Promise((resolve,reject)=>{const worker=new Worker(url,{type:'module'}),mask=new Uint8Array(27);mask[13]=1;const timeout=setTimeout(()=>{worker.terminate();reject(Error('worker timeout'));},10000);worker.onmessage=event=>{if(event.data.points){const points=event.data.points,bounds=[];for(let axis=0;axis<3;axis++){const values=Array.from(points).filter((_,i)=>i%3===axis);bounds.push(Math.min(...values),Math.max(...values));}clearTimeout(timeout);worker.terminate();resolve(bounds);}else if(event.data.error){clearTimeout(timeout);worker.terminate();reject(Error(event.data.error));}};worker.postMessage({mask,labels:[1],geometry:{dimensions:[3,3,3],spacing:[1,2,3],origin:[10,20,30],direction:[0,1,0,-1,0,0,0,0,1]}});}),workerUrl);
 assert.deepEqual(physicalBounds,[7,9,20.5,21.5,31.5,34.5]);
 await volume.getByRole('checkbox',{name:'Mənbə həcm',exact:true}).uncheck();await volume.screenshot({path:out+'/surfaces-only.png'});await volume.getByRole('checkbox',{name:'Mənbə həcm',exact:true}).check();
 const plyDownload=volume.waitForEvent('download');await volume.getByRole('button',{name:'İxrac et PLY',exact:true}).click();await (await plyDownload).saveAs(out+'/synthetic-LPS.ply');

 await volume.getByRole('button',{name:'Professional 3D ayarları',exact:true}).click();await volume.getByRole('checkbox',{name:'Fərdi transfer funksiyası',exact:true}).check();await volume.getByRole('checkbox',{name:'Altı müstəvi ilə kəsmə',exact:true}).check();await volume.getByRole('slider',{name:'Həcm oxu I Başlanğıc',exact:true}).fill('30');await volume.screenshot({path:out+'/transfer-crop.png'});await volume.keyboard.press('Escape');
 await page.getByRole('button',{name:'Yardım və lisenziya',exact:true}).click();await page.getByRole('menuitem',{name:'Ayarlar',exact:true}).click();await page.getByRole('combobox',{name:'İnterfeys dili',exact:true}).selectOption('en');assert.equal(await page.locator('html').getAttribute('lang'),'en');await page.getByRole('combobox',{name:'Interface language',exact:true}).waitFor();await page.getByRole('combobox',{name:'Interface language',exact:true}).selectOption('ru');await page.getByRole('combobox',{name:'Язык интерфейса',exact:true}).selectOption('en');await page.getByRole('dialog').locator('footer button').click();
 await panel.getByRole('button',{name:'Liver',exact:true}).waitFor();await page.screenshot({path:out+'/anatomy-en.png'});
 await page.reload();await page.waitForFunction(()=>document.documentElement.lang==='en');
 await volume.close();assert.deepEqual(errors,[]);writeFileSync(out+'/browser-result.json',JSON.stringify({passed:true,syntheticOnly:true,checks:['model registry','mask overlays','detached MPR overlays','per-structure controls','brush undo redo','segmentation export','detached 3D surfaces','worker physical LPS geometry','PLY export','custom transfer','oblique-ready cropping','language switching and persistence'],errors},null,2));console.log('PASS: platform browser checks');
} catch(error){if(page){await page.screenshot({path:out+'/failure.png'}).catch(()=>{});writeFileSync(out+'/failure.txt',await page.locator('body').innerText().catch(()=>''));}throw error;}finally{await browser.close();}
