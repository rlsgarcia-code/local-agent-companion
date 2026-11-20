// Real VS Code Extension Host and webview with the production Studio/agent
// classes. Only the connection factory is bound to an existing temporary engine;
// never invoke the personal user's installer, LaunchAgent or provider settings.
import assert from "node:assert/strict";
import { spawn,execFile } from "node:child_process";
import { promisify } from "node:util";
import { once } from "node:events";
import { mkdtemp,mkdir,readFile,writeFile,rm,cp,realpath,readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createServer } from "node:net";
import * as esbuild from "esbuild";
import { chromium } from "playwright-core";
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

const executable=process.env.VSCODE_EXECUTABLE_PATH??(process.platform==="darwin"?"/Applications/Visual Studio Code.app/Contents/MacOS/Code":undefined);
if(!executable||!path.isAbsolute(executable))throw new Error("Set VSCODE_EXECUTABLE_PATH to the existing VS Code executable for this host.");
if(process.platform==="win32")throw new Error("This runner's owned-process cleanup is qualified on POSIX only; Windows UI qualification remains pending.");
const root=await realpath(await mkdtemp(path.join(tmpdir(),"studio-vscode-"))),state=path.join(root,"service"),workspace=path.join(root,"workspace"),extension=path.join(root,"fixture-extension"),profile=path.join(root,"profile"),output=path.resolve("output/playwright/game-studio/native-vscode/runs",new Date().toISOString().replace(/[:.]/g,"-")),engine=path.resolve(engineOption??"engine-dist");
for(const folder of [state,workspace,extension,path.join(profile,"User"),path.join(root,"extensions"),path.join(root,"exports"),output])await mkdir(folder,{recursive:true,mode:0o700});
await writeFile(path.join(profile,"User/settings.json"),JSON.stringify({"telemetry.telemetryLevel":"off","update.mode":"none","extensions.autoUpdate":false,"extensions.autoCheckUpdates":false,"workbench.enableExperiments":false,"workbench.startupEditor":"none","window.dialogStyle":"custom","files.simpleDialog.enable":true,"security.workspace.trust.enabled":false,"git.autofetch":false,"localAgentCompanion.autonomyMode":"review"}));
await writeFile(path.join(workspace,"README.md"),"# Temporary Game Studio integration workspace\nNo model inference or personal settings are used.\n");
await bootstrap.verifyBundle(engine,undefined,true);
if(modelEditing){const record=JSON.parse(await readFile(blenderOption,"utf8")),manifest=JSON.parse(await readFile(path.join(engine,"manifest.json"),"utf8"));assert.equal(record.driverSha256,manifest.files["game-editors/blender/process.py"]);await mkdir(path.join(state,"toolchains"),{mode:0o700});await writeFile(path.join(state,"toolchains/blender.json"),JSON.stringify(record),{mode:0o600});}
const credential=await security.createClientCredential(state,{id:"native-vscode-studio",product:"companion-vscode",profile:"default",workspace,providers:["litellm"],hostTools:[]}),identity=await security.ensureIdentity(state),store=new storage.Store(path.join(state,"metadata.sqlite"));store.register(credential);store.close();
const engineChild=spawn(path.join(engine,process.platform==="win32"?"node.exe":"node"),[path.join(engine,"service.cjs"),state],{stdio:["ignore","pipe","pipe"]});
let codeChild,browser,page,client,engineLogs="",codeLogs="",passed=false;
engineChild.stdout.on("data",(data)=>{engineLogs=(engineLogs+data).slice(-50000);});engineChild.stderr.on("data",(data)=>{engineLogs=(engineLogs+data).slice(-50000);});
const tick=()=>new Promise((resolve)=>setTimeout(resolve,50));
async function waitFor(fn,description,attempts=400){for(let i=0;i<attempts;i++){const result=await fn();if(result)return result;await tick();}throw new Error(`Timed out observing ${description}; inspect the same process before any retry.`);}
async function settled(id){return waitFor(async()=>{const job=await client.getGameProduction(id);if(["queued","running","cancelling"].includes(job.state))return false;assert.equal(job.state,"completed",job.error);return job;},"production job",2400);}
async function studioFrame(){return waitFor(async()=>{for(const frame of page.frames()){try{if(await frame.locator("#studio #title").count())return frame;}catch{}}return false;},"the real Studio webview",600);}
async function confirm(){const button=page.getByRole("button",{name:/^Continuar$/});await button.waitFor({state:"visible",timeout:15000});await button.click();}
async function stopOwnedCode(){
  if(!codeChild)return;
  async function owned(){
    const {stdout}=await promisify(execFile)("ps",["-axo","pid=,pgid=,stat=,args="],{maxBuffer:8*1024*1024});
    return stdout.split("\n").flatMap((line)=>{
      const match=/^\s*(\d+)\s+(\d+)\s+(\S+)\s+(.+)$/.exec(line);if(!match||match[3].startsWith("Z"))return [];
      const pid=Number(match[1]),group=Number(match[2]),args=match[4];
      // The group was created detached by this runner. Crashpad deliberately
      // leaves that group, so require its exact private database path instead.
      return group===codeChild.pid||(args.includes("chrome_crashpad_handler ")&&args.includes(`--database=${profile}/Crashpad`))?[{pid,group}]:[];
    });
  }
  for(const signal of ["SIGTERM","SIGKILL"]){
    const remaining=await owned();if(!remaining.length)return;
    try{process.kill(-codeChild.pid,signal);}catch(error){if(error.code!=="ESRCH")throw error;}
    for(const row of remaining.filter((row)=>row.group!==codeChild.pid))try{process.kill(row.pid,signal);}catch(error){if(error.code!=="ESRCH")throw error;}
    for(let i=0;i<30;i++){if(!(await owned()).length)return;await new Promise((resolve)=>setTimeout(resolve,100));}
  }
  assert.deepEqual(await owned(),[],"Owned Code fixture shutdown is unconfirmed; do not retry this fixture or remove its live profile.");
}
async function launchOwnedCode(port,previousExtensionPid){
  codeChild=spawn(executable,[workspace,"--new-window",`--user-data-dir=${profile}`,`--extensions-dir=${path.join(root,"extensions")}`,`--extensionDevelopmentPath=${extension}`,"--disable-extensions","--skip-welcome","--skip-release-notes","--use-inmemory-secretstorage",`--remote-debugging-port=${port}`,"--remote-debugging-address=127.0.0.1"],{detached:process.platform!=="win32",stdio:["ignore","pipe","pipe"],env:{...process.env,STUDIO_FIXTURE_ROOT:root}});
  codeChild.stdout.on("data",(data)=>{codeLogs=(codeLogs+data).slice(-100000);});codeChild.stderr.on("data",(data)=>{codeLogs=(codeLogs+data).slice(-100000);});
  const endpoint=await waitFor(async()=>{if(codeChild.exitCode!==null)throw new Error(`VS Code exited ${codeChild.exitCode}: ${codeLogs}`);try{const response=await fetch(`http://127.0.0.1:${port}/json/version`,{signal:AbortSignal.timeout(500)});if(!response.ok)return false;return (await response.json()).webSocketDebuggerUrl;}catch{return false;}},"the owned Code renderer debugger",600);
  browser=await chromium.connectOverCDP(endpoint);page=await waitFor(()=>browser.contexts().flatMap((context)=>context.pages()).find((candidate)=>candidate.url().includes("workbench")),"the owned Code workbench");
  return waitFor(async()=>{try{const error=await readFile(path.join(root,"error.txt"),"utf8");throw new Error(error);}catch(error){if(error.code!=="ENOENT")throw error;}try{const ready=JSON.parse(await readFile(path.join(root,"ready.json"),"utf8"));return ready.processId!==previousExtensionPid?ready:false;}catch{return false;}},"the new fixture extension process activation",600);
}
async function reopenStudio(){
  await page.keyboard.press(process.platform==="darwin"?"Meta+Shift+p":"Control+Shift+p");const picker=page.locator(".quick-input-widget input").first();await picker.waitFor({state:"visible"});await picker.fill(">Game Studio Fixture: Open");await page.getByRole("option",{name:/Game Studio Fixture: Open/}).click();return studioFrame();
}
try{
  await waitFor(async()=>{if(engineChild.exitCode!==null)throw new Error(engineLogs);try{return JSON.parse(await readFile(path.join(state,"runtime.json"),"utf8")).pid===engineChild.pid;}catch{return false;}},"the isolated packaged engine",600);
  client=new sdk.AgentClient({address:security.ipcPath(state),certificate:identity.cert,credential});await client.connect();
  const document=fixtures.fixtureGameDocument();document.title="Native VS Code Game";
  for(const [name,text] of webFixtures.webFixture("phaser"))document.files.push(await client.uploadGameFile(name,Buffer.from(text),"text/plain"));
  const project=await client.createGameProject("native-editor-project",document),build=await client.startGameBuild("fixture-build",project.id,1);await settled(build.id);
  const observation=await client.startGameValidation("fixture-observe",build.id,"web-browser-runtime-v1");await settled(observation.id);
  await writeFile(path.join(root,"fixture.json"),JSON.stringify({credential,certificate:identity.cert,address:security.ipcPath(state),workspace,projectId:project.id}),{mode:0o600});
  await cp("dist/game-studio",path.join(extension,"dist/game-studio"),{recursive:true});await cp("dist/game-model-runtime",path.join(extension,"dist/game-model-runtime"),{recursive:true});await cp("dist/node_modules/playwright-core",path.join(extension,"node_modules/playwright-core"),{recursive:true});
  const manifest={name:"game-studio-native-fixture",displayName:"Game Studio Native Fixture",publisher:"local-suite-tests",version:"0.0.0",private:true,engines:{vscode:"^1.106.0"},activationEvents:["onStartupFinished"],main:"./extension.cjs",contributes:{commands:[{command:"studioFixture.open",title:"Game Studio Fixture: Open"}]}};
  await writeFile(path.join(extension,"package.json"),JSON.stringify(manifest));
  const source=`import * as vscode from 'vscode';import {readFile,writeFile,appendFile} from 'node:fs/promises';import path from 'node:path';
import {DevelopmentAgent} from ${JSON.stringify(path.resolve("src/agent.ts"))};
import {EditorServiceRuntime} from ${JSON.stringify(path.resolve("src/service-runtime.ts"))};
import {ContextCollector} from ${JSON.stringify(path.resolve("src/context.ts"))};
import {ProjectMemory} from ${JSON.stringify(path.resolve("src/memory.ts"))};
import {ChangeReviewManager} from ${JSON.stringify(path.resolve("src/change-review.ts"))};
import {openEditorGameStudio} from ${JSON.stringify(path.resolve("src/game-studio.ts"))};
import {AgentClient} from ${JSON.stringify(path.resolve("packages/client-ts/src/index.ts"))};
import {GameStudioController} from ${JSON.stringify(path.resolve("packages/client-ts/src/game-studio.ts"))};
export async function activate(context){const root=process.env.STUDIO_FIXTURE_ROOT;
try{const fixture=JSON.parse(await readFile(path.join(root,'fixture.json'),'utf8'));
const logCommand=value=>{void appendFile(path.join(root,'studio-commands.jsonl'),JSON.stringify(value)+'\\n').catch(()=>{});};
const dispatch=GameStudioController.prototype.dispatch;GameStudioController.prototype.dispatch=function(command){const base={action:command?.action,projectId:command?.projectId,expectedRevision:command?.expectedRevision,requestId:command?.requestId,processId:process.pid};const pending=dispatch.call(this,command);void pending.then(result=>logCommand({...base,result:{opened:result?.opened,revision:typeof result?.revision==='number'?result.revision:result?.project?.revision,cancelled:result?.cancelled,canWrite:result?.canWrite,recoveredDesignCommit:result?.recoveredDesignCommit}}),error=>logCommand({...base,error:String(error.message).slice(0,1000)}));return pending;};
const client=new AgentClient({address:fixture.address,certificate:fixture.certificate,credential:fixture.credential});await client.connect();
const downloadArtifact=client.downloadGameArtifactFile.bind(client);client.downloadGameArtifactFile=function(jobId,filePath){const start=performance.now();logCommand({action:'artifact-read-start',jobId,path:filePath,processId:process.pid});const pending=downloadArtifact(jobId,filePath);void pending.then(bytes=>logCommand({action:'artifact-read-end',jobId,path:filePath,bytes:bytes.length,durationMs:Math.round(performance.now()-start),processId:process.pid}),error=>logCommand({action:'artifact-read-error',jobId,path:filePath,durationMs:Math.round(performance.now()-start),error:String(error.message).slice(0,1000),processId:process.pid}));return pending;};

const commitDesign=client.commitGameRevision.bind(client);let loseDesignAck=true;try{await readFile(path.join(root,'lost-design-ack.marker'));loseDesignAck=false;}catch(error){if(error.code!=='ENOENT')throw error;}
client.commitGameRevision=async(...args)=>{const project=await commitDesign(...args);await appendFile(path.join(root,'design-dispatch.json'),JSON.stringify({requestId:args[1],revision:project.revision})+'\\n');if(loseDesignAck){loseDesignAck=false;await writeFile(path.join(root,'lost-design-ack.marker'),'committed');throw Error('Fixture lost committed editor design response');}return project;};

// Failure injection exists only in this temporary native harness.
const processAsset=client.processGameAsset.bind(client);let loseLibraryAck=true;
let loseModelAck=true;try{await readFile(path.join(root,'lost-model-ack.marker'));loseModelAck=false;}catch(error){if(error.code!=='ENOENT')throw error;}
client.processGameAsset=async(...args)=>{const job=await processAsset(...args);if(args[3]?.operation?.type==='model.scene'){await appendFile(path.join(root,'model-dispatch.jsonl'),JSON.stringify({requestId:args[0],jobId:job.id})+'\\n');if(loseModelAck){loseModelAck=false;await writeFile(path.join(root,'lost-model-ack.marker'),'acknowledged by service');throw Error('Fixture lost native model acknowledgment');}}if(loseLibraryAck&&args[3]?.operation?.type==='library.copy'){loseLibraryAck=false;throw new Error('Fixture lost native library acknowledgment');}return job;};
const runtime=new EditorServiceRuntime(context);runtime.connect=async(workspace,catalog=[])=>{if(workspace!==fixture.workspace||catalog.length)throw new Error('Fixture connection scope mismatch');if(!client.connected)throw new Error('Existing fixture engine unavailable; no installer may run');return client;};
const review=new ChangeReviewManager(),agent=new DevelopmentAgent(context,new ContextCollector(),new ProjectMemory(),review,runtime);
context.subscriptions.push(agent,review,{dispose:()=>client.close()},vscode.commands.registerCommand('studioFixture.open',()=>openEditorGameStudio(context,agent)));
const connection=await agent.gameStudioConnection();await client.selectGameProject(connection.session.id,fixture.projectId);
let restarted=false;try{await readFile(path.join(root,'studio-restart.marker'));restarted=true;}catch(error){if(error.code!=='ENOENT')throw error;}if(!restarted)await openEditorGameStudio(context,agent);await writeFile(path.join(root,'ready.json'),JSON.stringify({version:vscode.version,processId:process.pid,sessionId:connection.session.id,workspace:fixture.workspace,extensionMode:context.extensionMode}));
}catch(error){await writeFile(path.join(root,'error.txt'),error.stack??error.message);throw error;}}
`;
  await esbuild.build({stdin:{contents:source,resolveDir:process.cwd(),loader:"ts"},outfile:path.join(extension,"extension.cjs"),bundle:true,platform:"node",format:"cjs",target:"node22",external:["vscode","playwright-core"],define:{__LOCAL_COMPANION_PROVIDER_VARIANT__:JSON.stringify("litellm")},logLevel:"silent"});
  const reserve=createServer();reserve.listen(0,"127.0.0.1");await once(reserve,"listening");const address=reserve.address();assert.ok(address&&typeof address==="object");const port=address.port;await new Promise((resolve)=>reserve.close(resolve));
  const initialReady=await launchOwnedCode(port),restarts=[];
  let frame=await studioFrame();await frame.getByRole("heading",{name:document.title,exact:true}).waitFor({timeout:20000});await frame.locator("#capture").waitFor({state:"visible",timeout:20000});
  const layout=await frame.evaluate(()=>({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,columns:getComputedStyle(document.querySelector("#studio")).gridTemplateColumns}));
  assert.ok(layout.scrollWidth<=layout.width,"the Studio must fit the real editor panel without horizontal overflow");
  if(layout.width<=920)assert.equal(layout.columns.trim().split(/\s+/).length,1,"the compact editor layout must preserve space for the project");
  assert.deepEqual(await frame.evaluate(()=>({require:typeof require,process:typeof process,acquire:typeof acquireVsCodeApi,studio:typeof window.gameStudioHost})),{require:"undefined",process:"undefined",acquire:"function",studio:"undefined"});
  await page.screenshot({path:path.join(output,"overview.png"),fullPage:true});
  await frame.locator('[data-tab="builds"]').click();await frame.locator("#workflow").getByText("Produção · Design",{exact:true}).waitFor();
  await frame.locator("#workflow").getByRole("button",{name:"Avançar etapa",exact:true}).click();await frame.locator("#workflow").getByText("Produção · Experiência central",{exact:true}).waitFor();
  assert.equal(await frame.locator("#workflow").getByRole("button",{name:"Avançar etapa",exact:true}).isDisabled(),true);
  assert.equal((await client.getGameWorkflow(project.id)).workflow.stage,"core");
  await page.screenshot({path:path.join(output,"workflow.png"),fullPage:true});
  await frame.locator('[data-tab="design"]').click();await frame.getByRole("button",{name:"Editar design",exact:true}).click();await frame.getByLabel("Premissa",{exact:true}).fill("A design saved through the real VS Code webview, with source and history preserved.");
  await frame.getByRole("button",{name:"Salvar design",exact:true}).click();await confirm();await frame.locator("#notice").filter({hasText:"Fixture lost committed editor design response"}).waitFor();assert.equal((await client.getGameProject(project.id)).revision,2);
  const originalDesignDispatch=await readFile(path.join(root,"design-dispatch.json"),"utf8"),designFrame=frame;
  await page.keyboard.press(process.platform==="darwin"?"Meta+w":"Control+w");await waitFor(()=>designFrame.isDetached(),"the disposed Studio panel",600);
  await page.keyboard.press(process.platform==="darwin"?"Meta+Shift+p":"Control+Shift+p");const openPicker=page.locator(".quick-input-widget input").first();await openPicker.waitFor({state:"visible"});await openPicker.fill(">Game Studio Fixture: Open");await page.getByRole("option",{name:/Game Studio Fixture: Open/}).click();
  frame=await studioFrame();await frame.getByRole("button",{name:"Retomar pedido",exact:true}).waitFor();assert.equal(await readFile(path.join(root,"design-dispatch.json"),"utf8"),originalDesignDispatch);
  // The old panel was recreated above. Now terminate the whole owned editor,
  // preserve the same Memento/profile/workspace, and reopen by explicit command.
  await writeFile(path.join(root,"studio-restart.marker"),"Explicit fixture reopen; no product serializer claimed");
  const firstCodePid=codeChild.pid;await stopOwnedCode();await browser.close().catch(()=>{});
  assert.equal((await client.getGameProject(project.id)).revision,2);
  const secondReady=await launchOwnedCode(port,initialReady.processId);assert.notEqual(codeChild.pid,firstCodePid);assert.notEqual(secondReady.processId,initialReady.processId);assert.equal(secondReady.sessionId,initialReady.sessionId);
  frame=await reopenStudio();await frame.locator('[data-tab="design"]').click();await frame.getByRole("button",{name:"Retomar pedido",exact:true}).waitFor();
  assert.equal(await frame.getByLabel("Premissa",{exact:true}).inputValue(),"A design saved through the real VS Code webview, with source and history preserved.");assert.equal(await frame.getByLabel("Premissa",{exact:true}).isDisabled(),true);assert.equal(await readFile(path.join(root,"design-dispatch.json"),"utf8"),originalDesignDispatch);
  restarts.push({kind:"frozen-design",firstCodePid,secondCodePid:codeChild.pid,firstExtensionPid:initialReady.processId,secondExtensionPid:secondReady.processId,sameSession:true,noAutomaticCommit:true});
  await page.screenshot({path:path.join(output,"whole-editor-frozen-design.png"),fullPage:true});
  await frame.getByRole("button",{name:"Retomar pedido",exact:true}).click();await frame.locator("#design-form").waitFor({state:"hidden"});await frame.locator("#notice").filter({hasText:"Pedido confirmado na revisão 2"}).waitFor();
  assert.equal(await page.getByRole("button",{name:/^Continuar$/}).isVisible(),false,"readback cannot request mutation confirmation");assert.equal(await readFile(path.join(root,"design-dispatch.json"),"utf8"),originalDesignDispatch);assert.equal((await client.getGameProject(project.id)).revision,2);
  await page.screenshot({path:path.join(output,"design.png"),fullPage:true});
  await frame.getByRole("button",{name:"Editar design",exact:true}).click();const unsent="An unsent design preserved after a complete editor process restart.";await frame.getByLabel("Premissa",{exact:true}).fill(unsent);await frame.waitForFunction(()=>document.querySelector("#draft-status").dataset.state==="saved");
  const secondCodePid=codeChild.pid;await stopOwnedCode();await browser.close().catch(()=>{});assert.equal((await client.getGameProject(project.id)).revision,2);
  const thirdReady=await launchOwnedCode(port,secondReady.processId);assert.notEqual(codeChild.pid,secondCodePid);assert.notEqual(thirdReady.processId,secondReady.processId);assert.equal(thirdReady.sessionId,initialReady.sessionId);
  frame=await reopenStudio();await frame.locator('[data-tab="design"]').click();assert.equal(await frame.getByLabel("Premissa",{exact:true}).inputValue(),unsent);assert.equal(await frame.getByLabel("Premissa",{exact:true}).isDisabled(),false);assert.equal(await readFile(path.join(root,"design-dispatch.json"),"utf8"),originalDesignDispatch);assert.equal((await client.getGameProject(project.id)).revision,2);
  restarts.push({kind:"unsent-design",firstCodePid:secondCodePid,secondCodePid:codeChild.pid,firstExtensionPid:secondReady.processId,secondExtensionPid:thirdReady.processId,sameSession:true,noAutomaticCommit:true});
  await page.screenshot({path:path.join(output,"whole-editor-unsent-design.png"),fullPage:true});await frame.locator("#cancel-design").click();await frame.locator("#design-form").waitFor({state:"hidden"});

  await frame.locator('[data-tab="history"]').click();await frame.locator("#revision-list .row").filter({hasText:"Revisão 1"}).getByRole("button",{name:"Restaurar"}).click();await confirm();await frame.waitForFunction(()=>document.querySelector("#revision").textContent.startsWith("Revisão 3"));
  await frame.locator('[data-tab="overview"]').click();await frame.getByRole("button",{name:"Jogar",exact:true}).first().click();await confirm();await frame.locator("#notice").filter({hasText:"Preview da revisão 1 aberto"}).waitFor({timeout:20000});
  await page.screenshot({path:path.join(output,"preview.png"),fullPage:true});
  await frame.getByRole("button",{name:"Exportar fonte",exact:true}).click();
  // The isolated profile selects VS Code's built-in custom folder picker. No
  // operating-system permission dialog or personal directory is automated.
  const picker=page.locator(".quick-input-widget input").first();await picker.waitFor({state:"visible",timeout:10000});await picker.fill(path.join(root,"exports")+path.sep);await picker.press("Enter");
  await frame.locator("#notice").filter({hasText:"Exportação concluída"}).waitFor({timeout:15000});const exported=await readdir(path.join(root,"exports"));assert.equal(exported.length,1);
  assert.equal(JSON.parse(await readFile(path.join(root,"exports",exported[0],"production.json"),"utf8")).snapshot.workflow.stage,"core");
  await frame.locator('[data-tab="assets"]').click();await frame.getByRole("button",{name:"Bibliotecas",exact:true}).click();
  await frame.getByLabel("Buscar recurso ou animação",{exact:true}).fill("walk");await frame.getByRole("button",{name:"Buscar",exact:true}).click();await frame.locator("#library-list .row").filter({hasText:"Character Soldier"}).waitFor();
  await frame.getByRole("button",{name:"Detalhes",exact:true}).click();await frame.getByLabel("Nome no projeto",{exact:true}).fill("VS Code licensed character");
  const originalFolder=await frame.getByLabel("Pasta no projeto",{exact:true}).inputValue();await frame.getByLabel("Pasta no projeto",{exact:true}).fill("../outside");
  await frame.getByRole("button",{name:"Preparar candidato",exact:true}).click();await frame.locator("#notice").filter({hasText:"Confira o recurso"}).waitFor();assert.equal(await frame.getByLabel("Nome no projeto",{exact:true}).isDisabled(),false);
  await frame.getByLabel("Pasta no projeto",{exact:true}).fill(originalFolder);await frame.getByRole("button",{name:"Preparar candidato",exact:true}).click();await confirm();
  await frame.locator("#notice").filter({hasText:"Fixture lost native library acknowledgment"}).waitFor();
  const jobsBeforeReload=(await client.listGameProduction(project.id)).jobs.filter(job=>job.kind==="assets");assert.equal(jobsBeforeReload.length,1);
  await page.keyboard.press(process.platform==="darwin"?"Meta+Shift+p":"Control+Shift+p");const reloadPicker=page.locator(".quick-input-widget input").first();await reloadPicker.waitFor({state:"visible"});await reloadPicker.fill(">Developer: Reload Webviews");await page.getByRole("option",{name:/Developer: Reload Webviews/}).click();const oldFrame=frame;await waitFor(()=>oldFrame.isDetached(),"the original webview frame to finish reloading",600);frame=await waitFor(async()=>{for(const current of page.frames()){try{if(await current.getByRole("button",{name:"Retomar pedido",exact:true}).isVisible())return current;}catch{}}return false;},"the reloaded webview and preserved library request",600);
  assert.equal(await frame.getByLabel("Nome no projeto",{exact:true}).isDisabled(),true);assert.equal(await frame.getByLabel("Nome no projeto",{exact:true}).inputValue(),"VS Code licensed character");
  assert.equal((await client.listGameProduction(project.id)).jobs.filter(job=>job.kind==="assets").length,1);
  await frame.getByRole("button",{name:"Retomar pedido",exact:true}).click();await confirm();await frame.locator("#library-import").waitFor({state:"hidden"});
  assert.equal((await client.listGameProduction(project.id)).jobs.find(job=>job.kind==="assets").id,jobsBeforeReload[0].id);

  const libraryJob=(await client.listGameProduction(project.id)).jobs.find(job=>job.assetSpec?.operation.type==="library.copy");assert.ok(libraryJob);await settled(libraryJob.id);assert.equal((await client.getGameProject(project.id)).revision,3);
  await frame.getByRole("button",{name:"Atualizar",exact:true}).click();await frame.locator("#candidate-list").getByRole("button",{name:"Revisar candidato",exact:true}).click();await frame.locator("#candidate-text").waitFor({state:"visible"});
  const libraryResult=await client.getGameAssetResult(libraryJob.id),notice=libraryResult.files.find(file=>file.path.endsWith("/License.txt"));
  assert.equal(await frame.locator("#candidate-text").textContent(),(await client.downloadGameAssetFile(libraryJob.id,notice.path)).toString("utf8"));
  await frame.getByRole("button",{name:"Inspecionar modelo 3D",exact:true}).click();await confirm();await frame.locator("#notice").filter({hasText:"Visor 3D aberto"}).waitFor({timeout:30000});
  assert.equal((await client.getGameProject(project.id)).revision,3,"editor model inspection cannot apply its candidate");
  await frame.locator("#candidate-text").scrollIntoViewIfNeeded();
  await page.screenshot({path:path.join(output,"library-license.png"),fullPage:true});
  await frame.getByRole("button",{name:"Aplicar ao projeto",exact:true}).click();await confirm();await frame.waitForFunction(()=>document.querySelector("#revision").textContent.startsWith("Revisão 4"));
  const library={jobId:libraryJob.id,fullLicenseSha256:notice.sha256,preparedWithoutApplication:true,knownInvalidInputEditable:true,lostAckAndRealWebviewStateRecoveredSameJob:true,explicitlyAppliedRevision:4,bridge:"Actual VS Code webview/host/controller and real custom confirmation; temporary engine connection"};
  await page.screenshot({path:path.join(output,"export.png"),fullPage:true});
  await frame.locator("#refresh").click();
  const playtests=await exerciseSyntheticPlaytest({scope:frame,confirm,title:"Native VS Code synthetic round"});
  await frame.locator("#export-playtest-summary").click();await confirm();
  const playtestPicker=page.locator(".quick-input-widget input").first();await playtestPicker.waitFor({state:"visible"});await playtestPicker.fill(path.join(root,"exports")+path.sep);await playtestPicker.press("Enter");
  await frame.locator("#notice").filter({hasText:"Exportação concluída"}).waitFor();
  const playtestExport=(await readdir(path.join(root,"exports"))).filter(name=>!exported.includes(name));assert.equal(playtestExport.length,1);
  assert.deepEqual(JSON.parse(await readFile(path.join(root,"exports",playtestExport[0],"playtest.json"),"utf8")).responses,[]);
  await page.screenshot({path:path.join(output,"playtests.png"),fullPage:true});
  const comparison=await exerciseRevisionComparison({scope:frame,targetRevision:4});await page.screenshot({path:path.join(output,"comparison.png"),fullPage:true});
  // The panel was already disposed/recreated above. A final Cmd+W may close the
  // entire workbench and strand its CDP key response. Stop and verify this owned
  // temporary process instead; then prove the independent service survived.
  await stopOwnedCode();assert.equal((await client.getGameProject(project.id)).revision,4);
  const ready=JSON.parse(await readFile(path.join(root,"ready.json"),"utf8"));
  const workflow=await client.getGameWorkflow(project.id);assert.equal(workflow.workflow.stage,"core");assert.equal(workflow.canAdvance,false);
  let nativeModel;
  if(modelEditing){
    await browser?.close().catch(()=>{});let modelReady=await launchOwnedCode(port,ready.processId);frame=await reopenStudio();
    const restart=async()=>{const former=modelReady.processId;await stopOwnedCode();await browser?.close().catch(()=>{});modelReady=await launchOwnedCode(port,former);assert.equal(modelReady.sessionId,initialReady.sessionId);frame=await reopenStudio();return frame;};
    nativeModel=(await exerciseNativeModelEditing({scope:frame,restart,client,projectId:project.id,confirm,deny:async()=>{const cancel=page.getByRole("button",{name:/^(Cancel|Cancelar)$/}).last();await cancel.waitFor();await cancel.click();},readDispatches:async()=>{try{return (await readFile(path.join(root,"model-dispatch.jsonl"),"utf8")).trim().split("\n").filter(Boolean).map(JSON.parse);}catch(error){if(error.code==="ENOENT")return [];throw error;}},capture:name=>page.screenshot({path:path.join(output,name),fullPage:true}),output})).result;
    await stopOwnedCode();
  }
  await writeFile(path.join(output,"evidence.json"),JSON.stringify({scope:"Actual VS Code and production DevelopmentAgent/EditorServiceRuntime/Studio classes; connection factory scoped to prestarted temporary engine, fresh profile and real custom dialogs; not installed VSIX or physical game acceptance",...ready,layout,engine:JSON.parse(await readFile(path.join(engine,"manifest.json"),"utf8")),projectId:project.id,revision:(await client.getGameProject(project.id)).revision,nativeModel,revisionBeforeModelEditing:4,workflow,library,comparison,playtests:{...playtests,summaryExportThroughNativeHost:true,nativeDialogsMocked:false},modelInspection:{actualNativeHost:true,firstFrameBeforeReturn:true,noAutomaticApplication:true},closure:{ownedEditorProcessStopped:true,serviceStillAvailable:true},wholeEditorRestarts:restarts,designReceipt:{panelRecreated:true,wholeEditorRestart:true,recoveredRevision:2,oneCommit:true,noAutomaticDispatch:true}},null,2));
  passed=true;
}catch(error){
  if(page)await page.screenshot({path:path.join(output,"failure.png"),fullPage:true}).catch(()=>{});
  if(page)for(const frame of page.frames())if(await frame.locator("#studio").count().catch(()=>0))await writeFile(path.join(output,"failure-ui.txt"),(await frame.locator("body").innerText()).slice(0,100000)).catch(()=>{});
  await writeFile(path.join(output,"failure.json"),JSON.stringify({error:error.message,frames:page?.frames().map((frame)=>({url:frame.url(),name:frame.name()})),codeLog:codeLogs},null,2));throw error;
}finally{
  try{await cp(path.join(root,"studio-commands.jsonl"),path.join(output,"studio-commands.jsonl"));}catch{}
  // CDP Browser.close alone can leave a windowless Mac Code process running;
  // end and verify the owned process group/Crashpad before removing its profile.
  await stopOwnedCode();await browser?.close().catch(()=>{});
  let idle=true;if(client)try{for(const project of (await client.listGameProjects()).projects)for(const job of (await client.listGameProduction(project.id)).jobs)if(!["completed","failed","cancelled"].includes(job.state))idle=false;}catch{idle=false;}
  client?.close();if(idle){if(engineChild.exitCode===null){const exited=once(engineChild,"exit");engineChild.kill("SIGTERM");await exited;}await rm(root,{recursive:true,force:true,maxRetries:3,retryDelay:100});}
  else{engineChild.unref();console.error(`Original service/unknown work preserved: ${root} pid=${engineChild.pid}`);}
}
if(passed){const file=path.join(output,"evidence.json"),evidence=JSON.parse(await readFile(file,"utf8"));await writeFile(file,JSON.stringify({...evidence,cleanupVerified:true,completedAt:Date.now()},null,2));console.log(`NATIVE_GAME_STUDIO_VSCODE_OK real webview bridge, scoped session, edit/restore, isolated preview, export and verified fixture shutdown ${output}`);}
