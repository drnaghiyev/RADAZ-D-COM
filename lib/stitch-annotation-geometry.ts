export type StitchAnnotationGeometry={sourceKey:string;left:number;topEdge:number;origins:[{x:number;y:number},{x:number;y:number}];scales:[number,number];rects:[{x:number;y:number;width:number;height:number},{x:number;y:number;width:number;height:number}];selected:0|1};
export function moveStitchPoint(point:number[],old:StitchAnnotationGeometry,next:StitchAnnotationGeometry,layer?:0|1){
 const world={x:point[0]+old.left,y:point[1]+old.topEdge};
 const contains=(i:0|1)=>{const r=old.rects[i];return world.x>=r.x&&world.x<=r.x+r.width&&world.y>=r.y&&world.y<=r.y+r.height;};
 const owner=layer??(contains(old.selected)?old.selected:contains(0)?0:1);
 return {layer:owner,point:[(world.x-old.origins[owner].x)/old.scales[owner]*next.scales[owner]+next.origins[owner].x-next.left,(world.y-old.origins[owner].y)/old.scales[owner]*next.scales[owner]+next.origins[owner].y-next.topEdge]};
}
