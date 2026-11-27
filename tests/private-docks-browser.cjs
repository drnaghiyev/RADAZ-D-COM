const {chromium}=require(process.env.PLAYWRIGHT_MODULE),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
(async()=>{const browser=await chromium.launch({channel:'msedge',headless:true});
try{for(const touch of [false,true]){
 const url=touch?'https://appassets.androidplatform.net':process.env.RADAZ_TEST_URL;
 const ctx=await browser.newContext({viewport:{width:1350,height:850},hasTouch:touch,isMobile:touch});
 if(touch)await ctx.route(url+'/**',r=>{const p=new URL(r.request().url()).pathname,f=path.join(process.env.VR_TABLET_ASSETS,p.endsWith('/')?p+'index.html':p);return fs.existsSync(f)&&fs.statSync(f).isFile()?r.fulfill({path:f}):r.fulfill({status:404,body:''});});
 await ctx.route('**/local-archive-api/**',r=>r.fulfill({json:r.request().url().endsWith('/license')?{valid:true,required:true,kind:'owner'}:[]}));
 const p=await ctx.newPage();p.setDefaultTimeout(9000);const err=[];p.on('pageerror',e=>err.push(e.message));
 await p.goto(url);const top=p.locator('.flat-toolbar-top'),right=p.locator('.flat-toolbar-right');
 await top.locator('[data-toolbar-item]').first().waitFor();await p.waitForTimeout(500);
 const n=()=>top.locator('[data-toolbar-item]:visible').count(),before=await n();
 await p.setViewportSize({width:750,height:850});await p.waitForTimeout(450);const narrow=await n();
 assert.ok(narrow<before,'fewer top buttons on narrow display');assert.ok(await right.locator('[data-tool-dock=top]').count()>0);
 await p.setViewportSize({width:1350,height:850});await p.waitForTimeout(600);assert.equal(await n(),before);
 const from=top.locator('[data-toolbar-item]:visible').first(),to=right.locator('[data-toolbar-item]:visible').first(),id=await from.getAttribute('data-toolbar-item');
 const a=await from.boundingBox(),b=await to.boundingBox(),x=a.x+a.width/2,y=a.y+a.height/2,tx=b.x+b.width/2,ty=b.y+b.height/2;
 const cdp=await ctx.newCDPSession(p);
 if(touch){const send=(type,pts)=>cdp.send('Input.dispatchTouchEvent',{type,touchPoints:pts});await send('touchStart',[{x,y,id:1}]);await p.waitForTimeout(550);await send('touchMove',[{x:tx,y:ty,id:1}]);await send('touchEnd',[]);}
 else{await p.mouse.move(x,y);await p.mouse.down();await p.mouse.move(tx,ty,{steps:12});await p.mouse.up();}
 const docked=right.locator('[data-toolbar-item="'+id+'"][data-tool-dock=right]');await docked.waitFor();await p.reload();await docked.waitFor();
 console.log('PASS',touch?'long press':'mouse',id,'top to right, persisted and responsive overflow');
 for(const route of ['archive','pacs']){
   await p.goto(url+'/'+route+'/');const filter=p.locator('.records-header-filters'),bar=p.locator('.flat-toolbar-top');await bar.locator('button:visible').first().waitFor();const f=await filter.boundingBox(),t=await bar.boundingBox();
   assert.ok(f.x<t.x && Math.max(f.y,t.y)<Math.min(f.y+f.height,t.y+t.height),route+' single row');
 }
 console.log('PASS record filters and tools share row');assert.deepEqual(err,[]);await ctx.close();
}}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1});
