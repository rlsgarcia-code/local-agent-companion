// Shared UI + exact packaged engine over real IPC. Bridge emulation is not
// evidence of an installed Electron app or a physical VS Code webview.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { mkdtemp,mkdir,readFile,writeFile,rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright-core";
import { PNG } from "pngjs";
import security from "../dist-tests/packages/agent-service/src/security.js";
import storage from "../dist-tests/packages/agent-service/src/store.js";
import sdk from "../dist-tests/packages/client-ts/src/index.js";
import studio from "../dist-tests/packages/client-ts/src/game-studio.js";
import draftModule from "../dist-tests/packages/client-ts/src/game-studio-drafts.js";
import exporter from "../dist-tests/packages/client-ts/src/game-export.js";
import previewModule from "../dist-tests/packages/adapter-game-browser/src/preview.js";
import browserModule from "../dist-tests/packages/adapter-game-browser/src/browser.js";
import pixels from "../dist-tests/packages/adapter-game-browser/src/pixels.js";
import fixtures from "../dist-tests/test/game-fixtures.js";
import webFixtures from "../dist-tests/test/game-web-fixtures.js";
import vectors from "../dist-tests/test/game-vector-fixtures.js";
import {qualifyAudioEditor} from "./qualify-game-audio-editor.mjs";

const vectorFormat=process.argv.find(value=>value.startsWith('--vector-format='))?.slice('--vector-format='.length)??'svg';
const audioEditing=process.argv.includes('--audio-editing');
assert.ok(['svg','png'].includes(vectorFormat),'Select --vector-format=svg or --vector-format=png.');

