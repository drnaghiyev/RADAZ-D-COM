import {areaWeights,displayPlaneSampler} from '../volume-resampling';

type Pixels=Int16Array|Float32Array|Uint8Array;
type Message={shape:[number,number,number,number]}|{planes:Pixels[]};
let sample:ReturnType<typeof displayPlaneSampler>;
let planeSize=0;
self.onmessage=({data}:{data:Message})=>{
  if('shape' in data){
    const [columns,rows,width,height]=data.shape;
    sample=displayPlaneSampler(columns,rows,areaWeights(columns,width),areaWeights(rows,height),true);
    planeSize=width*height;
    return;
  }
  const block=new Float32Array(planeSize*data.planes.length);
  let min=Infinity,max=-Infinity;
  for(let i=0;i<data.planes.length;i++){
    const plane=sample(data.planes[i]);block.set(plane,i*planeSize);
    for(let p=0;p<plane.length;p++){
      const value=plane[p];
      if(value<min)min=value;
      if(value>max)max=value;
    }
  }
  self.postMessage({block,min,max},{transfer:[block.buffer]});
};
