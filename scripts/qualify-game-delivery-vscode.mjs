// Actual production editor host/webview, isolated profile/workspace/service.
// Connection factory and one lost response are explicit fixtures, not an installer.
import assert from "node:assert/strict";
import { spawn,execFile } from "node:child_process";
import { promisify } from "node:util";
import { once } from "node:events";
import { mkdtemp,mkdir,readFile,writeFile,rm,cp,realpath,readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createServer } from "node:net";
import * as esbuild from "esbuild";
import {createHash,randomUUID} from "node:crypto";
import { chromium } from "playwright-core";
import security from "../dist-tests/packages/agent-service/src/security.js";
import storage from "../dist-tests/packages/agent-service/src/store.js";
import sdk from "../dist-tests/packages/client-ts/src/index.js";
import fixtures from "../dist-tests/test/game-fixtures.js";
import webFixtures from "../dist-tests/test/game-web-fixtures.js";
import bootstrap from "../dist-tests/packages/client-ts/src/bootstrap.js";

assert.equal(process.platform,'darwin');assert.equal(process.argv.length,4);assert.ok(process.argv[2].startsWith('--engine='));assert.ok(process.argv[3].startsWith('--input='));
const engine=path.resolve(process.argv[2].slice(9)),input=path.resolve(process.argv[3].slice(8));await bootstrap.verifyBundle(engine,undefined,true);
const executable=process.env.VSCODE_EXECUTABLE_PATH??'/Applications/Visual Studio Code.app/Contents/MacOS/Code';assert.ok(path.isAbsolute(executable));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const codec=JSON.parse(await readFile(path.join(input,'phaser/codec/menu.json'),'utf8')),master=await readFile(path.join(input,'phaser/build/assets/menu.wav')),aac=await readFile(path.join(input,'phaser/build/assets/menu.compact.m4a'));assert.equal(sha(master),codec.sourceSha256);assert.equal(sha(aac),codec.variants[0].sha256);
const root=await realpath(await mkdtemp('/private/tmp/delivery-code-')),state=path.join(root,'service'),workspace=path.join(root,'workspace'),extension=path.join(root,'fixture-extension'),profile=path.join(root,'profile'),output=path.resolve('output/playwright/game-delivery-native-vscode',new Date().toISOString().replace(/[:.]/g,'-')+'-'+randomUUID().slice(0,8));
assert.ok(Buffer.byteLength(profile)<=60,'Keep the private editor profile below macOS local socket path limits');
for(const folder of [state,workspace,extension,path.join(profile,'User'),path.join(root,'extensions'),path.join(root,'exports'),output])await mkdir(folder,{recursive:true,mode:0o700});
await writeFile(path.join(profile,'User/settings.json'),JSON.stringify({'telemetry.telemetryLevel':'off','update.mode':'none','extensions.autoUpdate':false,'extensions.autoCheckUpdates':false,'workbench.enableExperiments':false,'workbench.startupEditor':'none','window.dialogStyle':'custom','files.simpleDialog.enable':true,'security.workspace.trust.enabled':false,'git.autofetch':false,'localAgentCompanion.autonomyMode':'review'}));
await writeFile(path.join(workspace,'README.md'),'# Private native delivery qualification\nNo personal settings or model calls.\n');
const env={HOME:root,PATH:'/usr/bin:/bin',TMPDIR:tmpdir(),LANG:'en_US.UTF-8'};
const credential=await security.createClientCredential(state,{id:'native-delivery-editor',product:'companion-vscode',profile:'default',workspace,providers:['litellm'],hostTools:[]}),identity=await security.ensureIdentity(state),store=new storage.Store(path.join(state,'metadata.sqlite'));store.register(credential);store.close();
const engineChild=spawn(path.join(engine,'node'),[path.join(engine,'service.cjs'),state],{env,stdio:['ignore','pipe','pipe']});let codeChild,browser,page,client,project,engineLogs='',codeLogs='',passed=false;const lifecycle=[];
engineChild.stdout.on('data',data=>{engineLogs=(engineLogs+data).slice(-50000);});engineChild.stderr.on('data',data=>{engineLogs=(engineLogs+data).slice(-50000);});
const save=async(name,value)=>writeFile(path.join(output,name),JSON.stringify(value,null,2)+'\n');
// Owned process helpers retain the established exact private group/crashpad checks.
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
  codeChild=spawn(executable,[workspace,"--new-window",`--user-data-dir=${profile}`,`--extensions-dir=${path.join(root,"extensions")}`,`--extensionDevelopmentPath=${extension}`,"--disable-extensions","--skip-welcome","--skip-release-notes","--use-inmemory-secretstorage",`--remote-debugging-port=${port}`,"--remote-debugging-address=127.0.0.1"],{detached:process.platform!=="win32",stdio:["ignore","pipe","pipe"],env:{...env,STUDIO_FIXTURE_ROOT:root}});
  codeChild.stdout.on("data",(data)=>{codeLogs=(codeLogs+data).slice(-100000);});codeChild.stderr.on("data",(data)=>{codeLogs=(codeLogs+data).slice(-100000);});
  const endpoint=await waitFor(async()=>{if(codeChild.exitCode!==null)throw new Error(`VS Code exited ${codeChild.exitCode}: ${codeLogs}`);try{const response=await fetch(`http://127.0.0.1:${port}/json/version`,{signal:AbortSignal.timeout(500)});if(!response.ok)return false;return (await response.json()).webSocketDebuggerUrl;}catch{return false;}},"the owned Code renderer debugger",600);
  browser=await chromium.connectOverCDP(endpoint);const diagnostic=await browser.newBrowserCDPSession();await save('startup-targets-'+codeChild.pid+'.json',{browserVersion:browser.version(),targets:await diagnostic.send('Target.getTargets')});await diagnostic.detach();page=await waitFor(()=>browser.contexts().flatMap((context)=>context.pages()).find((candidate)=>candidate.url().includes("workbench")),"the owned Code workbench");
  return waitFor(async()=>{try{const error=await readFile(path.join(root,"error.txt"),"utf8");throw new Error(error);}catch(error){if(error.code!=="ENOENT")throw error;}try{const ready=JSON.parse(await readFile(path.join(root,"ready.json"),"utf8"));return ready.processId!==previousExtensionPid?ready:false;}catch{return false;}},"the new fixture extension process activation",600);
}
async function reopenStudio(){
  await page.keyboard.press(process.platform==="darwin"?"Meta+Shift+p":"Control+Shift+p");const picker=page.locator(".quick-input-widget input").first();await picker.waitFor({state:"visible"});await picker.fill(">Game Studio Fixture: Open");await page.getByRole("option",{name:/Game Studio Fixture: Open/}).click();return studioFrame();
}
async function shutdown(){if(codeChild){const pid=codeChild.pid;await stopOwnedCode();lifecycle.push({pid,ownedProcessGroupAndPrivateCrashpadStopped:true});codeChild=undefined;}await browser?.close().catch(()=>{});browser=undefined;}
try{
 await waitFor(async()=>{if(engineChild.exitCode!==null)throw Error(engineLogs);try{return JSON.parse(await readFile(path.join(state,'runtime.json'),'utf8')).pid===engineChild.pid;}catch{return false;}},'the exact isolated engine',600);
 client=new sdk.AgentClient({address:security.ipcPath(state),certificate:identity.cert,credential});await client.connect();
 const document=fixtures.fixtureGameDocument();document.title='Distribuição nativa · VS Code';
 for(const [name,text]of webFixtures.webFixture('phaser'))document.files.push(await client.uploadGameFile(name,Buffer.from(text),name.endsWith('.json')?'application/json':'text/plain'));
 for(const [name,bytes,mime]of [['assets/menu.wav',master,'audio/wav'],['assets/menu.compact.m4a',aac,'audio/mp4'],['assets/NOTICE.txt',Buffer.from('Full synthetic fixture notice, not finished music.'),'text/plain'],['assets/menu.encoded.json',Buffer.from(JSON.stringify(codec)),'application/json'],['data/levels.json',Buffer.from('{"rounds":[1,2,3]}'),'application/json']])document.files.push(await client.uploadGameFile(name,bytes,mime));
 const origin={kind:'procedural',source:'Acknowledged real-codec synthetic fixture',author:'Qualification',license:'Declared-unverified synthetic input',referenceIds:[]};document.assets=[{id:'master',kind:'audio',role:'Master',placeholder:true,files:['assets/menu.wav','assets/NOTICE.txt'],origin},{id:'variant',kind:'audio',role:'AAC',placeholder:true,files:['assets/menu.compact.m4a','assets/menu.encoded.json'],origin:{...origin,referenceIds:['master']}}];
 project=await client.createGameProject('native-source',document);
 await writeFile(path.join(root,'fixture.json'),JSON.stringify({credential,certificate:identity.cert,address:security.ipcPath(state),workspace,projectId:project.id}),{mode:0o600});
 for(const folder of ['game-studio','game-model-runtime'])await cp(path.join('dist',folder),path.join(extension,'dist',folder),{recursive:true});await cp('dist/node_modules/playwright-core',path.join(extension,'node_modules/playwright-core'),{recursive:true});
 for(const name of ['index.html','studio.js','studio.css'])assert.equal(sha(await readFile(path.join(extension,'dist/game-studio',name))),sha(await readFile(path.join('packages/game-studio-ui',name))));
 await writeFile(path.join(extension,'package.json'),JSON.stringify({name:'game-delivery-native-fixture',displayName:'Game Delivery Native Fixture',publisher:'local-suite-tests',version:'0.0.0',private:true,engines:{vscode:'^1.106.0'},activationEvents:['onStartupFinished'],main:'./extension.cjs',contributes:{commands:[{command:'studioFixture.open',title:'Game Studio Fixture: Open'}],configuration:{properties:{'localAgentCompanion.autonomyMode':{type:'string',enum:['plan','review','auto'],default:'review'}}}}}));
 const source=`import * as vscode from 'vscode';import {readFile,writeFile,appendFile} from 'node:fs/promises';import path from 'node:path';
import {DevelopmentAgent} from ${JSON.stringify(path.resolve('src/agent.ts'))};
import {EditorServiceRuntime} from ${JSON.stringify(path.resolve('src/service-runtime.ts'))};
import {ContextCollector} from ${JSON.stringify(path.resolve('src/context.ts'))};
import {ProjectMemory} from ${JSON.stringify(path.resolve('src/memory.ts'))};
import {ChangeReviewManager} from ${JSON.stringify(path.resolve('src/change-review.ts'))};
import {openEditorGameStudio} from ${JSON.stringify(path.resolve('src/game-studio.ts'))};
import {AgentClient} from ${JSON.stringify(path.resolve('packages/client-ts/src/index.ts'))};
export async function activate(context){const root=process.env.STUDIO_FIXTURE_ROOT;try{const f=JSON.parse(await readFile(path.join(root,'fixture.json'),'utf8')),client=new AgentClient({address:f.address,certificate:f.certificate,credential:f.credential});await client.connect();
const upload=client.uploadGameFile.bind(client);client.uploadGameFile=async(...args)=>{const result=await upload(...args);await appendFile(path.join(root,'upload-actions.jsonl'),JSON.stringify({path:args[0]})+'\\n');return result;};
const commit=client.commitGameRevision.bind(client);client.commitGameRevision=async(...args)=>{const result=await commit(...args);await appendFile(path.join(root,'delivery-dispatch.jsonl'),JSON.stringify({requestId:args[1],revision:result.revision})+'\\n');let lose=false;try{await readFile(path.join(root,'lost-delivery.marker'));}catch(e){if(e.code!=='ENOENT')throw e;lose=true;}if(lose){await writeFile(path.join(root,'lost-delivery.marker'),'committed');throw Error('Fixture lost editor delivery response');}return result;};
const runtime=new EditorServiceRuntime(context);runtime.connect=async(workspace,catalog=[])=>{if(workspace!==f.workspace||catalog.length||!client.connected)throw Error('Fixture engine scope unavailable; no installer may run');return client;};
const review=new ChangeReviewManager(),agent=new DevelopmentAgent(context,new ContextCollector(),new ProjectMemory(),review,runtime);
context.subscriptions.push(agent,review,{dispose:()=>client.close()},vscode.commands.registerCommand('studioFixture.open',()=>openEditorGameStudio(context,agent)));
const connection=await agent.gameStudioConnection();await client.selectGameProject(connection.session.id,f.projectId);let restarted=false;try{await readFile(path.join(root,'studio-restart.marker'));restarted=true;}catch(e){if(e.code!=='ENOENT')throw e;}if(!restarted)await openEditorGameStudio(context,agent);
await writeFile(path.join(root,'ready.json'),JSON.stringify({version:vscode.version,processId:process.pid,sessionId:connection.session.id,extensionMode:context.extensionMode,autonomyMode:vscode.workspace.getConfiguration('localAgentCompanion').get('autonomyMode')}));
}catch(error){await writeFile(path.join(root,'error.txt'),error.stack??error.message);throw error;}}
`;
 await esbuild.build({stdin:{contents:source,resolveDir:process.cwd(),loader:'ts'},outfile:path.join(extension,'extension.cjs'),bundle:true,platform:'node',format:'cjs',target:'node22',external:['vscode','playwright-core'],define:{__LOCAL_COMPANION_PROVIDER_VARIANT__:JSON.stringify('litellm')},logLevel:'silent'});
 const reserve=createServer();reserve.listen(0,'127.0.0.1');await once(reserve,'listening');const address=reserve.address();assert.ok(address&&typeof address==='object');const port=address.port;await new Promise(resolve=>reserve.close(resolve));
 await save('control.json',{manifestSha256:sha(await readFile(path.join(engine,'manifest.json'))),observerSha256:sha(await readFile(new URL(import.meta.url))),nativeHostSha256:sha(await readFile('src/game-studio.ts')),ownedServicePid:engineChild.pid,credentialExported:false,modelCalls:0});
 const first=await launchOwnedCode(port);let frame=await studioFrame();await frame.getByRole('heading',{name:document.title,exact:true}).waitFor();assert.deepEqual(await frame.evaluate(()=>({require:typeof require,process:typeof process,acquire:typeof acquireVsCodeApi,studio:typeof window.gameStudioHost})),{require:'undefined',process:'undefined',acquire:'function',studio:'undefined'});
 await frame.getByRole('button',{name:'Recursos do build',exact:true}).click();await frame.getByLabel('Arquivos do build',{exact:true}).selectOption('selected');await frame.getByRole('button',{name:'Desmarcar todos',exact:true}).click();await frame.getByRole('checkbox',{name:'assets/menu.compact.m4a',exact:true}).check();await frame.getByRole('checkbox',{name:'data/levels.json',exact:true}).check();await frame.getByLabel('Filtrar arquivos',{exact:true}).fill('menu');await frame.locator('#draft-status[data-state="saved"]').waitFor();await page.screenshot({path:path.join(output,'unsent.png'),fullPage:true});
 await writeFile(path.join(root,'studio-restart.marker'),'Explicit reopen only, no product serializer claimed');await shutdown();assert.equal((await client.getGameProject(project.id)).revision,1);assert.equal(engineChild.exitCode,null);
 const second=await launchOwnedCode(port,first.processId);assert.notEqual(second.processId,first.processId);assert.equal(second.sessionId,first.sessionId);frame=await reopenStudio();await frame.locator('#delivery-fields:not([disabled])').waitFor();assert.equal(await frame.getByLabel('Filtrar arquivos',{exact:true}).inputValue(),'menu');assert.equal(await frame.getByRole('checkbox',{name:'assets/menu.compact.m4a',exact:true}).isChecked(),true);assert.equal(await frame.getByRole('checkbox',{name:'assets/menu.wav',exact:true}).isChecked(),false);
 await frame.getByRole('button',{name:'Salvar recursos',exact:true}).click();await confirm();await frame.locator('#notice').filter({hasText:'Fixture lost editor delivery response'}).waitFor();assert.equal((await client.getGameProject(project.id)).revision,2);const dispatches=await readFile(path.join(root,'delivery-dispatch.jsonl'),'utf8');assert.equal(dispatches.trim().split('\n').length,1);const uploads=await readFile(path.join(root,'upload-actions.jsonl'),'utf8');
 await shutdown();const later=await client.getGameRevision(project.id);later.document.title='Distribuição nativa · trabalho posterior';await client.commitGameRevision(project.id,'later-work',2,later.document,'Preserve later work');await mkdir(path.join(workspace,'.vscode'),{recursive:true});await writeFile(path.join(workspace,'.vscode/settings.json'),JSON.stringify({'localAgentCompanion.autonomyMode':'plan'}));assert.equal(engineChild.exitCode,null);
 const third=await launchOwnedCode(port,second.processId);assert.notEqual(third.processId,second.processId);assert.equal(third.sessionId,first.sessionId);assert.equal(third.autonomyMode,'plan');frame=await reopenStudio();await frame.getByRole('button',{name:'Conferir pedido',exact:true}).waitFor();assert.equal(await frame.getByLabel('Arquivos do build',{exact:true}).isDisabled(),true);assert.equal(await readFile(path.join(root,'delivery-dispatch.jsonl'),'utf8'),dispatches);
 await frame.getByRole('button',{name:'Conferir pedido',exact:true}).click();await frame.locator('#delivery-editor').waitFor({state:'hidden'});assert.equal((await client.getGameProject(project.id)).revision,3);assert.equal(await readFile(path.join(root,'delivery-dispatch.jsonl'),'utf8'),dispatches);assert.equal(await readFile(path.join(root,'upload-actions.jsonl'),'utf8'),uploads);assert.equal(await page.getByRole('button',{name:/^Continuar$/}).isVisible(),false);await page.screenshot({path:path.join(output,'recovered-plan.png'),fullPage:true});
 await frame.getByRole('button',{name:'Exportar fonte',exact:true}).click();const picker=page.locator('.quick-input-widget input').first();await picker.waitFor({state:'visible',timeout:10000});await picker.fill(path.join(root,'exports')+path.sep);await picker.press('Enter');await frame.locator('#notice').filter({hasText:'Exportação concluída'}).waitFor({timeout:15000});const exports=await readdir(path.join(root,'exports'));assert.equal(exports.length,1);await cp(path.join(root,'exports',exports[0]),path.join(output,'exported-source'),{recursive:true});assert.equal(sha(await client.downloadGameFile(project.id,'assets/menu.wav')),sha(master));assert.equal((await client.getGameQuality(project.id)).ready,false);
 const layout=await frame.evaluate(()=>({width:innerWidth,scrollWidth:document.documentElement.scrollWidth}));assert.ok(layout.scrollWidth<=layout.width);await shutdown();assert.equal(engineChild.exitCode,null);assert.equal((await client.getGameProject(project.id)).revision,3);
 await save('report.json',{scope:'Real production VS Code webview/host, DevelopmentAgent and EditorServiceRuntime; private profile/workspace/file drafts and temporary service. Connection factory and lost response are fixtures. Not installed extension, physical/human/game or rollback acceptance.',manifestSha256:sha(await readFile(path.join(engine,'manifest.json'))),product:'companion-vscode',projectId:project.id,processes:[first,second,third],lifecycle,sameSession:true,independentServicePid:engineChild.pid,serviceSurvivedHostRestarts:true,unsentDraftRecovered:true,frozenDraftRecovered:true,planModeReceiptWithoutConsentUploadOrCommit:true,newDeliveryDispatches:1,laterRevision:3,laterTitlePreserved:true,nativeSourceExport:true,masterPreserved:true,layout,qualityApproved:false,modelCalls:0});passed=true;console.log('NATIVE_DELIVERY_VSCODE_QUALIFIED '+output);
}catch(error){await writeFile(path.join(root,'private-code-startup.log'),codeLogs,{mode:0o600});await save('failure.json',{message:error.message,ownedServicePid:engineChild.pid,ownedCodePid:codeChild?.pid,lifecycle});if(page)try{await page.screenshot({path:path.join(output,'failure.png'),fullPage:true});}catch{}throw error;}
finally{
 await shutdown();client?.close();if(engineChild.exitCode===null){const end=once(engineChild,'exit');engineChild.kill('SIGTERM');await end;}await save('closure.json',{serviceExitCode:engineChild.exitCode,editorLifecycle:lifecycle});
 if(passed){assert.equal(engineChild.exitCode,0);await rm(root,{recursive:true,force:true});}else console.error('Original failed fixture preserved: '+root);
}
