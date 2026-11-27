const assert=require('node:assert/strict'),path=require('node:path');
async function verifyAirway({view,vr,raster,drag,tablet,resultDir}){
  const button=name=>vr.getByRole('button',{name,exact:true});
  await button('3D rəng rejimləri').click(); await button('Tənəffüs yolları').click();
  await button('WW/WL ayarları · Ctrl+F11').click();
  const checkbox=vr.getByLabel('Bədən xaricini gizlət');
  assert.ok(await checkbox.isChecked());
  assert.equal(await vr.getByLabel('WL',{exact:true}).inputValue(),'129');
  assert.equal(await vr.getByLabel('WW',{exact:true}).inputValue(),'279');
  await button('Menyunu bağla').click();
  await drag(45,17);
  // Allow the interaction-quality image to refine before comparing pixels.
  const capture=async name=>{
    let frame=await raster.screenshot();
    for(let i=0;i<12;i++){
      await view.waitForTimeout(125);
      const next=await raster.screenshot();
      if(frame.equals(next)){frame=next;break;}
      frame=next;
    }
    require('node:fs').writeFileSync(path.join(resultDir,'airway-'+(tablet?'tablet':'desktop')+'-'+name+'.png'),frame);
    return frame.toString('base64');
  };
  const masked=await capture('masked');
  const toggle=async enabled=>{
    await button('WW/WL ayarları · Ctrl+F11').click();
    await checkbox.setChecked(enabled); await button('Menyunu bağla').click();
  };
  await toggle(false);
  const full=await capture('exterior');
  await toggle(true);
  const restored=await capture('restored');
  const metrics=await view.evaluate(async frames=>{
    const arrays=await Promise.all(frames.map(async png=>{
      const img=new Image();img.src='data:image/png;base64,'+png;await img.decode();
      const canvas=document.createElement('canvas');canvas.width=img.width;canvas.height=img.height;
      const c=canvas.getContext('2d');c.drawImage(img,0,0);
      return c.getImageData(0,0,canvas.width,canvas.height).data;
    }));
    const [a,b,c]=arrays;
    let cool=0,pale=0,exteriorDifferences=0,restoreDifferences=0;
    for(let i=0;i<a.length;i+=4){
      if(a[i+2]-a[i]>11 && a[i+2]>50 && a[i+1]>a[i])cool++;
      if(Math.min(a[i],a[i+1],a[i+2])>65 && Math.max(a[i],a[i+1],a[i+2])-Math.min(a[i],a[i+1],a[i+2])<18)pale++;
      if(Math.abs(a[i]-b[i])+Math.abs(a[i+1]-b[i+1])+Math.abs(a[i+2]-b[i+2])>30)exteriorDifferences++;
      if(Math.abs(a[i]-c[i])+Math.abs(a[i+1]-c[i+1])+Math.abs(a[i+2]-c[i+2])>30)restoreDifferences++;
    }
    return {cool,pale,exteriorDifferences,restoreDifferences,pixels:a.length/4};
  },[masked,full,restored]);
  console.log((tablet?'APK WebView emulation':'Desktop')+' airway after orbit',metrics);
  assert.ok(metrics.cool>30 && metrics.pale>100,'pale lung and blue airway are both visible');
  assert.ok(metrics.exteriorDifferences>200,'removing the exterior changes the rendered image');
  assert.ok(metrics.restoreDifferences<metrics.pixels*.001,'re-enabling mask restores the rendered image');
}
module.exports={verifyAirway};
