const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE);
const {observeTabletCanvas}=require('./vr-tablet-return.cjs');
const url='https://appassets.androidplatform.net';
const files=fs.readdirSync(process.env.VR_CT_DIR).filter(f=>f.endsWith('.dcm')).slice(0,24).map(name=>{
  const b=fs.readFileSync(path.join(process.env.VR_CT_DIR,name)),i=b.indexOf(Buffer.from([224,127,16,0,79,87]));
  assert.ok(i>0);const start=i+12,n=Math.sqrt((b.length-start)/2);assert.equal(n,Math.floor(n));
  b.fill(0,start);for(let y=78;y<=84;y++)for(let x=60;x<=66;x++)b.writeInt16LE(1800,start+2*(y*n+x));
  return {name,mimeType:'application/dicom',buffer:b};
});
async function frame(page){await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));}
async function pixel(page){
 return page.locator('[data-panel=A]').evaluate(p=>{
  let vp;
  for(let f=p[Object.keys(p).find(k=>k.startsWith('__reactFiber'))];f&&!vp;f=f.return)
    for(let h=f.memoizedState;h;h=h.next){const v=h.memoizedState;if(v?.getCurrentImageId&&v?.worldToCanvas){vp=v;break;}}
  if(!vp)throw Error('Missing viewport');
  const c=vp.canvas,rect=c.getBoundingClientRect(),ctx=c.getContext('2d'),rgba=ctx.getImageData(0,0,c.width,c.height).data;
  let x=0,y=0,n=0;for(let j=0;j<c.height;j++)for(let i=0;i<c.width;i++)if(rgba[(j*c.width+i)*4]>230){x+=i+.5;y+=j+.5;n++;}
  if(!n)throw Error('No visible phantom landmark');
  const img=vp.getImageData(),world=img.origin.map((v,k)=>v+63.5*img.spacing[0]*img.direction[k]+81.5*img.spacing[1]*img.direction[3+k]);
  const expected=[x/n*rect.width/c.width,y/n*rect.height/c.height],projected=vp.worldToCanvas(world),back=vp.canvasToWorld(projected);
  return {expected,projected,error:Math.hypot(expected[0]-projected[0],expected[1]-projected[1]),roundtrip:Math.hypot(...world.map((v,i)=>v-back[i])),scale:vp.getCamera().parallelScale};
 });
}
async function anchor(page,label){await frame(page);const s=await pixel(page);console.log(label,JSON.stringify(s));assert.ok(s.error<3,label+' image landmark mismatch');assert.ok(s.roundtrip<.02);return s;}
async function withTablet(check){const b=await chromium.launch({channel:'msedge',headless:true,args:['--enable-unsafe-swiftshader']});
 try{
 const ctx=await b.newContext({viewport:{width:1200,height:800},deviceScaleFactor:2,hasTouch:true,isMobile:true});ctx.setDefaultTimeout(12000);
 await observeTabletCanvas(ctx);
 await ctx.route(url+'/**',async r=>{
  const pathname=new URL(r.request().url()).pathname;
  if(pathname.includes('/local-archive-api/'))return r.fulfill({json:pathname.endsWith('/license')?{valid:true,required:true,kind:'owner'}:[]});
  const f=path.join(process.env.VR_TABLET_ASSETS,path.extname(pathname)?pathname:pathname+'/index.html');
  return fs.existsSync(f)&&fs.statSync(f).isFile()?r.fulfill({path:f}):r.fulfill({status:404,body:''});
 });
 const p=await ctx.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));
 await p.goto(url);await p.locator('.statusbar').filter({hasText:'Cornerstone3D hazırdır'}).waitFor();
 await p.locator('input[type=file][multiple]:not([webkitdirectory])').first().setInputFiles(files);
 const pane=p.locator('[data-panel=A]');await pane.locator('.bottom-right').filter({hasText:'/ 24'}).waitFor();await frame(p);
 await check({ctx,p,pane,errors});
 }finally{await b.close();}
}
module.exports={withTablet,anchor,pixel,frame};
