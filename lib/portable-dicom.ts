export type PortableDicom={rows:number;columns:number;kind:'int16'|'float32'|'rgb';tags:Record<string,string>;data:string};
export async function deflatePixels(bytes:Uint8Array){
 const blob=new Blob([Uint8Array.from(bytes).buffer]);return new Uint8Array(await new Response(blob.stream().pipeThrough(new CompressionStream('deflate'))).arrayBuffer());
}
export async function inflatePixels(bytes:Uint8Array){
 return new Uint8Array(await new Response(new Blob([Uint8Array.from(bytes).buffer]).stream().pipeThrough(new DecompressionStream('deflate'))).arrayBuffer());
}
