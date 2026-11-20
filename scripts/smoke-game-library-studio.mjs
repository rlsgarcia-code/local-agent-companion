// Authored UI qualification: real packaged service/SDK/catalog, emulated host
// bridges and consent. Not installed Mac/VS Code acceptance or a generated game.
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
import studio from '../dist-tests/packages/client-ts/src/game-studio.js';
import draftModule from "../dist-tests/packages/client-ts/src/game-studio-drafts.js";
import exporter from '../dist-tests/packages/client-ts/src/game-export.js';
import browserModule from '../dist-tests/packages/adapter-game-browser/src/browser.js';
import fixtures from '../dist-tests/test/game-fixtures.js';
import modelViewer from '../dist-tests/packages/adapter-game-browser/src/model-preview.js';
const engine=path.resolve('engine-dist'),state=await mkdtemp(path.join(tmpdir(),'companion-library-studio-'));
const output=path.resolve('output/playwright/game-library-studio/runs',`${new Date().toISOString().replace(/[:.]/g,'-')}-${randomUUID().slice(0,8)}`);
await mkdir(output,{recursive:true});
const identity=await security.ensureIdentity(state),store=new storage.Store(path.join(state,'metadata.sqlite')),credentials=[];
for(const product of ['companion-mac','companion-vscode']){const credential=await security.createClientCredential(state,{id:`library-ui-${product}`,product,profile:'fixture',workspace:'',providers:['ollama'],hostTools:[]});store.register(credential);credentials.push(credential);}store.close();
const child=spawn(path.join(engine,process.platform==='win32'?'node.exe':'node'),[path.join(engine,'service.cjs'),state],{stdio:['ignore','pipe','pipe']});
let logs='',browser,activePage,terminal=true;const clients=[],results=[],modelPreviews=[];const tick=()=>new Promise(resolve=>setTimeout(resolve,25));
const sha=data=>createHash('sha256').update(data).digest('hex');
child.stdout.on('data',bytes=>logs=(logs+bytes).slice(-100000));child.stderr.on('data',bytes=>logs=(logs+bytes).slice(-100000));
async function save(name,value){const target=path.join(output,name);await mkdir(path.dirname(target),{recursive:true});await writeFile(target,typeof value==='string'||value instanceof Uint8Array?value:JSON.stringify(value,null,2)+'\n');}
async function settled(client,id){terminal=false;for(let i=0;i<600;i++){const job=await client.getGameProduction(id);if(!['running','queued','cancelling'].includes(job.state)){terminal=['completed','failed','cancelled'].includes(job.state);assert.equal(job.state,'completed',job.error);return job;}await tick();}throw Error(`Observation expired: inspect original job ${id} in ${state}, do not repeat it.`);}
try{
  let ready=false;for(let i=0;i<600;i++){if(child.exitCode!==null)throw Error(logs||'Packaged service exited');try{if(JSON.parse(await readFile(path.join(state,'runtime.json'),'utf8')).pid===child.pid){ready=true;break;}}catch{}await tick();}assert.ok(ready);
  const qualified=await browserModule.qualifyBrowser();assert.ok(qualified);browser=await chromium.launch({executablePath:qualified.executablePath,headless:true,chromiumSandbox:true});
  for(const [index,credential]of credentials.entries()){
    const product=credential.registration.product,client=new sdk.AgentClient({address:security.ipcPath(state),certificate:identity.cert,credential});clients.push(client);await client.connect();
    const session=await client.call('sessions.create',{title:`Licensed library UI ${product}`}),document=fixtures.fixtureGameDocument();document.title=index?'Library Garden · Editor':'Library Garden';document.engine='babylon';document.brief.dimension='3d';
    const project=await client.createGameProject('library-ui',document),other=await client.createGameProject('other-library-ui',{...document,title:'Other isolated game'});await client.selectGameProject(session.id,project.id);
    let approve=true,canWrite=true,approvals=0,loseAck=true,exportedPath,exportAllowed=true,approvalMutation=null,modelOpens=0;
    const exports=path.join(state,`exports-${index}`);await mkdir(exports);
    const controller=new studio.GameStudioController(client,session.id,{canWrite:()=>canWrite,approve:async()=>{approvals++;if(approvalMutation)await approvalMutation();return approve;},preview:async()=>{throw Error('No game build preview is claimed by this catalog UI fixture');},previewModel:async(result,modelPath,readFile)=>{const preview=await modelViewer.openGameModelPreview({result,modelPath,readFile,runtimeDirectory:path.join(engine,'game-runtimes'),signal:new AbortController().signal,headless:true});modelPreviews.push(preview);try{await preview.page.getByRole('status').filter({hasText:'Modelo carregado'}).waitFor({timeout:20000});await preview.page.screenshot({path:path.join(output,product+'-model-viewer.png'),fullPage:true});await preview.page.selectOption('#clip','0');assert.equal(await preview.page.locator('#play').textContent(),'Reproduzir');await preview.page.locator('#play').click();assert.equal(await preview.page.locator('#play').textContent(),'Pausar');await preview.page.locator('#play').click();assert.equal(preview.errors.length,0,preview.errors.join('\n'));}finally{await preview.close();}modelOpens++;},
      exportSource:async()=>false,exportBuild:async()=>false,exportAsset:async jobId=>{if(!exportAllowed)return false;exportedPath=await exporter.exportGameDirectory({client,parent:exports,candidate:{jobId}});return true;}});
    const context=await browser.newContext({viewport:{width:index?740:1200,height:900},colorScheme:index?'dark':'light'}),page=await context.newPage(),errors=[],imports=[];page.on('pageerror',error=>errors.push(error.message));activePage=page;
    let draftData;const drafts=new draftModule.GameStudioDraftStore(`fixture-${product}-${session.id}`,{read:async()=>draftData,write:async value=>{draftData=structuredClone(value);}});
    await page.exposeFunction('__libraryStudioRequest',async command=>{
      if(drafts.handles(command))return drafts.dispatch(command);
      const value=await controller.dispatch(command);
      if(command.action==='import-library'&&value?.requestedAssetJobId){imports.push({command:structuredClone(command),jobId:value.requestedAssetJobId});if(loseAck){loseAck=false;await settled(client,value.requestedAssetJobId);throw Error('Fixture lost library acknowledgment; original job preserved');}}
      return value;
    });
    await page.addInitScript(({editor})=>{
      if(!editor)window.gameStudioHost={request:command=>window.__libraryStudioRequest(command)};
      else window.acquireVsCodeApi=()=>({getState:()=>JSON.parse(sessionStorage.getItem('fixture.vscode.state')??'null'),setState:value=>{sessionStorage.setItem('fixture.vscode.state',JSON.stringify(value));return value;},postMessage:message=>{window.__libraryStudioRequest(message.command).then(value=>window.postMessage({type:'game-studio-response',id:message.id,value},'*')).catch(error=>window.postMessage({type:'game-studio-response',id:message.id,error:error.message},'*'));}});
    },{editor:index===1});
    await page.goto(pathToFileURL(path.resolve(index?'dist/game-studio/index.html':'desktop-dist/game-studio/index.html')).href);
    await page.getByRole('heading',{name:document.title,exact:true}).waitFor();await page.locator('[data-tab="assets"]').click();await page.getByRole('button',{name:'Bibliotecas',exact:true}).click();
    await page.locator('#library-list .row').nth(9).waitFor();assert.equal(await page.locator('#library-list .row').count(),10);
    await page.getByRole('button',{name:'Mostrar mais recursos',exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll('#library-list .row').length===20);
    await page.getByRole('button',{name:'Mostrar mais recursos',exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll('#library-list .row').length===22);
    assert.equal(await page.locator('#more-library').isHidden(),true);assert.equal(new Set(await page.locator('#library-list .row strong').allTextContents()).size,22);
    await page.screenshot({path:path.join(output,`${product}-catalog.png`),fullPage:true});
    await page.getByLabel('Buscar recurso ou animação',{exact:true}).fill('not-a-real-resource');await page.getByRole('button',{name:'Buscar',exact:true}).click();await page.locator('#library-status').filter({hasText:'Nenhum recurso encontrado'}).waitFor();assert.equal(await page.locator('#library-list .row').count(),0);
    await page.getByLabel('Buscar recurso ou animação',{exact:true}).fill('walk');await page.getByRole('button',{name:'Buscar',exact:true}).click();await page.locator('#library-list .row').filter({hasText:'Character Soldier'}).waitFor();assert.equal(await page.locator('#library-list .row').count(),1);
    await page.getByRole('button',{name:'Detalhes',exact:true}).click();await page.locator('#library-import').waitFor({state:'visible'});
    await page.locator('#library-animation-title').click();assert.equal(await page.locator('#library-animation-list li').count(),32);assert.match(await page.locator('#library-entry-metadata').innerText(),/Tony Schär[\s\S]*CC0-1.0[\s\S]*License.txt[\s\S]*Textures\/colormap.png/);
    await page.getByLabel('Nome no projeto',{exact:true}).fill('Mensageiro da biblioteca');await page.getByLabel('Pasta no projeto',{exact:true}).fill('../outside');
    await page.getByRole('button',{name:'Preparar candidato',exact:true}).click();await page.locator('#notice').filter({hasText:'Confira o recurso'}).waitFor();assert.equal(approvals,0);assert.equal((await client.listGameProduction(project.id)).jobs.length,0);assert.equal(await page.getByLabel('Nome no projeto',{exact:true}).isDisabled(),false);
    await page.getByLabel('Pasta no projeto',{exact:true}).fill('assets/mensageiro');await page.getByLabel('Recurso temporário',{exact:true}).uncheck();approve=false;
    await page.getByRole('button',{name:'Preparar candidato',exact:true}).click();await page.locator('#notice').filter({hasText:'Operação cancelada'}).waitFor();assert.equal((await client.listGameProduction(project.id)).jobs.length,0);
    await page.screenshot({path:path.join(output,`${product}-details.png`),fullPage:true});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    approve=true;await page.getByRole('button',{name:'Preparar candidato',exact:true}).click();await page.locator('#notice').filter({hasText:'Fixture lost library acknowledgment'}).waitFor();
    assert.equal((await client.listGameProduction(project.id)).jobs.length,1);assert.equal((await client.getGameProject(project.id)).revision,1);assert.equal(await page.getByLabel('Nome no projeto',{exact:true}).isDisabled(),true);assert.equal(await page.getByRole('button',{name:'Cancelar importação',exact:true}).isDisabled(),true);
    const original=imports[0];assert.ok(original);const approvalsBeforeReload=approvals;
    await page.reload();await page.getByRole('heading',{name:document.title,exact:true}).waitFor();await page.getByRole('button',{name:'Retomar pedido',exact:true}).waitFor();
    assert.equal(await page.getByLabel('Nome no projeto',{exact:true}).inputValue(),'Mensageiro da biblioteca');assert.equal(await page.getByLabel('Nome no projeto',{exact:true}).isDisabled(),true);assert.equal(approvals,approvalsBeforeReload);assert.equal(imports.length,1,'Reload must never submit automatically');
    await page.screenshot({path:path.join(output,`${product}-restored-pending.png`),fullPage:true});
    approve=false;await page.getByRole('button',{name:'Retomar pedido',exact:true}).click();await page.locator('#notice').filter({hasText:'Operação cancelada'}).waitFor();assert.equal(await page.getByLabel('Nome no projeto',{exact:true}).isDisabled(),true);assert.equal((await client.listGameProduction(project.id)).jobs.length,1);
    approve=true;await page.getByRole('button',{name:'Retomar pedido',exact:true}).click();await page.locator('#library-import').waitFor({state:'hidden'});assert.equal(imports.length,2);assert.deepEqual(imports[1],original);assert.equal((await client.listGameProduction(project.id)).jobs.length,1);
    await settled(client,original.jobId);await page.getByRole('button',{name:'Atualizar',exact:true}).click();await page.locator('#candidate-list').getByRole('button',{name:'Revisar candidato',exact:true}).click();await page.locator('#candidate-text').waitFor({state:'visible'});
    const result=await client.getGameAssetResult(original.jobId),license=result.files.find(file=>file.path.endsWith('/License.txt')),licenseBytes=await client.downloadGameAssetFile(original.jobId,license.path);
    assert.equal(await page.locator('#candidate-text').textContent(),licenseBytes.toString('utf8'));assert.equal((await client.getGameProject(project.id)).revision,1);
    await page.screenshot({path:path.join(output,`${product}-full-license.png`),fullPage:true});
    await page.locator('#candidate-file').selectOption('assets/mensageiro/Textures/colormap.png');await page.waitForFunction(()=>!document.querySelector('#candidate-image').hidden&&document.querySelector('#candidate-image').naturalWidth>0);assert.equal(await page.locator('#candidate-text').isHidden(),true);
    await page.screenshot({path:path.join(output,`${product}-texture.png`),fullPage:true});
    assert.equal(modelOpens,0,'Reviewing a candidate cannot automatically open a model viewport');
    approve=false;await page.getByRole('button',{name:'Inspecionar modelo 3D',exact:true}).click();await page.locator('#notice').filter({hasText:'Operação cancelada'}).waitFor();assert.equal(modelOpens,0);
    approve=true;canWrite=false;await page.getByRole('button',{name:'Atualizar',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('#refresh').classList.contains('loading'));
    await page.getByRole('button',{name:'Inspecionar modelo 3D',exact:true}).click();await page.locator('#notice').filter({hasText:'Visor 3D aberto'}).waitFor();assert.equal(modelOpens,1);assert.equal((await client.getGameProject(project.id)).revision,1);assert.equal((await client.listGameProduction(project.id)).jobs.length,1);
    canWrite=true;await page.getByRole('button',{name:'Atualizar',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('#refresh').classList.contains('loading'));
    await page.getByRole('button',{name:'Exportar candidato',exact:true}).click();await page.locator('#notice').filter({hasText:'Exportação concluída'}).waitFor();
    assert.deepEqual(await readFile(path.join(exportedPath,'candidate',license.path)),licenseBytes);
    approve=false;await page.getByRole('button',{name:'Aplicar ao projeto',exact:true}).click();await page.locator('#notice').filter({hasText:'Operação cancelada'}).waitFor();assert.equal((await client.getGameProject(project.id)).revision,1);
    approve=true;await page.getByRole('button',{name:'Aplicar ao projeto',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#revision').textContent.startsWith('Revisão 2'));assert.equal((await client.getGameQuality(project.id)).ready,false);
    assert.equal((await client.getGameRevision(project.id)).document.assets[0].placeholder,false,'Explicit user declaration does not grant artistic/license acceptance');
    canWrite=false;await page.getByRole('button',{name:'Atualizar',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('#refresh').classList.contains('loading'));
    await page.getByLabel('Buscar recurso ou animação',{exact:true}).fill('walk');await page.getByRole('button',{name:'Buscar',exact:true}).click();await page.locator('#library-list .row').filter({hasText:'Character Soldier'}).waitFor();
    await page.getByRole('button',{name:'Detalhes',exact:true}).click();assert.equal(await page.getByRole('button',{name:'Preparar candidato',exact:true}).isDisabled(),true);assert.equal(await page.getByRole('button',{name:'Buscar',exact:true}).isEnabled(),true);
    canWrite=true;await page.getByRole('button',{name:'Atualizar',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('#refresh').classList.contains('loading'));
    await page.getByLabel('Pasta no projeto',{exact:true}).fill('assets/second-import');
    approvalMutation=async()=>{await client.selectGameProject(session.id,other.id);};await page.getByRole('button',{name:'Preparar candidato',exact:true}).click();await page.locator('#notice').filter({hasText:'O projeto ou a revisão mudou'}).waitFor();approvalMutation=null;
    assert.equal((await client.listGameProduction(project.id)).jobs.length,1);assert.equal((await client.listGameProduction(other.id)).jobs.length,0);
    await page.getByRole('button',{name:'Atualizar',exact:true}).click();await page.getByRole('heading',{name:'Other isolated game',exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'Preparar candidato',exact:true}).isDisabled(),true);
    assert.equal(await page.locator('#candidate-preview').isHidden(),true);assert.equal(await page.locator('#candidate-text').textContent(),'');
    await page.setViewportSize({width:400,height:820});await page.screenshot({path:path.join(output,`${product}-narrow-stale-draft.png`),fullPage:true});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    await page.getByRole('button',{name:'Cancelar importação',exact:true}).click();await page.locator('#library-import').waitFor({state:'hidden'});
    assert.deepEqual(errors,[]);results.push({product,projectId:project.id,approvals,searchPagedCount:22,animationNames:32,exactLicenseSha256:sha(licenseBytes),request:original.command,jobId:original.jobId,oneJobAfterLostAckAndReload:true,deniedResumeKeepsUnknown:true,fullLicenseText:true,modelViewer:{explicitConsent:true,noAutoplay:true,readonly:true,noApplication:true},explicitApplicationRevision:2,modeGuard:true,selectionDuringConsentBlocked:true,noHorizontalOverflow:true,exportPreservesLicense:true,bridge:'Emulated native consent and Mac/editor bridge; real SDK/service/catalog/jobs. No native installation or independent legal/artistic acceptance.'});
    await save('ui-evidence.json',{results,manifest:JSON.parse(await readFile(path.join(engine,'manifest.json'),'utf8')),browser:{version:browser.version(),sha256:qualified.sha256},fullProductAcceptance:false});for(const preview of modelPreviews)await preview.close();await context.close();
  }
  assert.notEqual(results[0].projectId,results[1].projectId);for(const client of clients)assert.equal((await client.listGameProjects()).projects.length,2);
  console.log(`PACKAGED_LIBRARY_STUDIO_OK products=${results.length} ${output}`);
}catch(error){try{await activePage?.screenshot({path:path.join(output,'failure.png'),fullPage:true});if(activePage)await save('failure-ui.txt',(await activePage.locator('body').innerText()).slice(0,100000));}catch{}await save('failure.json',{error:String(error.stack??error),stateDirectory:state,terminal,completedProducts:results.length});throw error;}
finally{
  for(const preview of modelPreviews)await preview.close();await save('service.log',logs);await browser?.close();
  // A UI observation failure does not authorize cancelling an unknown job.
  for(const client of clients)try{for(const project of (await client.listGameProjects()).projects){for(const job of (await client.listGameProduction(project.id)).jobs)if(!['completed','failed','cancelled'].includes(job.state))terminal=false;}}catch{terminal=false;}
  for(const client of clients)client.close();
  if(terminal){if(child.exitCode===null){const exited=once(child,'exit');child.kill('SIGTERM');await exited;}await rm(state,{recursive:true,force:true});}
  else{child.unref();console.error(`Original service and unknown work preserved: ${state} pid=${child.pid}`);}
}
