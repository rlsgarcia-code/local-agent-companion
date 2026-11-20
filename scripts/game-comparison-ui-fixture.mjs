// Read-only structural comparison in development interfaces; not game QA.
import assert from 'node:assert/strict';
export async function exerciseRevisionComparison({scope,targetRevision}){
  await scope.locator('[data-tab="history"]').click();
  await scope.locator('#comparison-base').fill('1');await scope.locator('#comparison-target').fill(String(targetRevision));
  await scope.locator('#compare-revisions').click();await scope.locator('#comparison-title').filter({hasText:`Revisão 1 → revisão ${targetRevision}`}).waitFor();
  assert.match(await scope.locator('#comparison-summary').textContent(),/diferenças estruturais/);
  await scope.locator('#comparison-section').selectOption('files');await scope.locator('#compare-revisions').click();
  await scope.locator('#comparison-title').filter({hasText:'Arquivos'}).waitFor();
  assert.ok(await scope.locator('.comparison-change').count());
  for(const heading of await scope.locator('.comparison-change h4').allTextContents())assert.match(heading,/^Arquivos/);
  await scope.locator('#comparison-base').fill(String(targetRevision));await scope.locator('#comparison-section').selectOption('all');await scope.locator('#compare-revisions').click();
  await scope.locator('#comparison-summary').filter({hasText:'mesmo conteúdo de origem'}).waitFor();assert.equal(await scope.locator('.comparison-change').count(),0);
  await scope.locator('#comparison-base').fill('1');await scope.locator('#compare-revisions').click();await scope.locator('#comparison-summary').filter({hasText:'diferenças estruturais'}).waitFor();
  return {readOnlyQueries:true,exactBaseRevision:1,exactTargetRevision:targetRevision,fileFilter:true,sameRevisionHasNoChanges:true,noRestore:true,gameQualityApproved:false};
}
