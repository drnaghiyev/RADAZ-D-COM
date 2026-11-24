'use client';
import {Settings} from 'lucide-react';
import {currentNetwork} from './api';

export function NetworkSettingsLink({clinic}:{clinic?:string}){
  const params=new URLSearchParams();
  if(clinic)params.set('clinic',clinic);
  if(currentNetwork()==='internet')params.set('network','internet');
  const url='/private-network/settings'+(params.size?'?'+params:'');
  return <a href={url} target="radaz-private-network-settings"><Settings size={16} aria-hidden="true"/> DICOM Network ayarları</a>;
}
