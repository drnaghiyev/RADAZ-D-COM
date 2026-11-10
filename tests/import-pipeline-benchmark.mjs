// Controlled latency benchmark: measures request overlap, not clinical-dataset speed.
import {performance} from 'node:perf_hooks';
import {setTimeout as delay} from 'node:timers/promises';
import {prefetchOrdered} from '../lib/import-pipeline.ts';
const files=Array.from({length:128},(_,i)=>i);
const load=async i=>{await delay(8);return i;};
const results=[];
for(const concurrency of [1,4]){
  let first=0,count=0;const start=performance.now();
  for await(const file of prefetchOrdered(files,load,concurrency)){if(!count)first=performance.now()-start;count++;}
  results.push({concurrency,files:count,firstImageMs:Math.round(first),totalMs:Math.round(performance.now()-start)});
}
console.log(JSON.stringify({fixture:'128 synthetic 8ms reads; no patient data',results,speedup:Math.round(results[0].totalMs/results[1].totalMs*100)/100},null,2));
