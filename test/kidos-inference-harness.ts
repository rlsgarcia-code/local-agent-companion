/** Explicit disposable-Linux qualification. Never an engine/release entrypoint. */
import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { appendFile, mkdir, readFile, readdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { PNG } from "pngjs";
import { AgentService } from "../packages/agent-service/src/service";
import { Store } from "../packages/agent-service/src/store";
import { LocalServer } from "../packages/agent-service/src/server";
import { createClientCredential, ensureIdentity, ipcPath } from "../packages/agent-service/src/security";
import { loadSignedAdapter } from "../packages/agent-service/src/installed-adapter";
import { enforceSystemProvisioning } from "../packages/agent-service/src/provisioning";
import { AgentClient } from "../packages/client-ts/src/index";
import { contentHash } from "../packages/contracts/src/identity";
import type { ClientCredential, Registration, Run, Session } from "../packages/contracts/src/index";
import type { GameDocument } from "../packages/contracts/src/games";
import { fixtureGameDesign } from "./game-fixtures";
import { gameAssetSpec } from "../packages/contracts/src/game-assets";
import { gameMediaToolchain } from "../packages/adapter-game-assets/src/media-toolchain";
import { gameBrowserCandidateToolchain } from "../packages/adapter-game-browser/src/candidate-toolchain";

const root="/qualification",shared=path.join(root,"shared"),state=path.join(root,"child/service");
const sha=(data:Uint8Array)=>createHash("sha256").update(data).digest("hex");
const json=async(file:string)=>JSON.parse(await readFile(file,"utf8"));
const save=async(file:string,value:unknown,mode=0o600)=>writeFile(file,JSON.stringify(value,null,2)+"\n",{mode});
const pause=()=>new Promise(resolve=>setTimeout(resolve,20));
const resultText=(run:Run)=>(run.result as {text?:unknown}|undefined)?.text;
async function guard(){
 assert.equal(process.platform,"linux");assert.equal(await readFile(root+"/.disposable-inference-qualification","utf8"),"fixture-only\n");
 assert.equal(process.versions.node,"22.23.4");
}

async function provision(){
 assert.equal(process.getuid!(),0);await mkdir(shared,{mode:0o755});
 const directory=shared+"/adapter";await mkdir(directory,{mode:0o755});
 for(const [source,destination] of [["adapter.cjs","domain-adapter.cjs"],["inference.cjs","inference.cjs"],["production.cjs","production.cjs"],["core-exchange.cjs","core-exchange.cjs"],["media.cjs","media.cjs"],["validation.cjs","validation.cjs"],["inference_fixture_bridge.py","fixture_bridge.py"]])
  await writeFile(path.join(directory,destination!),await readFile("/inputs/"+source!),{mode:0o644});
 const sourceManifest=await readFile("/inputs/source-manifest.json"),pin={version:"development-inference-composition",commit:"0".repeat(40),manifestSha256:sha(sourceManifest)};
 const catalog=await json("/inputs/catalog.json");catalog.protectedInference={schema:1,projects:{schema:1}};catalog.engine={...pin,sdkManifestSha256:"0".repeat(64)};
 const compilerLock=await json("/inputs/fixture-compiler/game-runtimes/runtime.lock.json"),implementation=sha(await readFile("/inputs/fixture-compiler/game-runtimes/runtime.lock.json"));
 catalog.gameProduction={schema:1,budgetPolicyABI:2,projectBudgets:{schema:1},queueAdmission:{schema:1},adapters:compilerLock.engines.map((row:any)=>({id:`kidos-core-${row.engine}-v1`,engine:row.engine,
  toolchain:{id:`web-${row.engine}`,version:`${row.version}+esbuild.${compilerLock.compiler.version}.adapter.1`,sha256:contentHash({runtime:row,compiler:compilerLock.compiler,adapterABI:1,implementation})}}))};
 const mediaPin=sha(await readFile(root+'/media-runtime/manifest.json'));
 catalog.gameMedia={schema:1,implementation_sha256:mediaPin,toolchain:gameMediaToolchain(mediaPin)};
 catalog.gameValidation={schema:1,implementation_sha256:mediaPin,browser_manifest_sha256:'e'.repeat(64),browser_component_manifest_sha256:'f'.repeat(64),
   browser_target:'linux-x64',toolchain:gameBrowserCandidateToolchain(mediaPin,'e'.repeat(64),'f'.repeat(64))};
 await save(directory+"/catalog.json",catalog,0o644);
 // Only desktop context/final presentation are fixtures. Model transport keeps
 // its production fixed paths/ownership; inspection reaches the real authority.
 const wrapper=`const {spawn}=require('node:child_process'),path=require('node:path');
 module.exports.createAdapter=api=>require('./domain-adapter.cjs').createAdapter({...api,bridge:(request,signal)=>new Promise((resolve,reject)=>{
 const child=spawn('/usr/bin/python3',['-I','-S',path.join(__dirname,'fixture_bridge.py')],{signal,stdio:['pipe','pipe','pipe'],env:{PATH:'/usr/bin:/bin',LANG:'C.UTF-8'}});
 let size=0,parts=[];child.stdout.on('data',data=>{size+=data.length;if(size>1048576){child.kill();reject(Error('Fixture bound'));}else parts.push(data);});
 child.stderr.resume();child.stdin.on('error',()=>{});child.once('error',reject);child.once('close',code=>{try{const row=JSON.parse(Buffer.concat(parts));if(code!==0||row.ok!==true)throw Error('Fixture bridge refused');resolve(row.result);}catch(error){reject(error);}});child.stdin.end(JSON.stringify(request));})});`;
 await writeFile(directory+"/adapter.cjs",wrapper,{mode:0o644});
 const files:Record<string,string>={};for(const name of await readdir(directory))files[name]=sha(await readFile(path.join(directory,name)));
 const bytes=Buffer.from(JSON.stringify({schema:1,product:"kidos",protocol:"1.0",entry:"adapter.cjs",files})),keys=generateKeyPairSync("ed25519");
 await writeFile(directory+"/manifest.json",bytes,{mode:0o644});await writeFile(directory+"/manifest.sig",sign(null,bytes,keys.privateKey),{mode:0o644});
 const descriptor=shared+"/descriptor.json",publicKey=shared+"/fixture.pub";
 await save(descriptor,{schema:1,directory,manifestSha256:sha(bytes)},0o644);
 await writeFile(publicKey,keys.publicKey.export({format:"pem",type:"spki"}),{mode:0o644});
 const registration:Registration={id:"inference-composition",product:"kidos",profile:"1000",workspace:"",providers:["kidos-gateway"],hostTools:catalog.tools.map((row:any)=>row.name),toolCatalog:catalog.tools};
 await save("/etc/kidos/agent-policy.json",{schema:1,clients:[{uid:1000,id:registration.id,registrationSha256:contentHash(registration)}]},0o644);
 await save(shared+"/config.json",{descriptor,publicKey,pin,registration},0o644);
}

async function serve(){
 assert.equal(process.getuid!(),1000);const config=await json(shared+"/config.json");
 const adapter=await loadSignedAdapter(config.descriptor,config.publicKey,{engine:config.pin});
 const service=new AgentService(new Store(state+"/metadata.sqlite"),state,undefined,{}, {adapter,deferRecovery:true});
 service.store.register(await json(root+"/child/client.json") as ClientCredential);
 const server=new LocalServer(service,state);await server.listen();
 for(const signal of ["SIGINT","SIGTERM"] as const)process.once(signal,()=>{void server.close().finally(()=>process.exit(0));});
}

async function run(){
 assert.equal(process.getuid!(),1000);const config=await json(shared+"/config.json"),registration=config.registration as Registration;
 enforceSystemProvisioning(registration);
 assert.throws(()=>enforceSystemProvisioning({...registration,product:"companion-mac"}));
 assert.throws(()=>enforceSystemProvisioning({...registration,profile:"1001"}));
 assert.throws(()=>enforceSystemProvisioning({...registration,hostTools:[...registration.hostTools,"shell"]}));
 await mkdir(state,{mode:0o700});const credential=await createClientCredential(state,registration),identity=await ensureIdentity(state);
 await save(root+"/child/client.json",credential);
 let child:ChildProcess|undefined,client:AgentClient|undefined,sequence=0;const cases:string[]=[],observations:unknown[]=[];
 async function control(action:string,projectId?:string){
  const id=++sequence;await save(root+"/child/control-request.json",{id,action,...(projectId?{project_id:projectId}:{})});const deadline=Date.now()+15000;
  for(;;){const row=await json(root+"/child/control-response.json").catch(()=>null);if(row?.id===id){assert.equal(row.ok,true,JSON.stringify(row));return row.result;}
   if(Date.now()>deadline)throw Error("Fixture control timed out");await pause();}
 }
 async function stop(){
  client?.close();client=undefined;
  if(child){if(child.exitCode===null&&child.signalCode===null){const exited=new Promise<void>(resolve=>child!.once("exit",()=>resolve()));child.kill("SIGKILL");await exited;}child=undefined;}
  await unlink(ipcPath(state)).catch(error=>{if(error.code!=="ENOENT")throw error;});
 }
 async function connect(){const candidate=new AgentClient({address:ipcPath(state),certificate:identity.cert,credential});try{await candidate.connect();client=candidate;}catch(error){candidate.close();throw error;}}
 async function boot(){
  child=spawn(process.execPath,[process.argv[1]!,"--serve"],{stdio:["ignore","pipe","pipe"],env:process.env});
  for(const stream of [child.stdout,child.stderr])stream?.on("data",data=>{void appendFile(root+"/child/service.log",data,{mode:0o600});});
  const deadline=Date.now()+20000;
  for(;;){if(child.exitCode!==null||child.signalCode!==null)throw Error("Fixture service exited; inspect its private log");try{await connect();return;}catch{client?.close();if(Date.now()>deadline)throw Error("Fixture service not ready");await pause();}}
 }
 async function get(id:string){return client!.call<Run>("runs.get",{id});}
 async function until(id:string,predicate:(run:Run)=>boolean){
  const deadline=Date.now()+30000;for(;;){const value=await get(id);if(predicate(value))return value;
   if(["failed","cancelled"].includes(value.state))throw Error(JSON.stringify(value));if(Date.now()>deadline)throw Error("Run did not reach the expected state: "+JSON.stringify(value));await pause();}
 }
 async function start(key:string,runtime:"standard"|"deep"="standard",projectId?:string){
  const session=await client!.call<Session>("sessions.create",{title:key});
  if(projectId)await client!.selectGameProject(session.id,projectId);
  const spec={runtime,mode:"execute",provider:{kind:"kidos-gateway",endpoint:"http://127.0.0.1:8788",roles:{executor:"managed-by-guardian"}},messages:[{role:"user",content:"Read-only native inference fixture."}],systemPrompt:"UI must not override product instructions",tools:registration.toolCatalog,productContext:{surface:"terminal"},recursionLimit:40};
  return {session,spec,run:await client!.startRun(session.id,key,spec)};
 }
 try{
  await boot();const info=await client!.call<{capabilities:string[]}>("engine.info",{});assert.ok(info.capabilities.includes("installed-inference-inspection-v1"));
  cases.push("root-provisioned-product-profile-and-tool-boundaries");
  for(const runtime of ["standard","deep"] as const){
   const item=await start(runtime,runtime),done=await until(item.run.id,value=>value.state==="completed");assert.equal(resultText(done),"Fixture completed.");
   const before=await control("snapshot");assert.equal((await client!.startRun(item.session.id,runtime,item.spec)).id,item.run.id);
   assert.deepEqual(await control("snapshot"),before);observations.push({runtime,runId:item.run.id});cases.push(runtime+"-graph-through-signed-adapter-and-real-uid-gateway");
  }
  await control("provider.hold");const detached=await start("detached");await control("provider.wait-held");
  client!.close();client=undefined;await control("provider.release");await connect();
  assert.equal(resultText(await until(detached.run.id,value=>value.state==="completed")),"Fixture completed.");cases.push("disconnected-sdk-does-not-cancel-independent-inference");
  await control("provider.hold");const inflight=await start("inflight-sigkill");await control("provider.wait-held");
  const held=await control("snapshot");await stop();await boot();
  assert.equal((await get(inflight.run.id)).state,"awaiting_reconciliation");
  assert.equal((await client!.inspectInference(inflight.run.id)).state,"awaiting_reconciliation");assert.deepEqual(await control("snapshot"),held);
  await client!.call("runs.cancel",{id:inflight.run.id});await control("provider.release");await control("resolve.settled-original");
  const settled=await control("snapshot");assert.equal((await client!.inspectInference(inflight.run.id)).state,"cancelled");
  await client!.call("runs.resume",{id:inflight.run.id});assert.deepEqual(await control("snapshot"),settled);
  observations.push({inflightHeld:held,inflightSettled:settled});cases.push("service-sigkill-during-active-provider-retains-admission-until-original-settles");
  await control("provider.normal");await control("policy.disable");const denied=await start("disabled");
  const waiting=await until(denied.run.id,value=>value.state==="awaiting_host");assert.equal(waiting.waitingFor,"protected-inference");
  const before=await control("snapshot");await stop();await boot();assert.equal((await get(denied.run.id)).state,"awaiting_host");
  assert.deepEqual(await control("snapshot"),before);await control("policy.enable");await client!.call("runs.resume",{id:denied.run.id});
  assert.equal(resultText(await until(denied.run.id,value=>value.state==="completed")),"Fixture completed.");cases.push("policy-refusal-restart-and-explicit-resume");
  await control("provider.truncated");const interrupted=await start("unknown");
  assert.equal((await until(interrupted.run.id,value=>value.state==="awaiting_reconciliation")).waitingFor,"protected-inference");
  const unknown=await control("snapshot");await assert.rejects(client!.call("runs.resume",{id:interrupted.run.id}));
  await assert.rejects(client!.call("inference.inspect",{runId:interrupted.run.id,result:{state:"completed"}}));
  assert.equal((await client!.inspectInference(interrupted.run.id)).state,"awaiting_reconciliation");
  await client!.call("runs.cancel",{id:interrupted.run.id});await stop();await boot();
  assert.equal((await get(interrupted.run.id)).state,"awaiting_reconciliation");assert.deepEqual(await control("snapshot"),unknown);
  await control("resolve.unknown");const resolved=await control("snapshot");assert.equal((await client!.inspectInference(interrupted.run.id)).state,"cancelled");
  await client!.call("runs.resume",{id:interrupted.run.id});assert.deepEqual(await control("snapshot"),resolved);
  cases.push("unknown-result-service-sigkill-inspection-and-cancel-without-replay");observations.push({unknown,resolved});
  await control("provider.normal");
  const document:GameDocument={schemaVersion:2,title:"Allocated fixture",engine:"phaser",brief:{request:"Fixture",audience:"Fixture",genre:"arcade",dimension:"2d",playMode:"single-player",players:{min:1,max:1},devices:["desktop"],inputs:["keyboard"]},design:null,files:[],assets:[]};
  const project=await client!.createGameProject("budget-project",document),other=await client!.createGameProject("other-project",document);
  const unapproved=await start("unapproved-project","standard",other.id);
  assert.equal((await until(unapproved.run.id,value=>value.state==="awaiting_host")).waitingFor,"protected-inference");
  await client!.call("runs.cancel",{id:unapproved.run.id});
  const allocation=await control("project.create",project.id);
  const first=await start("allocated-first","standard",project.id);await until(first.run.id,value=>value.state==="completed");
  const exhausted=await start("allocated-second","standard",project.id);await until(exhausted.run.id,value=>value.state==="awaiting_host");
  const beforeProject=await control("snapshot");await stop();await boot();
  await assert.rejects(client!.selectGameProject(exhausted.session.id,other.id),/active conversation/);await control("project.advance",project.id);
  await client!.call("runs.resume",{id:exhausted.run.id});await until(exhausted.run.id,value=>value.state==="completed");
  const projectState=await control("project.get",project.id);assert.equal(projectState.stages.design.calls,2);assert.equal(projectState.stages.core.calls,2);
  assert.equal(projectState.ref,allocation.ref);observations.push({projectBefore:beforeProject,project:projectState});
  cases.push("root-project-stage-quota-and-original-selection-survive-service-restart");
  await control("build.hold");
  const lock=await json("/inputs/fixture-compiler/game-runtimes/runtime.lock.json"),version=lock.engines.find((row:any)=>row.engine==="phaser").version;
  const files:{path:string;mime:"application/json"|"text/plain";data:Buffer}[]=[{path:"game.web.json",mime:"application/json",data:Buffer.from(JSON.stringify({schemaVersion:1,entry:"src/main.ts",engineVersion:version}))},
   {path:"src/main.ts",mime:"text/plain",data:Buffer.from("// public fixture; no real compiler executes it\n")}];
  const source:GameDocument={...document,design:fixtureGameDesign(),files:[]};
  for(const file of files){const transfer=await client!.upload("build-source-"+sha(file.data),file.data,file.mime);source.files.push({path:file.path,mime:file.mime,size:file.data.length,sha256:sha(file.data),transferId:transfer.id});}
  const buildProject=await client!.createGameProject("build-project",source);await control("project.build-create",buildProject.id);
  const job=await client!.startGameBuild("budget-build-first",buildProject.id,buildProject.revision),buildDeadline=Date.now()+45000;
  for(;;){const value=await control("build.snapshot"),executions=await control("build.executions"),current=await client!.getGameProduction(job.id);if(value.starts===1&&executions===1)break;
   if(['failed','cancelled','awaiting_reconciliation'].includes(current.state)||Date.now()>buildDeadline)throw Error('Build admission/dispatch fixture: '+JSON.stringify({state:current.state,error:current.error,starts:value.starts,executions}));await pause();}
  const queuedProject=await client!.createGameProject("queued-build-project",source);await control("project.build-create",queuedProject.id);
  const queued=await client!.startGameBuild("budget-build-queued",queuedProject.id,queuedProject.revision);
  for(;;){const value=await client!.getGameProduction(queued.id);if(value.state==='queued'&&value.admission==='reserved')break;if(value.state==='failed')throw Error(value.error);if(Date.now()>buildDeadline)throw Error("Queued admission was not confirmed");await pause();}
  assert.equal((await control("build.snapshot")).starts,2);assert.equal(await control("build.executions"),1);
  await client!.cancelGameProduction(queued.id);
  for(;;){const value=await client!.getGameProduction(queued.id);if(value.state==='cancelled')break;if(value.state==='awaiting_reconciliation')throw Error("Queued cancellation was not acknowledged");if(Date.now()>buildDeadline)throw Error("Queued cancellation timed out");await pause();}
  assert.equal((await control("build.snapshot")).starts,2);assert.equal(await control("build.executions"),1);
  observations.push({queuedJob:await client!.getGameProduction(queued.id),queuedProject:await control("project.get",queuedProject.id)});
  cases.push("protected-queue-admission-cancel-keeps-stage-debit-without-compiler-dispatch");
  await stop();await control("build.release");await boot();
  assert.equal((await client!.getGameProduction(job.id)).state,"awaiting_reconciliation");
  for(;;){const value=await client!.reconcileGameProduction(job.id);if(value.state==="completed")break;assert.equal(value.state,"awaiting_reconciliation");if(Date.now()>buildDeadline)throw Error("Original build did not reconcile");await pause();}
  const artifact=await client!.getGameArtifact(job.id);for(const file of artifact.files)assert.equal(sha(await client!.downloadGameArtifactFile(job.id,file.path)),file.sha256);
  const rejected=await client!.startGameBuild("budget-build-denied",buildProject.id,buildProject.revision);
  for(;;){const value=await client!.getGameProduction(rejected.id);if(value.state==="failed"){assert.match(value.error??"",/alocação/);break;}if(Date.now()>buildDeadline)throw Error("Stage budget was not enforced");await pause();}
  assert.equal((await control("build.snapshot")).starts,2);
  await control("project.continue-builds",buildProject.id);await control("inference.disable");
  const second=await client!.startGameBuild("budget-build-second",buildProject.id,buildProject.revision);
  for(;;){const value=await client!.getGameProduction(second.id);if(value.state==="completed")break;if(value.state==="failed")throw Error(value.error);if(Date.now()>buildDeadline)throw Error("Independent Core production failed");await pause();}
  assert.equal((await control("build.snapshot")).starts,3);assert.equal(await control("build.executions"),2);assert.equal((await client!.getGameQuality(buildProject.id)).ready,false);
  observations.push({buildProject:await control("project.get",buildProject.id),builds:await control("build.snapshot"),artifactFiles:artifact.files.length});
  cases.push("protected-build-stage-budget-recovery-and-core-independence-from-inference");
  const audio=gameAssetSpec.parse({processorId:'kidos-core-media-v1',target:{id:'tone',role:'Fixture tone'},operation:{type:'audio.render',output:'assets/tone.wav',sampleRate:22050,channels:1,durationMs:50,
    notes:[{waveform:'sine',frequency:440,startMs:0,durationMs:50,gain:0.2},{waveform:'sine',frequency:1200,startMs:0,durationMs:20,gain:1e-7,releaseMs:5}]}});
  async function terminal(id:string,expected='completed'){
    const deadline=Date.now()+45000;
    for(;;){const current=await client!.getGameProduction(id);if(current.state===expected)return current;
      if(['completed','failed','cancelled','awaiting_reconciliation'].includes(current.state)||Date.now()>deadline)throw Error('Media fixture: '+JSON.stringify(current));await pause();}
  }
  // Builds exhausted this project's exact stage. Switching producer cannot reset it.
  const mediaDenied=await client!.processGameAsset('shared-stage-denied',buildProject.id,1,audio);
  assert.match((await terminal(mediaDenied.id,'failed')).error??'',/alocação/);
  assert.equal((await control('build.snapshot')).starts,3);assert.equal(await control('media.executions'),0);
  const mediaSource=structuredClone(source);mediaSource.files=[];mediaSource.assets=[];
  for(const [id,width,height,color] of [['tiny',2,1,[255,0,0,255]],['green',180,180,[0,255,0,255]],['red',180,180,[255,0,0,255]]] as const){
    const png=new PNG({width,height});for(let i=0;i<png.data.length;i+=4)png.data.set(color,i);
    if(id==='tiny')png.data.set([0,0,255,0],4);
    const bytes=PNG.sync.write(png),transfer=await client!.upload('media-source-'+id,bytes,'image/png'),name='assets/'+id+'.png';
    mediaSource.files.push({path:name,mime:'image/png',size:bytes.length,sha256:sha(bytes),transferId:transfer.id});
    mediaSource.assets.push({id,kind:'image',role:'Synthetic pixels',files:[name],placeholder:true,origin:{kind:'procedural',source:'Local fixture pixels',author:'Fixture',license:'Synthetic test fixture',referenceIds:[]}});
  }
  const compose=gameAssetSpec.parse({processorId:'kidos-core-media-v1',target:{id:'final',role:'Composed fixture'},operation:{type:'image.compose',output:'assets/final.png',width:2,height:1,background:'#00ff00ff',
    layers:[{source:{assetId:'tiny',path:'assets/tiny.png'},x:0,y:0,width:2,height:1,flipX:true,filter:'nearest'}]}});
  const atlas=gameAssetSpec.parse({processorId:'kidos-core-media-v1',target:{id:'actors',role:'Atlas fixture'},operation:{type:'image.atlas',outputBase:'assets/actors',pageSize:256,maxPages:2,padding:2,trim:false,
    frames:[{id:'red',source:{assetId:'red',path:'assets/red.png'}},{id:'green',source:{assetId:'green',path:'assets/green.png'}}],animations:[{id:'blink',frames:['red','green'],fps:8,loop:true}]}});
  for(const [index,spec] of [compose,atlas,audio].entries()){
    const p=await client!.createGameProject('media-project-'+index,mediaSource);await control('project.build-create',p.id);
    if(index===0)await control('media.hold');
    const job=await client!.processGameAsset('real-media-'+index,p.id,1,spec);
    if(index===0){
      const deadline=Date.now()+45000;
      while(await control('media.executions')!==1){const current=await client!.getGameProduction(job.id);if(current.state==='failed'||Date.now()>deadline)throw Error('Media did not execute: '+JSON.stringify(current));await pause();}
      const q=await client!.createGameProject('queued-media',mediaSource);await control('project.build-create',q.id);
      const queued=await client!.processGameAsset('queued-media',q.id,1,audio);
      for(;;){const current=await client!.getGameProduction(queued.id);if(current.state==='queued'&&current.admission==='reserved')break;if(current.state==='failed'||Date.now()>deadline)throw Error('Media did not reserve: '+JSON.stringify(current));await pause();}
      assert.equal((await control('build.snapshot')).starts,5);await client!.cancelGameProduction(queued.id);await terminal(queued.id,'cancelled');
      assert.equal(await control('media.executions'),1);assert.equal((await control('project.get',q.id)).stages.design.production_by_kind.assets,1);
      await stop();await control('media.release');await boot();
      assert.equal((await client!.getGameProduction(job.id)).state,'awaiting_reconciliation');
      for(;;){const current=await client!.reconcileGameProduction(job.id);if(current.state==='completed')break;if(current.state!=='awaiting_reconciliation'||Date.now()>deadline)throw Error('Media did not recover: '+JSON.stringify(current));await pause();}
    }else await terminal(job.id);
    const result=await client!.getGameAssetResult(job.id),bytes=new Map<string,Buffer>();
    for(const file of result.files){const data=await client!.downloadGameAssetFile(job.id,file.path);assert.equal(sha(data),file.sha256);bytes.set(file.path,data);}
    if(index===0)assert.deepEqual([...PNG.sync.read(bytes.get('assets/final.png')!).data],[0,255,0,255,255,0,0,255]);
    if(index===1){const metadata=JSON.parse(bytes.get('assets/actors.atlas.json')!.toString());assert.equal(metadata.textures.length,2);assert.deepEqual(metadata.animations.blink,{frames:['red','green'],fps:8,loop:true});
      for(const [i,page] of metadata.textures.entries()){assert.equal(page.frames.length,1);assert.deepEqual([...PNG.sync.read(bytes.get('assets/'+page.image)!).data.subarray(0,4)],i?[0,255,0,255]:[255,0,0,255]);}}
    if(index===2){const wav=bytes.get('assets/tone.wav')!;assert.equal(wav.toString('ascii',0,4),'RIFF');assert.equal(wav.readUInt32LE(24),22050);assert.equal(wav.length,44+1103*2);assert.ok(wav.subarray(44).some(b=>b!==0));}
    assert.equal((await client!.getGameProject(p.id)).revision,1,'Processing cannot apply a candidate');
    assert.equal((await client!.applyGameAsset('apply-media-'+index,job.id,1)).revision,2);
    assert.equal((await client!.processGameAsset('real-media-'+index,p.id,1,spec)).id,job.id);
    assert.equal(await control('media.executions'),index+1);
    const allocation=await control('project.get',p.id);assert.equal(allocation.stages.design.production_requests,1);assert.deepEqual(allocation.stages.design.production_by_kind,{build:0,assets:1,validate:0});
    observations.push({media:spec.operation.type,jobId:job.id,recipeHash:result.recipeHash,filesVerified:result.files.length,allocation});
    cases.push('real-media-'+spec.operation.type+'-through-sdk-signed-port-core-and-root');
  }
  assert.equal((await control('build.snapshot')).starts,7);assert.equal(await control('media.executions'),3);
  const validationDenied=await client!.startGameValidation('validation-shared-stage-denied',second.id,'kidos-core-browser-v1');
  assert.match((await terminal(validationDenied.id,'failed')).error??'',/alocação/);
  assert.equal((await control('build.snapshot')).starts,7);assert.equal(await control('validation.executions'),0);
  cases.push('protected-validation-shares-root-stage-allocation-with-build-and-media');
  const validationBuilds=[];
  for(const name of ['first','queued']){
    const project=await client!.createGameProject('validation-project-'+name,source);await control('project.validation-create',project.id);
    const build=await client!.startGameBuild('validation-build-'+name,project.id,1);await terminal(build.id);
    validationBuilds.push({project,build});
  }
  const [firstValidation,queuedValidation]=validationBuilds;
  assert.equal((await control('build.snapshot')).starts,9);
  await control('validation.hold');
  const validating=await client!.startGameValidation('validation-first',firstValidation!.build.id,'kidos-core-browser-v1');
  const validationDeadline=Date.now()+45000;
  while(await control('validation.executions')!==1){
    const current=await client!.getGameProduction(validating.id);if(current.state==='failed'||Date.now()>validationDeadline)throw Error('Validation did not dispatch: '+JSON.stringify(current));await pause();
  }
  const validationQueued=await client!.startGameValidation('validation-queued',queuedValidation!.build.id,'kidos-core-browser-v1');
  for(;;){const current=await client!.getGameProduction(validationQueued.id);if(current.state==='queued'&&current.admission==='reserved')break;
    if(current.state==='failed'||Date.now()>validationDeadline)throw Error('Validation did not reserve before queue: '+JSON.stringify(current));await pause();}
  assert.equal((await control('build.snapshot')).starts,11);assert.equal(await control('validation.executions'),1);
  await client!.cancelGameProduction(validationQueued.id);await terminal(validationQueued.id,'cancelled');
  const queuedAllocation=await control('project.get',queuedValidation!.project.id);
  assert.equal(queuedAllocation.stages.design.production_requests,2);
  assert.deepEqual(queuedAllocation.stages.design.production_by_kind,{build:1,assets:0,validate:1});
  assert.equal(await control('validation.executions'),1);
  observations.push({queuedValidation:await client!.getGameProduction(validationQueued.id),queuedAllocation});
  cases.push('protected-validation-queued-cancel-preserves-root-debit-without-browser-dispatch');
  await stop();await control('validation.release');await boot();
  assert.equal((await client!.getGameProduction(validating.id)).state,'awaiting_reconciliation');
  for(;;){const current=await client!.reconcileGameProduction(validating.id);if(current.state==='completed')break;
    assert.equal(current.state,'awaiting_reconciliation');if(Date.now()>validationDeadline)throw Error('Original validation did not reconcile');await pause();}
  const reports=await client!.getGameReports(firstValidation!.build.id);
  assert.equal(reports.length,1);assert.equal(reports[0]!.checks[0]!.status,'unverified');
  assert.equal((await client!.startGameValidation('validation-first',firstValidation!.build.id,'kidos-core-browser-v1')).id,validating.id);
  assert.equal(await control('validation.executions'),1);assert.equal((await control('build.snapshot')).starts,11);
  assert.equal((await client!.getGameQuality(firstValidation!.project.id)).ready,false);
  observations.push({validationJob:validating.id,reports,allocation:await control('project.get',firstValidation!.project.id)});
  cases.push('protected-validation-sdk-signed-port-core-root-recovery-without-replay');
 }finally{await stop();}
 await save(root+"/child/service-report.json",{scope:"disposable-linux-root-authority-dedicated-gateway-uid-signed-adapter-sdk-service-simulated-provider-and-domain-context",state:"passed",cases,observations});
 console.log(JSON.stringify({state:"passed",cases:cases.length}));
}

for(const key of ["LANGCHAIN_TRACING_V2","LANGSMITH_TRACING","LANGSMITH_TRACING_V2"])process.env[key]="false";
void guard().then(()=>process.argv[2]==="--provision"?provision():process.argv[2]==="--serve"?serve():process.argv[2]==="--run"?run():Promise.reject(Error("Select explicit qualification mode"))).catch(error=>{console.error(error);process.exitCode=1;});
