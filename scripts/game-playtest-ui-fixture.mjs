// Shared UI interactions for synthetic qualification only. Never actual players,
// implicit consent, a runtime adapter or a product quality collector.
import assert from 'node:assert/strict';

export async function fillSyntheticObservation(scope, notes='Synthetic observation; no person participated.') {
  assert.equal(await scope.locator('#pt-consent').isChecked(),false);
  assert.equal(await scope.locator('#pt-distinct').isChecked(),false);
  assert.equal(await scope.locator('#pt-score').inputValue(),'');
  assert.equal(await scope.locator('#pt-understood').inputValue(),'');
  await scope.locator('#pt-understood').selectOption('yes');
  await scope.locator('#pt-seconds').fill('27.5');
  await scope.locator('#pt-score').selectOption('4');
  await scope.locator('#pt-platform').fill('Synthetic desktop fixture');
  await scope.locator('#pt-device').fill('No actual person or physical-device acceptance');
  await scope.locator('#pt-browser').fill('Qualification fixture');
  await scope.locator('#pt-input-keyboard').check();
  await scope.locator('#pt-notes').fill(notes);
  await scope.locator('#pt-consent').check();
  await scope.locator('#pt-distinct').check();
}

export async function exerciseSyntheticPlaytest({scope,confirm=async()=>{},title='Synthetic UI round'}) {
  await scope.locator('[data-tab="playtests"]').click();
  await scope.locator('#new-playtest').click();
  await scope.locator('#pt-title').fill(title);
  await scope.locator('#pt-audience').fill('Synthetic qualification only; no human playtest or consent proof.');
  await scope.locator('#submit-playtest').click();await confirm();
  await scope.locator('#playtest-form').waitFor({state:'hidden'});
  await scope.locator('#playtest-title').filter({hasText:title}).waitFor();
  await scope.locator('#record-playtest').click();
  await fillSyntheticObservation(scope);
  await scope.locator('#submit-playtest').click();await confirm();
  await scope.locator('#playtest-form').waitFor({state:'hidden'});
  await scope.locator('#playtest-summary').filter({hasText:'1 registros ativos'}).waitFor();
  assert.match(await scope.locator('#playtest-source').textContent(),/não aprovação de qualidade/);
  await scope.getByRole('button',{name:'Retirada de consentimento',exact:true}).click();
  assert.equal(await scope.locator('#pt-withdrawal').isChecked(),false);
  await scope.locator('#pt-withdrawal').check();
  await scope.locator('#submit-playtest').click();await confirm();
  await scope.locator('#playtest-form').waitFor({state:'hidden'});
  await scope.locator('#playtest-summary').filter({hasText:'0 registros ativos'}).waitFor();
  assert.match(await scope.locator('#playtest-summary').textContent(),/1 retirados/);
  assert.equal(await scope.locator('#playtest-responses details').count(),0);
  await scope.locator('#refresh-playtest').click();
  await scope.locator('#playtest-summary').filter({hasText:'1 retirados'}).waitFor();
  return {syntheticOnly:true,explicitNativeConfirmations:3,blankConsentAndScore:true,createdRecordedAndWithdrawn:true,withdrawnNotesAbsent:true,qualityApproved:false};
}
