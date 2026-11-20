import assert from 'node:assert/strict';

// Used with the browser fixture and the authenticated Windows desktop test.
export async function exerciseMemberChanges(page) {
  const button = (name) => page.getByRole('button', {name, exact: true});
  const label = (name) => page.getByLabel(name, {exact: true});
  const row = (name) => page.getByRole('row').filter({has: button('Düzəliş et: '+name)});
  const openMembers = () => button('Klinikalar və radioloqlar').click();

  async function addMember(id, name, role, rights) {
    await button('Yeni əməkdaş').click();
    await label('RADAZ hesab ID-si').fill(id);
    await label('Ad və soyad').fill(name);
    await page.getByRole('combobox', {name: /^Rol/}).selectOption(role);
    for (const right of rights) await label(right).check();
    await button('Üzvlüyü saxla').click();
    await row(name).waitFor();
  }

  await openMembers();
  await addMember('qa-reader', 'Test radioloq', 'radiologist', ['Qəbul', 'Arxivə endirmə']);
  await addMember('qa-operator', 'Test operator', 'operator', ['Göndərmə']);
  await button('Yeni əməkdaş').click();
  assert.equal(await label('RADAZ hesab ID-si').inputValue(), '');
  await label('RADAZ hesab ID-si').fill('qa-reader');
  await label('Ad və soyad').fill('Existing ID');
  await button('Üzvlüyü saxla').click();
  await page.getByRole('alert').filter({hasText: 'artıq klinikada var'}).waitFor();
  await button('Ləğv et').click();
  await row('Test radioloq').getByRole('button', {name: /Düzəliş et/}).click();
  assert.equal(await label('RADAZ hesab ID-si').isEditable(), false);
  assert.equal(await label('RADAZ hesab ID-si').inputValue(), 'qa-reader');
  assert.equal(await label('Qəbul').isChecked(), true);
  await label('Ad və soyad').fill('Test radioloq Əli');
  await label('Arxivə endirmə').uncheck();
  await button('Üzvlüyü saxla').click();
  await row('Test radioloq Əli').waitFor();

  await page.reload();
  await openMembers();
  await row('Test radioloq Əli').getByRole('button', {name: /Düzəliş et/}).click();
  assert.equal(await label('Arxivə endirmə').isChecked(), false);
  assert.equal(await label('Qəbul').isChecked(), true);
  assert.equal(await label('RADAZ hesab ID-si').inputValue(), 'qa-reader');
  const remove = () => row('Test radioloq Əli').getByRole('button', {name: /Siyahıdan sil/}).click();
  const confirmation = page.getByRole('alertdialog');
  await remove();
  assert.match(await confirmation.innerText(), /Test radioloq Əli/);
  await confirmation.getByRole('button', {name: 'Ləğv et'}).click();
  await confirmation.waitFor({state: 'hidden'});
  await row('Test radioloq Əli').waitFor();
  await remove();
  await confirmation.getByRole('button', {name: 'Siyahıdan sil', exact: true}).click();
  await row('Test radioloq Əli').waitFor({state: 'hidden'});

  await page.reload();
  await openMembers();
  await row('Test operator').waitFor();
  assert.equal(await row('Test radioloq Əli').count(), 0);
}
