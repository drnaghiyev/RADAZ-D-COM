'use client';
import {useState} from 'react';
import './tablet-layout.css';
import './tablet-inbox';

const key='radaz-tablet-dock-columns';
export function TabletLayoutSettings(){
  const [columns,setColumns]=useState(()=>typeof window!=='undefined' && localStorage.getItem(key)==='1'?'1':'2');
  return <fieldset className="language-settings"><legend>Alət paneli</legend>
    <label>Sağ paneldə düymələrin düzülüşü <select aria-label="Sağ paneldə sütun sayı" value={columns} onChange={event=>{
      const next=event.currentTarget.value;
      localStorage.setItem(key,next);
      document.documentElement.dataset.tabletColumns=next;
      setColumns(next);
    }}><option value="2">İki sütun</option><option value="1">Bir sütun</option></select></label>
  </fieldset>;
}
