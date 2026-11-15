// Development qualification of real SDK/service/Blender and shared renderer.
// Host bridges/consent are emulated. No inference or installed-client claim.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,mkdtemp,rm} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
import {chromium} from 'playwright-core';
import serviceModule from '../dist-tests/packages/agent-service/src/service.js';
import storeModule from '../dist-tests/packages/agent-service/src/store.js';
import serverModule from '../dist-tests/packages/agent-service/src/server.js';
import security from '../dist-tests/packages/agent-service/src/security.js';
import sdk from '../dist-tests/packages/client-ts/src/index.js';
import studio from '../dist-tests/packages/client-ts/src/game-studio.js';
import drafts from '../dist-tests/packages/client-ts/src/game-studio-drafts.js';
import fileDrafts from '../dist-tests/packages/client-ts/src/game-studio-file-drafts.js';
import blender from '../dist-tests/packages/adapter-game-blender/src/index.js';
import browserModule from '../dist-tests/packages/adapter-game-browser/src/browser.js';
import viewer from '../dist-tests/packages/adapter-game-browser/src/model-preview.js';
import glb from '../dist-tests/packages/game-production/src/glb.js';
import identityModule from '../dist-tests/packages/contracts/src/identity.js';
import models from '../dist-tests/test/game-blender-fixtures.js';
import fixtures from '../dist-tests/test/game-fixtures.js';
const config=process.argv.find(value=>value.startsWith('--provision='))?.slice(12);assert.ok(config,'Select the separate exact Blender record');
const timeline=process.argv.includes('--timeline');
const output=path.resolve('output/playwright/game-model-editing/runs',new Date().toISOString().replace(/[:.]/g,'-')+'-'+randomUUID().slice(0,8));await mkdir(output,{recursive:true});
const state=await mkdtemp(path.join(tmpdir(),'medit-')),hash=data=>createHash('sha256').update(data).digest('hex'),{contentHash}=identityModule;
const save=async(name,value)=>{const file=path.join(output,name);await mkdir(path.dirname(file),{recursive:true});await writeFile(file,Buffer.isBuffer(value)?value:JSON.stringify(value,null,2)+'\n');};
const provision=JSON.parse(await readFile(config));assert.equal(provision.driverSha256,hash(await readFile('packages/adapter-game-blender/image/process.py')));
const sources=[];for(const file of ['packages/contracts/src/game-studio.ts','packages/client-ts/src/game-studio.ts','packages/client-ts/src/game-studio-drafts.ts','packages/client-ts/src/game-studio-file-drafts.ts','packages/game-studio-ui/studio.js','packages/game-studio-ui/studio.css','packages/game-studio-ui/index.html','packages/adapter-game-blender/src/index.ts','packages/adapter-game-blender/image/process.py','test/game-blender-fixtures.ts','scripts/qualify-game-model-editing.mjs']){const bytes=await readFile(file);sources.push({path:file,sha256:hash(bytes)});await save('sources/'+file,bytes);}
const processor=await blender.createBlenderAssetProcessor({stateDirectory:state,configPath:path.resolve(config),driverSha256:provision.driverSha256,implementationSha256:contentHash(sources)});
const identity=await security.ensureIdentity(state),credentials=[];let service,server,store,browser,active,modelPreview,passed=false;const clients=[],jobs=[],results=[];
for(const product of ['companion-mac','companion-vscode'])credentials.push(await security.createClientCredential(state,{id:'model-edit-'+product,product,profile:'fixture',workspace:'',providers:['ollama'],hostTools:[]}));
async function boot(){store=new storeModule.Store(path.join(state,'metadata.sqlite'));for(const credential of credentials)store.register(credential);service=new serviceModule.AgentService(store,state,undefined,{}, {gameAssetProcessors:[processor]});server=new serverModule.LocalServer(service,state);await server.listen();for(const credential of credentials){const client=new sdk.AgentClient({address:security.ipcPath(state),certificate:identity.cert,credential});await client.connect();clients.push(client);}}
async function stop(){for(const client of clients.splice(0))client.close();await server?.close();await service?.close();}
const tick=()=>new Promise(resolve=>setTimeout(resolve,30));
async function settled(client,id){for(let i=0;i<8000;i++){const job=await client.getGameProduction(id);if(!['admitting','queued','running','cancelling'].includes(job.state)){assert.equal(job.state,'completed',job.error);return job;}await tick();}throw Error('Inspect the original job '+id+'; no automatic restart');}
try{
 await save('control.json',{scope:'Source service/SDK/shared renderer and actual isolated Blender; emulated Mac and VS Code bridges with actual file drafts, not native installed clients',sources,provision});
 await boot();const qualified=await browserModule.qualifyBrowser();assert.ok(qualified);browser=await chromium.launch({executablePath:qualified.executablePath,headless:true,chromiumSandbox:true});
 for(const [index,credential]of credentials.entries()){
  let client=clients[index];const product=credential.registration.product,session=await client.call('sessions.create',{title:'Model editing '+product}),document=fixtures.fixtureGameDocument();document.title='Model editing '+product;document.engine='babylon';document.brief.dimension='3d';
  const project=await client.createGameProject('model-project',document);await client.selectGameProject(session.id,project.id);
  const original=await client.processGameAsset('original',project.id,1,{processorId:processor.id,target:{id:'sleeve',role:'Peça de engenharia, não personagem final',placeholder:true},operation:models.fixtureSkinnedModelOperation()});jobs.push({product,id:original.id});await settled(client,original.id);
  const originalResult=await client.getGameAssetResult(original.id),originalHash=hash(await client.downloadGameAssetFile(original.id,'assets/sleeve.glb'));await save(product+'/original/result.json',originalResult);
  for(const file of originalResult.files)await save(product+'/original/'+file.path,await client.downloadGameAssetFile(original.id,file.path));
  const hostData=path.join(state,'host-'+index),scope=drafts.gameStudioDraftKey(credential.registration,session.id),draftFile=path.join(hostData,'game-studio-drafts',scope+'.json');
  let context,page,approve=true,loseAck=false,failSave=false;const sent=[],errors=[];
  const readDraft=async()=>{try{return JSON.parse(await readFile(draftFile,'utf8'));}catch(error){if(error.code==='ENOENT')return undefined;throw error;}};
  async function waitDraft(predicate){for(let i=0;i<400;i++){const record=await readDraft();if(predicate(record))return record;await tick();}throw Error('Draft acknowledgment not confirmed');}
  async function open(){
   const draftStore=fileDrafts.fileGameStudioDraftStore(hostData,scope),controller=new studio.GameStudioController(client,session.id,{canWrite:()=>true,approve:async()=>approve,preview:async()=>{throw Error('Not a game preview');},exportSource:async()=>false,exportBuild:async()=>false,exportAsset:async()=>false,
    previewModel:async(result,modelPath,readFile)=>{modelPreview=await viewer.openGameModelPreview({result,modelPath,readFile,runtimeDirectory:path.resolve(index?'dist/game-model-runtime':'desktop-dist/game-model-runtime'),signal:new AbortController().signal,headless:true});}});
   context=await browser.newContext({viewport:{width:index?800:1280,height:900},colorScheme:index?'dark':'light'});page=await context.newPage();active=page;page.on('pageerror',error=>errors.push(error.message));
   await page.exposeFunction('__modelEdit',async command=>{
    if(draftStore.handles(command)){if(command.action==='draft-write'&&failSave)throw Error('Fixture durable storage unavailable');return draftStore.dispatch(command);}
    if(command.action==='adjust-model')sent.push(structuredClone(command));const value=await controller.dispatch(command);
    if(command.action==='adjust-model'&&value?.requestedAssetJobId){jobs.push({product,id:value.requestedAssetJobId});if(loseAck){loseAck=false;await settled(client,value.requestedAssetJobId);throw Error('Fixture lost model acknowledgment');}}
    return value;
   });
   await page.addInitScript(({editor})=>{if(!editor)window.gameStudioHost={request:command=>window.__modelEdit(command)};else window.acquireVsCodeApi=()=>({postMessage:message=>{window.__modelEdit(message.command).then(value=>window.postMessage({type:'game-studio-response',id:message.id,value},'*')).catch(error=>window.postMessage({type:'game-studio-response',id:message.id,error:error.message},'*'));}});},{editor:index===1});
   await page.goto(pathToFileURL(path.resolve('packages/game-studio-ui/index.html')).href);await page.getByRole('heading',{name:document.title,exact:true}).waitFor();
  }
  const section=name=>page.locator('[data-model-section='+JSON.stringify(name)+']');
  async function expand(name){await section(name).locator(':scope > summary').click();}
  await open();await page.locator('[data-tab="assets"]').click();await page.getByRole('button',{name:'Revisar candidato',exact:true}).click();await page.getByRole('button',{name:'Ajustar modelo 3D',exact:true}).click();
  await expand('Objetos · 1');await expand('Objeto sleeve');await page.getByLabel('Objeto sleeve · Rotação em graus Z',{exact:true}).fill('12');
  await expand('Vértices · 36');await section('Vértices · 36').getByRole('button',{name:'Próximo',exact:true}).click();await expand('Vértice 12 · sleeve');
  await page.getByLabel('sleeve · Vértice 12 · Peso 1',{exact:true}).fill('0.4');await page.getByLabel('sleeve · Vértice 12 · Peso 2',{exact:true}).fill('0.4');await section('Vértice 12 · sleeve').getByRole('button',{name:'Normalizar pesos',exact:true}).click();
  assert.equal(await page.getByLabel('sleeve · Vértice 12 · Peso 1',{exact:true}).inputValue(),'0.5');
  await expand('Materiais · 1');await expand('Material copper');await page.getByLabel('Material copper · Cor RGBA',{exact:true}).fill('#4488ccff');
  await expand('Ossos · 2');await expand('Osso tip');await page.getByLabel('Osso tip · Fim Z',{exact:true}).fill('2.1');
  await expand('Animações · 1');await expand('Animação bend');await expand('Trilha 1 · tip · rotation');await page.getByLabel('bend · Trilha 1 · Chave 2 · Valor Z',{exact:true}).fill('-42');await section('Trilha 1 · tip · rotation').getByRole('button',{name:'Adicionar chave',exact:true}).click();
  if(timeline){
   const view=section('Trilha 1 · tip · rotation').locator('.model-timeline'),marker=view.getByRole('slider',{name:'Chave 2 · quadro',exact:true});
   await marker.focus();await marker.press('ArrowRight');assert.equal(await marker.getAttribute('aria-valuenow'),'16');await marker.press('Shift+ArrowLeft');assert.equal(await marker.getAttribute('aria-valuenow'),'6');
   await marker.press('End');assert.equal(await marker.getAttribute('aria-valuenow'),'6');assert.match(await view.getByRole('status').textContent(),/ocupado/);
   const target=async frame=>{const bounds=await view.locator('svg').boundingBox();return{x:bounds.x+bounds.width*(20+600*frame/30)/640,y:bounds.y+bounds.height*54/104};};
   let at=await target(6),to=await target(18);await page.mouse.move(at.x,at.y);await page.mouse.down();await page.mouse.move(to.x,to.y,{steps:4});await page.mouse.up();assert.equal(await marker.getAttribute('aria-valuenow'),'18');
   at=await target(18);to=await target(22);await page.mouse.move(at.x,at.y);await page.mouse.down();await page.mouse.move(to.x,to.y,{steps:3});await page.keyboard.press('Escape');await page.mouse.up();assert.equal(await marker.getAttribute('aria-valuenow'),'18');
   const cursor=view.getByLabel('Quadro para nova chave',{exact:true});await cursor.focus();await cursor.press('Home');for(let n=0;n<7;n++)await cursor.press('ArrowRight');await view.getByRole('button',{name:'Copiar chave neste quadro',exact:true}).click();
   const copied=await waitDraft(record=>record?.value?.mediaEdit?.operation.clips[0].tracks[0].keys.length===5);assert.deepEqual(copied.value.mediaEdit.operation.clips[0].tracks[0].keys.at(-1),{frame:7,value:[0,0,-42]});
   await view.getByRole('button',{name:'Remover chave selecionada',exact:true}).click();
   const duration=page.getByLabel('Animação bend · Duração em quadros',{exact:true});await duration.fill('20');assert.match(await view.getByRole('status').textContent(),/inválidos/);await duration.fill('30');assert.equal(await view.getByRole('slider',{name:'Chave 3 · quadro',exact:true}).getAttribute('aria-valuenow'),'30');
   await page.setViewportSize({width:600,height:840});await view.scrollIntoViewIfNeeded();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:path.join(output,product+'-timeline-narrow.png'),fullPage:true});await view.screenshot({path:path.join(output,product+'-timeline-detail.png')});await page.setViewportSize({width:1200,height:900});
   await waitDraft(record=>record?.value?.mediaEdit?.operation.clips[0].tracks[0].keys[1].frame===18&&record.value.mediaEdit.operation.clips[0].tracks[0].keys.length===4&&record.value.mediaEdit.operation.clips[0].frames===30);
   assert.equal(sent.length,0);assert.equal((await client.getGameProject(project.id)).revision,1);
  }
  const saved=await waitDraft(record=>record?.value?.mediaEdit?.operation.materials[0].color==='#4488ccff'&&record.value.mediaEdit.operation.clips[0].tracks[0].keys.length===4);assert.equal(saved.value.mediaEdit.operation.objects[0].skin.weights[12][0].weight,.5);
  await page.locator('#draft-status[data-state="saved"]').waitFor();await page.screenshot({path:path.join(output,product+'-editing.png'),fullPage:true});await context.close();await open();
  assert.equal(sent.length,0,'reopening cannot dispatch processing');await page.locator('[data-tab="assets"]').click();await expand('Materiais · 1');await expand('Material copper');assert.equal(await page.getByLabel('Material copper · Cor RGBA',{exact:true}).inputValue(),'#4488ccff');
  failSave=true;await page.locator('#submit-image').click();await page.locator('#notice').filter({hasText:'preservar o rascunho'}).waitFor();assert.equal(sent.length,0);failSave=false;await context.close();await open();
  await page.locator('[data-tab="assets"]').click();loseAck=true;await page.locator('#submit-image').click();await page.locator('#notice').filter({hasText:'Fixture lost model acknowledgment'}).waitFor();assert.equal(sent.length,1);const frozen=structuredClone(sent[0]);
  await waitDraft(record=>record?.value?.mediaEdit?.command?.requestId===frozen.requestId);await context.close();
  // All effects are terminal before a normal service restart. Reconnect the
  // same products/identities; no namespace reset, re-registration or new budget.
  await stop();await boot();client=clients[index];await open();assert.equal(sent.length,1);await page.locator('[data-tab="assets"]').click();assert.equal(await page.locator('#submit-image').textContent(),'Retomar pedido');await expand('Materiais · 1');await expand('Material copper');assert.equal(await page.getByLabel('Material copper · Cor RGBA',{exact:true}).isDisabled(),true);
  if(timeline){await expand('Animações · 1');await expand('Animação bend');await expand('Trilha 1 · tip · rotation');const frozenKey=section('Trilha 1 · tip · rotation').getByRole('slider',{name:'Chave 2 · quadro',exact:true});assert.equal(await frozenKey.getAttribute('aria-disabled'),'true');await frozenKey.focus();await frozenKey.press('ArrowRight');assert.equal(await frozenKey.getAttribute('aria-valuenow'),'18');assert.deepEqual((await readDraft()).value.mediaEdit.command,frozen);}
  approve=false;await page.locator('#submit-image').click();await page.locator('#notice').filter({hasText:'Operação cancelada'}).waitFor();assert.equal(sent.length,2);assert.deepEqual(sent[1],frozen);assert.ok((await readDraft()).value.mediaEdit.command);
  await context.close();await open();assert.equal(sent.length,2);await page.locator('[data-tab="assets"]').click();approve=true;await page.locator('#submit-image').click();await page.locator('#image-editor').waitFor({state:'hidden'});assert.equal(sent.length,3);assert.deepEqual(sent[2],frozen);
  const pageJobs=await client.listGameProduction(project.id);assert.equal(pageJobs.jobs.length,2);const variant=pageJobs.jobs.find(job=>job.id!==original.id);await settled(client,variant.id);const result=await client.getGameAssetResult(variant.id);
  assert.deepEqual(result.spec.operation,frozen.operation);assert.equal((await client.getGameProject(project.id)).revision,1);assert.equal(hash(await client.downloadGameAssetFile(original.id,'assets/sleeve.glb')),originalHash);assert.equal(result.asset.placeholder,true);
  await save(product+'/variant/result.json',result);await save(product+'/frozen-request.json',frozen);for(const file of result.files)await save(product+'/variant/'+file.path,await client.downloadGameAssetFile(variant.id,file.path));
  const info=glb.inspectGameGlb(await client.downloadGameAssetFile(variant.id,'assets/sleeve.glb'));assert.ok(info.mixedWeightVertices>0&&info.animations>0);assert.equal(info.maxSkinInfluences,2);
  await page.locator('#refresh').click();await page.locator('[data-tab="assets"]').click();await page.getByRole('button',{name:'Revisar candidato',exact:true}).first().click();await page.getByRole('button',{name:'Inspecionar modelo 3D',exact:true}).click();await page.locator('#notice').filter({hasText:'Visor 3D aberto'}).waitFor();assert.ok(modelPreview);await modelPreview.page.locator('#clip:enabled').waitFor();await modelPreview.page.locator('#clip').selectOption({label:'bend'});await modelPreview.page.locator('#play:enabled').waitFor();await modelPreview.page.screenshot({path:path.join(output,product+'-viewer.png')});await modelPreview.close();modelPreview=undefined;
  const beforeApply=(await client.getGameProject(project.id)).revision;await page.locator('#apply-candidate').click();for(let i=0;i<400&&(await client.getGameProject(project.id)).revision===beforeApply;i++)await tick();assert.equal((await client.getGameProject(project.id)).revision,beforeApply+1);
  assert.equal((await client.getGameQuality(project.id)).ready,false);assert.equal((await client.listGameProjects()).projects.length,1,'namespaces remain isolated');assert.deepEqual(errors,[]);
  await waitDraft(record=>record?.value?.mediaEdit===null);await page.screenshot({path:path.join(output,product+'-applied.png'),fullPage:true});await context.close();
  const observation={product,sourceCandidate:original.id,variant:variant.id,recipeHash:contentHash(frozen.operation),glb:info,unsentEditsRestored:true,failedSavePreventsDispatch:true,serviceRestart:true,noAutomaticDispatch:true,denialPreservesUnknown:true,exactReplay:true,oneNewJob:true,originalHashPreserved:true,explicitApplication:true,...(timeline?{graphicalTimeline:{keyboard:true,pointer:true,escapeCancelsUncommittedMove:true,duplicateFrameRefused:true,explicitCopyAndDelete:true,durationDoesNotDropKeys:true,narrowViewport:600,sourceKeyFramePreservedInVariant:18}}:{}),modelInvocations:0,hostBridge:'emulated',nativeInstalledAcceptance:false};if(timeline)assert.equal(frozen.operation.clips[0].tracks[0].keys[1].frame,18);await save(product+'-result.json',observation);results.push(observation);
 }
 passed=true;await save('report.json',{state:'passed',scope:'Real source service/SDK/Blender/shared renderer, actual file drafts, emulated Mac and VS Code bridges/consent; not installed or physical/human/art acceptance',results,modelInvocations:0,installed:false,published:false,fullProductAcceptance:false});console.log('MODEL_EDITING_QUALIFIED '+output);
}catch(error){await save('failure.json',{message:error.message});if(modelPreview)try{await modelPreview.page.screenshot({path:path.join(output,'failure-viewer.png')});}catch{}if(active&&!active.isClosed())try{await active.screenshot({path:path.join(output,'failure.png'),fullPage:true});}catch{}process.exitCode=1;}
finally{
 await modelPreview?.close();await browser?.close();let terminal=true;
 try{for(const job of jobs){const client=clients[credentials.findIndex(credential=>credential.registration.product===job.product)];if(!client||!['completed','failed','cancelled'].includes((await client.getGameProduction(job.id)).state))terminal=false;}}catch{terminal=false;}
 if(terminal){await stop();if(passed)await rm(state,{recursive:true,force:true});else console.error('Failed fixture state preserved: '+state);}else console.error('Inspect original model jobs; service/state preserved: '+state+' pid '+process.pid);
 await save('closure.json',{serviceClosed:terminal,browserClosed:true,originalJobsTerminal:terminal});
}
