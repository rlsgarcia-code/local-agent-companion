// Fixed engineering fixture for the actual native hosts. No model inference,
// personal profile, installed application changes or artistic acceptance.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import modelFixture from '../dist-tests/test/game-blender-fixtures.js';
import inspector from '../dist-tests/packages/game-production/src/glb.js';
const tick=()=>new Promise(resolve=>setTimeout(resolve,30));
export async function exerciseNativeModelEditing({scope,restart,client,projectId,confirm=async()=>{},prepareDeny=async()=>{},deny=async()=>{},capture,readDispatches,output}){
  const save=async(name,value)=>{const file=path.join(output,'model-editing',name);await mkdir(path.dirname(file),{recursive:true});await writeFile(file,Buffer.isBuffer(value)?value:JSON.stringify(value,null,2)+'\n');};
  async function settled(id){for(let i=0;i<8000;i++){const job=await client.getGameProduction(id);if(!['admitting','queued','running','cancelling'].includes(job.state)){assert.equal(job.state,'completed',job.error);return job;}await tick();}throw Error('Original model job '+id+' remains unconfirmed; inspect without repeating');}
  const initial=await client.getGameProject(projectId),operation=modelFixture.fixtureSkinnedModelOperation();operation.outputBase='assets/native-sleeve';
  const original=await client.processGameAsset('native-weighted-source',projectId,initial.revision,{processorId:'blender-model-isolated-v1',target:{id:'native-weighted-model',role:'Peça original para edição 3D',placeholder:true},operation});await settled(original.id);
  const preserve=async(id,directory)=>{const result=await client.getGameAssetResult(id);await save(directory+'/result.json',result);for(const file of result.files)await save(directory+'/'+file.path,await client.downloadGameAssetFile(id,file.path));return result;};
  const originalResult=await preserve(original.id,'original'),originalBytes=await client.downloadGameAssetFile(original.id,'assets/native-sleeve.glb'),hash=bytes=>createHash('sha256').update(bytes).digest('hex');
  const section=name=>scope.locator('[data-model-section='+JSON.stringify(name)+']');
  const expand=async name=>section(name).locator(':scope > summary').click();
  await scope.locator('#refresh').click();await scope.locator('[data-tab="assets"]').click();await scope.locator('#candidate-list').getByRole('button',{name:'Revisar candidato',exact:true}).first().click();await scope.getByRole('button',{name:'Ajustar modelo 3D',exact:true}).click();
  await expand('Objetos · 1');await expand('Objeto sleeve');await scope.getByLabel('Objeto sleeve · Rotação em graus Z',{exact:true}).fill('9');
  await expand('Vértices · 36');await section('Vértices · 36').getByRole('button',{name:'Próximo',exact:true}).click();await expand('Vértice 12 · sleeve');
  await scope.getByLabel('sleeve · Vértice 12 · Peso 1',{exact:true}).fill('.5');await scope.getByLabel('sleeve · Vértice 12 · Peso 2',{exact:true}).fill('.5');
  await expand('Materiais · 1');await expand('Material copper');await scope.getByLabel('Material copper · Cor RGBA',{exact:true}).fill('#55aaccff');
  await expand('Animações · 1');await expand('Animação bend');await expand('Trilha 1 · tip · rotation');await scope.getByLabel('bend · Trilha 1 · Chave 2 · Valor Z',{exact:true}).fill('-38');
  await scope.locator('#draft-status[data-state="saved"]').waitFor();await capture('model-editing-unsent.png');assert.equal((await readDispatches()).length,0);
  // restart() closes the complete owned application/editor and reconnects its
  // real host, preserving the same private profile/session and durable draft.
  scope=await restart();assert.equal((await readDispatches()).length,0);await scope.locator('[data-tab="assets"]').click();await expand('Materiais · 1');await expand('Material copper');assert.equal(await scope.getByLabel('Material copper · Cor RGBA',{exact:true}).inputValue(),'#55aaccff');
  await scope.locator('#submit-image').click();await confirm();await scope.locator('#notice').filter({hasText:'Fixture lost native model acknowledgment'}).waitFor();
  const first=await readDispatches();assert.equal(first.length,1);await settled(first[0].jobId);const candidate=await preserve(first[0].jobId,'variant');
  scope=await restart();assert.deepEqual(await readDispatches(),first,'restart cannot submit an effect');await scope.locator('[data-tab="assets"]').click();await expand('Materiais · 1');await expand('Material copper');assert.equal(await scope.getByLabel('Material copper · Cor RGBA',{exact:true}).isDisabled(),true);
  await prepareDeny();await scope.locator('#submit-image').click();await deny();await scope.locator('#notice').filter({hasText:'Operação cancelada'}).waitFor();assert.deepEqual(await readDispatches(),first,'denial cannot dispatch another process or settle the previous result');
  scope=await restart();assert.deepEqual(await readDispatches(),first);await scope.locator('[data-tab="assets"]').click();assert.equal(await scope.locator('#submit-image').textContent(),'Retomar pedido');await scope.locator('#submit-image').click();await confirm();await scope.locator('#image-editor').waitFor({state:'hidden'});
  const dispatches=await readDispatches();assert.equal(dispatches.length,2);assert.deepEqual(dispatches[1],dispatches[0]);assert.equal((await client.getGameProject(projectId)).revision,initial.revision);
  const jobs=(await client.listGameProduction(projectId,0,100)).jobs.filter(job=>job.assetSpec?.operation.type==='model.scene');assert.equal(jobs.length,2);assert.equal(candidate.spec.operation.materials[0].color,'#55aaccff');assert.equal(candidate.spec.operation.clips[0].tracks[0].keys[1].value[2],-38);assert.equal(candidate.spec.operation.objects[0].skin.weights[12][0].weight,.5);
  assert.equal(hash(await client.downloadGameAssetFile(original.id,'assets/native-sleeve.glb')),hash(originalBytes));const geometry=inspector.inspectGameGlb(await client.downloadGameAssetFile(first[0].jobId,'assets/native-sleeve.glb'));assert.ok(geometry.mixedWeightVertices>0&&geometry.animations>0);
  await scope.locator('#refresh').click();await scope.locator('[data-tab="assets"]').click();await scope.locator('#candidate-list').getByRole('button',{name:'Revisar candidato',exact:true}).first().click();await scope.getByRole('button',{name:'Inspecionar modelo 3D',exact:true}).click();await confirm();await scope.locator('#notice').filter({hasText:'Visor 3D aberto'}).waitFor({timeout:30000});assert.equal((await client.getGameProject(projectId)).revision,initial.revision);await capture('model-editing-variant.png');
  await scope.locator('#apply-candidate').click();await confirm();await scope.waitForFunction(revision=>document.querySelector('#revision').textContent.startsWith('Revisão '+revision),initial.revision+1);assert.equal((await client.getGameProject(projectId)).revision,initial.revision+1);
  await capture('model-editing-applied.png');const result={sourceJobId:original.id,variantJobId:first[0].jobId,revisionBefore:initial.revision,revisionAfter:initial.revision+1,originalHash:hash(originalBytes),mixedWeightVertices:geometry.mixedWeightVertices,animations:geometry.animations,originalAndVariantBytesPreserved:true,wholeHostRestarts:3,noAutomaticDispatch:true,exactReplay:true,oneNewJob:true,denialPreservesUnknown:true,unsentEditRecovered:true,modelPreviewOpenedThroughNativeHost:true,explicitApplication:true,placeholderPreserved:candidate.asset.placeholder&&originalResult.asset.placeholder,fullArtisticOrInstalledAcceptance:false};await save('report.json',result);return {scope,result};
}
