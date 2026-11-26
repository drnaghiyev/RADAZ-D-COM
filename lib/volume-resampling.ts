type Dimensions = [number, number, number];

/** Keep every acquisition plane unless the GPU's actual limits require fewer. */
export function volumeDimensions(source:Dimensions,maxDimension:number,budgetBytes:number,nativeBytes=4):Dimensions {
  if(maxDimension<3||budgetBytes<108)throw Error('GPU həcm limiti kifayət deyil');
  if(source.every(n=>n<=maxDimension)&&source.reduce((n,d)=>n*d,nativeBytes)<=budgetBytes)return [...source];
  const depth=Math.min(source[2],Math.floor(maxDimension),Math.floor(budgetBytes/4));
  const scale=Math.min(1,maxDimension/source[0],maxDimension/source[1],Math.sqrt(budgetBytes/(4*depth*source[0]*source[1])));
  return [Math.max(1,Math.floor(source[0]*scale)),Math.max(1,Math.floor(source[1]*scale)),depth];
}

/** Desktop keeps every acquired plane. If depth exceeds a GPU limit the renderer uses CPU. */
export function desktopDisplayDimensions(source:Dimensions,maxDimension:number,budgetBytes:number):Dimensions {
  const [columns,rows,depth]=source;
  if(maxDimension<1 || depth*4>budgetBytes)throw Error('Bütün kəsiklər üçün yaddaş kifayət deyil.');
  const scale=Math.min(1,maxDimension/columns,maxDimension/rows,Math.sqrt(budgetBytes/(4*columns*rows*depth)));
  return [Math.max(1,Math.floor(columns*scale)),Math.max(1,Math.floor(rows*scale)),depth];
}

/** Area weights include all source voxels, including the last partial bin. */
export function areaWeights(input:number,output:number) {
  const ratio=input/output;
  return Array.from({length:output},(_,index)=>{
    const start=index*ratio,end=(index+1)*ratio;
    const weights:{index:number;weight:number}[]=[];
    for(let i=Math.floor(start);i<Math.min(input,Math.ceil(end));i++){
      const overlap=Math.min(end,i+1)-Math.max(start,i);
      if(overlap>1e-10)weights.push({index:i,weight:overlap/ratio});
    }
    return weights;
  });
}

/** Common display reductions cover up to three adjacent source samples on each axis. */
function threeTaps(bins:ReturnType<typeof areaWeights>){
  if(bins.some(bin=>bin.length>3))return null;
  const first=new Uint32Array(bins.length), second=new Uint32Array(bins.length), third=new Uint32Array(bins.length);
  const w0=new Float64Array(bins.length), w1=new Float64Array(bins.length), w2=new Float64Array(bins.length);
  bins.forEach((bin,i)=>{
    first[i]=bin[0].index;second[i]=bin[1]?.index??first[i];third[i]=bin[2]?.index??second[i];
    w0[i]=bin[0].weight;w1[i]=bin[1]?.weight??0;w2[i]=bin[2]?.weight??0;
  });
  return {first,second,third,w0,w1,w2};
}

/** Reuse the same separable box filter and scratch planes for a whole display stack. */
export function displayPlaneSampler(columns:number,rows:number,xWeights:ReturnType<typeof areaWeights>,yWeights:ReturnType<typeof areaWeights>,fastDesktop=false){
  const w=xWeights.length,h=yWeights.length;
  const horizontal=new Float64Array(w*rows),result=new Float32Array(w*h);
  const xx=fastDesktop && threeTaps(xWeights), yy=fastDesktop && threeTaps(yWeights);
  if(xx && yy)return (pixels:ArrayLike<number>)=>{
    for(let row=0;row<rows;row++){
      const input=row*columns,output=row*w;
      for(let col=0;col<w;col++)horizontal[output+col]=pixels[input+xx.first[col]]*xx.w0[col]
        +pixels[input+xx.second[col]]*xx.w1[col]+pixels[input+xx.third[col]]*xx.w2[col];
    }
    for(let row=0;row<h;row++){
      const a=yy.first[row]*w,b=yy.second[row]*w,c=yy.third[row]*w,output=row*w;
      const wa=yy.w0[row],wb=yy.w1[row],wc=yy.w2[row];
      for(let col=0;col<w;col++)result[output+col]=horizontal[a+col]*wa+horizontal[b+col]*wb+horizontal[c+col]*wc;
    }
    return result;
  };
  function pack(bins:ReturnType<typeof areaWeights>){
    const start=new Uint32Array(bins.length+1);
    for(let i=0;i<bins.length;i++)start[i+1]=start[i]+bins[i].length;
    const index=new Uint32Array(start[bins.length]),weight=new Float64Array(index.length);
    for(let i=0;i<bins.length;i++)for(let j=0;j<bins[i].length;j++){
      const entry=bins[i][j],k=start[i]+j;
      index[k]=entry.index;weight[k]=entry.weight;
    }
    return {start,index,weight};
  }
  const x=pack(xWeights),y=pack(yWeights);
  return (pixels:ArrayLike<number>)=>{
    for(let row=0;row<rows;row++){
      const input=row*columns,output=row*w;
      for(let col=0;col<w;col++){
        let sum=0;
        for(let k=x.start[col];k<x.start[col+1];k++)sum+=pixels[input+x.index[k]]*x.weight[k];
        horizontal[output+col]=sum;
      }
    }
    for(let row=0;row<h;row++)for(let col=0;col<w;col++){
      let sum=0;
      for(let k=y.start[row];k<y.start[row+1];k++)sum+=horizontal[y.index[k]*w+col]*y.weight[k];
      result[row*w+col]=sum;
    }
    return result;
  };
}

export function resamplePlane(pixels:ArrayLike<number>,columns:number,xWeights:ReturnType<typeof areaWeights>,yWeights:ReturnType<typeof areaWeights>) {
  const result=new Float32Array(xWeights.length*yWeights.length);
  for(let y=0;y<yWeights.length;y++)for(let x=0;x<xWeights.length;x++){
    let sum=0;
    for(const row of yWeights[y])for(const column of xWeights[x])sum+=pixels[row.index*columns+column.index]*row.weight*column.weight;
    result[y*xWeights.length+x]=sum;
  }
  return result;
}
