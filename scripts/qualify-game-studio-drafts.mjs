// Authored recovery fixture, not game generation or installed native acceptance.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {randomUUID} from 'node:crypto';
import {mkdtemp,mkdir,readFile,writeFile,rename,rm} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
import {chromium} from 'playwright-core';
import security from '../dist-tests/packages/agent-service/src/security.js';
import storage from '../dist-tests/packages/agent-service/src/store.js';
import sdk from '../dist-tests/packages/client-ts/src/index.js';
import studio from '../dist-tests/packages/client-ts/src/game-studio.js';
import draftModule from '../dist-tests/packages/client-ts/src/game-studio-drafts.js';
import desktopDrafts from '../dist-tests/desktop/game-studio-drafts.js';
import browserModule from '../dist-tests/packages/adapter-game-browser/src/browser.js';
import fixtures from '../dist-tests/test/game-fixtures.js';
const state=await mkdtemp(path.join(tmpdir(),'studio-draft-ui-')),output=path.resolve('output/playwright/game-studio-drafts/runs',`${new Date().toISOString().replace(/[:.]/g,'-')}-${randomUUID().slice(0,8)}`);
await mkdir(output,{recursive:true});
const identity=await security.ensureIdentity(state),store=new storage.Store(path.join(state,'metadata.sqlite')),credentials=[];
for(const product of ['companion-mac','companion-vscode']){const credential=await security.createClientCredential(state,{id:`draft-${product}`,product,profile:'fixture',workspace:'',providers:['ollama'],hostTools:[]});store.register(credential);credentials.push(credential);}store.close();
const engine=path.resolve('engine-dist'),child=spawn(path.join(engine,'node'),[path.join(engine,'service.cjs'),state],{stdio:['ignore','pipe','pipe']});
let browser,active,logs='',safeToStop=false;const clients=[],results=[];
child.stdout.on('data',bytes=>logs=(logs+bytes).slice(-100000));child.stderr.on('data',bytes=>logs=(logs+bytes).slice(-100000));
const tick=()=>new Promise(resolve=>setTimeout(resolve,25));
async function settled(client,id){for(let i=0;i<1000;i++){const job=await client.getGameProduction(id);if(['completed','failed','cancelled'].includes(job.state)){assert.equal(job.state,'completed',job.error);return job;}await tick();}throw Error(`Inspect original job ${id}; no retry.`);}
async function save(name,value){await writeFile(path.join(output,name),JSON.stringify(value,null,2)+'\n');}
try{
  for(let i=0;i<600;i++){try{if(JSON.parse(await readFile(path.join(state,'runtime.json'),'utf8')).pid===child.pid)break;}catch{}assert.equal(child.exitCode,null,logs);await tick();}
  const qualified=await browserModule.qualifyBrowser();assert.ok(qualified);browser=await chromium.launch({executablePath:qualified.executablePath,headless:true,chromiumSandbox:true});
  for(const [index,credential]of credentials.entries()){
    const product=credential.registration.product,client=new sdk.AgentClient({address:security.ipcPath(state),certificate:identity.cert,credential});clients.push(client);await client.connect();
    const session=await client.call('sessions.create',{title:`Draft host recovery ${product}`}),doc=fixtures.fixtureGameDocument();doc.title=`Draft Garden ${product}`;
    const project=await client.createGameProject('draft-ui',doc);await client.selectGameProject(session.id,project.id);
    const original=await client.processGameAsset('original-audio',project.id,1,{processorId:'local-media-v1',target:{id:'draft-wave',role:'Som para editar',placeholder:true},operation:{type:'audio.render',output:'assets/draft.wav',durationMs:100,sampleRate:22050,channels:1,notes:[{waveform:'sine',frequency:330,startMs:0,durationMs:80,gain:.2,pan:0,attackMs:5,releaseMs:5,seed:1}],clips:[]}});await settled(client,original.id);
    const hostData=path.join(state,`host-${index}`);await mkdir(hostData);const scope=draftModule.gameStudioDraftKey(credential.registration,session.id),mementoFile=path.join(hostData,'memento.json');
    const draftFile=index?mementoFile:path.join(hostData,'game-studio-drafts',`${scope}.json`);
    let context,page,approve=true,loseAck=false,loseDesignAck=false,loseRestoreAck=false,loseRestoreBeforeDispatch=false,loseRestoreCleanupAck=false,failSave=false,writable=true,approvals=0;const sent=[],errors=[];
    async function readDraft(){try{return JSON.parse(await readFile(draftFile,'utf8'));}catch(error){if(error.code==='ENOENT')return undefined;throw error;}}
    async function waitDraft(predicate){for(let i=0;i<300;i++){const value=await readDraft();if(predicate(value))return value;await tick();}throw Error('Original host draft was not acknowledged');}
    async function open(){
      const drafts=index?new draftModule.GameStudioDraftStore(draftFile,{read:readDraft,write:async value=>{const temporary=mementoFile+'.tmp';await writeFile(temporary,JSON.stringify(value),{mode:0o600});await rename(temporary,mementoFile);}}):desktopDrafts.desktopGameStudioDraftStore(hostData,scope);
      const controller=new studio.GameStudioController(client,session.id,{canWrite:()=>writable,approve:async()=>{approvals++;return approve;},preview:async()=>{throw Error('Preview not part of this fixture');},exportSource:async()=>false,exportBuild:async()=>false,exportAsset:async()=>false});
      context=await browser.newContext({viewport:{width:index?760:1200,height:900},colorScheme:index?'dark':'light'});page=await context.newPage();active=page;page.on('pageerror',error=>errors.push(error.message));
      await page.exposeFunction('__draftRequest',async command=>{
        if(drafts.handles(command)){if(command.action==='draft-write'&&failSave)throw Error('Fixture host draft storage unavailable');const stored=await drafts.dispatch(command);if(command.action==='draft-write'&&loseRestoreCleanupAck&&command.value&&!Object.hasOwn(command.value,'restoreEdit')){loseRestoreCleanupAck=false;throw Error('Fixture lost completed restoration cleanup acknowledgment');}return stored;}
        if(['adjust-audio','design','resume-design','restore','resume-restore'].includes(command.action))sent.push(structuredClone(command));
        if(command.action==='restore'&&loseRestoreBeforeDispatch){loseRestoreBeforeDispatch=false;throw Error('Fixture lost restore before dispatch; outcome unknown to renderer');}
        const result=await controller.dispatch(command);
        if(command.action==='restore'&&loseRestoreAck&&result?.project){loseRestoreAck=false;throw Error('Fixture lost committed restore response');}
        if(command.action==='design'&&loseDesignAck&&result?.project){loseDesignAck=false;throw Error('Fixture lost committed design response');}
        if(command.action==='adjust-audio'&&loseAck&&result?.requestedAssetJobId){loseAck=false;await settled(client,result.requestedAssetJobId);throw Error('Fixture lost audio result; original job preserved');}
        return result;
      });
      await page.addInitScript(({editor})=>{if(!editor)window.gameStudioHost={request:command=>window.__draftRequest(command)};else window.acquireVsCodeApi=()=>({postMessage:message=>{window.__draftRequest(message.command).then(value=>window.postMessage({type:'game-studio-response',id:message.id,value},'*')).catch(error=>window.postMessage({type:'game-studio-response',id:message.id,error:error.message},'*'));}});},{editor:index===1});
      await page.goto(pathToFileURL(path.resolve(index?'dist/game-studio/index.html':'desktop-dist/game-studio/index.html')).href);
      await page.getByRole('heading',{name:doc.title,exact:true}).waitFor();
    }
    await open();await page.locator('[data-tab="assets"]').click();await page.getByRole('button',{name:'Revisar candidato',exact:true}).click();await page.locator('#candidate-audio').waitFor({state:'visible'});await page.getByRole('button',{name:'Ajustar áudio',exact:true}).click();
    await page.getByLabel('Duração total · ms',{exact:true}).fill('200');await page.locator('[data-note-index="0"] summary').click();await page.getByLabel('Frequência inicial · Hz',{exact:true}).fill('660');
    await waitDraft(record=>record?.value?.mediaEdit?.operation.durationMs===200&&record.value.mediaEdit.operation.notes[0].frequency===660);
    await page.locator('[data-tab="design"]').click();await page.getByRole('button',{name:'Editar design',exact:true}).click();await page.getByLabel('Premissa',{exact:true}).fill('Design preservado depois de fechar a interface');
    const beforeClose=await waitDraft(record=>record?.value?.designEdit?.values.premise==='Design preservado depois de fechar a interface');
    await page.locator('#draft-status[data-state="saved"]').waitFor();await context.close();await open();assert.equal(sent.length,0,'reopening the host never submits a request');
    assert.equal(await page.getByLabel('Premissa',{exact:true}).inputValue(),'Design preservado depois de fechar a interface');
    await page.locator('[data-tab="assets"]').click();assert.equal(await page.getByLabel('Duração total · ms',{exact:true}).inputValue(),'200');await page.locator('[data-note-index="0"] summary').click();assert.equal(await page.getByLabel('Frequência inicial · Hz',{exact:true}).inputValue(),'660');
    await page.screenshot({path:path.join(output,`${product}-restored-unsent.png`),fullPage:true});
    loseAck=true;await page.locator('#submit-image').click();await page.locator('#notice').filter({hasText:'Fixture lost audio result'}).waitFor();
    assert.equal(sent.length,1);const frozen=structuredClone(sent[0]);await waitDraft(record=>record?.value?.mediaEdit?.command?.requestId===frozen.requestId);
    await context.close();await open();assert.equal(sent.length,1);await page.locator('[data-tab="assets"]').click();assert.equal(await page.locator('#submit-image').textContent(),'Retomar pedido');assert.equal(await page.getByLabel('Duração total · ms',{exact:true}).isDisabled(),true);
    assert.equal(await page.locator('audio').evaluateAll(values=>values.every(value=>value.paused)),true);
    approve=false;await page.locator('#submit-image').click();await page.locator('#notice').filter({hasText:'Operação cancelada'}).waitFor();assert.equal(sent.length,2);assert.deepEqual(sent[1],frozen);
    await context.close();await open();await page.locator('[data-tab="assets"]').click();assert.equal(await page.getByLabel('Duração total · ms',{exact:true}).isDisabled(),true);assert.equal(sent.length,2);
    approve=true;await page.locator('#submit-image').click();await page.locator('#image-editor').waitFor({state:'hidden'});assert.equal(sent.length,3);assert.deepEqual(sent[2],frozen);
    const jobs=await client.listGameProduction(project.id);assert.equal(jobs.jobs.length,2);assert.equal((await client.getGameProject(project.id)).revision,1,'processing remains separate from application');
    await waitDraft(record=>record?.value?.mediaEdit===null);assert.equal((await readDraft()).value.designEdit.requestId,beforeClose.value.designEdit.requestId);
    await page.locator('[data-tab="design"]').click();failSave=true;const count=sent.length;await page.getByRole('button',{name:'Salvar design',exact:true}).click();await page.locator('#notice').filter({hasText:'preservar o rascunho'}).waitFor();assert.equal(sent.length,count,'a failed host save must prevent effect dispatch');failSave=false;
    await context.close();const preserved=await readFile(draftFile);await writeFile(draftFile,'{preserved corrupted fixture',{mode:0o600});await open();await page.locator('#notice').filter({hasText:'recuperar os rascunhos'}).waitFor();assert.equal(sent.length,count);assert.equal(await readFile(draftFile,'utf8'),'{preserved corrupted fixture');
    await page.screenshot({path:path.join(output,`${product}-preserved-corruption.png`),fullPage:true});await context.close();await writeFile(draftFile,preserved,{mode:0o600});
    await open();await page.locator('[data-tab="design"]').click();loseDesignAck=true;
    await page.getByRole('button',{name:'Salvar design',exact:true}).click();await page.locator('#notice').filter({hasText:'Fixture lost committed design response'}).waitFor();
    const designCommand=sent.at(-1);assert.equal(designCommand.action,'design');assert.equal((await client.getGameProject(project.id)).revision,2);
    const later=await client.getGameRevision(project.id,2);later.document.design.audio.mix='Later work must survive receipt recovery';await client.commitGameRevision(project.id,'later-independent-work',2,later.document,'Keep later revision');
    const beforeRecovery=sent.length,approvalBeforeRecovery=approvals;await context.close();writable=false;await open();assert.equal(sent.length,beforeRecovery,'reopening must not resume the committed request');
    await page.getByRole('button',{name:'Retomar pedido',exact:true}).click();await page.locator('#design-form').waitFor({state:'hidden'});await page.locator('#notice').filter({hasText:'Pedido confirmado na revisão 2'}).waitFor();
    assert.equal(approvals,approvalBeforeRecovery,'readback requires no new mutation approval');assert.deepEqual(sent.at(-1),{...designCommand,action:'resume-design'});
    assert.equal((await client.getGameProject(project.id)).revision,3);assert.equal((await client.getGameRevision(project.id)).document.design.audio.mix,'Later work must survive receipt recovery');
    await waitDraft(record=>record?.value?.designEdit===null);await page.screenshot({path:path.join(output,`${product}-recovered-committed-design.png`),fullPage:true});await context.close();
    writable=true;await open();await page.locator('[data-tab="history"]').click();
    const oldRestore=await page.locator('[data-restore-revision="1"]').elementHandle(),otherDoc={...doc,title:'Other displayed restore project'};
    const otherProject=await client.createGameProject('other-restore-display',otherDoc);await client.commitGameRevision(otherProject.id,'other-restore-second',1,{...otherDoc,title:otherDoc.title},'Other revision');
    const staleCount=sent.length;await client.selectGameProject(session.id,otherProject.id);await page.locator('#refresh').click();await page.getByRole('heading',{name:otherDoc.title,exact:true}).waitFor();await page.locator('#refresh:not(.loading)').waitFor();
    // Deliberately dispatch the retained old DOM listener, not game code or an
    // API grant. It must keep the displayed project/revision binding.
    await oldRestore.evaluate(control=>control.dispatchEvent(new MouseEvent('click',{bubbles:true})));await page.locator('#notice').filter({hasText:'A seleção mudou'}).waitFor();
    assert.equal(sent.length,staleCount);assert.equal((await client.getGameProject(otherProject.id)).revision,2);await oldRestore.dispose();
    await client.selectGameProject(session.id,project.id);await page.locator('#refresh').click();await page.getByRole('heading',{name:doc.title,exact:true}).waitFor();await page.locator('#refresh:not(.loading)').waitFor();
    failSave=true;const beforeRestore=sent.length;await page.locator('[data-restore-revision="1"]').click();await page.locator('#notice').filter({hasText:'preservar o rascunho'}).waitFor();assert.equal(sent.length,beforeRestore,'failed restore draft save must prevent mutation dispatch');failSave=false;await context.close();
    await open();await page.locator('[data-tab="history"]').click();loseRestoreAck=true;
    await page.locator('[data-restore-revision="1"]').click();await page.locator('#notice').filter({hasText:'Fixture lost committed restore response'}).waitFor();
    const restoreCommand=sent.at(-1);assert.equal(restoreCommand.action,'restore');assert.equal(restoreCommand.expectedRevision,3);assert.equal((await client.getGameProject(project.id)).revision,4);
    const pendingRestore=await waitDraft(record=>record?.value?.restoreEdit?.requestId===restoreCommand.requestId);assert.deepEqual(pendingRestore.value.restoreEdit,restoreCommand);
    await page.screenshot({path:path.join(output,`${product}-restore-lost.png`),fullPage:true});
    const afterRestore=await client.getGameRevision(project.id,4);afterRestore.document.design.audio.mix='Work created after restoration must survive recovery';await client.commitGameRevision(project.id,'after-restore',4,afterRestore.document,'Preserve revision after restoration');
    const restoreCount=sent.length,restoreApprovals=approvals;await context.close();writable=false;await open();assert.equal(sent.length,restoreCount,'reopening cannot resume a restoration');
    await page.locator('#restore-request').waitFor({state:'visible'});await page.getByRole('button',{name:'Conferir restauração',exact:true}).click();
    await page.locator('#notice').filter({hasText:'Restauração confirmada na revisão 4'}).waitFor();await waitDraft(record=>Boolean(record?.value)&&!Object.hasOwn(record.value,'restoreEdit'));
    await page.locator('#restore-request').waitFor({state:'hidden'});assert.equal(await page.locator('[data-restore-revision="1"]').isEnabled(),false,'read-only recovery must not enable mutation controls');
    assert.equal(approvals,restoreApprovals,'read-only restoration acknowledgment needs no mutation consent');assert.deepEqual(sent.at(-1),{...restoreCommand,action:'resume-restore'});
    assert.equal((await client.getGameProject(project.id)).revision,5);assert.equal((await client.getGameRevision(project.id)).document.design.audio.mix,'Work created after restoration must survive recovery');
    await page.screenshot({path:path.join(output,`${product}-restore-recovered.png`),fullPage:true});
    writable=true;await page.locator('#refresh').click();await page.locator('[data-tab="history"]').click();loseRestoreBeforeDispatch=true;
    await page.locator('[data-restore-revision="2"]').click();await page.locator('#notice').filter({hasText:'Fixture lost restore before dispatch'}).waitFor();const uncertain=sent.at(-1);
    await context.close();approve=false;await open();await page.getByRole('button',{name:'Conferir restauração',exact:true}).click();await page.locator('#notice').filter({hasText:'Operação cancelada'}).waitFor();
    assert.deepEqual((await readDraft()).value.restoreEdit,uncertain,'denying the retry does not settle the earlier unknown restore');assert.equal((await client.getGameProject(project.id)).revision,5);
    await context.close();await open();approve=true;await page.getByRole('button',{name:'Conferir restauração',exact:true}).click();await waitDraft(record=>Boolean(record?.value)&&!Object.hasOwn(record.value,'restoreEdit'));
    assert.deepEqual(sent.at(-1),{...uncertain,action:'resume-restore'});assert.equal((await client.getGameProject(project.id)).revision,6);
    await page.locator('#restore-request').waitFor({state:'hidden'});assert.equal(await page.locator('[data-restore-revision="1"]').isEnabled(),true);
    await page.screenshot({path:path.join(output,`${product}-restore-retried-exactly.png`),fullPage:true});await context.close();
    await open();await page.locator('[data-tab="history"]').click();loseRestoreCleanupAck=true;await page.locator('[data-restore-revision="1"]').click();
    await page.locator('#notice').filter({hasText:'confirmar a limpeza do pedido'}).waitFor();assert.equal((await client.getGameProject(project.id)).revision,7);
    assert.equal(Object.hasOwn((await readDraft()).value,'restoreEdit'),false,'cleanup committed even though its acknowledgment was lost');await page.locator('#restore-request').waitFor({state:'visible'});
    const clearedCount=sent.length;await context.close();await open();assert.equal(sent.length,clearedCount,'reopen must never repeat a restore after a lost cleanup acknowledgment');
    await page.locator('[data-tab="history"]').click();await page.locator('#restore-request').waitFor({state:'hidden'});assert.equal(await page.locator('[data-restore-revision="1"]').isEnabled(),true);
    await page.screenshot({path:path.join(output,`${product}-restore-cleanup-reopened.png`),fullPage:true});await context.close();
    const goodRestoreStorage=await readFile(draftFile),invalidRestore=JSON.parse(goodRestoreStorage);invalidRestore.value.restoreEdit=false;
    const invalidRestoreBytes=JSON.stringify(invalidRestore);await writeFile(draftFile,invalidRestoreBytes,{mode:0o600});const beforeInvalidRestore=sent.length;await open();
    await page.locator('#notice').filter({hasText:'recuperar os rascunhos'}).waitFor();assert.equal(sent.length,beforeInvalidRestore);assert.equal(await readFile(draftFile,'utf8'),invalidRestoreBytes,'falsy malformed restoration must stay preserved');
    await context.close();await writeFile(draftFile,goodRestoreStorage,{mode:0o600});
    assert.deepEqual(errors,[]);await save(`${product}-result.json`,{product,draftBackend:index?'File-backed Memento fixture':'Actual Mac file backend',unsentDesignAndAudioRestored:true,wholeBrowserContextDestroyed:true,noAutomaticDispatch:true,frozenRequestRetained:true,denialDoesNotForgetUnknown:true,oneNewJob:true,exactRepeatedCommand:true,noAutoplay:true,failedDraftSavePreventsDispatch:true,corruptStatePreserved:true,lostCommittedDesignRecovered:true,laterRevisionPreserved:true,readonlyRecoveryWithoutApproval:true,lostCommittedRestoreRecovered:true,restoreLaterRevisionPreserved:true,restoreDraftSavePreventsDispatch:true,restoreDenialPreservesUnknown:true,restoreRetryUsesExactIdentity:true,restoreControlsRespectReadOnlyAndUnlockWhenWritable:true,malformedFalsyRestorePreserved:true,lostRestoreCleanupAcknowledgmentRecovered:true,resolvedRestoreFieldOmittedForLegacyReaders:true,staleDisplayedRestoreCannotRetargetProject:true,installedNativeAcceptance:false});
    results.push({product,passed:true});
  }
  await save('report.json',{scope:'Both emulated bridges with real renderer/SDK/service, actual Mac file backend and file-backed Memento fixture; not installed Mac/VS Code acceptance.',engineManifestSha256:(await import('node:crypto')).createHash('sha256').update(await readFile(path.join(engine,'manifest.json'))).digest('hex'),results});console.log(`STUDIO_DRAFT_RECOVERY_OK ${output}`);
}catch(error){if(active&&!active.isClosed())try{await active.screenshot({path:path.join(output,'failure.png'),fullPage:true});await save('failure.json',{message:error.message,notice:await active.locator('#notice').textContent()});}catch{}throw error;}
finally{
  await browser?.close();
  try{safeToStop=true;for(const client of clients){let cursor=0;while(true){const page=await client.listGameProjects(cursor,100);for(const project of page.projects){let jobCursor=0;while(true){const jobs=await client.listGameProduction(project.id,jobCursor,100);if(jobs.jobs.some(job=>!['completed','failed','cancelled'].includes(job.state)))safeToStop=false;if(!jobs.hasMore)break;jobCursor=jobs.cursor;}}if(!page.hasMore)break;cursor=page.cursor;}}}catch{safeToStop=false;}
  for(const client of clients)client.close();
  await writeFile(path.join(output,'service.log'),logs);
  if(safeToStop&&child.exitCode===null){const exited=once(child,'exit');child.kill('SIGTERM');await exited;await rm(state,{recursive:true,force:true});}else if(child.exitCode===null){child.unref();console.error(`Inspect original fixture service: ${child.pid} ${state}`);}
}
