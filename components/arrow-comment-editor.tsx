'use client';
import {useTranslation as useUiTranslation,translate as tr} from '@/lib/i18n';

import {useState} from 'react';
import type {LocalMark} from './measurement-overlay';
export function ArrowCommentEditor({mark,onSave,onClose}:{mark:LocalMark;onSave:(text:string)=>void;onClose:()=>void}){
  useUiTranslation();
 const [text,setText]=useState(mark.comment||'');
 return <form className="arrow-comment-editor" role="dialog" aria-label={tr('ui.arrow_comment_8d7a1')} onClick={e=>e.stopPropagation()} onDoubleClick={e=>e.stopPropagation()}
  onKeyDown={e=>{if(e.key==='Escape'){e.stopPropagation();onClose();}}} onSubmit={e=>{e.preventDefault();onSave(text.trim());onClose();}}>
  <label htmlFor={`comment-${mark.id}`}>{tr('ui.arrow_comment_8d7a1')}</label>
  <textarea id={`comment-${mark.id}`} autoFocus maxLength={500} rows={3} value={text} onChange={e=>setText(e.target.value)} placeholder={tr('ui.enter_a_comment_71959')}/>
  <div><button type="submit">{tr('ui.save_33632')}</button><button type="button" onClick={onClose}>{tr('ui.cancel_94727')}</button></div>
 </form>;
}