const state=await mkdtemp(path.join(tmpdir(),"companion-studio-")),engine=path.resolve("engine-dist"),output=path.resolve("output/playwright/game-studio/runs",`${new Date().toISOString().replace(/[:.]/g,"-")}-${randomUUID().slice(0,8)}`);
const identity=await security.ensureIdentity(state),store=new storage.Store(path.join(state,"metadata.sqlite")),credentials=[];
for(const product of ["companion-mac","companion-vscode"]){const credential=await security.createClientCredential(state,{id:`studio-${product}`,product,profile:"fixture",workspace:"",providers:["ollama"],hostTools:[]});store.register(credential);credentials.push(credential);}store.close();
const child=spawn(path.join(engine,process.platform==="win32"?"node.exe":"node"),[path.join(engine,"service.cjs"),state],{stdio:["ignore","pipe","pipe"]});
let logs="",browser;const clients=[],results=[];child.stdout.on("data",(data)=>{logs=(logs+data).slice(-100000);});child.stderr.on("data",(data)=>{logs=(logs+data).slice(-100000);});
const tick=()=>new Promise((resolve)=>setTimeout(resolve,25));
let inferenceRequests=0;
const inferenceServer=createServer(async(request,response)=>{
  try{
    if(request.method!=="POST"||request.url!=="/v1/chat/completions"){response.writeHead(404);response.end();return;}
    let data="";for await(const chunk of request){data+=chunk;if(Buffer.byteLength(data)>1024*1024)throw new Error("Fixture request too large");}
    const body=JSON.parse(data);inferenceRequests++;
    const text="Read-only synthetic project inspection; no tools were executed.",usage={prompt_tokens:7,completion_tokens:3,total_tokens:10};
    if(!body.stream){response.writeHead(200,{"content-type":"application/json"});response.end(JSON.stringify({id:"studio-fixture",object:"chat.completion",choices:[{index:0,message:{role:"assistant",content:text},finish_reason:"stop"}],usage}));return;}
    response.writeHead(200,{"content-type":"text/event-stream"});
    for(const value of [{id:"studio-fixture",object:"chat.completion.chunk",choices:[{index:0,delta:{role:"assistant",content:text},finish_reason:null}]},
      {id:"studio-fixture",object:"chat.completion.chunk",choices:[{index:0,delta:{},finish_reason:"stop"}],usage}])response.write(`data: ${JSON.stringify(value)}\n\n`);
    response.end("data: [DONE]\n\n");
  }catch{response.writeHead(500);response.end("Synthetic fixture failure");}
});
async function settled(client,id){for(let i=0;i<2400;i++){const job=await client.getGameProduction(id);if(!["queued","running","cancelling"].includes(job.state)){assert.equal(job.state,"completed",job.error);return job;}await tick();}throw new Error("Studio job did not settle");}
async function projectJobs(client,projectId){const jobs=[],seen=new Set();for(let cursor=0;;){assert.ok(!seen.has(cursor),"Job pagination must not repeat a cursor");seen.add(cursor);const page=await client.listGameProduction(projectId,cursor,30,"desc");jobs.push(...page.jobs);if(!page.hasMore){assert.equal(new Set(jobs.map(job=>job.id)).size,jobs.length,"Job pages must not duplicate identities");return jobs;}assert.notEqual(page.cursor,cursor,"Job pagination must advance");cursor=page.cursor;}}
try{
  inferenceServer.listen(0,"127.0.0.1");await once(inferenceServer,"listening");const address=inferenceServer.address();assert.ok(address&&typeof address==="object");
  const inferenceEndpoint=`http://127.0.0.1:${address.port}/v1`;
  await mkdir(output,{recursive:true});
  for(let i=0;i<600;i++){if(child.exitCode!==null)throw new Error(logs);try{if(JSON.parse(await readFile(path.join(state,"runtime.json"),"utf8")).pid===child.pid)break;}catch{}await tick();}
  const qualified=await browserModule.qualifyBrowser();assert.ok(qualified,"Qualified Chromium required for UI acceptance");
  browser=await chromium.launch({executablePath:qualified.executablePath,headless:true,chromiumSandbox:true});
  for(const [index,credential] of credentials.entries()){
    const product=credential.registration.product,client=new sdk.AgentClient({address:security.ipcPath(state),certificate:identity.cert,credential});clients.push(client);await client.connect();
    const session=await client.call("sessions.create",{title:`Studio ${product}`}),document=fixtures.fixtureGameDocument();document.title=product==="companion-mac"?"Gravity Garden":"Gravity Garden · Editor";
    const source=webFixtures.webFixture("phaser");source.set("data/playtests.json",JSON.stringify({schemaVersion:1,scenarios:[{id:"fixture-movement",steps:[{action:"wait",ms:200},{action:"capture",name:"before"},{action:"press",key:"Space"},{action:"wait",ms:100},{action:"expect-image",baseline:"before",comparison:"changed",threshold:0.001}]}]}));
    for(const [name,text] of source)document.files.push(await client.uploadGameFile(name,Buffer.from(text),"text/plain"));
    const image=new PNG({width:64,height:64});for(let y=0;y<64;y++)for(let x=0;x<64;x++)if((x-32)**2+(y-32)**2<24**2)image.data.set([242,190,100,255],(y*64+x)*4);
    const file=await client.uploadGameFile("assets/seed.png",PNG.sync.write(image),"image/png");document.files.push(file);document.assets.push({id:"seed",kind:"sprite",role:"Seed · integration fixture",files:[file.path],placeholder:true,origin:{kind:"procedural",source:"Local fixture geometry; not final artwork",author:"Companion test",license:"Local fixture; no external library",referenceIds:[]}});
    const project=await client.createGameProject("fixture",document);await client.selectGameProject(session.id,project.id);
    const run=await client.call("runs.start",{sessionId:session.id,key:"metered-inspection",spec:{runtime:"standard",mode:"plan",provider:{kind:"ollama",endpoint:inferenceEndpoint,roles:{executor:"studio-fixture"}},
      messages:[{role:"user",content:"Read-only simulated inspection; no tool calls"}],systemPrompt:"Inspect only; all inference is simulated by the private fixture.",tools:[]}});
    for(let attempt=0;;attempt++){const current=await client.call("runs.get",{id:run.id});if(["completed","failed"].includes(current.state)){assert.equal(current.state,"completed",current.error);break;}assert.ok(attempt<600,"Metered fixture did not settle");await tick();}
    const inference=await client.getInferenceBudgets(session.id);for(const budget of inference.budgets){assert.equal(budget.calls,1);assert.equal(budget.chargedTokens,10);assert.equal(budget.pendingCalls,0);}
    const build=await client.startGameBuild("build",project.id,1);await settled(client,build.id);
    const validation=await client.startGameValidation("observe",build.id,"web-browser-runtime-v1");await settled(client,validation.id);
    const exports=path.join(state,`exports-${index}`);await mkdir(exports);let approvals=0,played=0,exported=0,approvalAllowed=true,lastSourceExport,lastCandidateExport,candidateExportAllowed=false;
    const controller=new studio.GameStudioController(client,session.id,{canWrite:()=>true,approve:async()=>{approvals++;return approvalAllowed;},
      preview:async(artifact,readFile)=>{
        const abort=new AbortController(),preview=await previewModule.openGamePreview({artifact,readFile,signal:abort.signal,headless:true});
        try{const canvas=preview.page.locator("canvas").first();await canvas.waitFor();await preview.page.waitForTimeout(150);const before=await canvas.screenshot();await preview.page.keyboard.press("Space");await preview.page.waitForTimeout(100);assert.ok(pixels.imageDifference(before,await canvas.screenshot())>0.001);played++;}finally{abort.abort();await preview.close();}
      },
      exportSource:async(projectId,revision)=>{lastSourceExport=await exporter.exportGameDirectory({client,parent:exports,source:{projectId,revision}});exported++;return true;},
      exportAsset:async(jobId)=>{if(!candidateExportAllowed)return false;lastCandidateExport=await exporter.exportGameDirectory({client,parent:exports,candidate:{jobId}});exported++;return true;},
      exportBuild:async(artifact)=>{await exporter.exportGameDirectory({client,parent:exports,artifact});exported++;return true;}});
    const context=await browser.newContext({viewport:{width:index?740:1200,height:900},colorScheme:index?"dark":"light"}),page=await context.newPage(),errors=[];page.on("pageerror",(error)=>errors.push(error.message));
    let transportDown=false,loseImageAck=true,loseVectorAck=true;const designRequests=[],imageRequests=[],vectorRequests=[];
    let draftData;const drafts=new draftModule.GameStudioDraftStore(`fixture-${product}-${session.id}`,{read:async()=>draftData,write:async value=>{draftData=structuredClone(value);}});
    await page.exposeFunction("__studioRequest",async(command)=>{
      if(drafts.handles(command))return drafts.dispatch(command);
      if(transportDown)throw new Error("Fixture link unavailable; saved work preserved");
      const record=command.action==="design"?{projectId:command.projectId,error:null}:null;if(record)designRequests.push(record);
      try{
        const value=await controller.dispatch(command);
        if(command.action==="adjust-image"&&value?.requestedAssetJobId){imageRequests.push({requestId:command.requestId,jobId:value.requestedAssetJobId});if(loseImageAck){loseImageAck=false;throw new Error("Fixture lost image acknowledgment; original job preserved");}}
        if(command.action==="adjust-vector"&&value?.requestedAssetJobId){vectorRequests.push({requestId:command.requestId,jobId:value.requestedAssetJobId});if(loseVectorAck){loseVectorAck=false;throw new Error("Fixture lost vector acknowledgment; original job preserved");}}
        return value;
      }catch(error){if(record)record.error=error.message;throw error;}
    });
    await page.addInitScript(({editor})=>{
      if(!editor)window.gameStudioHost={request:(command)=>window.__studioRequest(command)};
      else window.acquireVsCodeApi=()=>({postMessage:(message)=>{window.__studioRequest(message.command).then((value)=>window.postMessage({type:"game-studio-response",id:message.id,value},"*")).catch((error)=>window.postMessage({type:"game-studio-response",id:message.id,error:error.message},"*"));}});
    },{editor:index===1});
    await page.goto(pathToFileURL(path.resolve(index?"dist/game-studio/index.html":"desktop-dist/game-studio/index.html")).href);
    await page.getByRole("heading",{name:document.title,exact:true}).waitFor({timeout:15000});await page.locator("#capture").waitFor({state:"visible",timeout:15000});
    await page.screenshot({path:path.join(output,`${product}-overview.png`),fullPage:true});
    await page.locator('[data-tab="builds"]').click();await page.locator("#workflow").getByText("Produção · Design",{exact:true}).waitFor();
    assert.match(await page.locator("#workflow").innerText(),/IA · Ambiente compartilhado[\s\S]*1 de 512 chamadas/);
    await page.locator("#workflow").getByRole("button",{name:"Avançar etapa",exact:true}).click();await page.locator("#workflow").getByText("Produção · Experiência central",{exact:true}).waitFor();
    assert.equal(await page.locator("#workflow").getByRole("button",{name:"Avançar etapa",exact:true}).isDisabled(),true,"boot/pixel evidence does not certify controls or an entire core stage");
    if(index===0){
      const allocation=(await client.getGameWorkflow(project.id)).budget.authorizedRequests;
      for(let i=0;i<allocation;i++){const requested=await client.startGameBuild(`stage-budget-${i}`,project.id,1);await settled(client,requested.id);}
      await page.getByRole("button",{name:"Atualizar",exact:true}).click();await page.locator("#workflow").getByRole("button",{name:"Autorizar continuação",exact:true}).waitFor();
      await page.screenshot({path:path.join(output,`${product}-budget.png`),fullPage:true});
      await page.locator("#workflow").getByRole("button",{name:"Autorizar continuação",exact:true}).click();
      await page.waitForFunction(()=>!document.querySelector("#workflow").textContent.includes("Autorizar continuação"));
      assert.equal((await client.getGameWorkflow(project.id)).budget.authorizedRequests,allocation*2);
    }
    await page.screenshot({path:path.join(output,`${product}-workflow.png`),fullPage:true});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,"production state must fit the client viewport");
    await page.locator('[data-tab="overview"]').click();
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,"UI must fit the client viewport");
    await page.getByRole("button",{name:"Jogar",exact:true}).first().click();await page.locator("#notice").filter({hasText:"Preview da revisão 1 aberto"}).waitFor({timeout:15000});assert.equal(played,1);
    await page.locator('[data-tab="assets"]').click();await page.getByRole("button",{name:"Inspecionar",exact:true}).click();await page.locator("#asset-image").waitFor({state:"visible"});
    assert.match(await page.locator("#asset-provenance").innerText(),/Local fixture; no external library/);
    await page.screenshot({path:path.join(output,`${product}-assets.png`),fullPage:true});
    await page.locator('[data-tab="design"]').click();await page.getByRole("button",{name:"Editar design",exact:true}).click();
    await page.getByLabel("Premissa",{exact:true}).fill("Guide a seed across floating gardens with changing gravity and visible checkpoints.");
    const other=await client.createGameProject("other-project",{...document,title:"Other isolated project"});await client.selectGameProject(session.id,other.id);
    await page.getByRole("button",{name:"Atualizar",exact:true}).click();await page.getByRole("heading",{name:"Other isolated project",exact:true}).waitFor();
    await page.waitForFunction(()=>!document.querySelector("#refresh").classList.contains("loading"));
    assert.equal(await page.getByRole("button",{name:"Salvar design",exact:true}).isDisabled(),true,"stale selection must prevent UI dispatch");
    assert.equal(designRequests.length,0);assert.equal((await client.getGameProject(other.id)).revision,1);
    await client.selectGameProject(session.id,project.id);await page.getByRole("button",{name:"Atualizar",exact:true}).click();await page.getByRole("heading",{name:document.title,exact:true}).waitFor();
    await page.waitForFunction(()=>!document.querySelector("#refresh").classList.contains("loading"));
    await page.getByRole("button",{name:"Salvar design",exact:true}).click();await page.waitForFunction(()=>document.querySelector("#revision").textContent.startsWith("Revisão 2"));assert.equal(designRequests.length,1);assert.equal(designRequests[0].projectId,project.id);assert.equal(designRequests[0].error,null);
    await page.locator('[data-tab="history"]').click();const restore=page.locator("#revision-list .row").filter({hasText:"Revisão 1"}).getByRole("button",{name:"Restaurar"});await restore.click();
    await page.waitForFunction(()=>document.querySelector("#revision").textContent.startsWith("Revisão 3"));await page.screenshot({path:path.join(output,`${product}-history.png`),fullPage:true});
    await page.locator('[data-tab="overview"]').click();await page.getByRole("button",{name:"Exportar fonte",exact:true}).click();await page.locator("#notice").filter({hasText:"Exportação concluída"}).waitFor();
    await page.getByRole("button",{name:"Exportar build",exact:true}).click();await page.locator("#notice").filter({hasText:"Exportação concluída"}).waitFor();assert.equal(exported,2);
    assert.match(await page.locator("#build-note").innerText(),/mesma fonte, gerado em outra revisão/);assert.equal((await client.getGameQuality(project.id)).ready,false);
    await page.evaluate(()=>{window.__noticeChanges=0;new MutationObserver(()=>window.__noticeChanges++).observe(document.querySelector("#notice"),{childList:true,characterData:true,subtree:true});});
    transportDown=true;await page.getByRole("button",{name:"Atualizar",exact:true}).click();await page.locator("#notice").filter({hasText:"Fixture link unavailable"}).waitFor();
    assert.match(await page.locator("#sync").innerText(),/dados exibidos podem estar antigos/);const noticeChanges=await page.evaluate(()=>window.__noticeChanges);
    await page.waitForTimeout(5500);assert.equal(await page.evaluate(()=>window.__noticeChanges),noticeChanges,"background polling must not repeatedly announce the same error");
    assert.equal(await page.locator("#title").innerText(),document.title);transportDown=false;await page.getByRole("button",{name:"Atualizar",exact:true}).click();await page.waitForFunction(()=>document.querySelector("#notice").textContent==="");
    const imageJob=await client.processGameAsset("studio-image-candidate",project.id,3,{processorId:"local-media-v1",target:{id:"seed-edited",role:"Seed redesenhada",placeholder:false},
      operation:{type:"image.compose",output:"assets/seed-edited.png",width:64,height:64,background:"#00000000",layers:[{source:{assetId:"seed",path:file.path},x:0,y:0,width:64,height:64,tint:"#20ffffff",opacity:1,flipX:true,flipY:false,filter:"nearest"}]}});
    await settled(client,imageJob.id);assert.equal((await client.getGameProject(project.id)).revision,3,"processing must leave the displayed project unchanged");
    await page.locator('[data-tab="assets"]').click();await page.getByRole("button",{name:"Atualizar",exact:true}).click();
    if(audioEditing){
      const review=page.locator('#candidate-list .row').filter({hasText:'Seed redesenhada'}).getByRole('button',{name:'Revisar candidato'});await review.waitFor();
      const snapshot=controller.snapshot.bind(controller);let release,entered;const gate=new Promise(resolve=>{release=resolve;}),arrived=new Promise(resolve=>{entered=resolve;});
      controller.snapshot=async(...args)=>{entered();await gate;return snapshot(...args);};
      let disabled;
      try{await page.getByRole('button',{name:'Atualizar',exact:true}).click();await arrived;disabled=await review.isDisabled();}
      finally{release();controller.snapshot=snapshot;}
      assert.equal(disabled,true,'a pending refresh must disable candidate review instead of silently discarding a click');
    }
    await page.locator("#candidate-list .row").filter({hasText:"Seed redesenhada"}).getByRole("button",{name:"Revisar candidato"}).click();
    await page.locator("#candidate-image").waitFor({state:"visible"});await page.waitForFunction(()=>document.querySelector("#candidate-image").naturalWidth===64);
    assert.match(await page.locator("#candidate-provenance").innerText(),/Temporário/);assert.match(await page.locator("#candidate-provenance").innerText(),/provenance/);
    assert.equal(await page.locator("#apply-candidate").isEnabled(),true);approvalAllowed=false;
    await page.locator("#apply-candidate").click();await page.locator("#notice").filter({hasText:"Operação cancelada"}).waitFor();assert.equal((await client.getGameProject(project.id)).revision,3);
    const beforeMedia=await client.getGameRevision(project.id);
    await client.commitGameRevision(project.id,"change-before-media",3,{...beforeMedia.document,title:document.title},"Independent revision while inspecting candidate");
    await page.getByRole("button",{name:"Atualizar",exact:true}).click();await page.waitForFunction(()=>document.querySelector("#revision").textContent.startsWith("Revisão 4"));
    assert.equal(await page.locator("#apply-candidate").isDisabled(),true);assert.match(await page.locator("#candidate-state").innerText(),/projeto mudou/);
    await page.locator("#refresh-candidate").click();await page.waitForFunction(()=>!document.querySelector("#apply-candidate").disabled);approvalAllowed=true;
    await page.screenshot({path:path.join(output,`${product}-candidate-image.png`),fullPage:true});
    const jobsBeforeAdjustment=(await projectJobs(client,project.id)).length;
    await page.locator("#adjust-image").click();await page.locator("#image-editor").waitFor({state:"visible"});
    for(const field of ["width","height","layers.0.width","layers.0.height"])await page.locator(`#image-editor [data-path="${field}"]`).fill("32");
    await page.locator('#image-editor [data-path="layers.0.opacity"]').fill("0.5");
    await page.locator('#image-editor [data-path="layers.0.flipY"]').check();
    await page.screenshot({path:path.join(output,`${product}-image-editor.png`),fullPage:true});
    approvalAllowed=false;await page.locator("#submit-image").click();await page.locator("#notice").filter({hasText:"Operação cancelada"}).waitFor();
    assert.equal((await projectJobs(client,project.id)).length,jobsBeforeAdjustment);assert.equal(await page.locator('#image-editor [data-path="width"]').isEnabled(),true);
    approvalAllowed=true;await page.locator("#submit-image").click();await page.locator("#notice").filter({hasText:"Fixture lost image acknowledgment"}).waitFor();
    assert.equal(imageRequests.length,1);const adjustedImageJobId=imageRequests[0].jobId;await settled(client,adjustedImageJobId);
    assert.equal(await page.locator('#image-editor [data-path="width"]').isDisabled(),true);assert.equal(await page.locator("#cancel-image-editor").isDisabled(),true);
    approvalAllowed=false;await page.locator("#submit-image").click();await page.locator("#notice").filter({hasText:"Operação cancelada"}).waitFor();
    assert.equal(await page.locator('#image-editor [data-path="width"]').isDisabled(),true,"refusing a retry must not forget an earlier unknown effect");
    approvalAllowed=true;await page.locator("#submit-image").click();await page.locator("#image-editor").waitFor({state:"hidden"});
    assert.equal(imageRequests.length,2);assert.deepEqual(imageRequests[1],imageRequests[0]);assert.equal((await projectJobs(client,project.id)).length,jobsBeforeAdjustment+1);
    assert.equal((await client.getGameProject(project.id)).revision,4,"processing must not apply the variant");
    await page.locator("#candidate-list .row").filter({hasText:"Seed redesenhada"}).filter({hasText:"Revisão 4"}).getByRole("button",{name:"Revisar candidato"}).click();
    await page.waitForFunction(()=>document.querySelector("#candidate-image").naturalWidth===32);
    await page.locator("#apply-candidate").click();await page.waitForFunction(()=>document.querySelector("#revision").textContent.startsWith("Revisão 5"));
    assert.equal(await page.locator("#apply-candidate").isDisabled(),true);assert.match(await page.locator("#candidate-state").innerText(),/Aplicado nesta revisão/);
    const applied=await client.getGameRevision(project.id),processed=applied.document.assets.find(asset=>asset.id==="seed-edited");assert.equal(processed.processing.jobId,adjustedImageJobId);assert.equal(processed.placeholder,true);
    await page.locator('[data-tab="overview"]').click();await page.getByRole("button",{name:"Exportar fonte",exact:true}).click();await page.locator("#notice").filter({hasText:"Exportação concluída"}).waitFor();
    assert.ok((await readFile(path.join(lastSourceExport,"source/assets/seed-edited.png"))).equals(await client.downloadGameFile(project.id,"assets/seed-edited.png",5)));
    const audioJob=await client.processGameAsset("studio-audio-candidate",project.id,5,{processorId:"local-media-v1",target:{id:"sound-candidate",role:"Som para revisão",placeholder:true},operation:{type:"audio.render",output:"assets/review.wav",durationMs:100,sampleRate:22050,channels:1,clips:[],notes:[{waveform:"sine",frequency:440,startMs:0,durationMs:100,gain:.2,pan:0,attackMs:5,releaseMs:10,seed:1}]}});
    await settled(client,audioJob.id);await page.locator('[data-tab="assets"]').click();await page.getByRole("button",{name:"Atualizar",exact:true}).click();
    await page.locator("#candidate-list .row").filter({hasText:"Som para revisão"}).getByRole("button",{name:"Revisar candidato"}).click();
    await page.locator("#candidate-audio").waitFor({state:"visible"});await page.waitForFunction(()=>document.querySelector("#candidate-audio").duration>0);
    assert.equal(await page.locator("#candidate-audio").evaluate(audio=>audio.paused),true,"audio must not autoplay during inspection");
    await page.locator("#export-candidate").click();await page.locator("#notice").filter({hasText:"Exportação cancelada"}).waitFor();assert.equal(lastCandidateExport,undefined);
    const approvalsBeforeExport=approvals;candidateExportAllowed=true;
    await page.locator("#export-candidate").click();await page.locator("#notice").filter({hasText:"Exportação concluída"}).waitFor();
    const candidateResult=await client.getGameAssetResult(audioJob.id);
    assert.deepEqual(JSON.parse(await readFile(path.join(lastCandidateExport,"candidate.json"),"utf8")),candidateResult);
    for(const file of candidateResult.files)assert.deepEqual(await readFile(path.join(lastCandidateExport,"candidate",file.path)),await client.downloadGameAssetFile(audioJob.id,file.path));
    assert.equal(approvals,approvalsBeforeExport);assert.equal((await client.getGameProject(project.id)).revision,5);
    await page.screenshot({path:path.join(output,`${product}-candidate-audio.png`),fullPage:true});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,"candidate files/provenance must fit the narrow editor");
    const vectorJob=await client.processGameAsset("studio-vector-candidate",project.id,5,{processorId:"local-media-v1",target:{id:"lantern",role:"Lanterna vetorial",placeholder:true},operation:vectors.vectorIllustrationFixture()});
    await settled(client,vectorJob.id);await page.getByRole("button",{name:"Atualizar",exact:true}).click();
    await page.locator("#candidate-list .row").filter({hasText:"Lanterna vetorial"}).getByRole("button",{name:"Revisar candidato"}).click();
    await page.waitForFunction(()=>document.querySelector("#candidate-image").naturalWidth===256);
    assert.match(await page.locator("#candidate-image").getAttribute("src"),/^data:image\/svg\+xml;base64,/);
    assert.equal(await page.locator("#adjust-image").innerText(),"Ajustar ilustração");
    assert.equal((await client.getGameProject(project.id)).revision,5);
    await page.screenshot({path:path.join(output,`${product}-candidate-vector.png`),fullPage:true});
    const vectorBefore=await client.downloadGameAssetFile(vectorJob.id,"assets/lantern.svg");
    await page.locator("#adjust-image").click();await page.getByRole("heading",{name:"Ajustar ilustração",exact:true}).waitFor();
    await page.getByLabel("Largura da ilustração",{exact:true}).fill("320");
    await page.getByLabel("Formato da variante",{exact:true}).selectOption(vectorFormat);
    const housing=page.locator('#vector-shapes details[data-shape-id="housing"]');await housing.locator("summary").click();
    await housing.getByLabel("Arredondamento",{exact:true}).fill("28");
    await housing.locator(".vector-paint").first().locator(".vector-stop").first().getByLabel("Cor · RGBA",{exact:true}).fill("#f5dbb4ff");
    const leaf=page.locator('#vector-shapes details[data-shape-id="leaf"]');await leaf.locator("summary").click();
    await leaf.locator('.vector-command[data-command-index="1"]').getByLabel("Controle 1 horizontal",{exact:true}).fill("96");
    await leaf.getByLabel("Adicionar à curva",{exact:true}).selectOption("M");await leaf.getByRole("button",{name:"Adicionar à curva",exact:true}).click();
    await leaf.getByLabel("Adicionar à curva",{exact:true}).selectOption("L");await leaf.getByRole("button",{name:"Adicionar à curva",exact:true}).click();
    const shadow=page.locator('#vector-shapes details[data-shape-id="shadow"]');await shadow.locator("summary").click();
    await shadow.locator(".vector-paint").first().getByLabel("Raio",{exact:true}).fill("70");
    await housing.getByLabel("Mover, girar ou escalar",{exact:true}).check();await housing.getByLabel("Rotação · graus",{exact:true}).fill("8");
    const base=page.locator('#vector-shapes details[data-shape-id="base-light"]');await base.locator("summary").click();await base.getByRole("button",{name:"Recuar forma",exact:true}).click();
    assert.equal(await page.locator("#vector-shapes>.vector-shape").nth(7).getAttribute("data-shape-id"),"base-light");await base.getByRole("button",{name:"Avançar forma",exact:true}).click();
    assert.equal(await page.locator("#vector-shapes>.vector-shape").nth(8).getAttribute("data-shape-id"),"base-light");
    await page.getByRole("button",{name:"Adicionar elipse",exact:true}).click();
    assert.equal(await page.locator("#vector-shapes>.vector-shape").count(),10);
    const added=page.locator("#vector-shapes>.vector-shape").last();await added.locator(".vector-paint").first().getByLabel("Tipo de pintura",{exact:true}).selectOption("radial");
    await added.locator(".vector-paint").first().getByLabel("Raio",{exact:true}).fill("48");
    await added.getByRole("button",{name:"Adicionar ponto de cor",exact:true}).click();assert.equal(await added.locator(".vector-stop").count(),3);
    await added.locator(".vector-stop").nth(1).getByRole("button",{name:"Remover ponto de cor",exact:true}).click();assert.equal(await added.locator(".vector-stop").count(),2);
    await added.getByLabel("Usar contorno",{exact:true}).check();await added.getByLabel("Espessura do contorno",{exact:true}).fill("4.5");
    await added.getByLabel("Mover, girar ou escalar",{exact:true}).check();await added.getByLabel("Mover, girar ou escalar",{exact:true}).uncheck();
    await added.getByRole("button",{name:"Duplicar forma",exact:true}).click();assert.equal(await page.locator("#vector-shapes>.vector-shape").count(),11);
    await page.locator("#vector-shapes>.vector-shape").last().getByRole("button",{name:"Remover forma",exact:true}).click();assert.equal(await page.locator("#vector-shapes>.vector-shape").count(),10);
    const vectorJobsBefore=(await projectJobs(client,project.id)).length;
    approvalAllowed=false;await page.locator("#submit-image").click();await page.locator("#notice").filter({hasText:"Operação cancelada"}).waitFor();
    assert.equal(await page.getByLabel("Largura da ilustração",{exact:true}).inputValue(),"320");assert.equal((await projectJobs(client,project.id)).length,vectorJobsBefore);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,"expanded vector forms must fit the narrow editor");
    await page.locator("#image-editor-title").scrollIntoViewIfNeeded();await page.screenshot({path:path.join(output,`${product}-vector-editor-viewport.png`)});
    await page.screenshot({path:path.join(output,`${product}-vector-adjustments.png`),fullPage:true});
    approvalAllowed=true;await page.locator("#submit-image").click();await page.locator("#notice").filter({hasText:"Fixture lost vector acknowledgment"}).waitFor();
    assert.equal(await page.getByLabel("Largura da ilustração",{exact:true}).isDisabled(),true);assert.equal(await page.getByRole("button",{name:"Adicionar retângulo",exact:true}).isDisabled(),true);
    assert.equal(await page.locator("#cancel-image-editor").isDisabled(),true);assert.equal((await projectJobs(client,project.id)).length,vectorJobsBefore+1);
    approvalAllowed=false;await page.locator("#submit-image").click();await page.locator("#notice").filter({hasText:"Operação cancelada"}).waitFor();assert.equal(await page.getByLabel("Largura da ilustração",{exact:true}).isDisabled(),true);
    approvalAllowed=true;await page.locator("#submit-image").click();await page.locator("#image-editor").waitFor({state:"hidden"});
    assert.equal(vectorRequests.length,2);assert.equal(vectorRequests[0].requestId,vectorRequests[1].requestId);assert.equal(vectorRequests[0].jobId,vectorRequests[1].jobId);
    const vectorVariantId=vectorRequests[1].jobId;await settled(client,vectorVariantId);assert.equal((await projectJobs(client,project.id)).length,vectorJobsBefore+1);
    const vectorVariant=await client.getGameAssetResult(vectorVariantId);assert.equal(vectorVariant.spec.operation.output,`assets/lantern.${vectorFormat}`);assert.equal(vectorVariant.spec.operation.width,320);assert.equal(vectorVariant.spec.operation.shapes.length,10);assert.equal(vectorVariant.asset.placeholder,true);
    const editedHousing=vectorVariant.spec.operation.shapes.find(shape=>shape.id==="housing"),editedLeaf=vectorVariant.spec.operation.shapes.find(shape=>shape.id==="leaf");
    assert.equal(editedHousing.radius,28);assert.equal(editedHousing.fill.stops[0].color,"#f5dbb4ff");assert.equal(editedHousing.transform.rotation,8);assert.equal(editedLeaf.commands[1].x1,96);
    assert.equal(editedLeaf.commands.length,6);assert.equal(vectorVariant.spec.operation.shapes.find(shape=>shape.id==="shadow").fill.r,70);
    const extra=vectorVariant.spec.operation.shapes.at(-1);assert.equal(extra.kind,"ellipse");assert.equal(extra.fill.type,"radial");assert.equal(extra.fill.r,48);assert.equal(extra.fill.stops.length,2);assert.equal(extra.stroke.width,4.5);assert.equal(extra.transform,undefined);
    assert.deepEqual(await client.downloadGameAssetFile(vectorJob.id,"assets/lantern.svg"),vectorBefore);assert.equal((await client.getGameProject(project.id)).revision,5);
    await page.getByRole("button",{name:"Atualizar",exact:true}).click();await page.locator("#candidate-list .row").filter({hasText:"Lanterna vetorial"}).first().getByRole("button",{name:"Revisar candidato"}).click();
    await page.waitForFunction(()=>document.querySelector("#candidate-image").naturalWidth===320);
    await page.locator("#apply-candidate").click();await page.waitForFunction(()=>document.querySelector("#revision").textContent.startsWith("Revisão 6"));
    await page.locator("#asset-list .row").filter({hasText:"Lanterna vetorial"}).getByRole("button",{name:"Inspecionar",exact:true}).click();
    await page.waitForFunction(()=>!document.querySelector("#asset-image").hidden&&document.querySelector("#asset-image").naturalWidth===320);
    assert.ok((await page.locator("#asset-image").getAttribute("src")).startsWith(`data:image/${vectorFormat==='png'?'png':'svg+xml'};base64,`));
    await page.screenshot({path:path.join(output,`${product}-applied-vector.png`),fullPage:true});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    await client.selectGameProject(session.id,other.id);await page.getByRole("button",{name:"Atualizar",exact:true}).click();
    await page.getByRole("heading",{name:"Other isolated project",exact:true}).waitFor();assert.equal(await page.locator("#candidate-preview").isHidden(),true);
    assert.equal(await page.locator("#candidate-audio").getAttribute("src"),null);assert.equal(await page.locator("#candidate-audio").evaluate(audio=>audio.paused),true);
    await client.selectGameProject(session.id,project.id);assert.equal((await client.getGameQuality(project.id)).ready,false);
    const audioEditor=audioEditing?await qualifyAudioEditor({page,client,controller,product,output,settled,setApproval:value=>{approvalAllowed=value;}}):undefined;
    assert.deepEqual(errors,[]);results.push({product,projectId:project.id,revision:6,approvals,played,exported,inference,audioEditor,
      mediaCandidates:{imageJobId:imageJob.id,imageAdjustment:{jobId:adjustedImageJobId,denialPreserved:true,lostAckRecoveredSameRequest:true,oneNewJob:true,processedWidth:32,appliedRevision:5},audioJobId:audioJob.id,denialPreserved:true,staleRevisionBlocked:true,appliedRevision:5,sourceBytesExported:true,candidateExport:{cancelledPicker:true,verifiedBytes:true,metadataPreserved:true,applied:false},audioAutoplay:false,selectionClearsMedia:true},
      vector:{jobId:vectorJob.id,trustedCandidateImage:true,variantJobId:vectorVariantId,geometryEdited:true,gradientEdited:true,curveEdited:true,transformEdited:true,shapeAdded:true,lostAckRecoveredSameRequest:true,oneNewJob:true,denialPreserved:true,noAutomaticApplication:true,explicitlyAppliedRevision:6,acknowledgedSourceImage:true},
      layout:index?"narrow dark editor bridge":"wide light Mac bridge",purpose:"Shared renderer and host controller against packaged service; real codecs and private simulated inference; not installed-client or artistic/physical audio acceptance"});await context.close();
  }
  assert.notEqual(results[0].projectId,results[1].projectId);for(const client of clients)assert.equal((await client.listGameProjects()).projects.length,audioEditing?3:2);
  assert.equal(inferenceRequests,credentials.length,"Each product made one actual simulated provider request; namespaces did not share the debit");
  await writeFile(path.join(output,"ui-evidence.json"),JSON.stringify({results,manifest:JSON.parse(await readFile(path.join(engine,"manifest.json"),"utf8")),browser:{version:browser.version(),sha256:qualified.sha256}},null,2));
  console.log(`PACKAGED_GAME_STUDIO_UI_OK Mac/VS Code namespaces, structured design, restore, media, isolated play and exports ${output}`);
}catch(error){
  const pages=browser?.contexts().flatMap(context=>context.pages())??[],details=[];
  for(const [index,page]of pages.entries())try{await page.screenshot({path:path.join(output,`failure-${index}.png`),fullPage:true});details.push({url:page.url(),notice:await page.locator('#notice').textContent(),sync:await page.locator('#sync').textContent()});}catch{}
  await writeFile(path.join(output,'failure.json'),JSON.stringify({error:String(error.stack??error),pages:details,stateDirectory:state,servicePid:child.pid},null,2));throw error;
}finally{
  // Preserve unknown production, including a lost renderer acknowledgement.
  // A failed observer is not permission to erase an admitted job/receipt.
  let terminal=false;
  try{
    terminal=true;
    for(const client of clients){let cursor=0;while(true){const page=await client.listGameProjects(cursor,30);for(const project of page.projects){let jobCursor=0;while(true){const jobs=await client.listGameProduction(project.id,jobCursor,30);if(jobs.jobs.some(job=>!['completed','failed','cancelled'].includes(job.state)))terminal=false;if(!jobs.hasMore)break;jobCursor=jobs.cursor;}}if(!page.hasMore)break;cursor=page.cursor;}}
  }catch{terminal=false;}
  for(const client of clients)client.close();await browser?.close();
  if(terminal){if(child.exitCode===null){const exited=once(child,"exit");child.kill("SIGTERM");await exited;}await rm(state,{recursive:true,force:true});}
  else{child.unref();console.error(`Original Studio production preserved: ${state} pid=${child.pid}`);}
  if(inferenceServer.listening)await new Promise((resolve,reject)=>inferenceServer.close((error)=>error?reject(error):resolve()));
}
