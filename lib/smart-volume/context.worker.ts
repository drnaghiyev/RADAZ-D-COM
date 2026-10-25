import {contextVolume} from './context-volume';
self.onmessage=({data})=>{try{
 let result;if(data.quality==='full'){
  let integral=true;for(let i=0;!(data.values instanceof Int16Array)&&i<data.values.length;i++){const v=data.values[i];if(!Number.isInteger(v)||v< -32768||v>32767){integral=false;break;}}
  const values=integral&&!(data.values instanceof Int16Array)?Int16Array.from(data.values):data.values;
  result={...data.geometry,values};
 }else result=contextVolume(data.geometry,data.values);
 // VTK otherwise scans the entire source on the UI thread before GPU upload.
 let min=Infinity,max=-Infinity;for(let i=0;i<result.values.length;i++){const v=result.values[i];if(v<min)min=v;if(v>max)max=v;}
 self.postMessage({...result,scalarRange:{min,max}},{transfer:[result.values.buffer]});
}catch(error){self.postMessage({error:String(error)});}};
