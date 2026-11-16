export type VolumeSourceQuality = 'auto'|'full'|'light';
/** Display policy only; segmentation, measurements and all Z planes stay intact. */
export function resolveVolumeSourceQuality(dimensions:readonly number[],quality:VolumeSourceQuality='auto'):'full'|'light'{
 return quality==='auto'?(dimensions.reduce((a,b)=>a*b,1)>32*1024*1024?'light':'full'):quality;
}
