const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const readline=require('node:readline');
const {spawn}=require('node:child_process');

async function fixture(release){
  const root=path.resolve(__dirname,'..');
  const jar=path.join(root,'build/qa/json-20240303.jar');
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(jar)).digest('hex'),'3cf6cd6892e32e2b4c1c39e0f52f5248a2f5b37646fdfbb79a66b46b618414ed');
  const child=spawn(process.env.TABLET_TEST_PYTHON||'python',['-u',path.join(__dirname,'clinic-fixture.py'),release,process.env.JAVA_HOME,jar],{windowsHide:true,stdio:['pipe','pipe','inherit']});
  const rows=readline.createInterface({input:child.stdout});
  const waiting=[];
  let failure;
  const next=()=>new Promise((ok,no)=>failure?no(failure):waiting.push({ok,no}));
  rows.on('line',line=>waiting.shift()?.ok(JSON.parse(line)));
  child.on('exit',code=>{failure=Error('Clinic fixture exited ('+code+')');while(waiting.length)waiting.shift().no(failure);});
  const settings=await next();
  function call(client,action,data={},session='',profile='internet',window='settings',restart=false) {
    const promise=next();
    child.stdin.write(JSON.stringify({client,window,action,data,session,profile,restart})+'\n');
    return promise.then(reply=>{
      if(reply.error && process.env.TABLET_TEST_TRACE)console.log('Fixture',profile,action,reply.code);
      return reply;
    });
  }
  return {settings,call,close:()=>child.stdin.end()};
}
async function checkNetwork(network,settings){
  const password=crypto.randomBytes(18).toString('hex');
  const form=settings.locator('.dn-access-form');
  await form.locator('[name=password]').fill(password);
  await form.locator('[name=confirm]').fill(password);
  await form.getByRole('button',{name:'Şifrəni yarat'}).click();
  const enroll=settings.getByRole('button',{name:'Qoşul və cihaz ID-si al'});
  await settings.locator('form').filter({has:enroll}).locator('[name=name]').fill('Synthetic Tablet');
  await enroll.click();
  const idField=settings.locator('input[readonly]').first();
  await idField.waitFor();
  const id=await idField.inputValue();
  assert.match(id,/^RD-(?:[A-F0-9]{4}-){7}[A-F0-9]{4}$/);
  const secrets={};
  async function apply(client,action,body={},profile='internet',restart=false){
    return await network.call(client,action,body,secrets[client]||'',profile,'settings',restart);
  }
  for(const client of ['Clinic Alpha','Clinic Beta']){
    let reply=await apply(client,'settings_set',{password});
    secrets[client]=reply.data.session;
    await apply(client,'enroll_pc',{name:client});
    const clinic=(await apply(client,'open_clinic',{name:client})).data.clinic;
    const invitation=await apply(client,'invite_pc',{clinic,target:id,name:'Synthetic Radiologist'});
    assert.ok(invitation.data.id);
    const wrong=await apply(client==='Clinic Alpha'?'unregistered':'Clinic Alpha','answer_invite',{id:invitation.data.id,accept:true});
    assert.ok(wrong.error);
  }
  await settings.getByRole('button',{name:'Yenilə',exact:true}).click();
  for(const name of ['Clinic Alpha','Clinic Beta']){
    const card=settings.locator('article').filter({has:settings.getByRole('heading',{name:name+' klinikasından dəvət',exact:true})});
    await card.getByRole('button',{name:'Dəvəti qəbul et'}).click();
    await card.waitFor({state:'detached'});
  }
  const clinics=settings.locator('.dn-layout aside select').first();
  await settings.waitForFunction(()=>document.querySelector('.dn-layout aside select')?.options.length===2);
  assert.deepEqual((await clinics.locator('option').allTextContents()).sort(),['Clinic Alpha','Clinic Beta']);
  await clinics.selectOption({label:'Clinic Beta'});
  await settings.getByRole('button',{name:'Klinikalar və radioloqlar'}).click();
  assert.equal(await form.count(),0);
  assert.equal(await settings.getByRole('button',{name:'Dəvəti həkimin RADAZ-ına göndər'}).count(),0);
  const create=settings.getByRole('button',{name:'Bu cihaz üçün klinika yarat'});
  await settings.locator('form').filter({has:create}).locator('[name=name]').fill('Tablet Clinic');
  await create.click();
  await clinics.selectOption({label:'Tablet Clinic'});
  const send=settings.getByRole('button',{name:'Dəvəti həkimin RADAZ-ına göndər'});
  const invitationForm=settings.locator('form').filter({has:send});
  const other='Clinic Alpha';
  const recipient=(await apply(other,'settings_state')).data.deviceId;
  await invitationForm.locator('[name=name]').fill('Synthetic consultant');
  await invitationForm.locator('[name=target]').fill(recipient);
  await send.click();
  await settings.getByText('Synthetic consultant · qəbul gözlənilir').waitFor();
  const incoming=(await apply(other,'settings_state')).data.invitations.find(i=>i.clinic==='Tablet Clinic');
  assert.ok((await apply(other,'answer_invite',{id:incoming.id,accept:true})).data.clinic);
  // A separate private HTTPS profile uses one-time enrollment and can link another clinic.
  await settings.getByLabel('Şəbəkə bağlantısı').selectOption('private');
  await settings.getByRole('button',{name:'Bağlantı ayarları',exact:true}).click();
  await settings.getByLabel('Şəbəkə xidmətinin ünvanı',{exact:true}).fill(network.settings.privateUrl);
  await settings.getByLabel('Cihazın adı',{exact:true}).fill('Synthetic Tablet Private');
  await settings.getByLabel('Birdəfəlik dəvət kodu').fill(network.settings.invites[0]);
  await settings.getByRole('button',{name:'Qeydiyyata al'}).click();
  await settings.waitForFunction(()=>document.querySelector('.dn-layout aside select')?.selectedOptions[0]?.textContent==='Private Alpha');
  const link=settings.getByLabel('Başqa klinikaya qoşulmaq üçün dəvət kodu');
  await link.fill(network.settings.invites[1]);await settings.getByRole('button',{name:'Klinikaya qoşul',exact:true}).click();
  await settings.waitForFunction(()=>[...document.querySelectorAll('.dn-layout aside select:first-of-type option')].some(o=>o.textContent==='Private Beta')).catch(async error=>{
    const labels=await settings.locator('.dn-body [role="alert"],.dn-body [role="status"],.dn-layout aside select').allInnerTexts();
    throw Error('Private clinic link: '+JSON.stringify(labels)+' '+error.message);
  });
  assert.deepEqual((await clinics.locator('option').allTextContents()).sort(),['Private Alpha','Private Beta']);
  await settings.getByRole('button',{name:'Kilidlə',exact:true}).click();
  await form.getByRole('button',{name:'Kilidi aç'}).waitFor();
  assert.equal((await apply('Tablet','settings_state')).code,'SETTINGS_LOCKED');
  const locked=await network.call('Tablet','settings_unlock',{password:'invalid-value'},'','private','settings',true);
  assert.equal(locked.code,'SETTINGS_PASSWORD_INVALID');
  const grant=await network.call('Tablet','settings_unlock',{password},'','private','settings');
  assert.ok(grant.data.session);
  const restored=await network.call('Tablet','settings_state',{},grant.data.session);
  assert.deepEqual(restored.data.clinics.map(c=>c.name).sort(),['Clinic Alpha','Clinic Beta','Tablet Clinic']);
  const replay=await network.call('Tablet','link_clinic',{invite:network.settings.invites[1]},grant.data.session,'private');
  assert.equal(replay.code,'HTTP_403');
  const anotherWindow=await network.call('Tablet','settings_state',{},grant.data.session,'private','other-window');
  assert.equal(anotherWindow.code,'SETTINGS_LOCKED');
  return {incomingClinics:2,outgoingInviteAccepted:true,privateInvite:true,settingsLock:true,identityAfterRestart:true};
}
module.exports={fixture,checkNetwork};
