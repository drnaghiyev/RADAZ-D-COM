'use client';
import {useTranslation} from '@/lib/i18n';
export function RadazLogo({size=32}:{size?:number}){
 return <svg className="radaz-logo" role="img" aria-label="RADAZ" width={size} height={size} viewBox="0 0 72 72" fill="none"><path d="M26 7.8C14.4 11.8 7.1 23.2 7.1 35.8c0 16 13.1 29.1 29.1 29.1s29.1-13.1 29.1-29.1c0-3.8-.7-7.4-2.1-10.8" stroke="currentColor" strokeWidth="4.4" strokeLinecap="round"/><path d="M27.5 51V20.5H39c7.3 0 11.4 3.6 11.4 9.5s-4.1 9.6-11.4 9.6H27.5M39 39.6 51.1 51" stroke="currentColor" strokeWidth="4.3" strokeLinecap="square" strokeLinejoin="round"/></svg>;
}
export function RadazTagline(){const {language}=useTranslation();return <small>{({az:'AĞILLI GÖRÜNTÜLƏMƏ',ru:'УМНАЯ ВИЗУАЛИЗАЦИЯ',en:'SMART IMAGING'})[language]}</small>;}
