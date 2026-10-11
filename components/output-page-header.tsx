'use client';
import {useTranslation as useUiTranslation,translate as tr} from '@/lib/i18n';
import { RadazLogo, RadazTagline } from './radaz-logo';
import { AppHelpMenu } from './app-product';
import type { ReactNode } from 'react';
import { Activity, ArrowLeft, Database, Disc3, Printer, Settings2 } from 'lucide-react';

export function OutputPageHeader({ kind, children }: { kind: 'print' | 'media' | 'settings'; children?: ReactNode }) {
  useUiTranslation();
  const Icon = kind === 'media' ? Disc3 : kind === 'settings' ? Settings2 : Printer;
  const title = kind === 'media' ? 'CD / DVD' : kind === 'settings' ? tr('ui.printer_settings_75fe9') : 'Çap önbaxışı';
  return <header className={`output-page-header ${kind === 'print' ? 'print-header' : ''}`}>
    <div className="output-page-brand"><RadazLogo size={34}/><span><strong>RADAZ</strong><RadazTagline/></span></div>
    <div className="output-page-title"><Icon size={20}/><div><h1>{title}</h1>{children && <p>{children}</p>}</div></div>
    <nav className="toolbar-group output-page-nav" aria-label={tr('ui.workspaces_a2ce8')}><a href="/" title={tr('ui.viewer_678bf')} aria-label={tr('ui.viewer_678bf')}><ArrowLeft size={16}/><span>{tr('ui.viewer_678bf')}</span></a><a href="/archive" title={tr('ui.local_archive_c13fe')} aria-label={tr('ui.local_archive_c13fe')}><Database size={16}/><span>{tr('ui.local_archive_c13fe')}</span></a>{kind !== 'settings' && <a title={tr('ui.printer_settings_75fe9')} aria-label={tr('ui.printer_settings_75fe9')} href="/printer-settings" target="_blank" rel="noreferrer"><Settings2 size={16}/><span>{tr('ui.printer_settings_75fe9')}</span></a>}<AppHelpMenu/></nav>
  </header>;
}
