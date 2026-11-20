// Actual Electron window/preload/IPC with isolated state and native dialogs mocked
// only in this temporary harness. Does not open the user's installed application.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp,mkdir,readFile,writeFile,rm,cp,readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import * as esbuild from "esbuild";
import { _electron } from "playwright-core";
import electronExecutable from "electron";
import security from "../dist-tests/packages/agent-service/src/security.js";
import storage from "../dist-tests/packages/agent-service/src/store.js";
import sdk from "../dist-tests/packages/client-ts/src/index.js";
import fixtures from "../dist-tests/test/game-fixtures.js";
import webFixtures from "../dist-tests/test/game-web-fixtures.js";
import {exerciseSyntheticPlaytest} from "./game-playtest-ui-fixture.mjs";
import {exerciseRevisionComparison} from "./game-comparison-ui-fixture.mjs";
import {exerciseNativeModelEditing} from "./game-model-native-ui-fixture.mjs";
import bootstrap from "../dist-tests/packages/client-ts/src/bootstrap.js";
const modelEditing=process.argv.includes("--model-editing"),engineOption=process.argv.find(value=>value.startsWith("--engine="))?.slice(9),blenderOption=process.argv.find(value=>value.startsWith("--blender="))?.slice(10);
if(modelEditing&&(!engineOption||!blenderOption))throw Error("Model qualification requires explicit --engine and --blender records");

