'use client';
import {Settings} from 'lucide-react';

export function NetworkSettingsLink({clinic}:{clinic?:string}){
  const url='/private-network/settings'+(clinic?'?clinic='+encodeURIComponent(clinic):'');
  return <a href={url} target="radaz-private-network-settings"><Settings size={16} aria-hidden="true"/> DICOM Network ayarları</a>;
}
