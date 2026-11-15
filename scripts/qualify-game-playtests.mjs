// Real renderer, SDK/TLS/IPC and packaged engine with emulated interface bridges.
// The data is synthetic; this does not qualify installed clients or real people.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createHash,randomUUID} from 'node:crypto';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
import {chromium} from 'playwright-core';
import security from '../dist-tests/packages/agent-service/src/security.js';
import storage from '../dist-tests/packages/agent-service/src/store.js';
import sdk from '../dist-tests/packages/client-ts/src/index.js';
import bootstrap from '../dist-tests/packages/client-ts/src/bootstrap.js';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import studio from '../dist-tests/packages/client-ts/src/game-studio.js';
import draftsModule from '../dist-tests/packages/client-ts/src/game-studio-drafts.js';
import desktopDrafts from '../dist-tests/desktop/game-studio-drafts.js';
import fileDrafts from '../dist-tests/packages/client-ts/src/game-studio-file-drafts.js';
import exporter from '../dist-tests/packages/client-ts/src/game-export.js';
import browserModule from '../dist-tests/packages/adapter-game-browser/src/browser.js';
import fixtures from '../dist-tests/test/game-fixtures.js';
import webFixtures from '../dist-tests/test/game-web-fixtures.js';
import {fillSyntheticObservation} from './game-playtest-ui-fixture.mjs';

