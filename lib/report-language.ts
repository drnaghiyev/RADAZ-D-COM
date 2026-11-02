export const reportLabels = (language = 'az') => ({
 az:{title:'RADİOLOJİ HESABAT',patient:'Pasiyent',birth:'Təvəllüd',date:'Müayinə tarixi',study:'Müayinə'},
 en:{title:'RADIOLOGY REPORT',patient:'Patient',birth:'Date of birth',date:'Study date',study:'Study'},
 ru:{title:'РАДИОЛОГИЧЕСКОЕ ЗАКЛЮЧЕНИЕ',patient:'Пациент',birth:'Дата рождения',date:'Дата исследования',study:'Исследование'},
 tr:{title:'RADYOLOJİ RAPORU',patient:'Hasta',birth:'Doğum tarihi',date:'Tetkik tarihi',study:'Tetkik'}
}[language] || {title:'RADİOLOJİ HESABAT',patient:'Pasiyent',birth:'Təvəllüd',date:'Müayinə tarixi',study:'Müayinə'});
