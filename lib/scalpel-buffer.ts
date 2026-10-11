/** One editable scalar buffer; undo stores one bit per changed voxel. Source stays immutable. */
export function createScalpelBuffer(source:ArrayLike<number>,floor:number){
 const values=Float32Array.from(source);
 const begin=()=>new Uint8Array(Math.ceil(values.length/8));
 const remove=(index:number,changes:Uint8Array)=>{if(values[index]===floor)return false;changes[index>>>3]|=1<<(index&7);values[index]=floor;return true;};
 const restore=(changes:Uint8Array)=>{for(let byte=0;byte<changes.length;byte++){const mask=changes[byte];if(!mask)continue;for(let bit=0;bit<8;bit++)if(mask&(1<<bit)){const index=byte*8+bit;values[index]=source[index];}}};
 return {values,begin,remove,restore,reset:()=>values.set(source)};
}
