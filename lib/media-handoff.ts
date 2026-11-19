type MediaFiles={study:string;files:File[]};
type Host=Window&{radazMediaFiles?:Map<string,MediaFiles>};
export function shareMediaFiles(study:string,files:File[]){const key=crypto.randomUUID(),host=window as Host;(host.radazMediaFiles??=new Map()).set(key,{study,files});setTimeout(()=>host.radazMediaFiles?.delete(key),300000);return key;}
export function takeMediaFiles(key:string,study:string):File[]|null{try{const host=window.opener as Host;if(!host||host.closed||host.location.origin!==location.origin)return null;const item=host.radazMediaFiles?.get(key);if(!item||item.study!==study)return null;host.radazMediaFiles!.delete(key);return item.files;}catch{return null;}}
