// Authored codec/runtime fixture. Never supplied as source to real-model generation.
// No inference, installation, external assets or product quality acceptance.
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
import vectors from "../dist-tests/test/game-vector-fixtures.js";

const format=process.argv.find(value=>value.startsWith('--format='))?.slice('--format='.length)??'svg';
assert.ok(['svg','png'].includes(format),'Select --format=svg or --format=png.');

const state=await mkdtemp(path.join(tmpdir(),"companion-vector-")),engine=path.resolve("engine-dist");
const output=path.resolve(`output/playwright/game-vector${format==='png'?'-png':''}/runs`,`${new Date().toISOString().replace(/[:.]/g,"-")}-${randomUUID().slice(0,8)}`);
await mkdir(output,{recursive:true});
const registration={id:"vector-smoke",product:"companion-mac",profile:"fixture",workspace:"",providers:["ollama"],hostTools:[]};
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
  assert.ok(caps.assetProcessors.some(item=>item.id==="local-media-v1"&&item.available&&item.operations.includes("image.vector")));
  assert.ok(caps.collectors.some(item=>item.id==="web-browser-runtime-v1"&&item.available));
  for(const name of ["phaser","babylon"]){
    const document=fixtures.fixtureGameDocument();document.engine=name;document.title=`Typed ${format.toUpperCase()} ${name} integration fixture`;
    document.brief.dimension=name==="phaser"?"2d":"3d";
    let project=await client.createGameProject(`create-${name}`,document);
    const operation={...vectors.vectorIllustrationFixture(),output:`assets/lantern.${format}`},spec={processorId:"local-media-v1",target:{id:"lantern",role:"Authored vector runtime fixture; not final game artwork",placeholder:true},operation};
    const request=`vector-${name}`,job=await submit(()=>client.processGameAsset(request,project.id,1,spec));
    assert.equal((await client.processGameAsset(request,project.id,1,spec)).id,job.id);
    assert.equal((await client.getGameProject(project.id)).revision,1);
    await stop();await boot();
    const result=await client.getGameAssetResult(job.id);assert.deepEqual(result.sourceAssets,[]);assert.equal(result.asset.origin.kind,"procedural");assert.equal(result.asset.placeholder,true);
    assert.deepEqual(result.spec.operation,operation);
    for(const file of result.files){const bytes=await client.downloadGameAssetFile(job.id,file.path);assert.equal(sha(bytes),file.sha256);await save(`${name}/candidate/${file.path}`,bytes);}
    project=await client.applyGameAsset(`apply-${name}`,job.id,1);assert.equal(project.revision,2);
    assert.deepEqual(await client.applyGameAsset(`apply-${name}`,job.id,1),project);
    const source=name==="phaser"?`import Phaser from 'phaser';
new Phaser.Game({type:Phaser.CANVAS,canvas:document.querySelector('#game'),width:640,height:360,backgroundColor:'#172c32',scene:{
 preload(){this.load.${format==='png'?'image':'svg'}('lantern','${operation.output}'${format==='svg'?',{width:256,height:256}':''});},
 create(){const illustration=this.add.image(220,185,'lantern').setScale(.85);this.input.keyboard.on('keydown-SPACE',()=>{illustration.x+=120;});}}});`
      :`import {Engine,Scene,FreeCamera,Vector3,MeshBuilder,StandardMaterial,Texture,Color3,Color4} from 'babylonjs';
const engine=new Engine(document.querySelector('#game'),true,{preserveDrawingBuffer:true});const scene=new Scene(engine);scene.clearColor=new Color4(.09,.17,.2,1);
const camera=new FreeCamera('camera',new Vector3(0,0,-7),scene);camera.setTarget(Vector3.Zero());
const illustration=MeshBuilder.CreatePlane('illustration',{size:3.5},scene);illustration.position.x=-1;
const material=new StandardMaterial('ink',scene);const texture=new Texture('${operation.output}',scene,false,true);texture.hasAlpha=true;
material.diffuseTexture=texture;material.useAlphaFromDiffuseTexture=true;material.disableLighting=true;material.emissiveColor=Color3.White();material.backFaceCulling=false;illustration.material=material;
window.addEventListener('keydown',event=>{if(event.code==='Space')illustration.position.x+=1.5;});engine.runRenderLoop(()=>scene.render());window.addEventListener('resize',()=>engine.resize());`;
    const current=(await client.getGameRevision(project.id)).document;
    const files=new Map([["game.web.json",JSON.stringify({schemaVersion:1,engineVersion:name==="phaser"?"4.2.1":"9.35.0",entry:"src/main.ts"})],["src/main.ts",source],
      ["data/playtests.json",JSON.stringify({schemaVersion:1,viewport:{width:640,height:360},scenarios:[{id:`${name}-${format}-keyboard`,steps:[{action:"wait",ms:1500},{action:"capture",selector:"canvas",name:"before"},{action:"press",key:"Space"},{action:"wait",ms:200},{action:"expect-image",selector:"canvas",baseline:"before",comparison:"changed",threshold:.005},{action:"capture",selector:"canvas",name:"after"}]}]})]]);
    for(const [file,text] of files)current.files.push(await client.uploadGameFile(file,Buffer.from(text),file.endsWith(".json")?"application/json":"text/plain"));
    project=await client.commitGameRevision(project.id,`runtime-${name}`,2,current,"Exercise exact SVG candidate with native engine image loader");
    const build=await submit(()=>client.startGameBuild(`build-${name}`,project.id,3));const artifact=await client.getGameArtifact(build.id);
    for(const file of artifact.files){const bytes=await client.downloadGameArtifactFile(build.id,file.path);assert.equal(sha(bytes),file.sha256);await save(`${name}/build/${file.path}`,bytes);}
    const validation=await submit(()=>client.startGameValidation(`validate-${name}`,build.id,"web-browser-runtime-v1"));
    const reports=await client.getGameReports(build.id);assert.ok(reports.some(report=>report.testCase?.id===`${name}-${format}-keyboard`));
    const pixels=[];
    for(const report of reports){
      for(const check of report.checks)assert.equal(check.status,"passed",check.detail);
      for(const file of report.evidence??[]){
        const bytes=await client.downloadGameReportFile(report.id,file.path);assert.equal(sha(bytes),file.sha256);await save(`${name}/observations/${report.id}/${file.path}`,bytes);
        if(file.mime==="image/png"){
          const png=PNG.sync.read(bytes);let gold=0,teal=0;
          for(let i=0;i<png.data.length;i+=4){const [r,g,b,a]=png.data.subarray(i,i+4);if(a>240&&r>120&&g>70&&g<r&&b<g)gold++;if(a>240&&r<80&&g>60&&b>40&&g>r*1.3)teal++;}
          pixels.push({path:file.path,sha256:file.sha256,width:png.width,height:png.height,goldPixels:gold,tealPixels:teal});
        }
      }
    }
    assert.ok(pixels.some(image=>image.goldPixels>1000&&image.tealPixels>500),"Actual vector color/gradient silhouette must render, not only a blank canvas or missing-texture placeholder");
    const quality=await client.getGameQuality(project.id);assert.equal(quality.ready,false);
    evidence.push({project,result,build,artifact,validation,reports,pixels,quality});
    await save("integration-evidence.json",Buffer.from(JSON.stringify({schemaVersion:1,purpose:"Authored deterministic vector worker + restart/application + real Phaser/Babylon rendering and keyboard fixture; no autonomous game, native UI, physical devices or human/artistic acceptance",engine:info,manifest:JSON.parse(await readFile(path.join(engine,"manifest.json"),"utf8")),results:evidence,fullProductAcceptance:false},null,2)));
  }
  console.log(`PACKAGED_VECTOR_OK engines=${evidence.length} ${output}`);
}catch(error){await save("failure.json",Buffer.from(JSON.stringify({error:String(error.stack??error),stateDirectory:state,terminal,completedEngines:evidence.length},null,2)));throw error;}
finally{
  await save("service.log",Buffer.from(log));
  if(terminal){await stop();await rm(state,{recursive:true,force:true});}
  else{client?.close();child?.unref();console.error(`Original service/job preserved: ${state} pid=${child?.pid}`);}
}
