const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE);

const sections = [
  ['cd/.0','import/.0','output/.0'],
  ['workspace/.$mpr','workspace/.$3d','workspace/.$archive','workspace/.$pacs','smart-volume/.0','workspace/.4'],
  ['layout/.0','window/.1','window/.0','contrast/.0','annotations/.0','layout/.1','window/.2','help/.0'],
  ['measure/.0:$scroll','measure/.0:$wl','measure/.0:$pan','measure/.0:$zoom','measure/.1','workspace/.3','measure/.2'],
  ['cine/.0','cine/.1','cine/.2','cine/.3','cine/.4','cine/.5'],
  ['workspace/.0','output/.1','output/.2'],
  ['help/.1','toolbar-settings/.0'],
];

(async()=>{
  for(const tablet of [false,true]){
      const origin=tablet?'https://appassets.androidplatform.net':process.env.RADAZ_TEST_URL;
      if(!origin || tablet&&!process.env.VR_TABLET_ASSETS)continue;
      const profile=fs.mkdtempSync(path.join(os.tmpdir(),'radaz-test-toolbar-'));
      const errors=[];let ctx,p;
      async function launch(){
      ctx=await chromium.launchPersistentContext(profile,{channel:'msedge',headless:true,viewport:{width:1920,height:1000},hasTouch:tablet,isMobile:tablet});
      if(tablet)await ctx.route(origin+'/**',r=>{
        const pathname=new URL(r.request().url()).pathname;
        const file=path.join(process.env.VR_TABLET_ASSETS,pathname.endsWith('/')?pathname+'index.html':pathname);
        return fs.existsSync(file)&&fs.statSync(file).isFile()?r.fulfill({path:file}):r.fulfill({status:404,body:''});
      });
      await ctx.route('**/local-archive-api/**',r=>r.fulfill({json:r.request().url().endsWith('/license')?{valid:true,required:true,kind:'owner'}:[]}));
      p=ctx.pages()[0] || await ctx.newPage();p.on('pageerror',e=>errors.push(e.message));
      await p.goto(origin+'/');
      }
      try {
      await launch();
      const read=()=>p.locator('[data-toolbar-scope=viewer] [data-toolbar-item][data-tool-dock=top]:not([hidden])').evaluateAll(els=>els.sort((a,b)=>a.style.order-b.style.order).map(e=>e.dataset.toolbarItem));
      const expected=sections.flat().filter(id=>!tablet||id!=='cd/.0');
      const waitForTools=()=>p.waitForFunction(n=>document.querySelectorAll('[data-toolbar-scope=viewer] [data-toolbar-item][data-tool-dock=top]:not([hidden])').length===n,expected.length);
      await waitForTools();assert.deepEqual(await read(),expected);
      assert.deepEqual(new Set(await p.locator('[data-toolbar-divider=true]').evaluateAll(es=>es.map(e=>e.dataset.toolbarItem))),new Set(sections.slice(1).map(s=>s[0])));
      const first=p.locator('[data-toolbar-item="import/.0"]'),target=p.locator('[data-toolbar-item="workspace/.$mpr"]');
      const a=await first.boundingBox(),b=await target.boundingBox(),start={x:a.x+10,y:a.y+a.height/2},end={x:b.x+b.width*.7,y:b.y+b.height/2};
      if(tablet){
        const cdp=await ctx.newCDPSession(p),send=(type,touchPoints)=>cdp.send('Input.dispatchTouchEvent',{type,touchPoints});
        await send('touchStart',[{...start,id:1}]);
        await p.locator('[data-toolbar-item="import/.0"][data-moving=true]').waitFor();
        await send('touchMove',[{...end,id:1}]);await send('touchEnd',[]);
      }else{
        await p.mouse.move(start.x,start.y);await p.mouse.down();await p.mouse.move(end.x,end.y,{steps:9});await p.mouse.up();
      }
      const changed=expected.filter(id=>id!=='import/.0');
      changed.splice(changed.indexOf('workspace/.$mpr')+1,0,'import/.0');
      await p.waitForFunction(()=>{const v=JSON.parse(localStorage.getItem('radaz-toolbar-flat-v1:viewer')||'{}').positions;return v&&v['import/.0'].order>v['workspace/.$mpr'].order;});
      await ctx.close();ctx=null;await launch();await waitForTools();assert.deepEqual(await read(),changed);
      await p.getByRole('button',{name:'Alət panelini fərdiləşdir',exact:true}).click();
      await p.getByRole('button',{name:'Standart düzülüşü bərpa et'}).click();await p.getByRole('button',{name:'Təsdiq',exact:true}).click();
      assert.deepEqual(await read(),expected);assert.deepEqual(errors,[]);
      console.log('PASS',tablet?'Android':'desktop',expected.length,'main toolbar actions, separators, drag, saved layout after complete process restart and confirmed reset');
      }finally{
        if(ctx)await ctx.close();
        if(path.dirname(profile)===path.resolve(os.tmpdir()) && path.basename(profile).startsWith('radaz-test-toolbar-')){
          fs.rmSync(profile,{recursive:true,force:true,maxRetries:5,retryDelay:100});
        }
      }
  }
})().catch(e=>{console.error(e);process.exitCode=1;});
