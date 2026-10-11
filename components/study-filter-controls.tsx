'use client';
import {useTranslation as useUiTranslation,translate as tr} from '@/lib/i18n';


import { CalendarRange, Check, ScanSearch } from 'lucide-react';
import {DropdownMenu,DropdownMenuTrigger,DropdownMenuContent,DropdownMenuItem,DropdownMenuCheckboxItem} from './ui/dropdown-menu';

type Props = {
  from: string;
  to: string;
  modalities: string[];
  options: string[];
  onFromChange: (value: string) => void;
  onToChange: (value: string) => void;
  onModalitiesChange: (value: string[]) => void;
};

export const localDate = (date = new Date()) => {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
};

export function StudyFilterControls({ from, to, modalities, options, onFromChange, onToChange, onModalitiesChange }: Props) {
  useUiTranslation();
  const todayDate = localDate();
  const chooseRange = (value: string) => {
    const today = new Date();
    if (value === 'all') { onFromChange(''); onToChange(''); return; }
    if (value === 'custom') return;
    const start = new Date(today);
    if (value === 'yesterday') start.setDate(today.getDate() - 1);
    if (value === 'week') start.setDate(today.getDate() - 6);
    if (value === 'month') start.setMonth(today.getMonth() - 1);
    if (value === 'year') start.setFullYear(today.getFullYear() - 1);
    onFromChange(localDate(start));
    onToChange(value === 'yesterday' ? localDate(start) : localDate(today));
  };
  const allSelected = modalities.length === 0;
  const toggle = (modality: string) => onModalitiesChange(modalities.includes(modality)
    ? modalities.filter(item => item !== modality)
    : [...modalities, modality]);

  return <div className="study-filter-controls">
    <label className="today-filter"><input type="checkbox" checked={from === todayDate && to === todayDate} onChange={event => { const value = event.currentTarget.checked ? todayDate : ''; onFromChange(value); onToChange(value); }}/><span>{tr('ui.today_dfb2e')}</span></label>
    <label className="date-preset"><CalendarRange size={15}/><select aria-label={tr('ui.quick_date_selection_de219')} value="custom" onChange={event => chooseRange(event.currentTarget.value)}>
      <option value="custom">{tr('ui.date_range_02279')}</option><option value="all">{tr('ui.all_dates_306ea')}</option><option value="today">{tr('ui.today_dfb2e')}</option><option value="yesterday">{tr('ui.yesterday_e5d49')}</option><option value="week">{tr('ui.last_week_587b2')}</option><option value="month">{tr('ui.last_month_4ae0f')}</option><option value="year">{tr('ui.last_year_ae11f')}</option>
    </select></label>
    <label className="compact-date"><span>{tr('ui.start_cf0f0')}</span><input aria-label={tr('ui.start_date_3d5f2')} type="date" value={from} max={to || undefined} onChange={event => onFromChange(event.currentTarget.value)}/></label>
    <label className="compact-date"><span>{tr('ui.end_4e850')}</span><input aria-label={tr('ui.end_date_48dae')} type="date" value={to} min={from || undefined} onChange={event => onToChange(event.currentTarget.value)}/></label>
    <DropdownMenu><DropdownMenuTrigger asChild><button type="button" className="modality-trigger" title={tr('ui.select_modalities_5a9a6')} aria-label={tr('ui.select_modalities_5a9a6')}><ScanSearch size={15}/><span>{allSelected ? tr('ui.all_studies_4945b') : modalities.join(', ')}</span></button></DropdownMenuTrigger>
      <DropdownMenuContent className="header-menu modality-popover" align="start">
        <DropdownMenuItem onSelect={()=>onModalitiesChange([])}><Check size={13}/> {tr('ui.all_studies_4945b')}</DropdownMenuItem>
        {options.map(modality=><DropdownMenuCheckboxItem key={modality} checked={modalities.includes(modality)} onSelect={event=>event.preventDefault()} onCheckedChange={()=>toggle(modality)}>{modality}</DropdownMenuCheckboxItem>)}
      </DropdownMenuContent>
    </DropdownMenu>
  </div>;
}
