'use client';
import {Settings} from 'lucide-react';
import type {MouseEvent} from 'react';
import {currentNetwork,type NetworkProfile} from './api';

export const settingsDestinationEvent='radaz-network-settings-destination';
export type SettingsDestination={profile:NetworkProfile;clinic?:string};
const settingsPath='/private-network/settings';

export function NetworkSettingsLink({clinic,profile}:{clinic?:string;profile?:NetworkProfile}){
  const params=new URLSearchParams();
  if(clinic)params.set('clinic',clinic);
  if(profile||currentNetwork()==='internet')params.set('network',profile||'internet');
  const url=settingsPath+(params.size?'?'+params:'');
  function open(event:MouseEvent<HTMLAnchorElement>){
    if(event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;
    const target=window.open('',event.currentTarget.target);
    if(!target)return;
    try{
      if(target.location.origin===location.origin&&target.location.pathname===settingsPath){
        if(profile||clinic)target.dispatchEvent(new CustomEvent<SettingsDestination>(settingsDestinationEvent,{
          detail:{profile:profile??currentNetwork(),clinic},
        }));
      }else target.location.replace(event.currentTarget.href);
      event.preventDefault();
      target.focus();
    }catch{ /* Let the link navigate normally if the target cannot be accessed. */ }
  }
  return <a href={url} target="radaz-private-network-settings" onClick={open}><Settings size={16} aria-hidden="true"/> DICOM Network ayarları</a>;
}
