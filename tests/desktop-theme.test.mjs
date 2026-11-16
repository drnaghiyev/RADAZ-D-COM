import {test} from 'node:test';import assert from 'node:assert/strict';import {readFileSync,existsSync} from 'node:fs';import vm from 'node:vm';import path from 'node:path';
const source=readFileSync('desktop/main.cjs','utf8');const functions=source.slice(source.indexOf('function themeIcon'),source.indexOf('function configureCloud'));
test('OS theme selects contrasting window, tray and shortcut icons',()=>{
 const changes=[],shortcuts=[],nativeTheme={shouldUseDarkColors:false};const box={runtime:'C:/RADAZ/versions/0.2.70',path,existsSync:()=>true,nativeTheme,windows:new Set([{isDestroyed:()=>false,setIcon:v=>changes.push(v)}]),tray:{setImage:v=>changes.push(v)},process:{platform:'win32'},app:{getPath:n=>'C:/test/'+n},shell:{writeShortcutLink:(...args)=>shortcuts.push(args)}};
 vm.createContext(box);vm.runInContext(functions,box);vm.runInContext('refreshThemeIcons()',box);assert.ok(changes.every(p=>p.endsWith('radaz-dark.png')));assert.equal(shortcuts.length,2);assert.ok(shortcuts.every(v=>v[2].icon.endsWith('radaz-dark.ico')));
 changes.length=shortcuts.length=0;nativeTheme.shouldUseDarkColorsForSystemIntegratedUI=true; // System dark + app light must follow the system.vm.runInContext('refreshThemeIcons()',box);assert.ok(changes.every(p=>p.endsWith('radaz-light.png')));assert.ok(shortcuts.every(v=>v[2].icon.endsWith('radaz-light.ico')));assert.match(source,/nativeTheme.on\('updated',refreshThemeIcons\)/);
 for(const c of ['dark','light'])for(const extension of ['png','ico'])assert.ok(existsSync('public/radaz-'+c+'.'+extension));
});
