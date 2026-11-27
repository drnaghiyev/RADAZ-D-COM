import {createContext,useContext} from 'react';
import type {ResolutionPreference} from './tablet-volume-quality';

export const TabletResolutionContext=createContext<{
  value:ResolutionPreference;
  select:(value:ResolutionPreference,defer:boolean)=>void;
  message:string;
}|null>(null);

export function TabletResolutionSelect({defer=false}:{defer?:boolean}){
  const settings=useContext(TabletResolutionContext);
  if(!settings)return null;
  return <><label>3D kəsiyinin ölçüsü <select value={settings.value} onChange={e=>{
    const value=e.currentTarget.value;
    settings.select(value==='auto'?'auto':Number(value) as ResolutionPreference,defer);
  }}>
    <option value="auto">Avtomatik</option>
    {[64,128,256,512].map(n=><option key={n} value={n}>{n} × {n} px</option>)}
  </select></label>{settings.message&&<small role="status">{settings.message}</small>}</>;
}
