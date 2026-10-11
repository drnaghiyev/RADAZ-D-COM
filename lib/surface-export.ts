export function surfacesToPly(meshes:{points:ArrayLike<number>;polys:ArrayLike<number>;color:number[]}[]){
 for(const mesh of meshes)if(mesh.color.length!==3||mesh.color.some(n=>!Number.isFinite(n)||n<0||n>1)||mesh.points.length%3||mesh.polys.length%4)throw Error('invalid_mesh');
 const vertices=meshes.reduce((n,m)=>n+m.points.length/3,0),faces=meshes.reduce((n,m)=>n+m.polys.length/4,0);
 if(!Number.isInteger(vertices)||!Number.isInteger(faces)||vertices>10000000||faces>20000000)throw Error('invalid_mesh');
 const header=new TextEncoder().encode(`ply\nformat binary_little_endian 1.0\ncomment RADAZ research surface; coordinates DICOM LPS millimetres\nelement vertex ${vertices}\nproperty float x\nproperty float y\nproperty float z\nproperty uchar red\nproperty uchar green\nproperty uchar blue\nelement face ${faces}\nproperty list uchar uint vertex_indices\nend_header\n`);
 const data=new Uint8Array(vertices*15+faces*13),view=new DataView(data.buffer);let offset=0;
 for(const mesh of meshes)for(let i=0;i<mesh.points.length;i+=3){for(let axis=0;axis<3;axis++){const n=mesh.points[i+axis];if(!Number.isFinite(n))throw Error('invalid_mesh');view.setFloat32(offset,n,true);offset+=4;}for(const color of mesh.color){view.setUint8(offset++,Math.round(color*255));}}
 let base=0;for(const mesh of meshes){for(let i=0;i<mesh.polys.length;i+=4){if(mesh.polys[i]!==3)throw Error('invalid_mesh');view.setUint8(offset++,3);for(let j=1;j<=3;j++){const n=mesh.polys[i+j];if(!Number.isInteger(n)||n<0||n>=mesh.points.length/3)throw Error('invalid_mesh');view.setUint32(offset,n+base,true);offset+=4;}}base+=mesh.points.length/3;}
 return new Blob([header,data],{type:'application/octet-stream'});
}
