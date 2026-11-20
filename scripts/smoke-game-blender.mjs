// Real optional Blender image, packaged engine and authenticated IPC. Original
// fixture assets, not a finished game or artistic/physical/human acceptance.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp,mkdir,copyFile,readFile,writeFile,rm,readdir,lstat,unlink } from "node:fs/promises";
import { createConnection } from "node:net";
import path from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import security from "../dist-tests/packages/agent-service/src/security.js";
import storage from "../dist-tests/packages/agent-service/src/store.js";
import sdk from "../dist-tests/packages/client-ts/src/index.js";
import models from "../dist-tests/test/game-blender-fixtures.js";
import fixtures from "../dist-tests/test/game-fixtures.js";
import glbModule from "../dist-tests/packages/game-production/src/glb.js";
import containers from "../dist-tests/packages/adapter-game-container/src/process.js";
import identityModule from "../dist-tests/packages/contracts/src/identity.js";
import modelContracts from "../dist-tests/packages/contracts/src/game-models.js";

const {contentHash}=identityModule;
const state=await mkdtemp(path.join(tmpdir(),"companion-blender-")),engine=path.resolve("engine-dist"),output=path.resolve("output/playwright/game-blender");
await mkdir(path.join(state,"toolchains"));await copyFile(".cache/game-toolchains/blender.json",path.join(state,"toolchains/blender.json"));
const provision=JSON.parse(await readFile(path.join(state,"toolchains/blender.json"),"utf8"));
const registration={id:"blender-smoke",product:"companion-mac",profile:"fixture",workspace:"",providers:["ollama"],hostTools:[]};
const identity=await security.ensureIdentity(state),credential=await security.createClientCredential(state,registration),store=new storage.Store(path.join(state,"metadata.sqlite"));store.register(credential);store.close();
let child,client,logs="",passed=false;
const jobs=[],results=[];
const pause=()=>new Promise((resolve)=>setTimeout(resolve,50));
async function boot(){
  logs="";child=spawn(path.join(engine,process.platform==="win32"?"node.exe":"node"),[path.join(engine,"service.cjs"),state],{stdio:["ignore","pipe","pipe"]});
  child.stdout.on("data",(data)=>{logs=(logs+data).slice(-100000);});child.stderr.on("data",(data)=>{logs=(logs+data).slice(-100000);});
  let ready=false;for(let i=0;i<600;i++){if(child.exitCode!==null)throw new Error(logs);try{if(JSON.parse(await readFile(path.join(state,"runtime.json"),"utf8")).pid===child.pid){ready=true;break;}}catch{}await pause();}
  assert.ok(ready,"Packaged Blender engine did not start");client=new sdk.AgentClient({address:security.ipcPath(state),certificate:identity.cert,credential});await client.connect();
}
async function stop(){client?.close();if(child?.exitCode===null){const exited=once(child,"exit");child.kill("SIGTERM");await exited;}}
async function settled(id,expected="completed"){
  for(let i=0;i<5000;i++){const job=await client.getGameProduction(id);if(!["queued","running","cancelling"].includes(job.state)){assert.equal(job.state,expected,job.error);return job;}await pause();}
  throw new Error("Blender observation interval expired; inspect this same operation before retrying");
}
async function save(name,data){const target=path.join(output,name);await mkdir(path.dirname(target),{recursive:true});await writeFile(target,data);}
const hash=(data)=>createHash("sha256").update(data).digest("hex");
const binding=(job)=>({jobId:job.id,scope:contentHash({product:registration.product,profile:registration.profile,workspace:registration.workspace}),sourceHash:job.sourceHash,toolchain:job.toolchain,imageId:provision.imageId,recipeHash:contentHash(job.assetSpec)});
const command=(args)=>containers.dockerCommand(provision.dockerExecutable,args);
const ownedName=(job)=>`companion-tool-${contentHash(binding(job)).slice(0,40)}`;
async function live(job){
  for(let i=0;i<400;i++){
    const ids=(await command(["container","ls","--all","--filter",`name=^/${ownedName(job)}$`,"--format","{{.ID}}"]).catch(()=>Buffer.from(""))).toString().trim();
    if(ids){const [c]=JSON.parse((await command(["inspect",ids])).toString());
      assert.equal(c.Config.Labels["org.companion.game-tool-job"],contentHash(binding(job)));assert.equal(c.Image,provision.imageId);
      assert.equal(c.HostConfig.NetworkMode,"none");assert.equal(c.HostConfig.ReadonlyRootfs,true);assert.equal(c.HostConfig.Privileged,false);
      assert.deepEqual(c.HostConfig.CapDrop,["ALL"]);assert.ok(c.HostConfig.SecurityOpt.includes("no-new-privileges"));assert.notEqual(c.Config.User,"0:0");
      assert.equal(c.HostConfig.Memory,4*1024**3);assert.equal(c.HostConfig.MemorySwap,c.HostConfig.Memory);assert.equal(c.HostConfig.PidsLimit,256);
      assert.equal(c.Mounts.filter((m)=>m.Type==="bind").length,1);assert.ok(c.Mounts.some((m)=>m.Destination==="/source"&&!m.RW));
      if(c.State.Running&&(await command(["top",c.Id,"-eo","pid,comm"])).toString().includes("blender"))return {network:c.HostConfig.NetworkMode,readOnlyRoot:c.HostConfig.ReadonlyRootfs,user:c.Config.User,memory:c.HostConfig.Memory,pids:c.HostConfig.PidsLimit,mounts:c.Mounts.map((m)=>({destination:m.Destination,writable:m.RW,type:m.Type}))};
    }
    const current=await client.getGameProduction(job.id);assert.ok(["queued","running"].includes(current.state),JSON.stringify(current));await pause();
  }
  throw new Error("Original Blender process not yet observed; inspect the same job, do not resubmit");
}
async function removed(job){assert.equal((await command(["container","ls","--all","--filter",`name=^/${ownedName(job)}$`,"--format","{{.ID}}"])).toString().trim(),"");}
async function crashAndBoot(){
  client.close();client=undefined;const exited=once(child,"exit");child.kill("SIGKILL");await exited;
  assert.ok(child.exitCode!==null||child.signalCode!==null);
  const runtime=JSON.parse(await readFile(path.join(state,"runtime.json"),"utf8"));assert.equal(runtime.pid,child.pid);
  if(process.platform!=="win32"){
    const endpoint=security.ipcPath(state),before=await lstat(endpoint);assert.ok(before.isSocket()&&before.uid===process.getuid());
    await new Promise((resolve,reject)=>{const socket=createConnection(endpoint);socket.once("connect",()=>{socket.destroy();reject(new Error("Owned test socket still live"));});socket.once("error",(error)=>error.code==="ECONNREFUSED"?resolve():reject(error));socket.setTimeout(1000,()=>{socket.destroy();reject(new Error("Owned socket inspection inconclusive"));});});
    const current=await lstat(endpoint);assert.equal(current.ino,before.ino);assert.equal(current.dev,before.dev);await unlink(endpoint);
  }
  await boot();
}
try{
  await boot();const capabilities=await client.gameProductionCapabilities(),processor=capabilities.assetProcessors.find((item)=>item.id==="blender-model-isolated-v1");assert.equal(processor?.available,true,processor?.reason);
  const document=fixtures.fixtureGameDocument();document.title="Blender courier processing fixture";document.engine="babylon";document.brief.dimension="3d";
  let project=await client.createGameProject("model-fixture",document);
  const spec={processorId:processor.id,target:{id:"courier",role:"Original procedural rigged courier; integration fixture",placeholder:true},operation:models.fixtureModelOperation()};
  const job=await client.processGameAsset("generate",project.id,project.revision,spec);jobs.push(job);await settled(job.id);
  assert.equal((await client.processGameAsset("generate",project.id,project.revision,spec)).id,job.id,"Idempotent requests must not start another Blender process");
  assert.equal((await client.getGameProject(project.id)).revision,1,"Processing is not application");
  await stop();await boot();const result=await client.getGameAssetResult(job.id);results.push(result);
  for(const file of result.files){const data=await client.downloadGameAssetFile(job.id,file.path);assert.equal(hash(data),file.sha256);await save(`generated/${file.path}`,data);}
  const modelFile=result.files.find((f)=>f.path.endsWith(".glb")),model=await client.downloadGameAssetFile(job.id,modelFile.path),inspection=glbModule.inspectGameGlb(model);
  assert.ok(inspection.skins>0&&inspection.triangles>0&&inspection.animations>0);assert.ok(inspection.document.animations.some((a)=>a.name==="wave"));
  assert.equal(result.asset.kind,"model");assert.equal(result.asset.placeholder,true);
  project=await client.applyGameAsset("apply-model",job.id,1);assert.equal(project.revision,2);assert.deepEqual(await client.applyGameAsset("apply-model",job.id,1),project);
  console.log("BLENDER_GENERATE_RESTART_APPLY_OK");
  const originalHash=hash(model),editedSpec={processorId:processor.id,target:{id:"courier-edited",role:"Directed transform of registered rigged GLB",placeholder:false},operation:modelContracts.gameModelOperation.parse({type:"model.scene",outputBase:"assets/robot-edited",objects:[{id:"imported",geometry:{kind:"glb",source:{assetId:"courier",path:modelFile.path}},rotation:[0,0,20],scale:[0.9,0.9,0.9]}],preview:models.fixtureModelOperation().preview})};
  const edit=await client.processGameAsset("edit",project.id,project.revision,editedSpec);jobs.push(edit);await settled(edit.id);
  const edited=await client.getGameAssetResult(edit.id);results.push(edited);assert.equal(edited.asset.placeholder,true,"Derived asset cannot erase placeholder ancestry");assert.deepEqual(edited.asset.origin.referenceIds,["courier"]);
  const editedModel=await client.downloadGameAssetFile(edit.id,"assets/robot-edited.glb"),editedInspection=glbModule.inspectGameGlb(editedModel);
  assert.ok(editedInspection.skins>0&&editedInspection.animations>0,"Registered GLB editing must preserve imported rig/animation");
  project=await client.applyGameAsset("apply-edited",edit.id,2);assert.equal(project.revision,3);assert.equal(hash(await client.downloadGameAssetFile(job.id,modelFile.path)),originalHash);
  for(const file of edited.files)await save(`edited/${file.path}`,await client.downloadGameAssetFile(edit.id,file.path));
  console.log("BLENDER_REGISTERED_GLB_EDIT_RIG_PROVENANCE_OK");

  // Acknowledged candidate survives a failure before the SQLite publication.
  const faultStore=new storage.Store(path.join(state,"metadata.sqlite"));faultStore.db.exec("CREATE TRIGGER fixture_fail_asset_commit BEFORE INSERT ON game_asset_results BEGIN SELECT RAISE(ABORT,'controlled test interruption before asset commit'); END");
  const faultStart=Math.floor(Date.now()/1000)-1;
  const fault=await client.processGameAsset("candidate-commit-interruption",project.id,project.revision,{...spec,target:{...spec.target,id:"receipt-probe"},operation:{...spec.operation,outputBase:"assets/receipt-probe"}});jobs.push(fault);
  try{await settled(fault.id,"awaiting_reconciliation");}finally{faultStore.db.exec("DROP TRIGGER fixture_fail_asset_commit");faultStore.close();}
  const candidateDirectory=path.join(state,"game-tool-jobs",contentHash(binding(fault))),receipt=await readFile(path.join(candidateDirectory,"receipt.json"),"utf8");
  await stop();await boot();assert.equal((await client.getGameProduction(fault.id)).state,"awaiting_reconciliation");
  const recoveredJob=await client.reconcileGameProduction(fault.id);assert.equal(recoveredJob.state,"completed");assert.equal(recoveredJob.error,undefined);await removed(fault);
  const recovered=await client.getGameAssetResult(fault.id);assert.equal(recovered.files.find((f)=>f.path.endsWith(".glb")).sha256,hash(await client.downloadGameAssetFile(fault.id,"assets/receipt-probe.glb")));
  const creates=(await command(["events","--since",String(faultStart),"--until",String(Math.floor(Date.now()/1000)+1),"--filter","type=container","--filter","event=create","--filter",`label=org.companion.game-tool-job=${contentHash(binding(fault))}`,"--format","{{json .}}"]).then((bytes)=>bytes.toString().trim().split("\n").filter(Boolean)));
  assert.equal(creates.length,1,"Recovery must not create a second Blender container");
  console.log("BLENDER_CANDIDATE_COMMIT_RECOVERY_NO_REPEAT_OK");

  const cancel=await client.processGameAsset("cancel-live",project.id,project.revision,{...spec,target:{...spec.target,id:"cancel-probe"},operation:{...spec.operation,outputBase:"assets/cancel-probe"}});jobs.push(cancel);const isolation=await live(cancel);
  assert.equal((await client.cancelGameProduction(cancel.id)).state,"cancelling");await settled(cancel.id,"cancelled");await removed(cancel);
  const interrupted=await client.processGameAsset("crash-live",project.id,project.revision,{...spec,target:{...spec.target,id:"crash-probe"},operation:{...spec.operation,outputBase:"assets/crash-probe"}});jobs.push(interrupted);await live(interrupted);await crashAndBoot();
  assert.equal((await client.getGameProduction(interrupted.id)).state,"awaiting_reconciliation");assert.equal((await client.reconcileGameProduction(interrupted.id)).state,"failed");await removed(interrupted);
  assert.equal((await client.getGameProject(project.id)).revision,3,"Interrupted processing must not apply project changes");
  console.log("BLENDER_LIVE_CANCEL_CRASH_RECONCILIATION_OK");

  const current=(await client.getGameRevision(project.id)).document;
  const gameSource=`import * as B from 'babylonjs'; import 'babylonjs-loaders/glTF/2.0';
const canvas=document.querySelector('#game'),engine=new B.Engine(canvas,true,{preserveDrawingBuffer:true}),scene=new B.Scene(engine);scene.clearColor=new B.Color4(.035,.065,.1,1);
const camera=new B.ArcRotateCamera('camera',-Math.PI/2,1.22,5,new B.Vector3(0,1.3,0),scene);camera.attachControl(canvas,true);new B.HemisphericLight('light',new B.Vector3(0,1,0),scene);
B.SceneLoader.ImportMeshAsync(null,'assets/','robot-edited.glb',scene).then(result=>{for(const group of result.animationGroups)group.stop();const root=result.meshes[0];window.addEventListener('keydown',e=>{if(e.code==='Space')root.position.x+=.7;if(e.code==='KeyW')for(const group of result.animationGroups)group.start(true);});}).catch(error=>{console.error(error);throw error;});engine.runRenderLoop(()=>scene.render());window.addEventListener('resize',()=>engine.resize());`;
  for(const [name,text]of [["game.web.json",JSON.stringify({schemaVersion:1,engineVersion:"9.35.0",entry:"src/main.ts"})],["src/main.ts",gameSource],["data/playtests.json",JSON.stringify({schemaVersion:1,viewport:{width:640,height:360},scenarios:[{id:"processed-glb-input",steps:[{action:"wait",ms:1200},{action:"capture",selector:"canvas",name:"before"},{action:"press",key:"Space"},{action:"wait",ms:200},{action:"expect-image",selector:"canvas",baseline:"before",comparison:"changed",threshold:0.005}]},{id:"processed-rig-animation",steps:[{action:"press",key:"w"},{action:"wait",ms:120},{action:"capture",selector:"canvas",name:"arm-before"},{action:"wait",ms:400},{action:"expect-image",selector:"canvas",baseline:"arm-before",comparison:"changed",threshold:0.0002}]}]})]])current.files.push(await client.uploadGameFile(name,Buffer.from(text),name.endsWith(".json")?"application/json":"text/plain"));
  project=await client.commitGameRevision(project.id,"use-processed-glb",project.revision,current,"Render processed rigged GLB using the exact offline loader");
  const build=await client.startGameBuild("build-processed-glb",project.id,project.revision);await settled(build.id);const artifact=await client.getGameArtifact(build.id);assert.ok(!artifact.files.some((file)=>/\.blend[0-9]*$/.test(file.path)),"Editable .blend must not enter runtime builds");
  for(const file of artifact.files)await save(`build/${file.path}`,await client.downloadGameArtifactFile(build.id,file.path));
  const observation=await client.startGameValidation("observe-processed-glb",build.id,"web-browser-runtime-v1");await settled(observation.id);const reports=await client.getGameReports(build.id);
  for(const report of reports){for(const check of report.checks)assert.equal(check.status,"passed",JSON.stringify(report));for(const file of report.evidence??[])await save(`observations/${report.id}/${file.path}`,await client.downloadGameReportFile(report.id,file.path));}
  assert.ok(reports.some((report)=>report.testCase?.id==="processed-glb-input"));assert.ok(reports.some((report)=>report.testCase?.id==="processed-rig-animation"));
  for(const owned of jobs){const label=contentHash(binding(owned)),remaining=await containers.dockerCommand(provision.dockerExecutable,["container","ls","--all","--no-trunc","--filter",`label=org.companion.game-tool-job=${label}`,"--format","{{.ID}}"]);assert.equal(remaining.toString().trim(),"");}
  assert.deepEqual(await readdir(path.join(state,"game-tool-jobs")),[],"Terminal commit must dispose only the owned private candidate payloads");
  const quality=await client.getGameQuality(project.id);assert.equal(quality.ready,false);
  await save("integration-evidence.json",Buffer.from(JSON.stringify({purpose:"Actual isolated Blender, registered GLB editing, rig/clip/native source, CPU preview and observed offline Babylon rendering; no finished-game or human acceptance",manifest:JSON.parse(await readFile(path.join(engine,"manifest.json"),"utf8")),provision,project,results,inspection:{triangles:inspection.triangles,meshes:inspection.meshes,skins:inspection.skins,animations:inspection.animations,animationChannels:inspection.animationChannels},recovery:{receipt:JSON.parse(receipt),originalContainersCreated:creates.length,candidateRecoveredWithoutReprocessing:true,cancelled:cancel.id,interrupted:interrupted.id,isolation},artifact,reports,quality},null,2)));
  passed=true;
}finally{
  await stop();
  if(passed)await rm(state,{recursive:true,force:true});else console.error(`Blender fixture state preserved for inspection: ${state}\n${logs}`);
}
if(passed)console.log(`PACKAGED_BLENDER_MODEL_OK generated/edited rigged GLB, native source, CPU preview, offline Babylon rendering/animation, cancellation, crash and receipt recovery without reprocessing ${output}`);
