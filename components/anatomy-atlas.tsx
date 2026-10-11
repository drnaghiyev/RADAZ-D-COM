'use client';
import {useTranslation as useUiTranslation,translate as tr} from '@/lib/i18n';

import { useState } from 'react';
import { BookOpen, Crosshair, Search, X } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { anatomyStructures, anatomySystems, anatomyKinds, catalogueRegions, searchCatalogue, structureLabelText, isInAnatomySystem, type AnatomyStructure } from '@/lib/anatomy-catalogue';
import { anatomyPlates } from '@/lib/anatomy-plates';

export function AnatomyAtlas({open,onOpenChange,canPlace,onPlace}:{open:boolean;onOpenChange:(value:boolean)=>void;canPlace:boolean;onPlace:(item:AnatomyStructure,text:string)=>void}) {
  useUiTranslation();
  const [system,setSystem]=useState('cardiovascular');
  const [region,setRegion]=useState('all');
  const [kind,setKind]=useState('all');
  const [query,setQuery]=useState('');
  const [selected,setSelected]=useState('heart');
  const [side,setSide]=useState('none');
  const [language,setLanguage]=useState('both');
  const [zoom,setZoom]=useState(false);
  const found=searchCatalogue(query,system,kind,region);
  // A hidden selection must never place a label from an earlier search/filter.
  const item=found.find(entry=>entry.id===selected)||found[0];
  const plateId=item?.plate;
  const plate=plateId?anatomyPlates[plateId]:null;
  const pins=plateId?anatomyStructures.filter(entry=>entry.plate===plateId&&entry.point):[];
  const plateChoices=[...new Set(searchCatalogue('',system,kind,region).map(entry=>entry.plate))];
  function chooseSystem(id:string) {
    setSystem(id);setRegion('all');setKind('all');setQuery('');setZoom(false);
    setSelected(searchCatalogue('',id)[0]?.id||'');
  }
  function choosePin(entry:AnatomyStructure) {
    if(!isInAnatomySystem(entry,system))setSystem(entry.system);
    if(region!=='all'&&region!==entry.region)setRegion('all');
    if(kind!=='all'&&kind!==entry.kind)setKind('all');
    setQuery('');setSelected(entry.id);
  }
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="anatomy-dialog" showCloseButton={false}>
      <header className="anatomy-heading"><div className="anatomy-heading-icon"><BookOpen size={23}/></div><div>
        <div className="anatomy-eyebrow">{tr('ui.radaz_local_research_module_b878e')}</div>
        <DialogTitle>{tr('ui.radiographic_anatomy_059ce')}</DialogTitle>
        <DialogDescription>{tr('ui.extended_anatomical_atlas_b935d')}{anatomyStructures.length} {tr('ui.names_12_systems_manual_labelling_8d237')}</DialogDescription>
      </div><button className="anatomy-close" aria-label={tr('ui.close_atlas_4375c')} onClick={()=>onOpenChange(false)}><X size={21}/></button></header>
      <div className="anatomy-body">
        <nav className="anatomy-regions" aria-label={tr('ui.anatomical_systems_e7ba3')}><span className="anatomy-eyebrow">{tr('ui.systems_ec20b')}</span>
          {[{id:'all',name:'Bütün sistemlər'},...anatomySystems].map(entry=><button key={entry.id} aria-pressed={system===entry.id} onClick={()=>chooseSystem(entry.id)}>{entry.name}<small>{searchCatalogue('',entry.id).length}</small></button>)}
          <p>{tr('ui.click_a_point_in_the_illustration_or_choose_a_04bc1')}</p>
        </nav>
        <section className="anatomy-visual" aria-label={tr('ui.anatomical_atlas_illustration_f866c')}>
          {plate&&item?<>
            <div className="anatomy-plate-toolbar"><strong>{plate.caption}</strong><button aria-pressed={zoom} onClick={()=>setZoom(v=>!v)}>{zoom?'Tam görünüş':'Böyüt'}</button></div>
            {plateChoices.length>1&&<label className="anatomy-view-choice">{tr('ui.atlas_view_d4d57')}<select aria-label={tr('ui.atlas_view_d4d57')} value={plateId} onChange={event=>{setQuery('');setZoom(false);setSelected(searchCatalogue('',system,kind,region).find(entry=>entry.plate===event.target.value)!.id);}}>{plateChoices.map(id=><option key={id} value={id}>{anatomyPlates[id].caption}</option>)}</select></label>}
            <div className={`anatomy-plate-scroll ${zoom?'anatomy-zoom':''}`}>
              <svg key={plateId} className="anatomy-plate" data-plate={plateId} viewBox={`0 0 ${plate.width} ${plate.height}`} style={{aspectRatio:`${plate.width}/${plate.height}`}} aria-label={plate.caption}>
                <image href={plate.src} width={plate.width} height={plate.height}/>
                {pins.map((entry,index)=>{
                  const radius=plateId==='hand'?17:plateId==='foot'?20:Math.min(plate.width,plate.height)*.023;
                  return <g key={entry.id} role="button" tabIndex={0} aria-label={`Atlas: ${entry.az} — ${entry.latin}`} aria-pressed={item.id===entry.id}
                    className={`anatomy-pin ${item.id===entry.id?'is-selected':''}`} transform={`translate(${entry.point![0]},${entry.point![1]})`}
                    onClick={()=>choosePin(entry)} onKeyDown={event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();choosePin(entry);}}}>
                    <title>{entry.az} · {entry.latin}</title><circle r={radius}/><text style={{fontSize:radius*1.08}} textAnchor="middle" dominantBaseline="central">{index+1}</text>
                  </g>;
                })}
              </svg>
            </div>
            <div className="anatomy-plate-note"><strong>{item.point?'Seçilmiş struktur narıncı nöqtə ilə göstərilir.':'Bu ad kataloqdadır; şəkildə ayrıca işarələnməyib.'}</strong><span>{tr('ui.general_anatomical_reference_not_a_radiograph_cfdad')}</span></div>
          </>:<div className="anatomy-no-selection"><BookOpen size={38}/><p>{tr('ui.no_matching_structure_found_975f4')}</p><button onClick={()=>chooseSystem('all')}>{tr('ui.show_full_atlas_284b4')}</button></div>}
        </section>
        <section className="anatomy-catalogue" aria-label={tr('ui.anatomical_structure_catalogue_ac3a4')}>
          <label className="anatomy-search"><Search size={16}/><input aria-label={tr('ui.search_anatomical_structures_a9e50')} placeholder={tr('ui.azerbaijani_latin_name_7d9b5')} value={query} onChange={event=>{setQuery(event.target.value);setZoom(false);}}/>{query&&<button aria-label={tr('ui.clear_search_73be6')} onClick={()=>setQuery('')}><X size={15}/></button>}</label>
          <div className="anatomy-filters"><label>{tr('ui.type_58b13')}<select aria-label={tr('ui.structure_type_aaae5')} value={kind} onChange={event=>{setKind(event.target.value);setZoom(false);}}><option value="all">{tr('ui.all_types_04e08')}</option>{anatomyKinds.map(entry=><option key={entry.id} value={entry.id}>{entry.name}</option>)}</select></label><label>{tr('ui.region_e46e4')}<select aria-label={tr('ui.anatomical_region_b1c3e')} value={region} onChange={event=>{setRegion(event.target.value);setZoom(false);}}><option value="all">{tr('ui.all_regions_7cd9f')}</option>{catalogueRegions.map(entry=><option key={entry.id} value={entry.id}>{entry.name}</option>)}</select></label></div>
          <div className="anatomy-count" role="status">{found.length} {tr('ui.names_4a0cd')}{system==='all'?'bütün sistemlər':anatomySystems.find(s=>s.id===system)?.name}</div>
          <div className="anatomy-results">
            {found.map(entry=><button key={entry.id} className={item?.id===entry.id?'is-selected':''} aria-pressed={item?.id===entry.id} onClick={()=>{setSelected(entry.id);setZoom(false);}}><strong>{entry.az}</strong><span>{entry.latin}</span></button>)}
            {!found.length&&<p className="anatomy-empty">{tr('ui.enter_another_name_or_change_the_filters_bb6f0')}<button onClick={()=>chooseSystem('all')}>{tr('ui.clear_filters_dea7b')}</button></p>}
          </div>
          <div className="anatomy-selection"><span className="anatomy-eyebrow">{tr('ui.selected_structure_c4add')}</span><strong>{item?.az||'Struktur seçilməyib'}</strong><span lang="la">{item?.latin||'—'}</span>
            {item&&<span className="anatomy-category">{anatomyKinds.find(k=>k.id===item.kind)?.name} · {catalogueRegions.find(r=>r.id===item.region)?.name}</span>}
            <div className="anatomy-options"><label>{tr('ui.side_6e081')}<select aria-label={tr('ui.anatomical_side_c542a')} value={item?.paired?side:'none'} disabled={!item?.paired} onChange={event=>setSide(event.target.value)}><option value="none">{item?.paired?'Göstərilməsin':'Tətbiq olunmur'}</option><option value="left">{tr('ui.left_36184')}</option><option value="right">{tr('ui.right_a8e0e')}</option></select></label>
            <label>{tr('ui.label_language_8d833')}<select aria-label={tr('ui.anatomical_label_language_5349a')} value={language} onChange={event=>setLanguage(event.target.value)}><option value="both">{tr('ui.az_latin_84e63')}</option><option value="az">{tr('ui.azerbaijani_1ceb3')}</option><option value="latin">{tr('ui.latin_1cd1b')}</option></select></label></div>
            <button className="anatomy-place" disabled={!canPlace||!item} onClick={()=>{if(item){onPlace(item,structureLabelText(item,side,language));onOpenChange(false);}}}><Crosshair size={17}/>{tr('ui.label_on_image_088c4')}</button>
            {!canPlace&&<small>{tr('ui.open_an_image_in_the_viewer_to_place_a_label_2e655')}</small>}
          </div>
        </section>
      </div>
      <footer className="anatomy-footer"><span>{tr('ui.manual_labelling_no_automatic_recognition_lab_639d3')}</span><details><summary>{tr('ui.atlas_sources_cb88a')}</summary><div className="anatomy-sources"><p>{tr('ui.original_illustrations_are_preserved_selectio_a6eaa')}</p>{Object.values(anatomyPlates).map(p=><p key={p.src}><a href={p.source} target="_blank" rel="noreferrer">{p.caption}</a><br/>{p.author} · {p.licenseUrl?<a href={p.licenseUrl} target="_blank" rel="noreferrer">{p.license}</a>:p.license}</p>)}<p>{tr('ui.point_layers_for_the_heart_and_endocrine_atla_81cd9')}</p></div></details></footer>
    </DialogContent>
  </Dialog>;
}
