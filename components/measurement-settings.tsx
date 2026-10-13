'use client';
import {useSyncExternalStore} from 'react';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from './ui/dialog';
import {getLengthUnit,setLengthUnit,subscribeLengthUnit} from '@/lib/measurement-units';
export const useMeasurementUnit = () => useSyncExternalStore(subscribeLengthUnit,getLengthUnit,()=> 'mm' as const);
export function MeasurementSettings({open,onOpenChange}:{open:boolean;onOpenChange:(open:boolean)=>void}) {
  const unit=useMeasurementUnit();
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="measurement-settings">
    <DialogHeader><DialogTitle>Ölçü ayarları</DialogTitle><DialogDescription>Uzunluq vahidi bütün görüntü panellərinə tətbiq edilir.</DialogDescription></DialogHeader>
    <fieldset><legend>Uzunluq vahidi</legend>
      <label><input type="radio" name="length-unit" checked={unit==='mm'} onChange={()=>setLengthUnit('mm')}/> mm — millimetr</label>
      <label><input type="radio" name="length-unit" checked={unit==='cm'} onChange={()=>setLengthUnit('cm')}/> sm — santimetr</label>
    </fieldset>
    <p>1 sm = 10 mm. Fiziki piksel ölçüsü olmayan görüntülərdə nəticə px ilə göstərilir.</p>
  </DialogContent></Dialog>;
}
