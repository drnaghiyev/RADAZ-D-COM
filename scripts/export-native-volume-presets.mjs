// Native preview and vtk.js must use the same evaluated transfer curves.
import fs from 'node:fs';
import ts from 'typescript';
const source = new URL('../lib/volume-presets.ts', import.meta.url);
const js = ts.transpileModule(fs.readFileSync(source, 'utf8'), {compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;
const {volumeStyles, qualityProfiles} = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
fs.writeFileSync(new URL('../bridge/native-volume-presets.json', import.meta.url), JSON.stringify({schema:1,presets:volumeStyles,qualityProfiles}, null, 2)+'\n');
