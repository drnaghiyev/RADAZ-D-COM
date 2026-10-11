/** RADAZ receiver: one-time, two-minute capability; no patient data in the URL. */
export async function importFromRadazSite(
  openSources: (files: File[]) => Promise<void>,
  status: (message: string) => void,
  allowedOrigins: string[],
): Promise<boolean> {
  const params=new URLSearchParams(window.location.hash.slice(1));
  const ticket=params.get('radaz-ticket'),source=params.get('radaz-site');
  if(!ticket&&!source)return false;
  // Remove the capability from the address bar/history before network or import work.
  params.delete('radaz-ticket');params.delete('radaz-site');
  history.replaceState(null,'',location.pathname+location.search+(params.size?'#'+params.toString():''));
  if(!ticket||!/^[A-Za-z0-9_-]{43}$/.test(ticket)||!source)throw Error('RADAZ sayt keçidi düzgün deyil.');
  const origin=new URL(source);
  if(origin.origin!==source||!['https:','http:'].includes(origin.protocol)||origin.username||origin.password)throw Error('RADAZ sayt ünvanı düzgün deyil.');
  const allowed=new Set([window.location.origin,...allowedOrigins.filter(Boolean)]);
  if(!allowed.has(origin.origin))throw Error('Bu RADAZ saytına icazə verilməyib. Saytın ünvanını RADAZ bağlantı konfiqurasiyasına əlavə edin.');
  status('RADAZ saytından müayinə alınır…');
  const response=await fetch(origin.origin+'/api/viewer/redeem',{
    method:'POST',mode:'cors',credentials:'omit',redirect:'error',
    headers:{'Content-Type':'application/json','X-RADAZ-CLIENT':'web'},body:JSON.stringify({ticket}),signal:AbortSignal.timeout(120000),
  });
  if(!response.ok)throw Error('Saytdan müayinə alınmadı. Keçidin vaxtı bitmiş ola bilər; saytda “RADAZ-da aç” düyməsini yenidən seçin.');
  if(!response.headers.get('Content-Type')?.includes('application/zip'))throw Error('Server DICOM arxivi qaytarmadı.');
  if(Number(response.headers.get('Content-Length')||0)>256*1024*1024)throw Error('Arxiv 256 MB limitini aşır.');
  const blob=await response.blob();
  if(blob.size>256*1024*1024)throw Error('Arxiv 256 MB limitini aşır.');
  await openSources([new File([blob],'RADAZ-site-study.zip',{type:'application/zip'})]);
  return true;
}
