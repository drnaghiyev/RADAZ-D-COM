import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';

export const testPassword = () => randomBytes(24).toString('base64url');

export async function setTestPassword(page, password) {
  await page.getByLabel('Yeni şifrə', {exact:true}).fill(password);
  await page.getByLabel('Yeni şifrəni təkrarlayın', {exact:true}).fill(password);
  await page.getByRole('button', {name:'Şifrəni yarat', exact:true}).click();
}

export async function unlockTestSettings(page, password) {
  await page.getByLabel('Şifrə', {exact:true}).fill(password);
  await page.getByRole('button', {name:'Kilidi aç', exact:true}).click();
}

export async function checkPasswordChanges(page, password) {
  const otherWindow = page.context().waitForEvent('page');
  await page.evaluate(()=>{window.open('/private-network/settings','radaz-qa-second-settings');});
  const other = await otherWindow;
  await other.getByLabel('Şifrə',{exact:true}).waitFor();
  assert.equal(await other.getByRole('heading',{name:'Cihaz və bağlantı'}).count(),0);
  await unlockTestSettings(other,password);
  await other.getByRole('heading',{name:'Cihaz və bağlantı'}).waitFor();
  const nextPassword = testPassword();
  await page.getByRole('button',{name:'Şifrəni dəyiş',exact:true}).click();
  await page.getByLabel('Cari şifrə',{exact:true}).fill(password);
  await page.getByLabel('Yeni şifrə',{exact:true}).fill(nextPassword);
  await page.getByLabel('Yeni şifrəni təkrarlayın',{exact:true}).fill(nextPassword);
  await Promise.all([
    page.waitForResponse(r=>r.url().endsWith('/settings_change')&&r.ok()),
    page.getByRole('button',{name:'Yeni şifrəni saxla',exact:true}).click(),
  ]);
  await page.getByRole('button',{name:'Şifrəni dəyiş',exact:true}).waitFor();
  await other.getByLabel('Şifrə',{exact:true}).waitFor();
  await other.close();
  await page.getByRole('button',{name:'Kilidlə',exact:true}).click();
  assert.equal(await page.getByRole('heading',{name:'Cihaz və bağlantı'}).count(),0);
  const reject = page.waitForResponse(r=>r.url().endsWith('/settings_unlock') && r.status()===403);
  await unlockTestSettings(page,password);
  await reject;
  await unlockTestSettings(page,nextPassword);
  await page.getByRole('heading',{name:'Cihaz və bağlantı'}).waitFor();
  return nextPassword;
}