if(process.platform!=="darwin")throw new Error("This native Mac window smoke requires macOS.");
const root=await mkdtemp(path.join(tmpdir(),"game-studio-electron-")),state=path.join(root,"service"),output=path.resolve("output/playwright/game-studio/native-mac/runs",new Date().toISOString().replace(/[:.]/g,"-")),engine=path.resolve(engineOption??"engine-dist");
await mkdir(state);await mkdir(path.join(root,"app-profile"));await mkdir(path.join(root,"exports"));await mkdir(output,{recursive:true});
await bootstrap.verifyBundle(engine,undefined,true);
if(modelEditing){const record=JSON.parse(await readFile(blenderOption,"utf8")),manifest=JSON.parse(await readFile(path.join(engine,"manifest.json"),"utf8"));assert.equal(record.driverSha256,manifest.files["game-editors/blender/process.py"]);await mkdir(path.join(state,"toolchains"),{mode:0o700});await writeFile(path.join(state,"toolchains/blender.json"),JSON.stringify(record),{mode:0o600});}
const credential=await security.createClientCredential(state,{id:"native-studio",product:"companion-mac",profile:"fixture",workspace:"",providers:["ollama"],hostTools:[]}),identity=await security.ensureIdentity(state),store=new storage.Store(path.join(state,"metadata.sqlite"));store.register(credential);store.close();
const child=spawn(path.join(engine,"node"),[path.join(engine,"service.cjs"),state],{stdio:["ignore","pipe","pipe"]});let logs="",client,electronApp;
child.stdout.on("data",(data)=>{logs=(logs+data).slice(-50000);});child.stderr.on("data",(data)=>{logs=(logs+data).slice(-50000);});
try{
  for(let i=0;i<600;i++){if(child.exitCode!==null)throw new Error(logs);try{if(JSON.parse(await readFile(path.join(state,"runtime.json"),"utf8")).pid===child.pid)break;}catch{}await new Promise((resolve)=>setTimeout(resolve,25));}
  client=new sdk.AgentClient({address:security.ipcPath(state),certificate:identity.cert,credential});await client.connect();
  const session=await client.call("sessions.create",{title:"Native Game Studio fixture"}),document=fixtures.fixtureGameDocument();document.title="Native Studio Fixture";
  for(const [name,text] of webFixtures.webFixture("phaser"))document.files.push(await client.uploadGameFile(name,Buffer.from(text),"text/plain"));
  const project=await client.createGameProject("native-project",document);await client.selectGameProject(session.id,project.id);
  await writeFile(path.join(root,"fixture.json"),JSON.stringify({credential,certificate:identity.cert,address:security.ipcPath(state),session}),{mode:0o600});
  await cp("desktop-dist/game-studio",path.join(root,"game-studio"),{recursive:true});await cp("desktop-dist/game-model-runtime",path.join(root,"game-model-runtime"),{recursive:true});await cp("desktop-dist/game-studio-preload.cjs",path.join(root,"game-studio-preload.cjs"));await cp("desktop-dist/node_modules/playwright-core",path.join(root,"node_modules/playwright-core"),{recursive:true});
  const code=`import {app,dialog} from 'electron';
import {readFileSync,existsSync,writeFileSync,appendFileSync,unlinkSync} from 'node:fs';import path from 'node:path';
import {openDesktopGameStudio} from ${JSON.stringify(path.resolve("desktop/game-studio.ts"))};
import {AgentClient} from ${JSON.stringify(path.resolve("packages/client-ts/src/index.ts"))};
import {GameStudioController} from ${JSON.stringify(path.resolve("packages/client-ts/src/game-studio.ts"))};
const root=process.env.STUDIO_FIXTURE_ROOT;app.setName('Game Studio Validation');app.setPath('userData',path.join(root,'app-profile'));
dialog.showMessageBox=async()=>{const file=path.join(root,'deny-next-model.marker'),denied=existsSync(file);if(denied)unlinkSync(file);return {response:denied?0:1,checkboxChecked:false};};
dialog.showOpenDialog=async()=>({canceled:false,filePaths:[path.join(root,'exports')]});
app.on('window-all-closed',()=>app.quit());
app.whenReady().then(async()=>{const fixture=JSON.parse(readFileSync(path.join(root,'fixture.json'),'utf8'));
const client=new AgentClient({address:fixture.address,certificate:fixture.certificate,credential:fixture.credential});await client.connect();
// Bounded action/status diagnostics only; never draft fields or source bodies.
const trace=value=>{try{appendFileSync(path.join(root,'studio-actions.jsonl'),JSON.stringify({...value,at:Date.now()})+'\\n');}catch{}};
const dispatch=GameStudioController.prototype.dispatch;GameStudioController.prototype.dispatch=function(command){trace({phase:'start',action:command?.action});const pending=dispatch.call(this,command);void pending.then(value=>trace({phase:'done',action:command?.action,exported:value?.exported,cancelled:value?.cancelled}),error=>trace({phase:'error',action:command?.action,error:String(error.message).slice(0,500)})).catch(()=>{});return pending;};
// Failure injection exists only in this temporary native harness.
const commitDesign=client.commitGameRevision.bind(client);let loseDesignAck=!existsSync(path.join(root,'lost-design-ack.marker'));
client.commitGameRevision=async(...args)=>{const project=await commitDesign(...args);appendFileSync(path.join(root,'design-dispatch.jsonl'),JSON.stringify({requestId:args[1],revision:project.revision})+'\\n');if(loseDesignAck){loseDesignAck=false;writeFileSync(path.join(root,'lost-design-ack.marker'),'committed');throw Error('Fixture lost committed native design response');}return project;};
const processAsset=client.processGameAsset.bind(client);let loseLibraryAck=!existsSync(path.join(root,'lost-library-ack.marker'));
client.processGameAsset=async(...args)=>{const job=await processAsset(...args);if(args[3]?.operation?.type==='library.copy')appendFileSync(path.join(root,'library-dispatch.jsonl'),JSON.stringify({requestId:args[0],jobId:job.id})+'\\n');if(args[3]?.operation?.type==='model.scene'){appendFileSync(path.join(root,'model-dispatch.jsonl'),JSON.stringify({requestId:args[0],jobId:job.id})+'\\n');if(!existsSync(path.join(root,'lost-model-ack.marker'))){writeFileSync(path.join(root,'lost-model-ack.marker'),'acknowledged by service');throw Error('Fixture lost native model acknowledgment');}}if(loseLibraryAck&&args[3]?.operation?.type==='library.copy'){loseLibraryAck=false;writeFileSync(path.join(root,'lost-library-ack.marker'),'original job acknowledged by service');throw new Error('Fixture lost native library acknowledgment');}return job;};
await openDesktopGameStudio({runtime:{gameStudioConnection:async()=>({client,session:fixture.session,reconnect:async()=>client})},workspace:'',thread:{id:'fixture-thread',title:'Native fixture',messages:[]},canWrite:()=>true});
}).catch(error=>{console.error(error.message);app.exit(1);});`;
  await esbuild.build({stdin:{contents:code,resolveDir:process.cwd(),loader:"ts"},outfile:path.join(root,"harness.cjs"),bundle:true,platform:"node",format:"cjs",target:"node22",external:["electron","playwright-core"],logLevel:"silent"});
  electronApp=await _electron.launch({executablePath:electronExecutable,args:[path.join(root,"harness.cjs")],env:{...process.env,STUDIO_FIXTURE_ROOT:root},timeout:20000});
  let window=await electronApp.firstWindow();await window.getByRole("heading",{name:document.title,exact:true}).waitFor({timeout:20000});
  assert.deepEqual(await window.evaluate(()=>({node:typeof require,process:typeof process,companion:typeof window.companion,studio:typeof window.gameStudioHost.request})),{node:"undefined",process:"undefined",companion:"undefined",studio:"function"});
  await window.locator('[data-tab="builds"]').click();await window.locator("#workflow").getByText("Produção · Design",{exact:true}).waitFor();
  await window.locator("#workflow").getByRole("button",{name:"Avançar etapa",exact:true}).click();await window.locator("#workflow").getByText("Produção · Experiência central",{exact:true}).waitFor();
  assert.equal(await window.locator("#workflow").getByRole("button",{name:"Avançar etapa",exact:true}).isDisabled(),true);
  assert.equal((await client.getGameWorkflow(project.id)).workflow.stage,"core");
  await window.screenshot({path:path.join(output,"workflow.png"),fullPage:true});
  await window.locator('[data-tab="design"]').click();await window.getByRole("button",{name:"Editar design"}).click();await window.getByLabel("Premissa",{exact:true}).fill("A new native-window design with preserved source files and history.");await window.getByRole("button",{name:"Salvar design"}).click();
  await window.locator("#notice").filter({hasText:"Fixture lost committed native design response"}).waitFor();assert.equal((await client.getGameProject(project.id)).revision,2);
  await electronApp.close();electronApp=undefined;
  electronApp=await _electron.launch({executablePath:electronExecutable,args:[path.join(root,"harness.cjs")],env:{...process.env,STUDIO_FIXTURE_ROOT:root},timeout:20000});
  window=await electronApp.firstWindow();await window.getByRole("heading",{name:document.title,exact:true}).waitFor({timeout:20000});await window.getByRole("button",{name:"Retomar pedido",exact:true}).waitFor();
  assert.equal((await readFile(path.join(root,"design-dispatch.jsonl"),"utf8")).trim().split("\n").length,1);
  await window.getByRole("button",{name:"Retomar pedido",exact:true}).click();await window.locator("#design-form").waitFor({state:"hidden"});await window.locator("#notice").filter({hasText:"Pedido confirmado na revisão 2"}).waitFor();
  assert.equal((await readFile(path.join(root,"design-dispatch.jsonl"),"utf8")).trim().split("\n").length,1,"readback cannot commit again");assert.equal((await client.getGameProject(project.id)).revision,2);
  await window.screenshot({path:path.join(output,"design-receipt-recovered.png"),fullPage:true});
  await window.locator('[data-tab="overview"]').click();await window.getByRole("button",{name:"Exportar fonte"}).click();await window.locator("#notice").filter({hasText:"Exportação concluída"}).waitFor({timeout:15000});
  const exported=await readdir(path.join(root,"exports"));assert.equal(exported.length,1);assert.equal((await client.getGameProject(project.id)).revision,2);
  assert.equal(JSON.parse(await readFile(path.join(root,"exports",exported[0],"production.json"),"utf8")).snapshot.workflow.stage,"core");
  await window.locator('[data-tab="assets"]').click();await window.getByRole("button",{name:"Bibliotecas",exact:true}).click();
  await window.getByLabel("Buscar recurso ou animação",{exact:true}).fill("walk");await window.getByRole("button",{name:"Buscar",exact:true}).click();await window.locator("#library-list .row").filter({hasText:"Character Soldier"}).waitFor();
  await window.getByRole("button",{name:"Detalhes",exact:true}).click();await window.getByLabel("Nome no projeto",{exact:true}).fill("Native licensed character");
  const originalFolder=await window.getByLabel("Pasta no projeto",{exact:true}).inputValue();await window.getByLabel("Pasta no projeto",{exact:true}).fill("../outside");
  await window.getByRole("button",{name:"Preparar candidato",exact:true}).click();await window.locator("#notice").filter({hasText:"Confira o recurso"}).waitFor();assert.equal(await window.getByLabel("Nome no projeto",{exact:true}).isDisabled(),false);
  await window.getByLabel("Pasta no projeto",{exact:true}).fill(originalFolder);await window.getByRole("button",{name:"Preparar candidato",exact:true}).click();
  await window.locator("#notice").filter({hasText:"Fixture lost native library acknowledgment"}).waitFor();
  const jobsBeforeReload=(await client.listGameProduction(project.id)).jobs;assert.equal(jobsBeforeReload.length,1);
  await window.reload();await window.getByRole("button",{name:"Retomar pedido",exact:true}).waitFor();assert.equal(await window.getByLabel("Nome no projeto",{exact:true}).isDisabled(),true);
  assert.equal(await window.getByLabel("Nome no projeto",{exact:true}).inputValue(),"Native licensed character");assert.equal((await client.listGameProduction(project.id)).jobs.length,1);
  // A new process, renderer partition and controller must recover only from
  // the host's private file. No browser storage or live singleton survives.
  await electronApp.close();electronApp=undefined;
  electronApp=await _electron.launch({executablePath:electronExecutable,args:[path.join(root,"harness.cjs")],env:{...process.env,STUDIO_FIXTURE_ROOT:root},timeout:20000});
  window=await electronApp.firstWindow();await window.getByRole("heading",{name:document.title,exact:true}).waitFor({timeout:20000});
  await window.getByRole("button",{name:"Retomar pedido",exact:true}).waitFor();assert.equal(await window.getByLabel("Nome no projeto",{exact:true}).isDisabled(),true);
  assert.equal((await readFile(path.join(root,"library-dispatch.jsonl"),"utf8")).trim().split("\n").length,1,"a host restart must not dispatch again");
  await window.screenshot({path:path.join(output,"host-restarted-frozen.png"),fullPage:true});
  await window.getByRole("button",{name:"Retomar pedido",exact:true}).click();await window.locator("#library-import").waitFor({state:"hidden"});
  const dispatches=(await readFile(path.join(root,"library-dispatch.jsonl"),"utf8")).trim().split("\n").map(JSON.parse);assert.equal(dispatches.length,2);assert.deepEqual(dispatches[1],dispatches[0]);
  assert.equal((await client.listGameProduction(project.id)).jobs[0].id,jobsBeforeReload[0].id);

  let libraryJob;for(let i=0;i<600;i++){libraryJob=(await client.listGameProduction(project.id)).jobs.find(job=>job.assetSpec?.operation.type==="library.copy");if(libraryJob&&["completed","failed","awaiting_reconciliation"].includes(libraryJob.state))break;await new Promise(resolve=>setTimeout(resolve,25));}
  assert.equal(libraryJob?.state,"completed",libraryJob?.error);assert.equal((await client.getGameProject(project.id)).revision,2);
  await window.getByRole("button",{name:"Atualizar",exact:true}).click();await window.locator("#candidate-list").getByRole("button",{name:"Revisar candidato",exact:true}).click();await window.locator("#candidate-text").waitFor({state:"visible"});
  const libraryResult=await client.getGameAssetResult(libraryJob.id),notice=libraryResult.files.find(file=>file.path.endsWith("/License.txt"));
  assert.equal(await window.locator("#candidate-text").textContent(),(await client.downloadGameAssetFile(libraryJob.id,notice.path)).toString("utf8"));
  await window.getByRole("button",{name:"Inspecionar modelo 3D",exact:true}).click();await window.locator("#notice").filter({hasText:"Visor 3D aberto"}).waitFor({timeout:30000});
  assert.equal((await client.getGameProject(project.id)).revision,2,"native model inspection cannot apply its candidate");
  await window.screenshot({path:path.join(output,"library-license.png"),fullPage:true});
  await window.getByRole("button",{name:"Aplicar ao projeto",exact:true}).click();await window.waitForFunction(()=>document.querySelector("#revision").textContent.startsWith("Revisão 3"));
  const library={jobId:libraryJob.id,fullLicenseSha256:notice.sha256,preparedWithoutApplication:true,knownInvalidInputEditable:true,lostAckAndNativeReloadRecoveredSameJob:true,wholeHostRestartRecoveredSameRequest:true,noAutomaticDispatchOnRestart:true,modelInspection:{actualNativeHost:true,firstFrameBeforeReturn:true,noAutomaticApplication:true},explicitlyAppliedRevision:3,bridge:"Actual Electron preload/controller; native confirmation mocked only by the isolated harness"};
  const playtestBuild=await client.startGameBuild("native-playtest-build",project.id,3);
  for(let i=0;i<600;i++){const state=await client.getGameProduction(playtestBuild.id);if(!["running","queued"].includes(state.state)){assert.equal(state.state,"completed",state.error);break;}await new Promise(resolve=>setTimeout(resolve,25));}
  assert.equal((await client.getGameProduction(playtestBuild.id)).state,"completed");await window.locator("#refresh").click();
  const playtests=await exerciseSyntheticPlaytest({scope:window,title:"Native Mac synthetic round"});
  await window.screenshot({path:path.join(output,"playtests.png"),fullPage:true});
  await window.locator("#export-playtest-summary").click();await window.locator("#notice").filter({hasText:"Exportação concluída"}).waitFor();
  const playtestExport=(await readdir(path.join(root,"exports"))).filter(name=>!exported.includes(name));assert.equal(playtestExport.length,1);
  assert.deepEqual(JSON.parse(await readFile(path.join(root,"exports",playtestExport[0],"playtest.json"),"utf8")).responses,[]);
  const comparison=await exerciseRevisionComparison({scope:window,targetRevision:3});await window.screenshot({path:path.join(output,"comparison.png"),fullPage:true});
  await window.screenshot({path:path.join(output,"window.png"),fullPage:true});await electronApp.close();electronApp=undefined;
  assert.equal((await client.getGameProject(project.id)).revision,3,"closing the native UI preserves service-owned work");
  const workflow=await client.getGameWorkflow(project.id);assert.equal(workflow.workflow.stage,"core");assert.equal(workflow.canAdvance,false);
  let nativeModel;
  if(modelEditing){
    const restart=async()=>{await electronApp?.close();electronApp=await _electron.launch({executablePath:electronExecutable,args:[path.join(root,"harness.cjs")],env:{...process.env,STUDIO_FIXTURE_ROOT:root},timeout:20000});window=await electronApp.firstWindow();await window.getByRole("heading",{name:document.title,exact:true}).waitFor();return window;};
    await restart();nativeModel=(await exerciseNativeModelEditing({scope:window,restart,client,projectId:project.id,prepareDeny:()=>writeFile(path.join(root,"deny-next-model.marker"),"Deny only this fixture confirmation"),readDispatches:async()=>{try{return (await readFile(path.join(root,"model-dispatch.jsonl"),"utf8")).trim().split("\n").filter(Boolean).map(JSON.parse);}catch(error){if(error.code==="ENOENT")return [];throw error;}},capture:name=>window.screenshot({path:path.join(output,name),fullPage:true}),output})).result;
    await electronApp.close();electronApp=undefined;
  }
  await writeFile(path.join(output,"evidence.json"),JSON.stringify({platform:process.platform,electron:JSON.parse(await readFile("node_modules/electron/package.json","utf8")).version,engine:JSON.parse(await readFile(path.join(engine,"manifest.json"),"utf8")),scope:"Actual development Electron window/preload/IPC; temporary host harness, native dialogs mocked; not installed/notarized app or physical gameplay acceptance",projectId:project.id,revision:(await client.getGameProject(project.id)).revision,nativeModel,revisionBeforeModelEditing:3,workflow,library,comparison,playtests:{...playtests,summaryExportThroughNativeHost:true,nativeDialogsMocked:true},designReceipt:{wholeHostRestart:true,recoveredRevision:2,oneCommit:true,noAutomaticDispatch:true}},null,2));
  console.log(`NATIVE_GAME_STUDIO_MAC_OK preload isolation, authenticated IPC, structured edit, export and UI closure ${output}`);
}catch(error){
  if(electronApp)try{const current=electronApp.windows().find(page=>!page.isClosed());if(current){await current.screenshot({path:path.join(output,"failure.png"),fullPage:true});await writeFile(path.join(output,"failure.json"),JSON.stringify({error:error.message,notice:await current.locator("#notice").textContent(),sync:await current.locator("#sync").textContent(),draft:await current.locator("#draft-status").textContent(),exports:await readdir(path.join(root,"exports"))},null,2));}}catch{}
  throw error;
}finally{
  try{await cp(path.join(root,"studio-actions.jsonl"),path.join(output,"studio-actions.jsonl"));}catch{}
  await electronApp?.close();let idle=true;
  if(client)try{for(const project of (await client.listGameProjects()).projects)for(const job of (await client.listGameProduction(project.id)).jobs)if(!["completed","failed","cancelled"].includes(job.state))idle=false;}catch{idle=false;}
  client?.close();if(idle){if(child.exitCode===null){const exited=once(child,"exit");child.kill("SIGTERM");await exited;}await rm(root,{recursive:true,force:true});}
  else{child.unref();console.error(`Original service/unknown work preserved: ${root} pid=${child.pid}`);}
}
