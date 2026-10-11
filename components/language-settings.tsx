'use client';
import {useEffect} from 'react';
import {initializeLanguage,setLanguage,useTranslation,isLanguage} from '@/lib/i18n';
export function LanguageInitialization(){useEffect(initializeLanguage,[]);return null;}
export function LanguageSettings(){
 const {t,language}=useTranslation();
 return <fieldset className="language-settings"><legend>{t('settings.general')}</legend><label>{t('settings.language')}<select aria-label={t('settings.language')} value={language} onChange={event=>{if(isLanguage(event.target.value))setLanguage(event.target.value);}}><option value="az">Azərbaycan dili</option><option value="ru">Русский</option><option value="en">English</option></select></label><p>{t('settings.languageNote')}</p></fieldset>;
}
