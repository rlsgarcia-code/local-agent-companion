// Real renderer/controller/SDK and packaged service with emulated Mac/VS bridges.
// No inference, game execution, installed application or quality approval.
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
import draftModule from '../dist-tests/packages/client-ts/src/game-studio-drafts.js';
import fileDrafts from '../dist-tests/packages/client-ts/src/game-studio-file-drafts.js';
import browserModule from '../dist-tests/packages/adapter-game-browser/src/browser.js';
import fixtures from '../dist-tests/test/game-fixtures.js';

const root=await mkdtemp(path.join(tmpdir(),'game-comparison-ui-')),engine=path.resolve(process.argv[2]??'engine-dist');
const output=path.resolve('output/playwright/game-comparison/runs',`${new Date().toISOString().replace(/[:.]/g,'-')}-${randomUUID().slice(0,8)}`);await mkdir(output,{recursive:true});
const identity=await security.ensureIdentity(root),store=new storage.Store(path.join(root,'metadata.sqlite')),credentials=[];
for(const product of ['companion-mac','companion-vscode']){const credential=await security.createClientCredential(root,{id:`comparison-${product}`,product,profile:'fixture',workspace:'',providers:['ollama'],hostTools:[]});store.register(credential);credentials.push(credential);}store.close();
const child=spawn(path.join(engine,'node'),[path.join(engine,'service.cjs'),root],{stdio:['ignore','pipe','pipe']});let logs='',browser,active,passed=false;const clients=[],results=[];
child.stdout.on('data',data=>logs=(logs+data).slice(-50000));child.stderr.on('data',data=>logs=(logs+data).slice(-50000));
const tick=()=>new Promise(resolve=>setTimeout(resolve,25));
try{
  for(let i=0;i<600;i++){assert.equal(child.exitCode,null,logs);try{if(JSON.parse(await readFile(path.join(root,'runtime.json'),'utf8')).pid===child.pid)break;}catch{}await tick();}
  const qualified=await browserModule.qualifyBrowser();assert.ok(qualified);browser=await chromium.launch({executablePath:qualified.executablePath,headless:true,chromiumSandbox:true});
  for(const [index,credential]of credentials.entries()){
    const client=new sdk.AgentClient({address:security.ipcPath(root),certificate:identity.cert,credential});clients.push(client);await client.connect();
    const session=await client.call('sessions.create',{title:'Read-only comparison'}),document=fixtures.fixtureGameDocument();document.title=`Comparison ${credential.registration.product}`;
    document.design.content=Array.from({length:120},(_,i)=>({id:`content-${i}`,kind:'Synthetic fixture',description:`Before ${i}`}));
    document.files=[await client.uploadGameFile('src/main.ts',Buffer.from('const before = 1;'),'text/plain')];
    document.assets=[{id:'source',kind:'other',role:'Synthetic source',files:['src/main.ts'],placeholder:true,origin:{kind:'procedural',source:'Synthetic fixture',author:'Test',license:'Fixture only',referenceIds:[]}}];
    const project=await client.createGameProject('comparison',document),next=structuredClone(document);
    next.design.premise='<img src="https://invalid.example/never-requested"> displayed as text';next.design.content.forEach((entry,i)=>entry.description=`After ${i}`);
    next.files=[await client.uploadGameFile('src/main.ts',Buffer.from('const after = 2;'),'text/plain')];next.assets[0].origin.license='A changed declaration; not legal verification';
    await client.commitGameRevision(project.id,'change',1,next,'Synthetic structural comparison');await client.selectGameProject(session.id,project.id);
    const drafts=fileDrafts.fileGameStudioDraftStore(path.join(root,`host-${index}`),draftModule.gameStudioDraftKey(credential.registration,session.id));
    const host={canWrite:()=>false,approve:async()=>{throw Error('A read-only comparison cannot request write consent');},preview:async()=>{throw Error('No preview in comparison fixture');},exportSource:async()=>false,exportBuild:async()=>false,exportAsset:async()=>false};
    const controller=new studio.GameStudioController(client,session.id,host),context=await browser.newContext({viewport:{width:index?600:1200,height:950},colorScheme:index?'dark':'light'}),page=await context.newPage();active=page;const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.exposeFunction('__comparisonRequest',command=>drafts.handles(command)?drafts.dispatch(command):controller.dispatch(command));
    await page.addInitScript(({editor})=>{if(!editor)window.gameStudioHost={request:command=>window.__comparisonRequest(command)};else window.acquireVsCodeApi=()=>({postMessage:message=>{window.__comparisonRequest(message.command).then(value=>window.postMessage({type:'game-studio-response',id:message.id,value},'*')).catch(error=>window.postMessage({type:'game-studio-response',id:message.id,error:error.message},'*'));}});},{editor:index===1});
    await page.goto(pathToFileURL(path.resolve(index?'dist/game-studio/index.html':'desktop-dist/game-studio/index.html')).href);await page.getByRole('heading',{name:document.title,exact:true}).waitFor();
    await page.locator('[data-tab="history"]').click();assert.equal(await page.getByRole('button',{name:'Restaurar',exact:true}).first().isDisabled(),true);
    await page.locator('#comparison-base').fill('1');await page.locator('#comparison-target').fill('2');await page.locator('#compare-revisions').click();
    await page.locator('#comparison-title').filter({hasText:'Revisão 1 → revisão 2'}).waitFor();assert.equal(await page.locator('.comparison-change').count(),30);
    while(await page.locator('#more-comparison').isVisible()){const count=await page.locator('.comparison-change').count();await page.locator('#more-comparison').click();await page.waitForFunction(count=>document.querySelectorAll('.comparison-change').length>count,count);}
    assert.equal(await page.locator('.comparison-change').count(),123);assert.equal(new Set(await page.locator('.comparison-change h4').allTextContents()).size,123);assert.equal(await page.locator('.comparison-change img').count(),0);
    assert.ok((await page.locator('.comparison-values pre').allTextContents()).includes(next.design.premise));
    await page.locator('#comparison-title').scrollIntoViewIfNeeded();await page.screenshot({path:path.join(output,`${credential.registration.product}-paged.png`),fullPage:false});
    const originalHash=(await client.getGameRevision(project.id,2)).contentHash,later=structuredClone(next);later.title='Later immutable revision';await client.commitGameRevision(project.id,'later',2,later,'Keep later source');
    await page.locator('#refresh').click();await page.locator('#comparison-binding').filter({hasText:'atualmente na revisão 3'}).waitFor();assert.equal(await page.locator('#comparison-target').inputValue(),'2');assert.ok((await page.locator('#comparison-binding').textContent()).includes(originalHash.slice(0,12)));
    await page.locator('#comparison-section').selectOption('files');await page.locator('#compare-revisions').click();await page.locator('#comparison-title').filter({hasText:'Arquivos'}).waitFor();assert.equal(await page.locator('.comparison-change').count(),1);assert.match(await page.locator('.comparison-values').textContent(),/src\/main.ts/);
    const layout=await page.evaluate(()=>({width:innerWidth,scrollWidth:document.documentElement.scrollWidth}));assert.ok(layout.scrollWidth<=layout.width);
    await page.screenshot({path:path.join(output,`${credential.registration.product}-file.png`),fullPage:true});
    await page.locator('#comparison-base').fill('2');await page.locator('#comparison-target').fill('1');await page.locator('#comparison-section').selectOption('design');await page.locator('#compare-revisions').click();
    await page.locator('#comparison-title').filter({hasText:'Revisão 2 → revisão 1'}).waitFor();assert.match(await page.locator('.comparison-values').first().textContent(),/After|displayed as text/);
    await page.locator('#comparison-base').fill('1');await page.locator('#compare-revisions').click();await page.locator('#comparison-summary').filter({hasText:'mesmo conteúdo de origem'}).waitFor();assert.equal(await page.locator('.comparison-change').count(),0);
    assert.equal((await client.getGameProject(project.id)).revision,3);assert.equal((await client.listGameProduction(project.id)).jobs.length,0);
    await context.close();assert.deepEqual(errors,[]);results.push({product:credential.registration.product,readOnly:true,pagedAll123Changes:true,untrustedValuesAsText:true,immutableSelectionAfterLaterRevision:true,fileMetadataFilter:true,reverseDirection:true,identicalRevision:true,layout,noBuildsOrRestores:true,installedAcceptance:false});
  }
  passed=true;await writeFile(path.join(output,'report.json'),JSON.stringify({scope:'Real renderer/SDK/TLS/IPC and packaged engine; emulated Mac and VS Code bridges, synthetic sources, no inference or installed/quality acceptance.',engineManifestSha256:createHash('sha256').update(await readFile(path.join(engine,'manifest.json'))).digest('hex'),results},null,2));console.log(`GAME_COMPARISON_UI_OK ${output}`);
}catch(error){if(active&&!active.isClosed())try{await active.screenshot({path:path.join(output,'failure.png'),fullPage:true});await writeFile(path.join(output,'failure.json'),JSON.stringify({message:error.message,notice:await active.locator('#notice').textContent()},null,2));}catch{}throw error;}
finally{await browser?.close();clients.forEach(client=>client.close());await writeFile(path.join(output,'service.log'),logs);
  // This fixture never starts a run, tool, build or validation. Only its owned
  // metadata service may be stopped; no personal installation is touched.
  if(child.exitCode===null){const exited=once(child,'exit');child.kill('SIGTERM');await exited;}await rm(root,{recursive:true,force:true});
}
