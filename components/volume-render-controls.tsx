'use client';
import {useTranslation} from '@/lib/i18n';
import {TransferFunctionEditor} from './transfer-function-editor';
import {fullVolumeCrop} from '@/lib/transfer-function';
import {resolvedVolumeSettings,volumePresetConfig,type VolumePreset,type VolumeRenderSettings} from '@/lib/volume-presets';

export function VolumeRenderControls({preset,settings,onChange,ct=true}:{ct?:boolean;preset:VolumePreset;settings:VolumeRenderSettings;onChange:(next:VolumeRenderSettings)=>void}) {
 const {t}=useTranslation();
 const value=resolvedVolumeSettings(preset,settings);
 const set=(patch:Partial<VolumeRenderSettings>)=>onChange({...settings,...patch});
 const slider=(key:keyof VolumeRenderSettings,label:string,min:number,max:number,step:number,unit='')=><label key={key}>
   <span>{label}<output>{Number(value[key]).toFixed(step<.1?2:step<1?1:0)}{unit}</output></span>
   <input aria-label={label} type="range" min={min} max={max} step={step} value={Number(value[key])} onChange={e=>set({[key]:+e.target.value})}/></label>;
 const check=(key:'gradient'|'normalFromOpacity',label:string)=><label className="volume-check"><input type="checkbox" checked={value[key]} onChange={e=>set({[key]:e.target.checked})}/>{label}</label>;
 return <div className="volume-settings-panel" onPointerDown={e=>e.stopPropagation()} onClick={e=>e.stopPropagation()}>
  <label>{t('render.leftMouse')}<select aria-label={t('render.mouseMode')} value={value.mouseMode} onChange={e=>set({mouseMode:e.target.value as typeof value.mouseMode})}><option value="rotate">{t('render.rotate')}</option><option value="tissue">{t('render.tissue')}</option></select></label>
  <small>{t('render.mouseHelp')}</small>
  <fieldset><legend>{t('render.surface')}</legend>
   {slider('transferWidth',t('render.transferWidth'),.25,3,.05,'×')}{slider('opacityDistance',t('render.opacityDistance'),.1,5,.1,' mm')}
   {check('normalFromOpacity',t('render.normalOpacity'))}{check('gradient',t('render.gradient'))}
   {value.gradient&&<>{slider('gradientMin',t('render.gradientMin'),0,300,1)}{slider('gradientMax',t('render.gradientMax'),1,1000,1)}</>}
   <label>{t('render.interpolation')}<select aria-label={t('render.interpolation')} value={value.interpolation} onChange={e=>set({interpolation:e.target.value as typeof value.interpolation})}><option value="linear">{t('render.linear')}</option><option value="nearest">{t('render.nearest')}</option></select></label>
  </fieldset>
  <fieldset><legend>{t('render.lighting')}</legend>
   <label>{t('render.lightMode')}<select aria-label={t('render.lightMode')} value={value.lighting} onChange={e=>set({lighting:e.target.value as typeof value.lighting})}><option value="even">{t('render.even')}</option><option value="studio">{t('render.studio')}</option><option value="flat">{t('render.flat')}</option></select></label>
   <label>{t('render.shading')}<select aria-label={t('render.shading')} value={value.shading} disabled={!volumePresetConfig[preset].shade} onChange={e=>set({shading:e.target.value as typeof value.shading})}><option value="surface">{t('render.surfaceLight')}</option><option value="occlusion">{t('render.occlusion')}</option><option value="scattering">{t('render.scatteringMode')}</option></select></label>
   {slider('ambient',t('render.ambient'),0,1,.01)}{slider('diffuse',t('render.diffuse'),0,1,.01)}{slider('specular',t('render.specular'),0,1,.01)}{slider('specularPower',t('render.specularPower'),1,80,1)}{slider('lightIntensity',t('render.lightIntensity'),.25,2,.05,'×')}
   {value.shading==='occlusion'&&<>{slider('occlusionRadius',t('render.occlusionRadius'),1,8,1)}{slider('occlusionSamples',t('render.occlusionSamples'),4,24,1)}</>}
   {value.shading==='scattering'&&<>{slider('scattering',t('render.scattering'),0,.8,.05)}{slider('shadowReach',t('render.shadowReach'),0,.5,.01)}</>}
  </fieldset>
  <fieldset><legend>{t('render.quality')}</legend>
   <label>{t('render.quality')}<select aria-label={t('render.quality')} value={value.quality} onChange={e=>set({quality:e.target.value as typeof value.quality})}>{(['performance','balanced','high','ultra','auto'] as const).map(q=><option key={q} value={q}>{t(`render.${q}`)}</option>)}</select></label>
   {slider('sampling',t('render.sampling'),.5,2,.1,'×')}<small>{t('render.qualityHelp')}</small>
  </fieldset>
  <TransferFunctionEditor key={`${preset}-${ct}`} preset={preset} ct={ct} value={settings.customTransfer} onChange={customTransfer=>set({customTransfer})}/>
  <fieldset><legend>{t('crop.title')}</legend><label className="volume-check"><input type="checkbox" checked={settings.crop?.enabled??false} onChange={e=>set({crop:{...(settings.crop??fullVolumeCrop()),enabled:e.target.checked}})}/>{t('crop.enabled')}</label>
   {settings.crop?.enabled&&[0,1,2].map(axis=><div key={axis}><b>{t('crop.axis',{axis:['I','J','K'][axis]})}</b>{[0,1].map(side=><label key={side}>{t(side===0?'crop.min':'crop.max')}<input type="range" aria-label={`${t('crop.axis',{axis:['I','J','K'][axis]})} ${t(side===0?'crop.min':'crop.max')}`} min={0} max={100} step={1} value={(settings.crop?.bounds[axis*2+side]??side)*100} onChange={e=>{const crop=settings.crop??fullVolumeCrop(),bounds=[...crop.bounds] as typeof crop.bounds;bounds[axis*2+side]=Math.max(side?bounds[axis*2]+.01:0,Math.min(side?1:bounds[axis*2+1]-.01,+e.target.value/100));set({crop:{...crop,bounds}});}}/></label>)}</div>)}<small>{t('crop.help')}</small>
  </fieldset>
  <button type="button" onClick={()=>onChange({...volumePresetConfig[preset].lighting,quality:settings.quality})}>{t('render.restore')}</button>
 </div>;
}
