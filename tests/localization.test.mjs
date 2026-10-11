import test from 'node:test';
import assert from 'node:assert/strict';
import {loadTypeScript} from './load-typescript.mjs';
const {messages}=loadTypeScript('lib/locales/messages.ts');
test('every registered message has AZ/RU/EN and identical placeholders',()=>{
 for(const [key,values] of Object.entries(messages)){
  assert.deepEqual(Object.keys(values).sort(),['az','en','ru'],key);
  const variables=text=>[...text.matchAll(/\{(\w+)\}/g)].map(m=>m[1]).sort();
  for(const language of ['az','ru','en']){assert.ok(values[language].trim(),`${key}.${language}`);assert.deepEqual(variables(values[language]),variables(values.az),key);}
 }
});
