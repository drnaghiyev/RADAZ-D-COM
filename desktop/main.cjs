const {app,BrowserWindow,Menu,Tray,dialog,shell,session,webContents}=require('electron');
const {spawn}=require('node:child_process');
const {existsSync,mkdirSync,openSync,closeSync,readFileSync,appendFileSync}=require('node:fs');
const path=require('node:path');
const installRoot=process.env.RADAZ_DESKTOP_RUNTIME||process.env.RADAZ_INSTALL_ROOT||path.resolve(__dirname,'../../../../../..');
let runtime=path.join(installRoot,'versions',require('./package.json').version);
const port=Number(process.env.RADAZ_PORT||5173),workerPort=Number(process.env.RADAZ_WORKER_PORT||5175);
const origin=`http://localhost:${port}`,archivePort=Number(process.env.RADAZ_ARCHIVE_PORT||8766);
const profile=process.env.RADAZ_DESKTOP_PROFILE||path.join(app.getPath('appData'),'RADAZ Desktop');
app.setName('RADAZ Desktop');app.setPath('userData',profile);app.setAppUserModelId('RADAZ.Desktop');
// Bound Chromium's disposable HTTP cache only. Never clear IndexedDB,
// localStorage or the clinical archive: those may contain the only DICOM copy.
app.commandLine.appendSwitch('disk-cache-size',String(256*1024*1024));
let tray,mainWindow,quitting=false;
const windows=new Set();
const local=url=>{try{return new URL(url).origin===origin;}catch{return false;}};
const cloudVoice=url=>{try{return new URL(url).origin==='https://radaz.space';}catch{return false;}};
const cloudWindows=new Set();
function configureCloud(win){
 windows.add(win);cloudWindows.add(win.webContents.id);win.setMenuBarVisibility(false);win.maximize();
 const id=win.webContents.id;win.on('closed',()=>{windows.delete(win);cloudWindows.delete(id);});
 win.webContents.setWindowOpenHandler(({url})=>{if(cloudVoice(url)){void win.loadURL(url);return {action:'deny'};}external(url);return {action:'deny'};});
 for(const event of ['will-navigate','will-redirect'])win.webContents.on(event,(e,url)=>{if(!cloudVoice(url)){e.preventDefault();external(url);}});
}
const external=url=>{try{if(['https:','http:','mailto:'].includes(new URL(url).protocol))void shell.openExternal(url);}catch{}};
const show=()=>{if(mainWindow&&!mainWindow.isDestroyed()){if(mainWindow.isMinimized())mainWindow.restore();mainWindow.show();mainWindow.focus();}};
function configure(win){
 windows.add(win);win.setMenuBarVisibility(false);if(win!==mainWindow)win.maximize();win.on('closed',()=>windows.delete(win));
 win.webContents.setWindowOpenHandler(({url,frameName})=>{
  if(frameName==='radaz-cloud-voice'&&url==='https://radaz.space/voice/')return {action:'allow',overrideBrowserWindowOptions:{width:1280,height:900,minWidth:600,minHeight:600,autoHideMenuBar:true,title:'RADAZ Voice · sayt hesabı',webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true}}};
  if(frameName==='radaz-system-report'&&local(url)&&new URL(url).pathname==='/report'){external(url);return {action:'deny'};}
  // Native window.open retains opener and BroadcastChannel for MPR/report handoffs.
  if(local(url)||url==='about:blank'||url==='')return {action:'allow',overrideBrowserWindowOptions:{width:1500,height:980,minWidth:480,minHeight:400,autoHideMenuBar:true,icon:path.join(runtime,'public/radaz.ico'),webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true}}};
  external(url);return {action:'deny'};
 });
 win.webContents.on('did-create-window',(child,details)=>{if(cloudVoice(details.url))configureCloud(child);else configure(child);});
 win.webContents.on('will-navigate',(event,url)=>{if(!local(url)&&url!=='about:blank'){event.preventDefault();external(url);}});
 win.webContents.on('will-redirect',(event,url)=>{if(!local(url))event.preventDefault();});
}
async function waitForReady(){const until=Date.now()+120000;while(Date.now()<until){try{const response=await fetch(origin+'/radaz-health.json',{signal:AbortSignal.timeout(1500)});if(response.ok&&(await response.json()).ready)return;}catch{}await new Promise(r=>setTimeout(r,350));}throw Error('RADAZ xidməti başlamadı. Log: '+path.join(profile,'logs'));}
async function run(command){
 mkdirSync(path.join(profile,'logs'),{recursive:true});const log=openSync(path.join(profile,'logs/desktop.log'),'a');
 let task;try{task=spawn(path.join(runtime,'runtime/python/python.exe'),['bridge/radaz_desktop.py',command,'--install-root',installRoot,'--no-shortcuts','--no-browser'],{cwd:runtime,windowsHide:true,stdio:['ignore',log,log],env:{...process.env,PATH:[path.join(runtime,'runtime/node'),path.join(runtime,'runtime/python'),path.join(runtime,'runtime/ffmpeg'),path.join(process.env.SystemRoot||'C:/Windows','System32'),path.join(process.env.SystemRoot||'C:/Windows','System32/WindowsPowerShell/v1.0'),process.env.PATH||''].join(path.delimiter),RADAZ_INSTALL_ROOT:installRoot,RADAZ_PORT:String(port),RADAZ_WORKER_PORT:String(workerPort),RADAZ_ARCHIVE_PORT:String(archivePort)}});}finally{closeSync(log);}
 await new Promise((resolve,reject)=>{task.once('error',reject);task.once('exit',code=>code===0?resolve():reject(Error('RADAZ açıla bilmədi. Log: '+path.join(profile,'logs/desktop.log'))));});
}
async function boot(){
 if(!existsSync(path.join(runtime,'dist/server/index.js')))throw Error('RADAZ tətbiq faylları çatışmır. Setup faylını yenidən başladın.');
 // Reuse the original package verification, update staging and rollback. Local
 // services outlive the windows; the clinical archive remains outside this root.
 if(!existsSync(path.join(installRoot,'active.json')))await run('initialize');
 const active=JSON.parse(readFileSync(path.join(installRoot,'active.json'),'utf8')).version;
 if(!/^\d+\.\d+\.\d+$/.test(active))throw Error('RADAZ versiya məlumatı düzgün deyil.');
 runtime=path.join(installRoot,'versions',active);
 const handedBuild=process.argv.find(arg=>arg.startsWith('--radaz-ready-build='))?.split('=')[1];
 let handedReady=false;
 if(handedBuild){
  const expected=JSON.parse(readFileSync(path.join(runtime,'dist/server/radaz-build.json'),'utf8'));
  try{
   const [served,health]=await Promise.all(['/radaz-runtime.json','/radaz-health.json'].map(async route=>{
    const response=await fetch(origin+route,{signal:AbortSignal.timeout(3000)});if(!response.ok)throw Error('Health unavailable');return response.json();
   }));
   handedReady=handedBuild===expected.buildId&&served.buildId===handedBuild&&served.version===active&&health.buildId===handedBuild&&health.ready===true;
  }catch{}
 }
 // A shortcut's controller already validated the package and listener. Avoid
 // launching a second controller for its newly opened native window.
 if(!handedReady)await run('launch');
 await waitForReady();
 runtime=path.join(installRoot,'versions',JSON.parse(readFileSync(path.join(installRoot,'active.json'),'utf8')).version);
 // Existing RADAZ receivers deliberately accept the original 5173 origin.
 // Translate only requests from our own sandboxed local windows to the two
 // fixed loopback services. Their authentication and endpoint checks remain.
 const bridge='http://127.0.0.1:8765';
 const owned=d=>{const wc=webContents.fromId(d.webContentsId);return !!wc&&local(wc.getURL());};
 session.defaultSession.webRequest.onBeforeSendHeaders({urls:[origin+'/local-archive-api/*',bridge+'/*']},(details,callback)=>{
  const headers={...details.requestHeaders};
  if(owned(details)&&(!headers.Origin||headers.Origin===origin)){
   headers.Origin='http://localhost:5173';
   if(details.url.startsWith(origin+'/'))headers.Host='localhost:5173';
  }
  callback({requestHeaders:headers});
 });
 session.defaultSession.webRequest.onHeadersReceived({urls:[bridge+'/*']},(details,callback)=>{
  const headers={...details.responseHeaders};
  if(owned(details))for(const key of Object.keys(headers))if(key.toLowerCase()==='access-control-allow-origin'&&headers[key]?.[0]==='http://localhost:5173')headers[key]=[origin];
  callback({responseHeaders:headers});
 });
 if(!process.env.RADAZ_DESKTOP_SKIP_PACS){
  let ready=false;try{const r=await fetch(bridge+'/health',{headers:{Origin:'http://localhost:5173'},signal:AbortSignal.timeout(1500)});ready=r.ok;}catch{}
  if(!ready){const log=openSync(path.join(profile,'logs/pacs.log'),'a');try{const child=spawn(path.join(runtime,'runtime/python/python.exe'),['bridge/radaz_pacs_bridge.py','--origin','http://localhost:5173'],{cwd:runtime,windowsHide:true,detached:true,stdio:['ignore',log,log]});child.on('error',()=>{});child.unref();}finally{closeSync(log);}}
 }
 const microphoneGrants=new Set();
 session.defaultSession.setPermissionRequestHandler(async(contents,permission,callback,details)=>{
  const trusted=local(contents.getURL())&&(!details.requestingUrl||local(details.requestingUrl));
  const trustedAudio=trusted||(cloudWindows.has(contents.id)&&cloudVoice(contents.getURL())&&cloudVoice(details.requestingUrl||contents.getURL()));
  if(trustedAudio&&permission==='media'&&details.mediaTypes?.length&&details.mediaTypes.every(t=>t==='audio')){
   if(microphoneGrants.has(contents.id)){callback(true);return;}
   const answer=await dialog.showMessageBox(BrowserWindow.fromWebContents(contents),{type:'question',buttons:['İcazə ver','İmtina'],defaultId:1,cancelId:1,title:'RADAZ Voice',message:'Diktə üçün mikrofona icazə verilsin?',detail:'Yazma yalnız Danışmağa başla düyməsi ilə başlayır. Dayandırdıqda səs OpenAI-a göndərilir.'});
   if(answer.response===0&&!contents.isDestroyed()){microphoneGrants.add(contents.id);contents.once('destroyed',()=>microphoneGrants.delete(contents.id));callback(true);}else callback(false);
   return;
  }
  callback(trusted&&['fullscreen','clipboard-sanitized-write','fileSystem'].includes(permission));
 });
 session.defaultSession.setPermissionCheckHandler((contents,permission,requestingOrigin,details)=>{
  if(!contents)return false;const trusted=local(contents.getURL())&&local(requestingOrigin);
  if(permission==='media')return details.mediaType==='audio'&&microphoneGrants.has(contents.id)&&(trusted||(cloudWindows.has(contents.id)&&cloudVoice(contents.getURL())&&cloudVoice(requestingOrigin)));
  return trusted&&['fullscreen','clipboard-sanitized-write','fileSystem'].includes(permission);
 });
 Menu.setApplicationMenu(null);
 mainWindow=new BrowserWindow({width:1500,height:980,minWidth:480,minHeight:400,title:'RADAZ',backgroundColor:'#071017',show:false,autoHideMenuBar:true,icon:path.join(runtime,'public/radaz.ico'),webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true}});
 configure(mainWindow);mainWindow.on('close',event=>{if(!quitting){event.preventDefault();mainWindow.hide();}});
 void mainWindow.loadURL(origin).catch(error=>{if(!quitting&&error.code!=='ERR_ABORTED'&&error.errno!==-3)dialog.showErrorBox('RADAZ',error.message);});
 tray=new Tray(path.join(runtime,'public/radaz.ico'));tray.setToolTip('RADAZ Desktop');tray.on('double-click',show);
 tray.setContextMenu(Menu.buildFromTemplate([{label:'RADAZ-ı aç',click:show},{type:'separator'},{label:'Çıxış',click:()=>{quitting=true;app.quit();}}]));
 if(!process.argv.includes('--background')){mainWindow.maximize();mainWindow.show();}
}
if(!app.requestSingleInstanceLock())app.quit();else{
 app.on('second-instance',show);app.on('activate',show);app.on('window-all-closed',()=>{});app.on('before-quit',()=>{quitting=true;});
 app.whenReady().then(boot).catch(error=>{try{mkdirSync(path.join(profile,'logs'),{recursive:true});appendFileSync(path.join(profile,'logs/desktop.log'),new Date().toISOString()+' '+String(error.stack||error)+'\n');}catch{}dialog.showErrorBox('RADAZ açıla bilmədi',error.message);quitting=true;app.quit();});
}
