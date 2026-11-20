// Authored library/runtime fixture. Never supplied as source to real-model generation.
// No inference, installation or product quality acceptance. Uses the exact bundled CC0 pack, never network assets.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash,randomUUID } from "node:crypto";
import { mkdtemp,mkdir,readFile,writeFile,rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { once } from "node:events";
import { PNG } from "pngjs";
import security from "../dist-tests/packages/agent-service/src/security.js";
import storage from "../dist-tests/packages/agent-service/src/store.js";
import sdk from "../dist-tests/packages/client-ts/src/index.js";
import fixtures from "../dist-tests/test/game-fixtures.js";


const state=await mkdtemp(path.join(tmpdir(),"companion-library-")),engine=path.resolve("engine-dist");
const output=path.resolve("output/playwright/game-library/runs",`${new Date().toISOString().replace(/[:.]/g,"-")}-${randomUUID().slice(0,8)}`);
await mkdir(output,{recursive:true});
const registration={id:"library-smoke",product:"companion-mac",profile:"fixture",workspace:"",providers:["ollama"],hostTools:[]};
const identity=await security.ensureIdentity(state),credential=await security.createClientCredential(state,registration);
const store=new storage.Store(path.join(state,"metadata.sqlite"));store.register(credential);store.close();
let child,client,log="",terminal=true;
const pause=()=>new Promise(resolve=>setTimeout(resolve,25));
const sha=bytes=>createHash("sha256").update(bytes).digest("hex");
async function save(name,bytes){const target=path.join(output,name);await mkdir(path.dirname(target),{recursive:true});await writeFile(target,bytes);}
async function boot(){
  child=spawn(path.join(engine,process.platform==="win32"?"node.exe":"node"),[path.join(engine,"service.cjs"),state],{stdio:["ignore","pipe","pipe"]});
  child.stdout.on("data",data=>{log=(log+data).slice(-100000);});child.stderr.on("data",data=>{log=(log+data).slice(-100000);});
  let ready=false;
  for(let i=0;i<600;i++){
    if(child.exitCode!==null)throw Error(`Packaged service exited: ${log}`);
    try{if(JSON.parse(await readFile(path.join(state,"runtime.json"),"utf8")).pid===child.pid){ready=true;break;}}catch{}await pause();
  }
  assert.ok(ready,"Packaged service readiness");client=new sdk.AgentClient({address:security.ipcPath(state),certificate:identity.cert,credential});await client.connect();
}
async function stop(){client?.close();if(child?.exitCode===null){const exited=once(child,"exit");child.kill("SIGTERM");await exited;}}
async function settled(id){
  terminal=false;
  for(let i=0;i<4800;i++){const job=await client.getGameProduction(id);if(!["running","queued","cancelling"].includes(job.state)){terminal=["completed","failed","cancelled"].includes(job.state);assert.equal(job.state,"completed",job.error);return job;}await pause();}
  throw Error(`Observation deadline: preserve original job ${id} in ${state}; do not repeat it.`);
}
async function submit(start){terminal=false;const job=await start();await settled(job.id);return job;}
const evidence=[];
try{
  await boot();const info=await client.call("engine.info"),caps=await client.gameProductionCapabilities();
  assert.ok(caps.assetProcessors.some(item=>item.id==="licensed-libraries-v1"&&item.available&&item.operations.includes("library.copy")));
  assert.ok(caps.collectors.some(item=>item.id==="web-browser-runtime-v1"&&item.available));
  const first=await client.listGameLibraries({limit:7}),second=await client.listGameLibraries({cursor:first.cursor,limit:30});
  assert.equal(first.entries.length+second.entries.length,22);assert.equal(second.hasMore,false);
  const selected=(await client.listGameLibraries({query:"character-soldier"})).entries[0];assert.equal(selected.entry.animations.length,32);
  const document=fixtures.fixtureGameDocument();document.engine="babylon";document.title="Pinned library model/texture/animation runtime fixture";document.brief.dimension="3d";
  let project=await client.createGameProject("create-library-fixture",document);
  const spec={processorId:"licensed-libraries-v1",target:{id:"hero",role:"Original licensed character fixture; no artistic acceptance",placeholder:true},operation:{type:"library.copy",selection:selected,outputBase:"assets/hero"}};
  const job=await submit(()=>client.processGameAsset("copy-hero",project.id,1,spec));
  assert.equal((await client.processGameAsset("copy-hero",project.id,1,spec)).id,job.id);assert.equal((await client.getGameProject(project.id)).revision,1);
  await stop();await boot();const result=await client.getGameAssetResult(job.id);
  assert.equal(result.asset.origin.kind,"library");assert.equal(result.asset.placeholder,true);assert.match(result.asset.origin.license,/CC0-1.0/);
  for(const file of result.files){const bytes=await client.downloadGameAssetFile(job.id,file.path);assert.equal(sha(bytes),file.sha256);await save(`candidate/${file.path}`,bytes);}
  project=await client.applyGameAsset("apply-hero",job.id,1);assert.equal(project.revision,2);assert.deepEqual(await client.applyGameAsset("apply-hero",job.id,1),project);
  const source=`import * as B from 'babylonjs'; import 'babylonjs-loaders/glTF/2.0';
const canvas=document.querySelector('#game'),engine=new B.Engine(canvas,true,{preserveDrawingBuffer:true}),scene=new B.Scene(engine);scene.clearColor=new B.Color4(.09,.17,.2,1);
const camera=new B.ArcRotateCamera('camera',-Math.PI/2,1.22,3.5,new B.Vector3(0,.75,0),scene);camera.attachControl(canvas,true);new B.HemisphericLight('light',new B.Vector3(0,1,0),scene);
B.SceneLoader.ImportMeshAsync(null,'assets/hero/','character-soldier.glb',scene).then(result=>{for(const group of result.animationGroups)group.stop();const root=result.meshes[0];const walk=result.animationGroups.find(group=>group.name==='walk');if(!walk)throw Error('The original pinned walk animation is missing');
window.addEventListener('keydown',event=>{if(event.code==='Space')root.position.x+=.65;if(event.code==='KeyW')walk.start(true);});}).catch(error=>{console.error(error);throw error;});
engine.runRenderLoop(()=>scene.render());window.addEventListener('resize',()=>engine.resize());`;
  const recipe={schemaVersion:1,viewport:{width:640,height:360},scenarios:[
    {id:"library-original-model-input",steps:[{action:"wait",ms:1600},{action:"capture",selector:"canvas",name:"before"},{action:"press",key:"Space"},{action:"wait",ms:200},{action:"expect-image",selector:"canvas",baseline:"before",comparison:"changed",threshold:.005},{action:"capture",selector:"canvas",name:"after"}]},
    {id:"library-original-rig-animation",steps:[{action:"wait",ms:1600},{action:"press",key:"w"},{action:"wait",ms:120},{action:"capture",selector:"canvas",name:"walk-before"},{action:"wait",ms:400},{action:"expect-image",selector:"canvas",baseline:"walk-before",comparison:"changed",threshold:.0002},{action:"capture",selector:"canvas",name:"walk-after"}]}]};
  const current=(await client.getGameRevision(project.id)).document;
  for(const [name,text]of [["game.web.json",JSON.stringify({schemaVersion:1,engineVersion:"9.35.0",entry:"src/main.ts"})],["src/main.ts",source],["data/playtests.json",JSON.stringify(recipe)]])current.files.push(await client.uploadGameFile(name,Buffer.from(text),name.endsWith(".json")?"application/json":"text/plain"));
  project=await client.commitGameRevision(project.id,"runtime-source",2,current,"Render the original pinned GLB, external texture and walk animation through the offline loader");
  const build=await submit(()=>client.startGameBuild("build-library",project.id,3)),artifact=await client.getGameArtifact(build.id);
  for(const file of artifact.files){const bytes=await client.downloadGameArtifactFile(build.id,file.path);assert.equal(sha(bytes),file.sha256);await save(`build/${file.path}`,bytes);}
  assert.ok(artifact.files.some(file=>file.path==="assets/hero/Textures/colormap.png"));assert.ok(artifact.files.some(file=>file.path==="assets/hero/License.txt"));
  const validation=await submit(()=>client.startGameValidation("validate-library",build.id,"web-browser-runtime-v1"));
  const reports=await client.getGameReports(build.id);assert.ok(reports.some(report=>report.testCase?.id==="library-original-rig-animation"));
  await save("browser-reports.json",Buffer.from(JSON.stringify({project,result,build,artifact,validation,reports},null,2)));
  const pixels=[];
  for(const report of reports){

    for(const file of report.evidence??[]){const bytes=await client.downloadGameReportFile(report.id,file.path);assert.equal(sha(bytes),file.sha256);await save(`observations/${report.id}/${file.path}`,bytes);
      if(file.mime==="image/png"){const png=PNG.sync.read(bytes);let warm=0;for(let i=0;i<png.data.length;i+=4){const [r,g,b,a]=png.data.subarray(i,i+4);if(a>240&&r>100&&g>50&&r>g*1.1&&g>b*1.1)warm++;}pixels.push({path:file.path,sha256:file.sha256,width:png.width,height:png.height,warmTexturePixels:warm});}
    }
  }
  await save("pixel-observations.json",Buffer.from(JSON.stringify(pixels,null,2)));
  for(const report of reports)for(const check of report.checks)assert.equal(check.status,"passed",check.detail);
  assert.ok(pixels.some(image=>image.warmTexturePixels>100),"The original character's textured colors must appear, not only a blank canvas or default material");
  const quality=await client.getGameQuality(project.id);assert.equal(quality.ready,false);
  evidence.push({project,result,build,artifact,validation,reports,pixels,quality});
  await save("integration-evidence.json",Buffer.from(JSON.stringify({schemaVersion:1,purpose:"Pinned licensed library + SDK/TLS + restart/idempotent explicit application + actual Babylon GLB/external texture/keyboard/original rig fixture; not an autonomous game, installed UI, legal, physical or human acceptance",engine:info,catalogPages:[first,second],selection:selected,manifest:JSON.parse(await readFile(path.join(engine,"manifest.json"),"utf8")),results:evidence,fullProductAcceptance:false},null,2)));
  console.log(`PACKAGED_LIBRARY_OK assets=22 animations=32 ${output}`);
}catch(error){await save("failure.json",Buffer.from(JSON.stringify({error:String(error.stack??error),stateDirectory:state,terminal,completedFixtures:evidence.length},null,2)));throw error;}
finally{
  await save("service.log",Buffer.from(log));
  if(terminal){await stop();await rm(state,{recursive:true,force:true});}
  else{client?.close();child?.unref();console.error(`Original service/job preserved: ${state} pid=${child?.pid}`);}
}
