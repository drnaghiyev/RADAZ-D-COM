export type Dock = 'top'|'bottom'|'right'|'pool'|'menu';
export type Position = { dock: Dock; order: number };
export type Tool = { home: string; groupOrder: number; order: number; label: string; menu: boolean };
export type Layout = { positions: Record<string,Position>; dividers: string[]; ignoreLegacy?: boolean };
type LegacyGroups = Record<string,{side?:string;order?:number}>;
type LegacyItems = {
  groups?:{id:string}[]; items?:Record<string,{group:string;order:number}>; removed?:string[];
  rows?:number; groupRows?:Record<string,number>;
};
export type Legacy = {groups:LegacyGroups;items:LegacyItems};
export const emptyLayout=():Layout=>({positions:{},dividers:[]});
// Native and tablet tool sources share these stable IDs. The tablet omits the optical-disc command.
const viewerSections = [
  ['cd/.0', 'import/.0', 'output/.0'],
  ['workspace/.$mpr', 'workspace/.$3d', 'workspace/.$archive', 'workspace/.$pacs', 'smart-volume/.0', 'workspace/.4'],
  ['layout/.0', 'window/.1', 'window/.0', 'contrast/.0', 'annotations/.0', 'layout/.1', 'window/.2', 'help/.0'],
  ['measure/.0:$scroll', 'measure/.0:$wl', 'measure/.0:$pan', 'measure/.0:$zoom', 'measure/.1', 'workspace/.3', 'measure/.2'],
  ['cine/.0', 'cine/.1', 'cine/.2', 'cine/.3', 'cine/.4', 'cine/.5'],
  ['workspace/.0', 'output/.1', 'output/.2'],
  ['help/.1', 'toolbar-settings/.0'],
];

export function defaultLayout(scope:string):Layout {
  const layout = emptyLayout();
  layout.ignoreLegacy = true;
  if (scope !== 'viewer') return layout;
  viewerSections.flat().forEach((id,order) => {layout.positions[id]={dock:'top',order};});
  layout.dividers = viewerSections.slice(1).map(section => section[0]);
  // Rotation commands remain available in the toolbar editor.
  for (let i=0;i<6;i++) layout.positions['rotation/.'+i]={dock:'pool',order:i};
  return layout;
}

function read<T>(storage:Storage,key:string,fallback:T):T{
  try { return JSON.parse(storage.getItem(key)||'null')??fallback; } catch { return fallback; }
}
export function readLayouts(storage:Storage,scope:string,tablet:boolean){
  const saved=read(storage,'radaz-toolbar-flat-v1:'+scope,emptyLayout());
  const layout=emptyLayout();
  for(const [id,value] of Object.entries(saved.positions||{})){
    if(value && ['top','bottom','right','pool','menu'].includes(value.dock) && Number.isFinite(value.order))layout.positions[id]=value;
  }
  layout.dividers=Array.isArray(saved.dividers)?saved.dividers.filter(id=>typeof id==='string'):[];
  layout.ignoreLegacy=!!saved.ignoreLegacy;
  const defaults:LegacyGroups=tablet&&scope==='viewer'?Object.fromEntries(['help','window','output','rotation'].map((id,order)=>[id,{side:'right',order}])):{};
  const groups=read<LegacyGroups>(storage,'radaz-toolbar-v1:'+scope,{});
  const legacy:Legacy={groups:Object.keys(groups).length?groups:defaults,items:read<LegacyItems>(storage,'radaz-toolbar-items-v1:'+scope,{})};
  const items=legacy.items;
  const hasLegacyChanges=Object.keys(groups).length>0 || !!(items.groups?.length || items.removed?.length ||
    Object.keys(items.items||{}).length || items.rows===2 || Object.keys(items.groupRows||{}).length);
  const hasFlatChanges=Object.keys(layout.positions).length>0 || layout.dividers.length>0;
  // Earlier versions automatically saved an empty preference on first launch.
  if(scope==='viewer' && !hasFlatChanges && (layout.ignoreLegacy || !hasLegacyChanges))
    return {layout:defaultLayout(scope),legacy,defaults};
  return {layout,legacy,defaults};
}
export function placements(tools:Record<string,Tool>,layout:Layout,legacy:Legacy):Record<string,Position>{
  const homeOrders=new Map(Object.values(tools).map(item=>[item.home,item.groupOrder]));
  const all:Record<string,Position>={};
  for(const [id,item] of Object.entries(tools)){
    const pinned=layout.positions[id];
    if(pinned){all[id]=pinned;continue;}
    const previous=legacy.items.items?.[id];
    let home=previous?.group || (legacy.items.removed?.includes(item.home)?'pool':item.menu?'menu':item.home);
    if(item.menu&&(home==='pool'||legacy.items.removed?.includes(home)))home='menu';
    if(item.home==='toolbar-settings' && (home==='pool'||legacy.items.removed?.includes(home)))home=item.home;
    const group=legacy.groups[home];
    const dock=home==='menu'||home==='pool'?home:group?.side==='right'?'right':legacy.items.rows===2 && legacy.items.groupRows?.[home]===2?'bottom':'top';
    const custom=legacy.items.groups?.findIndex(g=>g.id===home)??-1;
    const groupOrder=group?.order??homeOrders.get(home)??(custom<0?item.groupOrder:95+custom/100);
    all[id]={dock,order:groupOrder*10000+(previous?.order??item.order)};
  }
  return all;
}
export function reorder(layout:Layout,all:Record<string,Position>,id:string,dock:Dock,before?:string):Layout{
  if(id===before)return layout;
  const ids=Object.keys(all).filter(key=>key!==id&&all[key].dock===dock).sort((a,b)=>all[a].order-all[b].order);
  const index=before?ids.indexOf(before):-1;
  ids.splice(index<0?ids.length:index,0,id);
  const positions={...layout.positions};
  ids.forEach((key,index)=>{positions[key]={dock,order:index};});
  return {...layout,positions};
}