assert.equal(process.versions.node,'22.23.4');
const corrections=process.argv.includes('--corrections');
const root=await mkdtemp(path.join(tmpdir(),'playtest-ui-')),engine=path.resolve(process.argv[2]??'engine-dist');
await bootstrap.verifyBundle(engine,undefined,true);
const engineManifest=await readFile(path.join(engine,'manifest.json'));
const closedEnv={HOME:root,PATH:'/usr/bin:/bin:/usr/sbin:/sbin',TMPDIR:tmpdir(),LANG:'en_US.UTF-8'};
const output=path.resolve('output/playwright/game-playtests/runs',`${new Date().toISOString().replace(/[:.]/g,'-')}-${randomUUID().slice(0,8)}`);
await mkdir(output,{recursive:true});
const sourcePaths=['scripts/qualify-game-playtests.mjs','packages/game-studio-ui/studio.js','packages/game-studio-ui/index.html','packages/client-ts/src/game-studio.ts','packages/agent-service/src/game-playtests.ts','packages/contracts/src/game-playtests.ts'];
await writeFile(path.join(output,'control.json'),JSON.stringify({node:process.versions.node,corrections,engineManifestSha256:createHash('sha256').update(engineManifest).digest('hex'),sources:await Promise.all(sourcePaths.map(async name=>({path:name,sha256:createHash('sha256').update(await readFile(name)).digest('hex')}))),syntheticOnly:true,closedChildEnvironment:true},null,2));
const identity=await security.ensureIdentity(root),store=new storage.Store(path.join(root,'metadata.sqlite')),credentials=[];
for(const product of ['companion-mac','companion-vscode']){const credential=await security.createClientCredential(root,{id:`playtest-${product}`,product,profile:'fixture',workspace:'',providers:['ollama'],hostTools:[]});store.register(credential);credentials.push(credential);}store.close();
const child=spawn(path.join(engine,'node'),[path.join(engine,'service.cjs'),root],{stdio:['ignore','pipe','pipe'],env:closedEnv});
let browser,browserServer,active,logs='',safeToStop=false,passed=false,rootRemoved=false;const clients=[],results=[];
child.stdout.on('data',data=>logs=(logs+data).slice(-50000));child.stderr.on('data',data=>logs=(logs+data).slice(-50000));
const tick=()=>new Promise(resolve=>setTimeout(resolve,25));
async function until(fn,message){for(let i=0;i<600;i++){if(await fn())return;await tick();}throw Error(message);}
async function settled(client,id){await until(async()=>{const job=await client.getGameProduction(id);if(['completed','failed','cancelled'].includes(job.state)){assert.equal(job.state,'completed',job.error);return true;}return false;},'Original build did not settle; inspect it without restarting.');}
try{
  await until(async()=>{assert.equal(child.exitCode,null,logs);try{return JSON.parse(await readFile(path.join(root,'runtime.json'),'utf8')).pid===child.pid;}catch{return false;}},'Original engine did not become observable.');
  const qualifier=pathToFileURL(path.resolve('dist-tests/packages/adapter-game-browser/src/browser.js')).href;
  const qualified=JSON.parse((await promisify(execFile)(process.execPath,['--input-type=module','-e',"const m=await import(process.argv[1]);const q=await m.default.qualifyBrowser();if(!q)throw Error('Qualified browser unavailable');process.stdout.write(JSON.stringify(q));",qualifier],{env:closedEnv,timeout:10000,maxBuffer:16384})).stdout);assert.ok(qualified);
  browserServer=await chromium.launchServer({executablePath:qualified.executablePath,headless:true,chromiumSandbox:true,host:'127.0.0.1',env:closedEnv});browser=await chromium.connect(browserServer.wsEndpoint());
  for(const [index,credential]of credentials.entries()){
    const product=credential.registration.product,client=new sdk.AgentClient({address:security.ipcPath(root),certificate:identity.cert,credential});clients.push(client);await client.connect();
    const session=await client.call('sessions.create',{title:'Synthetic playtest UI'}),document=fixtures.fixtureGameDocument();document.title=`Playtest fixture ${product}`;
    for(const [name,text]of webFixtures.webFixture('phaser'))document.files.push(await client.uploadGameFile(name,Buffer.from(text),'text/plain'));
    const project=await client.createGameProject('playtest-project',document);await client.selectGameProject(session.id,project.id);
    const build=await client.startGameBuild('playtest-build',project.id,1);await settled(client,build.id);
    const hostData=path.join(root,`host-${index}`),exports=path.join(hostData,'exports');await mkdir(exports,{recursive:true});
    const scope=draftsModule.gameStudioDraftKey(credential.registration,session.id),file=path.join(hostData,'game-studio-drafts',scope+'.json');
    let context,page,writable=true,approve=true,loseAck=false,loseCorrectionAck=false,failSave=false,approvals=0;const sent=[],errors=[],exported=[];
    async function readDraft(){try{return JSON.parse(await readFile(file,'utf8'));}catch(error){if(error.code==='ENOENT')return undefined;throw error;}}
    async function waitDraft(predicate){await until(async()=>predicate(await readDraft()),'Host draft was not acknowledged.');}
    async function open(){
      const drafts=index?fileDrafts.fileGameStudioDraftStore(hostData,scope):desktopDrafts.desktopGameStudioDraftStore(hostData,scope);
      const controller=new studio.GameStudioController(client,session.id,{canWrite:()=>writable,approve:async()=>{approvals++;return approve;},preview:async()=>{throw Error('This fixture does not claim preview acceptance');},exportSource:async()=>false,exportBuild:async()=>false,exportAsset:async()=>false,
        exportPlaytest:async(studyId,includeResponses)=>{exported.push(await exporter.exportGameDirectory({client,parent:exports,playtest:{studyId,includeResponses}}));return true;}});
      context=await browser.newContext({viewport:{width:index?760:1200,height:960},colorScheme:index?'dark':'light'});page=await context.newPage();active=page;page.on('pageerror',error=>errors.push(error.message));
      await page.exposeFunction('__playtestRequest',async command=>{
        if(drafts.handles(command)){if(command.action==='draft-write'&&failSave)throw Error('Synthetic host save failure');return drafts.dispatch(command);}
        if(['create-playtest','record-playtest','correct-playtest','withdraw-playtest','resume-playtest'].includes(command.action))sent.push(structuredClone(command));
        const result=await controller.dispatch(command);
        if(command.action==='record-playtest'&&loseAck&&result?.playtestMutationAcknowledged){loseAck=false;throw Error('Synthetic lost committed observation response');}
        if(command.action==='correct-playtest'&&loseCorrectionAck&&result?.playtestMutationAcknowledged){loseCorrectionAck=false;throw Error('Synthetic lost committed correction response');}return result;
      });
      await page.addInitScript(({editor})=>{if(!editor)window.gameStudioHost={request:command=>window.__playtestRequest(command)};else window.acquireVsCodeApi=()=>({postMessage:message=>{window.__playtestRequest(message.command).then(value=>window.postMessage({type:'game-studio-response',id:message.id,value},'*')).catch(error=>window.postMessage({type:'game-studio-response',id:message.id,error:error.message},'*'));}});},{editor:index===1});
      await page.goto(pathToFileURL(path.resolve(index?'dist/game-studio/index.html':'desktop-dist/game-studio/index.html')).href);
      await page.getByRole('heading',{name:document.title,exact:true}).waitFor();
    }
    await open();await page.locator('[data-tab="playtests"]').click();await page.locator('#new-playtest').click();
    await page.locator('#pt-title').fill('Synthetic round, not human acceptance');await page.locator('#pt-audience').fill('Synthetic fixtures only');
    await page.locator('#submit-playtest').click();await page.locator('#playtest-form').waitFor({state:'hidden'});
    const study=(await client.listGamePlaytests(project.id)).studies[0].study;
    await page.locator('#record-playtest').click();const notes='<img src="https://invalid.example/never-requested"> =Synthetic local text';
    await fillSyntheticObservation(page,notes);await waitDraft(value=>{const fields=value?.value?.playtestEdit?.values;return fields?.notes===notes&&fields.consent===true&&fields.distinct===true;});
    await page.locator('#draft-status[data-state="saved"]').waitFor();
    await context.close();await open();assert.equal(sent.length,1,'Restoring an unsent form must not submit it');
    assert.equal(await page.locator('#pt-notes').inputValue(),notes);assert.equal(await page.locator('#pt-consent').isChecked(),true,'Restore only the operator-entered local draft');
    await page.screenshot({path:path.join(output,`${product}-restored-unsent.png`),fullPage:true});
    loseAck=true;await page.locator('#submit-playtest').click();await page.locator('#notice').filter({hasText:'Synthetic lost committed observation response'}).waitFor();
    const original=structuredClone(sent.at(-1));assert.equal(original.action,'record-playtest');assert.equal((await client.getGamePlaytest(study.id)).summary.active,1);
    await waitDraft(value=>value?.value?.playtestEdit?.command?.request.requestId===original.request.requestId);
    await context.close();writable=false;await open();assert.equal(sent.length,2);assert.equal(await page.locator('#pt-notes').isDisabled(),true);assert.equal(await page.locator('#cancel-playtest-edit').isDisabled(),true);
    const beforeRead=approvals;await page.locator('#submit-playtest').click();await page.locator('#playtest-form').waitFor({state:'hidden'});assert.equal(approvals,beforeRead);assert.deepEqual(sent.at(-1),{action:'resume-playtest',projectId:project.id,command:original});
    assert.equal((await client.getGamePlaytest(study.id)).summary.active,1);await page.getByRole('button',{name:'Ver observações',exact:true}).count();
    await page.locator('#playtest-responses summary').click();assert.equal(await page.locator('#playtest-responses details p').textContent(),notes);assert.equal(await page.locator('#playtest-responses img').count(),0);
    let correctionCommand;
    if(corrections){
      writable=true;await page.locator('#refresh').click();await page.getByRole('button',{name:'Corrigir registro',exact:true}).click();await page.getByRole('heading',{name:'Corrigir observações',exact:true}).waitFor();
      for(const id of ['consent','distinct','correction'])assert.equal(await page.locator('#pt-'+id).isChecked(),false);
      assert.equal(await page.locator('#pt-score').inputValue(),'4');await page.locator('#pt-score').selectOption('2');
      const reason='<img src="https://invalid.example/correction"> Synthetic transcription correction';await page.locator('#pt-reason').fill(reason);
      for(const id of ['consent','distinct','correction'])await page.locator('#pt-'+id).check();
      await waitDraft(d=>d?.value?.playtestEdit?.kind==='correct'&&d.value.playtestEdit.values.reason===reason&&d.value.playtestEdit.values.correction===true);
      const beforeReload=sent.length;await context.close();await open();assert.equal(sent.length,beforeReload);assert.equal(await page.locator('#pt-reason').inputValue(),reason);
      loseCorrectionAck=true;await page.locator('#submit-playtest').click();await page.locator('#notice').filter({hasText:'Synthetic lost committed correction response'}).waitFor();
      correctionCommand=structuredClone(sent.at(-1));assert.equal(correctionCommand.action,'correct-playtest');
      assert.equal((await client.getGamePlaytestCorrections(study.id,correctionCommand.request.participantId)).entries.length,1);
      await context.close();writable=false;await open();assert.equal(await page.locator('#pt-reason').isDisabled(),true);
      const beforeCorrectionRecovery=approvals;await page.locator('#submit-playtest').click();await page.locator('#playtest-form').waitFor({state:'hidden'});assert.equal(approvals,beforeCorrectionRecovery);
      const corrected=await client.getGamePlaytestCorrections(study.id,correctionCommand.request.participantId);assert.equal(corrected.current.experienceScore,2);assert.equal(corrected.entries.length,1);
      assert.equal((await client.getGamePlaytest(study.id)).summary.active,1);await page.getByRole('button',{name:'Histórico de correções',exact:true}).click();
      await page.locator('#playtest-correction-entries').filter({hasText:reason}).waitFor();assert.equal(await page.locator('#playtest-correction-entries img').count(),0);
      await page.screenshot({path:path.join(output,`${product}-correction-history.png`),fullPage:true});
    }
    await page.locator('#export-playtest-summary').click();await page.locator('#notice').filter({hasText:'Exportação concluída'}).waitFor();
    assert.deepEqual(JSON.parse(await readFile(path.join(exported.at(-1),'playtest.json'),'utf8')).responses,[]);
    await page.locator('#export-playtest-records').click();await until(async()=>exported.length===2,'Individual export was not acknowledged');assert.equal(JSON.parse(await readFile(path.join(exported.at(-1),'playtest.json'),'utf8')).responses.length,1);
    writable=true;await page.locator('#refresh').click();await page.getByRole('button',{name:'Retirada de consentimento',exact:true}).click();assert.equal(await page.locator('#pt-withdrawal').isChecked(),false);await page.locator('#pt-withdrawal').check();
    await page.locator('#submit-playtest').click();await page.locator('#playtest-form').waitFor({state:'hidden'});await page.locator('#playtest-summary').filter({hasText:'0 registros ativos'}).waitFor();assert.equal(await page.locator('#playtest-responses details').count(),0);
    await page.screenshot({path:path.join(output,`${product}-withdrawn.png`),fullPage:true});
    const afterWithdrawalSent=sent.length;
    if(corrections){const audit=await client.getGamePlaytestCorrections(study.id,correctionCommand.request.participantId);assert.equal(audit.entries[0].withdrawn,true);assert.equal('reason' in audit.entries[0],false);}
    // Reopening after a lost record and a later withdrawal returns a tombstone,
    // never the old answers, even from a locally retained exact frozen command.
    await context.close();const saved=await readDraft();saved.value.playtestEdit={schemaVersion:1,kind:'record',projectId:project.id,projectTitle:document.title,requestId:original.request.requestId,study,participantId:original.request.participantId,command:original,values:{}};
    await writeFile(file,JSON.stringify(saved),{mode:0o600});writable=false;await open();assert.equal(sent.length,afterWithdrawalSent);await page.locator('#submit-playtest').click();await page.locator('#playtest-form').waitFor({state:'hidden'});await page.locator('#notice').filter({hasText:'as respostas não foram recriadas'}).waitFor();assert.equal((await client.getGamePlaytest(study.id)).summary.active,0);
    writable=true;await page.locator('#refresh').click();await page.locator('#record-playtest').click();await fillSyntheticObservation(page);await page.locator('#draft-status[data-state="saved"]').waitFor();failSave=true;const count=sent.length;await page.locator('#submit-playtest').click();await page.locator('#notice').filter({hasText:'Nenhuma nova gravação foi enviada'}).waitFor();assert.equal(sent.length,count);failSave=false;
    await context.close();await open();assert.equal(sent.length,count);await page.locator('#cancel-playtest-edit').click();
    // A new source revision leaves the historical build/round visible as old.
    const revision=await client.getGameRevision(project.id);revision.document.title='Changed synthetic source';await client.commitGameRevision(project.id,'later-source',1,revision.document,'Synthetic staleness');
    await page.locator('#refresh').click();await page.locator('[data-tab="playtests"]').click();await page.getByRole('button',{name:'Abrir rodada',exact:true}).click();await page.locator('#playtest-build').filter({hasText:'o projeto já está na revisão 2'}).waitFor();
    assert.ok(await page.locator('#playtest-source').textContent());assert.equal((await client.getGamePlaytest(study.id)).summary.qualityApproved,false);
    const layout=await page.evaluate(()=>({width:innerWidth,scrollWidth:document.documentElement.scrollWidth}));assert.ok(layout.scrollWidth<=layout.width,'Playtest UI must fit compact/light and wide/dark fixtures');
    await page.screenshot({path:path.join(output,`${product}-historical-round.png`),fullPage:true});await context.close();assert.deepEqual(errors,[]);
    results.push({product,auditedCorrectionRecovery:corrections,syntheticOnly:true,wholeBrowserContextRestart:true,noAutomaticDispatch:true,unknownRequestBindingPreserved:true,readOnlyRecoveryWithoutApproval:true,withdrawalTombstoneRecovered:true,explicitSummaryAndRecordExports:true,failedSavePreventsDispatch:true,notesRenderedAsText:true,historicalBuildLabel:true,layout,installedClientAcceptance:false});
  }
  await writeFile(path.join(output,'report.json'),JSON.stringify({scope:'Both emulated bridges, real renderer/controller/SDK/TLS/IPC/packaged engine. All observations synthetic; no people or installed-client acceptance.',engineManifestSha256:createHash('sha256').update(await readFile(path.join(engine,'manifest.json'))).digest('hex'),results},null,2));
  passed=true;console.log(`GAME_PLAYTEST_UI_OK ${output}`);
}catch(error){const message=String(error?.message??error).replace(/wss?:\/\/\S+/g,'[private browser control]').slice(0,4000);if(active&&!active.isClosed())try{await active.screenshot({path:path.join(output,'failure.png'),fullPage:true});await writeFile(path.join(output,'failure.json'),JSON.stringify({message,notice:await active.locator('#notice').textContent()},null,2));}catch{}throw Error(message);}
finally{
  await browser?.close();await browserServer?.close();
  try{safeToStop=true;for(const client of clients)for(const project of (await client.listGameProjects()).projects)if((await client.listGameProduction(project.id)).jobs.some(job=>!['completed','failed','cancelled'].includes(job.state)))safeToStop=false;}catch{safeToStop=false;}
  clients.forEach(client=>client.close());await writeFile(path.join(output,'service.log'),logs);
  if(safeToStop&&child.exitCode===null){const stopped=once(child,'exit');child.kill('SIGTERM');await stopped;if(passed){await rm(root,{recursive:true,force:true});rootRemoved=true;}}else if(child.exitCode===null){child.unref();console.error(`Original fixture remains for inspection: ${root} pid=${child.pid}`);}
  await writeFile(path.join(output,'closure.json'),JSON.stringify({passed,servicePid:child.pid,serviceExitCode:child.exitCode,serviceSignal:child.signalCode,browserPid:browserServer?.process().pid,browserExitCode:browserServer?.process().exitCode,browserDisconnected:browser?!browser.isConnected():null,privateRootRemoved:rootRemoved,privateRoot:rootRemoved?undefined:root},null,2));
  assert.ok(engineManifest.equals(await readFile(path.join(engine,'manifest.json'))));await bootstrap.verifyBundle(engine,undefined,true);
}
