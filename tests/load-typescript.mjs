import {readFileSync,existsSync} from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import ts from 'typescript';
const nodeRequire=createRequire(import.meta.url),cache=new Map();
export function loadTypeScript(file){
 const absolute=path.resolve(file);if(cache.has(absolute))return cache.get(absolute);
 const output={};cache.set(absolute,output);
 const require=name=>{if(name.startsWith('.')){const base=path.resolve(path.dirname(absolute),name);return loadTypeScript(existsSync(base)?base:base+'.ts');}return nodeRequire(name);};
 new Function('exports','require',ts.transpileModule(readFileSync(absolute,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(output,require);
 return output;
}
