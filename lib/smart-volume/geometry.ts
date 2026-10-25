export type Vec3 = [number, number, number];
export type Geometry = { dimensions: Vec3; spacing: Vec3; origin: Vec3; direction: number[] };
export function validateGeometry(g: Geometry) {
  if (g.dimensions.length !== 3 || g.dimensions.some(n => !Number.isSafeInteger(n) || n < 1) ||
      g.spacing.length !== 3 || g.spacing.some(n => !Number.isFinite(n) || n <= 0) ||
      g.origin.length !== 3 || g.origin.some(n => !Number.isFinite(n)) || g.direction.length !== 9 || g.direction.some(n => !Number.isFinite(n))) throw Error('Invalid volume geometry');
  for (let a = 0; a < 3; a++) for (let b = a; b < 3; b++) {
    const dot = [0,1,2].reduce((s,k) => s + g.direction[a*3+k]*g.direction[b*3+k],0);
    if (Math.abs(dot-(a===b?1:0)) > 1e-4) throw Error('Non-orthonormal volume geometry');
  }
  const count = g.dimensions.reduce((a,b)=>a*b,1);
  if (!Number.isSafeInteger(count)) throw Error('Invalid voxel count');
  return count;
}
export function worldToIndex(g: Geometry, world: Vec3): Vec3 {
  return [0,1,2].map(a => [0,1,2].reduce((s,k)=>s+(world[k]-g.origin[k])*g.direction[a*3+k],0)/g.spacing[a]) as Vec3;
}
/** Counts actual labelled voxels; extents are explicitly separate from volume. */
export function measureMask(mask: Uint8Array | Uint16Array, g: Geometry, label: number) {
  if (mask.length !== validateGeometry(g) || !Number.isInteger(label) || label <= 0) throw Error('Invalid mask');
  let voxels=0; const min=[Infinity,Infinity,Infinity], max=[-Infinity,-Infinity,-Infinity];
  const [nx,ny]=g.dimensions;
  for(let i=0;i<mask.length;i++) if(mask[i]===label) {
    voxels++; const p=[i%nx,Math.floor(i/nx)%ny,Math.floor(i/(nx*ny))];
    for(let a=0;a<3;a++){min[a]=Math.min(min[a],p[a]);max[a]=Math.max(max[a],p[a]);}
  }
  const mm3=voxels*g.spacing[0]*g.spacing[1]*g.spacing[2];
  // These are oriented bounding extents, NOT a maximum Feret diameter.
  const orientedExtentsMm=g.spacing.map((s,a)=>voxels?(max[a]-min[a]+1)*s:0) as Vec3;
  return {voxels,mm3,cm3:mm3/1000,ml:mm3/1000,orientedExtentsMm};
}
