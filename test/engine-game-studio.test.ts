import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { PNG } from "pngjs";
import { mkdtemp,rm,mkdir,readFile,writeFile,readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { AgentService } from "../packages/agent-service/src/service";
import { Store } from "../packages/agent-service/src/store";
import { LocalServer } from "../packages/agent-service/src/server";
import { ensureIdentity,createClientCredential,ipcPath } from "../packages/agent-service/src/security";
import { AgentClient } from "../packages/client-ts/src/index";
import { GameStudioController,type GameStudioHost,type GameStudioSnapshot } from "../packages/client-ts/src/game-studio";
import { exportGameDirectory } from "../packages/client-ts/src/game-export";
import { createWebGameAdapters } from "../packages/adapter-game-web/src/index";
import { createLocalGameAssetProcessor } from "../packages/adapter-game-assets/src/index";
import {gameAssetSpec,type GameAssetResult} from "../packages/contracts/src/game-assets";
import type { Registration,Session } from "../packages/contracts/src/index";
import { fixtureGameDocument } from "./game-fixtures";
import { webFixture } from "./game-web-fixtures";
import { vectorIllustrationFixture } from "./game-vector-fixtures";
import {createGameLibraryProcessor} from "../packages/adapter-game-library/src/index";
import type {GameLibraryPage} from "../packages/contracts/src/game-library";
import {decodeWave} from "../packages/adapter-game-assets/src/audio";
import type {GameAssetProcessor} from "../packages/game-production/src/index";
import {fixtureSkinnedModelOperation} from "./game-blender-fixtures";

async function fixture(extra:GameAssetProcessor[]=[]){
  const directory=await mkdtemp(path.join(tmpdir(),"studio-ipc-")),reg:Registration={id:"studio",product:"companion-mac",profile:"default",workspace:"",providers:["ollama"],hostTools:[]};
  const service=new AgentService(new Store(path.join(directory,"state.sqlite")),directory,undefined,{}, {gameAdapters:createWebGameAdapters(path.resolve("packages/adapter-game-web/runtimes")),gameAssetProcessors:[createLocalGameAssetProcessor(),await createGameLibraryProcessor({directory:path.resolve("packages/adapter-game-library/libraries")}),...extra]});
  const identity=await ensureIdentity(directory),credential=await createClientCredential(directory,reg);service.store.register(credential);
  const server=new LocalServer(service,directory);await server.listen();const client=new AgentClient({address:ipcPath(directory),certificate:identity.cert,credential});await client.connect();
  const session=await client.call<Session>("sessions.create",{title:"Game Studio"}),host:GameStudioHost={canWrite:()=>true,approve:async()=>true,preview:async()=>{},exportSource:async()=>false,exportBuild:async()=>false,exportAsset:async()=>false};
  const controller=new GameStudioController(client,session.id,host);
  async function project(key="create"){
    const document=fixtureGameDocument();for(const [name,text] of webFixture("phaser"))document.files.push(await client.uploadGameFile(name,Buffer.from(text),"text/plain"));
    return client.createGameProject(key,document);
  }
  async function wait(id:string){for(let i=0;i<500;i++){const job=await client.getGameProduction(id);if(!["running","queued"].includes(job.state))return job;await new Promise((resolve)=>setTimeout(resolve,5));}throw new Error("Build did not settle");}
  return {directory,service,server,client,session,host,controller,project,wait,async close(){client.close();await server.close();await service.close();await rm(directory,{recursive:true,force:true});}};
}

test("historical media inspection binds revision, asset, exact bytes and selection without writes or consent",async()=>{
  const f=await fixture();try{
    const png=(color:number)=>{const image=new PNG({width:16,height:16});for(let i=0;i<image.data.length;i+=4)image.data.set([color,90,140,255],i);return PNG.sync.write(image);};
    const first=png(10),second=png(200),document=fixtureGameDocument();
    document.files=[await f.client.uploadGameFile("assets/picture.png",first,"image/png"),await f.client.uploadGameFile("assets/unowned.png",first,"image/png"),await f.client.uploadGameFile("assets/vector.svg",Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'),"image/svg+xml"),await f.client.uploadGameFile("assets/large.png",Buffer.alloc(4*1024*1024+1),"image/png")];
    document.assets=[{id:"picture",kind:"image",role:"Synthetic comparison input",placeholder:true,files:["assets/picture.png","assets/vector.svg","assets/large.png"],origin:{kind:"procedural",author:"Test",source:"Synthetic data",license:"Test only",referenceIds:[]}}];
    let project=await f.client.createGameProject("media-origin",document);await f.client.selectGameProject(f.session.id,project.id);
    const secondFile=await f.client.uploadGameFile("assets/picture.png",second,"image/png");
    project=await f.client.commitGameRevision(project.id,"media-second",1,{...document,files:[secondFile,...document.files.slice(1)]},"Changed image");
    const third=await f.client.getGameRevision(project.id);project=await f.client.commitGameRevision(project.id,"media-third",2,{...third.document,title:"Later work"},"Preserve earlier comparison");
    f.host.canWrite=()=>false;f.host.approve=async()=>{throw Error("Reading must not request write consent");};
    const command={action:"revision-media",projectId:project.id,revision:1,path:"assets/picture.png",sha256:document.files[0]!.sha256};
    const a=await f.controller.dispatch(command) as {data:string;revision:number;sha256:string},b=await f.controller.dispatch({...command,revision:2,sha256:secondFile.sha256}) as {data:string;revision:number};
    assert.deepEqual(Buffer.from(a.data,"base64"),first);assert.deepEqual(Buffer.from(b.data,"base64"),second);assert.equal(a.revision,1);assert.equal(b.revision,2);
    await assert.rejects(f.controller.dispatch({...command,sha256:secondFile.sha256}),/hash desta revisão/);
    await assert.rejects(f.controller.dispatch({...command,revision:0}),{name:"ZodError"});
    await assert.rejects(f.controller.dispatch({...command,namespace:"other"}),{name:"ZodError"});
    for(const file of document.files.slice(1))await assert.rejects(f.controller.dispatch({...command,path:file.path,sha256:file.sha256}),file.path.includes("unowned")?/asset e hash/:/comparação aceita/);
    const download=f.client.downloadGameFile.bind(f.client);
    f.client.downloadGameFile=async()=>Buffer.alloc(first.length);await assert.rejects(f.controller.dispatch(command),/bytes não correspondem/);f.client.downloadGameFile=download;
    const other=await f.project("media-other");f.client.downloadGameFile=async(...args)=>{const data=await download(...args);await f.client.selectGameProject(f.session.id,other.id);return data;};
    await assert.rejects(f.controller.dispatch(command),/selecionado mudou/);f.client.downloadGameFile=download;
    await assert.rejects(f.controller.dispatch(command),/selecionado mudou/);await f.client.selectGameProject(f.session.id,project.id);
    assert.equal((await f.client.getGameProject(project.id)).revision,3);assert.equal((await f.client.listGameProduction(project.id)).jobs.length,0);
    assert.deepEqual(await f.client.downloadGameFile(project.id,"assets/picture.png",1),first);
  }finally{await f.close();}
});

test("model recipe editing binds sources, consent and exact replay without allowing new GLB/texture access or applying candidates",async()=>{
  let processed=0;
  // Policy fixture only: real Blender/browser deformation is qualified separately.
  const processor:GameAssetProcessor={id:"blender-model-isolated-v1",products:["companion-mac"],authority:"workspace",operations:["model.scene"],toolchain:{id:"policy-fixture",version:"1",sha256:"1".repeat(64)},
    resources:{memoryMiB:16,cpuSlots:1,exclusiveGroups:[]},async probe(){return {available:true};},async process(access){processed++;assert.equal(access.spec.operation.type,"model.scene");if(access.spec.operation.type!=="model.scene")throw Error("Policy fixture only accepts model recipes");const base=access.spec.operation.outputBase;return {files:[[".glb","model/gltf-binary"],[".blend","application/octet-stream"],[".preview.png","image/png"],[".model.json","application/json"]].map(([suffix,mime])=>({path:base+suffix,mime:mime!,data:Buffer.from(JSON.stringify(access.spec.operation))})),info:{fixture:true}};}};
  const f=await fixture([processor]);try{
    let p=await f.project();const other=await f.project("other-model");await f.client.selectGameProject(f.session.id,p.id);
    const original=await f.client.processGameAsset("original-model",p.id,1,{processorId:processor.id,target:{id:"sleeve",role:"Policy fixture, not rendered geometry",placeholder:true},operation:fixtureSkinnedModelOperation()});
    assert.equal((await f.wait(original.id)).state,"completed");const result=await f.client.getGameAssetResult(original.id);assert.equal(result.spec.operation.type,"model.scene");
    if(result.spec.operation.type!=="model.scene")throw Error("Missing model operation");
    const operation=structuredClone(result.spec.operation);operation.materials[0]!.color="#4499ccff";operation.objects[0]!.rotation[2]=10;operation.clips[0]!.tracks[0]!.keys[1]!.value[2]=-35;
    const command={action:"adjust-model",projectId:p.id,jobId:original.id,expectedRevision:1,requestId:"directed-model",operation};
    const reject=async(input:unknown,pattern:RegExp)=>{const value=await f.controller.dispatch(input) as {imageAdjustmentRejected:boolean;message:string};assert.equal(value.imageAdjustmentRejected,true);assert.match(value.message,pattern);};
    let approvals=0;f.host.approve=async()=>{approvals++;return true;};
    await reject({...command,operation:{...operation,outputBase:"assets/forged"}},/pasta de saída/);
    await reject({...command,operation:{...operation,materials:[{...operation.materials[0],texture:{assetId:"foreign",path:"assets/secret.png"}}]}},/texturas registrados/);
    await reject({...command,operation:{...operation,objects:[{id:"foreign",geometry:{kind:"glb",source:{assetId:"foreign",path:"assets/secret.glb"}}}]}},/modelos e texturas/);
    const invalid=structuredClone(operation);invalid.objects[0]!.skin!.weights[0]=[{bone:"base",weight:.2}];await reject({...command,operation:invalid},/pesos/);
    await reject({...command,operation:{...operation,python:"forged"}},/inválidos/);assert.equal(approvals,0);assert.equal(processed,1);
    f.host.canWrite=()=>false;await reject(command,/modo de edição/);f.host.canWrite=()=>true;
    f.host.approve=async()=>false;assert.deepEqual(await f.controller.dispatch(command),{cancelled:true});assert.equal(processed,1);
    f.host.approve=async()=>{await f.client.selectGameProject(f.session.id,other.id);return true;};await reject(command,/projeto ou a revisão/);await f.client.selectGameProject(f.session.id,p.id);
    f.host.approve=async()=>{f.host.canWrite=()=>false;return true;};await reject(command,/modo de edição/);f.host.canWrite=()=>true;
    f.host.approve=async()=>{const revision=await f.client.getGameRevision(p.id);p=await f.client.commitGameRevision(p.id,"concurrent-model",1,{...revision.document,title:"Later work"},"Later work");return true;};await reject(command,/revisão mudou/);assert.equal(processed,1);
    const request={...command,expectedRevision:2};f.host.approve=async()=>true;const process=f.client.processGameAsset.bind(f.client);
    f.client.processGameAsset=async(...args)=>{await process(...args);throw Error("Lost model processing acknowledgment");};await assert.rejects(f.controller.dispatch(request),/Lost model/);f.client.processGameAsset=process;
    const resumed=await f.controller.dispatch(request) as {requestedAssetJobId:string};assert.ok(resumed.requestedAssetJobId);assert.equal((await f.wait(resumed.requestedAssetJobId)).state,"completed");
    assert.equal(processed,2);assert.equal((await f.client.listGameProduction(p.id)).jobs.length,2);assert.equal((await f.client.getGameProject(p.id)).revision,2);
    const variant=await f.client.getGameAssetResult(resumed.requestedAssetJobId);assert.deepEqual(variant.spec.operation,operation);assert.equal(variant.asset.placeholder,true);
    assert.deepEqual((await f.client.getGameAssetResult(original.id)).spec.operation,result.spec.operation);
    await assert.rejects(f.controller.dispatch({...request,operation:{...operation,fps:24}}),/different|outro conteúdo/);assert.equal(processed,2);
  }finally{await f.close();}
});

test("Studio playtests keep native consent, exact build/project and read-only receipt recovery without duplicating withdrawn observations",async()=>{
  const f=await fixture();
  try{
    const project=await f.project();await f.client.selectGameProject(f.session.id,project.id);
    const build=await f.client.startGameBuild("playtest-build",project.id,1);assert.equal((await f.wait(build.id)).state,"completed");
    const create={action:"create-playtest",projectId:project.id,requestId:"create-study",buildId:build.id,title:"Synthetic round",audience:"Fixture only; no actual people"};
    let approvals=0;f.host.approve=async()=>{approvals++;return true;};f.host.canWrite=()=>false;
    assert.equal((await f.controller.dispatch(create) as {playtestEditRejected:boolean}).playtestEditRejected,true);assert.equal(approvals,0);
    f.host.canWrite=()=>true;f.host.approve=async()=>false;assert.deepEqual(await f.controller.dispatch(create),{cancelled:true});assert.equal((await f.client.listGamePlaytests(project.id)).studies.length,0);
    f.host.approve=async()=>{f.host.canWrite=()=>false;return true;};assert.equal((await f.controller.dispatch(create) as {playtestEditRejected:boolean}).playtestEditRejected,true);
    f.host.canWrite=()=>true;f.host.approve=async()=>{approvals++;return true;};
    const realCreate=f.client.createGamePlaytest.bind(f.client);let creations=0;
    f.client.createGamePlaytest=async(...args)=>{creations++;await realCreate(...args);throw Error("Lost study acknowledgment");};
    await assert.rejects(f.controller.dispatch(create),/Lost study/);f.client.createGamePlaytest=realCreate;
    f.host.canWrite=()=>false;f.host.approve=async()=>{throw Error("Read-only acknowledgment must not ask for mutation consent");};
    const recovered=await f.controller.dispatch({action:"resume-playtest",projectId:project.id,command:create}) as {studyId:string;recovered:boolean};
    assert.equal(recovered.recovered,true);assert.equal(creations,1);assert.equal((await f.client.listGamePlaytests(project.id)).studies.length,1);
    const study=(await f.client.getGamePlaytest(recovered.studyId)).study;
    const record={action:"record-playtest",projectId:project.id,artifactHash:study.artifactHash,request:{requestId:"record-once",studyId:study.id,participantId:randomUUID(),consentConfirmed:true,distinctParticipantConfirmed:true,
      understoodWithoutHelp:false,actionSeconds:null,experienceScore:2,environment:{platform:"synthetic",device:"No actual person",browser:"fixture",input:["keyboard"]},notes:"Private synthetic observation"}};
    f.host.canWrite=()=>true;f.host.approve=async()=>true;
    const realRecord=f.client.recordGamePlaytest.bind(f.client);let records=0;
    f.client.recordGamePlaytest=async(...args)=>{records++;await realRecord(...args);throw Error("Lost observation acknowledgment");};
    await assert.rejects(f.controller.dispatch(record),/Lost observation/);f.client.recordGamePlaytest=realRecord;
    const withdrawal={action:"withdraw-playtest",projectId:project.id,artifactHash:study.artifactHash,request:{requestId:"withdraw-once",studyId:study.id,participantId:record.request.participantId,consentWithdrawalConfirmed:true}};
    assert.equal((await f.controller.dispatch(withdrawal) as {withdrawn:boolean}).withdrawn,true);
    f.host.canWrite=()=>false;f.host.approve=async()=>{throw Error("Readback must not dispatch or approve another effect");};
    assert.deepEqual(await f.controller.dispatch({action:"resume-playtest",projectId:project.id,command:record}),{playtestMutationAcknowledged:true,studyId:study.id,withdrawn:true,recovered:true});assert.equal(records,1);
    const read=await f.client.getGamePlaytest(study.id);assert.equal(read.summary.active,0);assert.equal(read.summary.withdrawn,1);assert.equal(read.responses.length,1);assert.equal("notes" in read.responses[0]!,false);
    assert.equal((await f.controller.dispatch({action:"resume-playtest",projectId:project.id,command:{...record,request:{...record.request,experienceScore:5}}}) as {playtestEditRejected:boolean}).playtestEditRejected,true);
    assert.equal((await f.controller.dispatch({action:"resume-playtest",projectId:project.id,command:{...record,artifactHash:"0".repeat(64)}}) as {playtestEditRejected:boolean}).playtestEditRejected,true);
    const call=f.client.call.bind(f.client);f.client.call=async(method,params)=>method==="engine.info"?{capabilities:[]} as never:call(method,params);
    assert.equal((await f.controller.dispatch({action:"resume-playtest",projectId:project.id,command:record}) as {playtestEditRejected:boolean}).playtestEditRejected,true);f.client.call=call;
    const other=await f.project("other-project");await f.client.selectGameProject(f.session.id,other.id);
    assert.equal((await f.controller.dispatch({action:"resume-playtest",projectId:project.id,command:record}) as {playtestEditRejected:boolean}).playtestEditRejected,true);
    assert.equal((await f.client.getGameProject(project.id)).revision,1);
  }finally{await f.close();}
});

test("a missing playtest receipt permits only normal exact-request consent, and changing selected project during approval prevents dispatch",async()=>{
  const f=await fixture();
  try{
    const project=await f.project(),other=await f.project("other-project");await f.client.selectGameProject(f.session.id,project.id);
    const build=await f.client.startGameBuild("playtest-build",project.id,1);assert.equal((await f.wait(build.id)).state,"completed");
    const command={action:"create-playtest",projectId:project.id,requestId:"never-sent",buildId:build.id,title:"Synthetic only",audience:"No people"};
    f.host.approve=async()=>{await f.client.selectGameProject(f.session.id,other.id);return true;};
    assert.equal((await f.controller.dispatch({action:"resume-playtest",projectId:project.id,command}) as {playtestEditRejected:boolean}).playtestEditRejected,true);
    assert.deepEqual(await f.client.inspectGamePlaytest(command.requestId),{state:"missing"});assert.equal((await f.client.listGamePlaytests(project.id)).studies.length,0);
    await f.client.selectGameProject(f.session.id,project.id);f.host.approve=async()=>false;
    assert.deepEqual(await f.controller.dispatch({action:"resume-playtest",projectId:project.id,command}),{cancelled:true});
    f.host.approve=async()=>true;const result=await f.controller.dispatch({action:"resume-playtest",projectId:project.id,command}) as {studyId:string};
    assert.equal((await f.client.getGamePlaytest(result.studyId)).study.buildId,build.id);assert.equal((await f.client.listGamePlaytests(project.id)).studies.length,1);
  }finally{await f.close();}
});

test("playtest exports require explicit scope consent, preserve raw JSON and neutralize spreadsheet formulas in individual CSV",async()=>{
  const f=await fixture();
  try{
    const project=await f.project();await f.client.selectGameProject(f.session.id,project.id);
    const build=await f.client.startGameBuild("playtest-build",project.id,1);assert.equal((await f.wait(build.id)).state,"completed");
    const study=await f.client.createGamePlaytest({requestId:"study",buildId:build.id,title:"Synthetic export",audience:"No actual people"});
    const notes='  =HYPERLINK("https://invalid.example","synthetic")\nSecond line, "quoted"';
    await f.client.recordGamePlaytest({requestId:"record",studyId:study.id,participantId:randomUUID(),consentConfirmed:true,distinctParticipantConfirmed:true,understoodWithoutHelp:true,actionSeconds:25,experienceScore:4,
      environment:{platform:"@synthetic",device:"+fixture",browser:"-none",input:["keyboard"]},notes});
    const parent=path.join(f.directory,"playtest-exports");await mkdir(parent);await writeFile(path.join(parent,"existing.txt"),"preserved");
    let destination="",calls=0;const prompts:string[]=[];
    f.host.exportPlaytest=async(id,includeResponses)=>{calls++;destination=await exportGameDirectory({client:f.client,parent,playtest:{studyId:id,includeResponses}});return true;};
    f.host.canWrite=()=>false;f.host.approve=async message=>{prompts.push(message);return false;};
    assert.deepEqual(await f.controller.dispatch({action:"export-playtest",projectId:project.id,studyId:study.id,includeResponses:true}),{cancelled:true});assert.equal(calls,0);
    f.host.approve=async message=>{prompts.push(message);return true;};
    assert.deepEqual(await f.controller.dispatch({action:"export-playtest",projectId:project.id,studyId:study.id,includeResponses:false}),{exported:true});
    assert.match(prompts.at(-1)!,/somente o resumo/);assert.deepEqual((JSON.parse(await readFile(path.join(destination,"playtest.json"),"utf8")) as {responses:unknown[]}).responses,[]);
    assert.equal((await readdir(destination)).includes("observations.csv"),false);
    await f.controller.dispatch({action:"export-playtest",projectId:project.id,studyId:study.id,includeResponses:true});assert.match(prompts.at(-1)!,/registros individuais, incluindo notas e códigos/);
    const exported=JSON.parse(await readFile(path.join(destination,"playtest.json"),"utf8"));assert.equal(exported.responses[0].notes,notes);
    const csv=await readFile(path.join(destination,"observations.csv"),"utf8");assert.ok(csv.includes('"\'  =HYPERLINK('));assert.ok(csv.includes('"\'@synthetic"'));assert.ok(csv.includes('"\'+fixture"'));assert.ok(csv.includes('"\'-none"'));assert.ok(csv.includes('""quoted""'));
    const before=await readdir(parent),exportStudy=f.client.exportGamePlaytest.bind(f.client);
    f.client.exportGamePlaytest=async(...args)=>({...await exportStudy(...args),includeResponses:!args[1]});
    await assert.rejects(exportGameDirectory({client:f.client,parent,playtest:{studyId:study.id,includeResponses:false}}),/seleção confirmada/);assert.deepEqual(await readdir(parent),before);
    assert.equal(await readFile(path.join(parent,"existing.txt"),"utf8"),"preserved");
    assert.equal((await f.client.getGameProject(project.id)).revision,1);
  }finally{await f.close();}
});

test("audio editing keeps canonical envelopes, source authority, native consent and lost-response identity before explicit application",async()=>{
  const f=await fixture();
  try{
    let p=await f.project();await f.client.selectGameProject(f.session.id,p.id);
    const source=await f.client.processGameAsset("audio-source",p.id,1,gameAssetSpec.parse({processorId:"local-media-v1",target:{id:"wave",role:"Source waveform",placeholder:true},operation:{type:"audio.render",output:"assets/source.wav",sampleRate:22050,channels:1,durationMs:200,notes:[{waveform:"sine",frequency:220,startMs:0,durationMs:200,gain:.3,attackMs:5,releaseMs:10}]}}));
    assert.equal((await f.wait(source.id)).state,"completed");p=await f.client.applyGameAsset("apply-source",source.id,1);
    const spec=gameAssetSpec.parse({processorId:"local-media-v1",target:{id:"mix",role:"Sound mix",placeholder:true},operation:{type:"audio.render",output:"assets/mix.wav",durationMs:250,notes:[{waveform:"sine",frequency:440,startMs:100,durationMs:100,gain:.2}],clips:[{source:{assetId:"wave",path:"assets/source.wav"},startMs:0,offsetMs:10,durationMs:100,gain:.5}]}});
    assert.equal(spec.operation.type,"audio.render");if(spec.operation.type!=="audio.render")throw Error("Fixture");
    const original=await f.client.processGameAsset("audio-mix",p.id,2,spec);assert.equal((await f.wait(original.id)).state,"completed");const originalBytes=await f.client.downloadGameAssetFile(original.id,"assets/mix.wav");
    const operation=structuredClone(spec.operation);operation.durationMs=300;operation.sampleRate=48000;operation.channels=2;operation.normalizePeak=.8;operation.notes[0]!.frequency=880;operation.clips[0]!.pan=-.75;operation.clips[0]!.fadeInMs=10;operation.clips[0]!.fadeOutMs=10;
    operation.waveformBins=256;
    operation.notes.push({...operation.notes[0]!,frequency:660,startMs:200,durationMs:80});operation.clips.push({...operation.clips[0]!,startMs:120});
    const command={action:"adjust-audio",projectId:p.id,jobId:original.id,requestId:"audio-variant",expectedRevision:2,operation};let approvals=0;f.host.approve=async()=>{approvals++;return true;};
    const rejected=async(value:unknown,reason:RegExp)=>{const result=await f.controller.dispatch(value) as {imageAdjustmentRejected:boolean;message:string};assert.equal(result.imageAdjustmentRejected,true);assert.match(result.message,reason);};
    await rejected({...command,operation:{...operation,normalizePeak:2}},/valores inválidos/);
    await rejected({...command,operation:{...operation,notes:[{...operation.notes[0],attackMs:100,releaseMs:100}]}},/valores inválidos/);
    await rejected({...command,operation:{...operation,output:"assets/other.wav"}},/preservar/);
    await rejected({...command,operation:{...operation,clips:[{...operation.clips[0],source:{assetId:"forged",path:"assets/secret.wav"}}]}},/fontes registradas/);
    assert.equal((await f.controller.snapshot()).canAnalyzeAudio,true);
    const call=f.client.call.bind(f.client);f.client.call=async(method,params)=>method==="engine.info"?{capabilities:[]} as never:call(method,params);
    await rejected(command,/forma de onda/);f.client.call=call;
    assert.equal(approvals,0);f.host.canWrite=()=>false;await rejected(command,/modo de edição/);f.host.canWrite=()=>true;
    f.host.approve=async()=>false;assert.deepEqual(await f.controller.dispatch(command),{cancelled:true});assert.equal((await f.client.listGameProduction(p.id)).jobs.length,2);
    f.host.approve=async()=>{f.host.canWrite=()=>false;return true;};await rejected(command,/modo de edição/);f.host.canWrite=()=>true;
    f.host.approve=async()=>true;const process=f.client.processGameAsset.bind(f.client);f.client.processGameAsset=async(...args)=>{await process(...args);throw Error("Lost audio response");};await assert.rejects(f.controller.dispatch(command),/Lost audio response/);
    f.client.processGameAsset=process;f.host.approve=async()=>false;assert.deepEqual(await f.controller.dispatch(command),{cancelled:true});assert.equal((await f.client.listGameProduction(p.id)).jobs.length,3);
    f.host.approve=async()=>true;const resumed=await f.controller.dispatch(command) as GameStudioSnapshot&{requestedAssetJobId:string};assert.equal((await f.wait(resumed.requestedAssetJobId)).state,"completed");assert.equal((await f.client.listGameProduction(p.id)).jobs.length,3);
    const result=await f.client.getGameAssetResult(resumed.requestedAssetJobId),bytes=await f.client.downloadGameAssetFile(result.jobId,"assets/mix.wav"),decoded=decodeWave(bytes);
    assert.equal(decoded.rate,48000);assert.equal(decoded.channels,2);assert.equal(decoded.frames,14400);assert.ok(Math.max(...decoded.samples.map(Math.abs))<=.801);assert.ok(decoded.samples.some(sample=>Math.abs(sample)>.7));
    assert.deepEqual(result.spec.operation,operation);assert.deepEqual(result.sourceAssets.map(source=>source.id),["wave"]);assert.deepEqual(await f.client.downloadGameAssetFile(original.id,"assets/mix.wav"),originalBytes);
    const measured=await f.controller.dispatch({action:"asset-audio-analysis",projectId:p.id,jobId:result.jobId}) as {analysis:{audioSha256:string;requestedBins:number;channels:unknown[]}};
    assert.equal(measured.analysis.requestedBins,256);assert.equal(measured.analysis.channels.length,2);
    await assert.rejects(f.controller.dispatch({action:"asset-audio-analysis",projectId:p.id,jobId:original.id}),/não contém/);
    const downloadAsset=f.client.downloadGameAssetFile.bind(f.client);f.client.downloadGameAssetFile=async()=>Buffer.from("forged");
    await assert.rejects(f.controller.dispatch({action:"asset-audio-analysis",projectId:p.id,jobId:result.jobId}),/bytes da análise/);f.client.downloadGameAssetFile=downloadAsset;
assert.equal((await f.client.getGameProject(p.id)).revision,2);
    const applied=await f.controller.dispatch({action:"apply-asset",projectId:p.id,jobId:result.jobId,expectedRevision:2,requestId:"apply-audio-variant"}) as GameStudioSnapshot;assert.equal(applied.project!.revision,3);assert.equal(applied.quality!.ready,false);
  }finally{await f.close();}
});

test("Studio converts an editable vector candidate to actual PNG with the same lost-response identity, then feeds composition and atlas",async()=>{
  const f=await fixture();
  try{
    let p=await f.project();await f.client.selectGameProject(f.session.id,p.id);
    const original=await f.client.processGameAsset("vector-original",p.id,1,{processorId:"local-media-v1",target:{id:"lantern",role:"Editable art",placeholder:true},operation:vectorIllustrationFixture()});
    assert.equal((await f.wait(original.id)).state,"completed");
    const operation={...vectorIllustrationFixture(),output:"assets/lantern.png"};
    const command={action:"adjust-vector",projectId:p.id,jobId:original.id,expectedRevision:1,requestId:"raster-variant",operation};
    f.host.approve=async()=>false;assert.deepEqual(await f.controller.dispatch(command),{cancelled:true});assert.equal((await f.client.listGameProduction(p.id)).jobs.length,1);
    f.host.approve=async()=>true;const process=f.client.processGameAsset.bind(f.client);
    f.client.processGameAsset=async(...args)=>{await process(...args);throw Error("Lost raster response");};await assert.rejects(f.controller.dispatch(command),/Lost raster response/);
    f.client.processGameAsset=process;
    const resumed=await f.controller.dispatch(command) as GameStudioSnapshot&{requestedAssetJobId:string};
    assert.equal((await f.client.listGameProduction(p.id)).jobs.length,2);assert.equal((await f.wait(resumed.requestedAssetJobId)).state,"completed");
    const result=await f.client.getGameAssetResult(resumed.requestedAssetJobId),file=result.files.find(file=>file.path===operation.output)!;
    const bytes=await f.client.downloadGameAssetFile(result.jobId,file.path);assert.equal(file.mime,"image/png");const pixels=PNG.sync.read(bytes);assert.equal(pixels.width,operation.width);assert.equal(pixels.height,operation.height);
    assert.deepEqual((await f.client.getGameAssetResult(original.id)).spec.operation,vectorIllustrationFixture(),"original SVG candidate stays immutable");
    assert.equal((await f.client.getGameProject(p.id)).revision,1,"rasterization cannot apply a candidate");
    p=(await f.controller.dispatch({action:"apply-asset",projectId:p.id,jobId:result.jobId,expectedRevision:1,requestId:"apply-raster"}) as GameStudioSnapshot).project!;
    assert.equal(p.revision,2);
    const compose=await f.client.processGameAsset("compose-raster",p.id,2,gameAssetSpec.parse({processorId:"local-media-v1",target:{id:"composed",role:"Composed sprite",placeholder:true},operation:{type:"image.compose",output:"assets/composed.png",width:128,height:128,layers:[{source:{assetId:"lantern",path:operation.output},x:0,y:0,width:128,height:128}]}}));
    assert.equal((await f.wait(compose.id)).state,"completed");assert.equal((await f.client.getGameAssetResult(compose.id)).sourceAssets[0]!.id,"lantern");
    const atlas=await f.client.processGameAsset("atlas-raster",p.id,2,gameAssetSpec.parse({processorId:"local-media-v1",target:{id:"atlas",role:"Animated sprite atlas",placeholder:true},operation:{type:"image.atlas",outputBase:"assets/lantern-atlas",pageSize:512,maxPages:1,frames:[{id:"lantern-frame",source:{assetId:"lantern",path:operation.output}}],animations:[{id:"idle",frames:["lantern-frame"],fps:8,loop:true}]}}));
    assert.equal((await f.wait(atlas.id)).state,"completed");const atlasResult=await f.client.getGameAssetResult(atlas.id);assert.equal(atlasResult.asset.kind,"atlas");assert.equal(atlasResult.sourceAssets[0]!.id,"lantern");
    assert.equal((await f.client.getGameQuality(p.id)).ready,false,"codec/atlas success is not complete game acceptance");
  }finally{await f.close();}
});

test("studio UI uses authenticated SDK data and native consent; it cannot switch namespace, bypass plan mode or apply a stale project's command",async()=>{
  const f=await fixture();try{
    const empty=await f.controller.snapshot();assert.equal(empty.project,null);
    const first=await f.project(),second=await f.project("second");
    await f.controller.dispatch({action:"select",projectId:first.id});let snapshot=await f.controller.snapshot();assert.equal(snapshot.project!.id,first.id);
    assert.ok(snapshot.capabilities.adapters.some((adapter)=>adapter.engine==="phaser"&&adapter.available));
    f.host.canWrite=()=>false;await assert.rejects(f.controller.dispatch({action:"build",projectId:first.id,expectedRevision:1,requestId:"plan"}),/modo de edição/);
    f.host.canWrite=()=>true;f.host.approve=async()=>false;
    assert.deepEqual(await f.controller.dispatch({action:"build",projectId:first.id,expectedRevision:1,requestId:"denied"}),{cancelled:true});assert.equal((await f.client.listGameProduction(first.id)).jobs.length,0);
    f.host.approve=async()=>true;await f.controller.dispatch({action:"build",projectId:first.id,expectedRevision:1,requestId:"accepted"});
    const job=(await f.client.listGameProduction(first.id)).jobs[0]!;assert.equal((await f.wait(job.id)).state,"completed");
    let previewed=false;f.host.preview=async(artifact,read)=>{assert.equal(artifact.jobId,job.id);assert.match((await read("index.html")).toString(),/<canvas/);previewed=true;};
    await f.controller.dispatch({action:"preview",projectId:first.id,buildId:job.id});assert.equal(previewed,true);
    await f.client.selectGameProject(f.session.id,second.id);
    const rejected=await f.controller.dispatch({action:"design",projectId:first.id,expectedRevision:1,requestId:"stale-window",design:fixtureGameDocument().design}) as {designEditRejected:boolean;message:string};assert.equal(rejected.designEditRejected,true);assert.match(rejected.message,/outra janela/);
    await assert.rejects(f.controller.dispatch({action:"preview",projectId:second.id,buildId:job.id}),/outro projeto/);
    await assert.rejects(f.controller.dispatch({action:"refresh",product:"kidos",workspace:"/forged"}));
    snapshot=await f.controller.snapshot();assert.equal(snapshot.project!.revision,1);assert.equal(snapshot.project!.id,second.id);
  }finally{await f.close();}
});

test("Studio design edits distinguish known pre-dispatch rejection from a lost committed response and recheck native consent",async()=>{
  const f=await fixture();try{
    const p=await f.project(),other=await f.project("design-other");await f.client.selectGameProject(f.session.id,p.id);
    const design=structuredClone(fixtureGameDocument().design!);design.premise="A directed revision preserved through native consent";
    const command={action:"design",projectId:p.id,expectedRevision:1,requestId:"design-frozen",design};let commits=0,approvals=0;
    const commit=f.client.commitGameRevision.bind(f.client);f.client.commitGameRevision=async(...args)=>{commits++;return commit(...args);};
    f.host.canWrite=()=>false;assert.equal((await f.controller.dispatch(command) as {designEditRejected:boolean}).designEditRejected,true);assert.equal(commits,0);
    f.host.canWrite=()=>true;f.host.approve=async()=>{approvals++;await f.client.selectGameProject(f.session.id,other.id);return true;};
    assert.equal((await f.controller.dispatch(command) as {designEditRejected:boolean}).designEditRejected,true);assert.equal(commits,0);assert.equal(approvals,1);
    await f.client.selectGameProject(f.session.id,p.id);f.host.approve=async()=>{f.host.canWrite=()=>false;return true;};
    assert.equal((await f.controller.dispatch(command) as {designEditRejected:boolean}).designEditRejected,true);assert.equal(commits,0);
    f.host.canWrite=()=>true;f.host.approve=async()=>true;f.client.commitGameRevision=async(...args)=>{commits++;await commit(...args);throw Error("Lost committed design response");};
    await assert.rejects(f.controller.dispatch(command),/Lost committed design/);assert.equal((await f.client.getGameProject(p.id)).revision,2);
    // A later preflight rejection describes only the retry, not the prior
    // committed effect. The renderer retains the exact frozen request.
    assert.equal((await f.controller.dispatch(command) as {designEditRejected:boolean}).designEditRejected,true);assert.equal(commits,1);
    const later=structuredClone(fixtureGameDocument());later.title="Work after the lost response";
    await commit(p.id,"independent-later-work",2,later,"Keep later work");
    f.host.canWrite=()=>false;f.host.approve=async()=>{throw Error("A read-only recovery must not ask for new approval");};
    const recovered=await f.controller.dispatch({...command,action:"resume-design"}) as {project:{revision:number};recoveredDesignCommit:{revision:number}};
    assert.equal(recovered.recoveredDesignCommit.revision,2);assert.equal(recovered.project.revision,3);assert.equal(commits,1);
    assert.equal((await f.client.getGameProject(p.id)).title,later.title,"readback cannot replace work made after the original commit");
    const inspect=f.client.inspectGameMutation.bind(f.client);
    f.client.inspectGameMutation=async()=>({state:"acknowledged",projectId:p.id,requestId:command.requestId,revision:2,contentHash:"a".repeat(64),bindingHash:"f".repeat(64)});
    assert.equal((await f.controller.dispatch({...command,action:"resume-design"}) as {designEditRejected:boolean}).designEditRejected,true);assert.equal(commits,1);
    const exactReceipt=await inspect(p.id,command.requestId);assert.equal(exactReceipt.state,"acknowledged");
    f.client.inspectGameMutation=async()=>({...exactReceipt,contentHash:"a".repeat(64)} as Awaited<ReturnType<typeof inspect>>);
    assert.equal((await f.controller.dispatch({...command,action:"resume-design"}) as {designEditRejected:boolean}).designEditRejected,true,"receipt must identify its immutable acknowledged revision");assert.equal(commits,1);
    f.client.inspectGameMutation=inspect;
    const call=f.client.call.bind(f.client);
    f.client.call=async <T>(method:string,...args:Parameters<typeof call> extends [string,...infer R]?R:never)=>method==="engine.info"?{capabilities:[]} as T:call<T>(method,...args);
    f.client.inspectGameMutation=async()=>{throw Error("Legacy engines cannot inspect or repeat a commit");};
    assert.equal((await f.controller.dispatch({...command,action:"resume-design"}) as {designEditRejected:boolean}).designEditRejected,true);assert.equal(commits,1);
    f.client.call=call;f.client.inspectGameMutation=inspect;
    const missing={...command,action:"resume-design",requestId:"not-yet-committed",expectedRevision:3};
    assert.equal((await f.controller.dispatch(missing) as {designEditRejected:boolean}).designEditRejected,true,"missing receipt grants no permission to replay in plan mode");
    f.host.canWrite=()=>true;f.host.approve=async()=>false;
    assert.deepEqual(await f.controller.dispatch(missing),{cancelled:true});assert.equal(commits,1);
    f.host.approve=async()=>true;f.client.commitGameRevision=async(...args)=>{commits++;return commit(...args);};
    await f.controller.dispatch(missing);assert.equal(commits,2);assert.equal((await f.client.getGameProject(p.id)).revision,4);
    assert.equal((await f.client.getGameProject(other.id)).revision,1);
  }finally{await f.close();}
});

test("Studio library browsing is read-only; exact imports recheck consent, mode and revision, recover lost acknowledgments and keep full license text",async()=>{
  const f=await fixture();try{
    let p=await f.project();const other=await f.project("other-library");await f.client.selectGameProject(f.session.id,p.id);
    let approvals=0;f.host.approve=async()=>{approvals++;return true;};f.host.canWrite=()=>false;
    const catalog=await f.controller.dispatch({action:"libraries",projectId:p.id,query:{query:"character-soldier",limit:10}}) as GameLibraryPage;
    const selection=catalog.entries[0]!;assert.equal(selection.entry.animations.length,32);assert.equal(approvals,0);assert.equal((await f.client.listGameProduction(p.id)).jobs.length,0);
    const exact=await f.client.listGameLibraries({entryId:"wall"});assert.equal(exact.entries.length,1);assert.equal(exact.entries[0]!.entry.id,"wall");
    const command={action:"import-library",projectId:p.id,expectedRevision:1,requestId:"studio-library",spec:{processorId:"licensed-libraries-v1",target:{id:"hero",role:"Library character",placeholder:true},operation:{type:"library.copy" as const,selection,outputBase:"assets/imported-hero"}}};
    const rejected=async(input:unknown,pattern:RegExp)=>{const value=await f.controller.dispatch(input) as {libraryImportRejected:boolean;message:string};assert.equal(value.libraryImportRejected,true);assert.match(value.message,pattern);};
    await rejected(command,/modo de edição/);f.host.canWrite=()=>true;
    await rejected({...command,profile:"forged"},/Confira/);
    const forged=structuredClone(command);forged.spec.operation.selection.library.author="Forged by renderer";await rejected(forged,/catálogo instalado/);
    const stripped=structuredClone(command);stripped.spec.operation.selection.entry.files=stripped.spec.operation.selection.entry.files.filter(file=>file.path!=="License.txt");await rejected(stripped,/Confira/);
    await rejected({...command,spec:{...command.spec,processorId:"local-media-v1"}},/não está disponível/);assert.equal(approvals,0);
    f.host.approve=async()=>false;assert.deepEqual(await f.controller.dispatch(command),{cancelled:true});assert.equal((await f.client.listGameProduction(p.id)).jobs.length,0);
    f.host.approve=async()=>{await f.client.selectGameProject(f.session.id,other.id);return true;};await rejected(command,/projeto ou a revisão mudou/);
    await f.client.selectGameProject(f.session.id,p.id);f.host.approve=async()=>{f.host.canWrite=()=>false;return true;};await rejected(command,/modo de edição/);f.host.canWrite=()=>true;
    f.host.approve=async()=>{const revision=await f.client.getGameRevision(p.id);p=await f.client.commitGameRevision(p.id,"while-confirming-library",1,{...revision.document,title:"Concurrent title"},"Concurrent change");return true;};await rejected(command,/revisão mudou/);
    assert.equal((await f.client.listGameProduction(p.id)).jobs.length,0);
    const request={...command,expectedRevision:2};f.host.approve=async()=>true;const process=f.client.processGameAsset.bind(f.client);
    f.client.processGameAsset=async(...args)=>{await process(...args);throw Error("Lost library acknowledgment");};await assert.rejects(f.controller.dispatch(request),/Lost library acknowledgment/);
    const jobs=(await f.client.listGameProduction(p.id)).jobs;assert.equal(jobs.length,1);const original=jobs[0]!;assert.equal((await f.wait(original.id)).state,"completed");
    f.client.processGameAsset=process;f.host.approve=async()=>false;assert.deepEqual(await f.controller.dispatch(request),{cancelled:true});assert.equal((await f.client.listGameProduction(p.id)).jobs.length,1);
    f.host.approve=async()=>true;const resumed=await f.controller.dispatch(request) as GameStudioSnapshot&{requestedAssetJobId:string};assert.equal(resumed.requestedAssetJobId,original.id);assert.equal(resumed.project!.revision,2);assert.equal((await f.client.listGameProduction(p.id)).jobs.length,1);
    const result=await f.client.getGameAssetResult(original.id),license=result.files.find(file=>file.path.endsWith("/License.txt"))!;
    const text=await f.controller.dispatch({action:"asset-media",projectId:p.id,jobId:original.id,path:license.path}) as {text:string;mime:string;data?:unknown};
    assert.equal(text.mime,"text/plain");assert.equal(text.text,(await f.client.downloadGameAssetFile(original.id,license.path)).toString("utf8"));assert.match(text.text,/Tony Schär/);assert.equal(text.data,undefined);
    await assert.rejects(f.controller.dispatch({action:"asset-media",projectId:p.id,jobId:original.id,path:"assets/imported-hero/character-soldier.glb"}),/preview aceita/);
    assert.equal((await f.client.getGameProject(p.id)).revision,2,"preparing/reading a license must never apply the candidate");
    const applied=await f.controller.dispatch({action:"apply-asset",projectId:p.id,jobId:original.id,expectedRevision:2,requestId:"apply-library"}) as GameStudioSnapshot;
    assert.equal(applied.project!.revision,3);assert.equal(applied.quality!.ready,false);
    await rejected({...request,expectedRevision:3,requestId:"duplicate-target"},/já existe/);
  }finally{await f.close();}
});

test("Studio model inspection is read-only, candidate-bound and rechecks selection after native consent",async()=>{
  const f=await fixture();try{
    const p=await f.project(),other=await f.project("model-other");await f.client.selectGameProject(f.session.id,p.id);
    const selection=(await f.client.listGameLibraries({query:"character-soldier"})).entries[0]!;
    const job=await f.client.processGameAsset("model-candidate",p.id,1,{processorId:"licensed-libraries-v1",target:{id:"model",role:"Model to inspect",placeholder:true},operation:{type:"library.copy",selection,outputBase:"assets/model"}});
    assert.equal((await f.wait(job.id)).state,"completed");const result=await f.client.getGameAssetResult(job.id),model=result.files.find(file=>file.mime==="model/gltf-binary")!;
    const command={action:"preview-model",projectId:p.id,jobId:job.id,path:model.path};let opened=0,approvals=0;
    f.host.canWrite=()=>false;f.host.approve=async()=>{approvals++;return true;};
    await assert.rejects(f.controller.dispatch(command),/atualização/);assert.equal(approvals,0);
    f.host.previewModel=async(candidate,name,read)=>{opened++;assert.equal(candidate.jobId,job.id);assert.equal(name,model.path);assert.deepEqual(await read(name),await f.client.downloadGameAssetFile(job.id,name));};
    assert.equal((await f.controller.snapshot()).canPreviewModels,true);
    await assert.rejects(f.controller.dispatch({...command,path:"assets/not-in-candidate.glb"}),/preservado/);assert.equal(approvals,0);
    f.host.approve=async()=>false;assert.deepEqual(await f.controller.dispatch(command),{cancelled:true});assert.equal(opened,0);
    f.host.approve=async()=>{await f.client.selectGameProject(f.session.id,other.id);return true;};await assert.rejects(f.controller.dispatch(command),/selecionado mudou/);assert.equal(opened,0);
    await f.client.selectGameProject(f.session.id,p.id);f.host.approve=async()=>true;
    assert.equal((await f.controller.dispatch(command) as {modelPreviewOpened:boolean}).modelPreviewOpened,true);assert.equal(opened,1);
    assert.equal((await f.client.getGameProject(p.id)).revision,1);assert.equal((await f.client.getGameQuality(p.id)).ready,false);assert.equal((await f.client.listGameProduction(p.id)).jobs.length,1);
    await f.client.selectGameProject(f.session.id,other.id);await assert.rejects(f.controller.dispatch({...command,projectId:other.id}),/outro projeto/);assert.equal(opened,1);
  }finally{await f.close();}
});

test("Studio previews only acknowledged typed SVG candidates and preserves editable provenance without trusting imported markup",async()=>{
  const f=await fixture();try{
    let p=await f.project();await f.client.selectGameProject(f.session.id,p.id);
    const operation=vectorIllustrationFixture(),job=await f.client.processGameAsset("vector",p.id,1,{processorId:"local-media-v1",target:{id:"lantern",role:"Authored vector renderer fixture",placeholder:true},operation});
    assert.equal((await f.wait(job.id)).state,"completed");const result=await f.client.getGameAssetResult(job.id);
    assert.deepEqual(result.sourceAssets,[]);assert.equal(result.asset.origin.kind,"procedural");assert.equal(result.asset.placeholder,true);
    const svg=await f.client.downloadGameAssetFile(job.id,operation.output),recipe=result.files.find(file=>file.path.endsWith(".vector.json"))!;
    assert.deepEqual(JSON.parse((await f.client.downloadGameAssetFile(job.id,recipe.path)).toString()).operation,operation);
    const provenance=result.files.find(file=>file.path.startsWith("assets/provenance/"))!;
    assert.equal(JSON.parse((await f.client.downloadGameAssetFile(job.id,provenance.path)).toString()).licenseStatus,"declared-unverified");
    const preview=await f.controller.dispatch({action:"asset-media",projectId:p.id,jobId:job.id,path:operation.output}) as {mime:string;data:string};
    assert.equal(preview.mime,"image/svg+xml");assert.deepEqual(Buffer.from(preview.data,"base64"),svg);assert.equal((await f.client.getGameProject(p.id)).revision,1);
    await assert.rejects(f.controller.dispatch({action:"asset-media",projectId:p.id,jobId:job.id,path:recipe.path}),/preview aceita/);
    f.host.approve=async()=>false;const apply={action:"apply-asset",projectId:p.id,jobId:job.id,expectedRevision:1,requestId:"apply-vector"};
    assert.deepEqual(await f.controller.dispatch(apply),{cancelled:true});assert.equal((await f.client.getGameProject(p.id)).revision,1);
    f.host.approve=async()=>true;const applied=await f.controller.dispatch(apply) as GameStudioSnapshot;p=applied.project!;
    assert.equal(p.revision,2);assert.equal(applied.quality!.ready,false);
    const source=await f.controller.dispatch({action:"media",projectId:p.id,path:operation.output}) as {mime:string;data:string};assert.deepEqual(Buffer.from(source.data,"base64"),svg);
    const parent=path.join(f.directory,"vector-export");await mkdir(parent);
    const exported=await exportGameDirectory({client:f.client,parent,candidate:{jobId:job.id}});
    assert.deepEqual(await readFile(path.join(exported,"candidate",operation.output)),svg);
    const acknowledged=(await f.client.getGameRevision(p.id)).document;
    const foreign=await f.client.createGameProject("foreign-vector",structuredClone(acknowledged));await f.client.selectGameProject(f.session.id,foreign.id);
    await assert.rejects(f.controller.dispatch({action:"media",projectId:foreign.id,path:operation.output}),/diverge/);
    await f.client.selectGameProject(f.session.id,p.id);
    const changed=structuredClone(acknowledged),replacement=await f.client.uploadGameFile(operation.output,Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="forged()"/>'),"image/svg+xml");
    changed.files=changed.files.map(file=>file.path===operation.output?replacement:file);
    p=await f.client.commitGameRevision(p.id,"changed-svg",2,changed,"Preserve imported SVG without preview authority");
    await assert.rejects(f.controller.dispatch({action:"media",projectId:p.id,path:operation.output}),/diverge/);
    const raw=structuredClone(changed);raw.assets.find(asset=>asset.id==="lantern")!.processing=undefined;
    await f.client.commitGameRevision(p.id,"raw-svg",3,raw,"Unacknowledged markup remains exportable only");
    await assert.rejects(f.controller.dispatch({action:"media",projectId:p.id,path:operation.output}),/somente o resultado vetorial/);
    assert.deepEqual(await f.client.downloadGameAssetFile(job.id,operation.output),svg,"Imported edits must not change the original candidate");
  }finally{await f.close();}
});

test("directed vector variants use exact typed recipes, native consent and idempotent jobs without replacing their original",async()=>{
  const f=await fixture();try{
    let p=await f.project();const other=await f.project("other-vector");await f.client.selectGameProject(f.session.id,p.id);
    const original=await f.client.processGameAsset("vector-original",p.id,1,{processorId:"local-media-v1",target:{id:"lantern",role:"Vector editing fixture",placeholder:true},operation:vectorIllustrationFixture()});
    assert.equal((await f.wait(original.id)).state,"completed");const result=await f.client.getGameAssetResult(original.id);
    if(result.spec.operation.type!=="image.vector")throw Error("Expected vector fixture");
    const before=await f.client.downloadGameAssetFile(original.id,result.spec.operation.output),operation=structuredClone(result.spec.operation);operation.width=320;operation.height=192;
    const housing=operation.shapes.find(shape=>shape.id==="housing");if(housing?.kind!=="rect"||typeof housing.fill!=="object"||housing.fill?.type!=="linear")throw Error("Expected gradient fixture");
    housing.radius=28;housing.fill.stops[0]!.color="#f5dbb4ff";housing.transform={x:12,y:-4,rotation:5,scaleX:1.1,scaleY:.9,pivotX:128,pivotY:128};
    operation.shapes.push({...structuredClone(housing),id:"duplicate-housing"});operation.shapes.reverse();
    const command={action:"adjust-vector",projectId:p.id,jobId:original.id,expectedRevision:1,requestId:"directed-vector",operation};
    const rejected=async(input:unknown,pattern:RegExp)=>{const value=await f.controller.dispatch(input) as {imageAdjustmentRejected:boolean;message:string};assert.equal(value.imageAdjustmentRejected,true);assert.match(value.message,pattern);};
    let approvals=0;f.host.approve=async()=>{approvals++;return true;};
    await rejected({...command,operation:{...operation,svg:'<svg onload="forged()"/>'}},/valores inválidos/);
    await rejected({...command,operation:{...operation,shapes:operation.shapes.map(shape=>({...shape,fill:"https://outside/paint"}))}},/valores inválidos/);
    await rejected({...command,operation:{...operation,output:"assets/other.svg"}},/preservar o nome e a pasta/);assert.equal(approvals,0);
    f.host.canWrite=()=>false;await rejected(command,/modo de edição/);f.host.canWrite=()=>true;
    f.host.approve=async()=>false;assert.deepEqual(await f.controller.dispatch(command),{cancelled:true});assert.equal((await f.client.listGameProduction(p.id)).jobs.length,1);
    f.host.approve=async()=>{await f.client.selectGameProject(f.session.id,other.id);return true;};await rejected(command,/projeto ou a revisão mudou/);
    await f.client.selectGameProject(f.session.id,p.id);f.host.approve=async()=>{f.host.canWrite=()=>false;return true;};await rejected(command,/modo de edição/);f.host.canWrite=()=>true;
    f.host.approve=async()=>{const doc=(await f.client.getGameRevision(p.id)).document;p=await f.client.commitGameRevision(p.id,"concurrent-vector-title",1,{...doc,title:"Changed while confirming"},"Concurrent revision");return true;};
    await rejected(command,/revisão mudou/);assert.equal((await f.client.listGameProduction(p.id)).jobs.length,1);
    const request={...command,expectedRevision:2};f.host.approve=async()=>true;const process=f.client.processGameAsset.bind(f.client);
    f.client.processGameAsset=async(...args)=>{await process(...args);throw Error("Lost vector acknowledgment");};await assert.rejects(f.controller.dispatch(request),/Lost vector acknowledgment/);
    f.client.processGameAsset=process;
    await rejected({...request,operation:{...operation,width:NaN}},/valores inválidos/);assert.equal((await f.client.listGameProduction(p.id)).jobs.length,2,"a known rejection of another invocation must not erase the lost original");
    f.host.approve=async()=>false;assert.deepEqual(await f.controller.dispatch(request),{cancelled:true});assert.equal((await f.client.listGameProduction(p.id)).jobs.length,2);
    f.host.approve=async()=>true;const resumed=await f.controller.dispatch(request) as GameStudioSnapshot&{requestedAssetJobId:string};assert.ok(resumed.requestedAssetJobId);
    assert.equal((await f.wait(resumed.requestedAssetJobId)).state,"completed");assert.equal((await f.client.listGameProduction(p.id)).jobs.length,2);assert.equal((await f.client.getGameProject(p.id)).revision,2);
    const variant=await f.client.getGameAssetResult(resumed.requestedAssetJobId);assert.deepEqual(variant.spec.operation,operation);assert.deepEqual(variant.spec.target,result.spec.target);assert.equal(variant.asset.placeholder,true);
    const svg=(await f.client.downloadGameAssetFile(resumed.requestedAssetJobId,operation.output)).toString();assert.match(svg,/width="320" height="192"/);assert.match(svg,/#f5dbb4/);assert.match(svg,/rx="28"/);
    assert.deepEqual(await f.client.downloadGameAssetFile(original.id,result.spec.operation.output),before);
    await assert.rejects(f.controller.dispatch({...request,operation:{...operation,background:"#ffffffff"}}),/different|outro conteúdo/);
    const applied=await f.controller.dispatch({action:"apply-asset",projectId:p.id,jobId:resumed.requestedAssetJobId,expectedRevision:2,requestId:"apply-vector-variant"}) as GameStudioSnapshot;
    assert.equal(applied.project!.revision,3);assert.equal(applied.quality!.ready,false);assert.equal(applied.revision!.document.assets.find(asset=>asset.id==="lantern")!.processing!.jobId,resumed.requestedAssetJobId);
  }finally{await f.close();}
});

test("history is paginated newest first without losing older revisions; restore adds a revision and never reexecutes tools",async()=>{
  const f=await fixture();try{
    let p=await f.project();await f.client.selectGameProject(f.session.id,p.id);
    for(let i=2;i<=35;i++){const doc=(await f.client.getGameRevision(p.id)).document;doc.title=`Design ${i}`;p=await f.client.commitGameRevision(p.id,`revision-${i}`,i-1,doc,`Design ${i}`);}
    const newest=await f.client.listGameRevisions(p.id,0,30,"desc");assert.equal(newest.revisions[0]!.revision,35);assert.equal(newest.cursor,6);assert.equal(newest.hasMore,true);
    const oldest=await f.client.listGameRevisions(p.id,newest.cursor,30,"desc");assert.deepEqual(oldest.revisions.map((revision)=>revision.revision),[5,4,3,2,1]);assert.equal(oldest.hasMore,false);
    assert.deepEqual((await f.client.listGameRevisions(p.id,0,3)).revisions.map((revision)=>revision.revision),[1,2,3],"legacy ascending pagination stays compatible");
    const snapshot=await f.controller.dispatch({action:"restore",projectId:p.id,revision:1,expectedRevision:35,requestId:"restore"}) as GameStudioSnapshot;
    assert.equal(snapshot.project!.revision,36);assert.equal(snapshot.project!.title,fixtureGameDocument().title);
    assert.equal((await f.client.listGameProduction(p.id)).jobs.length,0);assert.equal((await f.client.getGameRevision(p.id,35)).document.title,"Design 35");
    assert.equal((await f.controller.dispatch({action:"restore",projectId:p.id,revision:1,expectedRevision:35,requestId:"stale"}) as {restoreRejected:boolean}).restoreRejected,true);
  }finally{await f.close();}
});

test("Studio inspects real media candidates without applying them and binds explicit native application to the exact project/revision",async()=>{
  const f=await fixture();try{
    const p=await f.project(),other=await f.project("other");await f.client.selectGameProject(f.session.id,p.id);
    const job=await f.client.processGameAsset("sound",p.id,1,{processorId:"local-media-v1",target:{id:"sound",role:"Fixture sound",placeholder:true},operation:{type:"audio.render",output:"assets/sound.wav",durationMs:100,sampleRate:22050,channels:1,clips:[],notes:[{waveform:"sine",frequency:440,startMs:0,durationMs:100,gain:.3,pan:0,attackMs:5,releaseMs:10,seed:1}]}});
    assert.equal((await f.wait(job.id)).state,"completed");
    const inspected=await f.controller.dispatch({action:"asset-result",projectId:p.id,jobId:job.id}) as {projectId:string;expectedRevision:number;result:GameAssetResult};
    assert.equal(inspected.projectId,p.id);assert.equal(inspected.expectedRevision,1);assert.equal(inspected.result.asset.placeholder,true);
    const media=await f.controller.dispatch({action:"asset-media",projectId:p.id,jobId:job.id,path:"assets/sound.wav"}) as {mime:string;data:string;jobId:string};
    assert.equal(media.mime,"audio/wav");assert.equal(media.jobId,job.id);assert.equal(Buffer.from(media.data,"base64").subarray(0,4).toString(),"RIFF");
    assert.equal((await f.client.getGameProject(p.id)).revision,1);
    await assert.rejects(f.controller.dispatch({action:"asset-media",projectId:p.id,jobId:job.id,path:inspected.result.files.find(file=>file.path.endsWith(".json"))!.path}),/preview aceita/);
    const apply={action:"apply-asset",projectId:p.id,jobId:job.id,expectedRevision:1,requestId:"apply"};
    f.host.canWrite=()=>false;await assert.rejects(f.controller.dispatch(apply),/modo de edição/);
    f.host.canWrite=()=>true;f.host.approve=async()=>false;assert.deepEqual(await f.controller.dispatch(apply),{cancelled:true});assert.equal((await f.client.getGameProject(p.id)).revision,1);
    f.host.approve=async()=>{await f.client.selectGameProject(f.session.id,other.id);return true;};
    await assert.rejects(f.controller.dispatch(apply),/selecionado mudou/);assert.equal((await f.client.getGameProject(p.id)).revision,1);assert.equal((await f.client.getGameProject(other.id)).revision,1);
    await assert.rejects(f.controller.dispatch({action:"asset-result",projectId:other.id,jobId:job.id}),/outro projeto/);
    await f.client.selectGameProject(f.session.id,p.id);f.host.approve=async()=>{f.host.canWrite=()=>false;return true;};
    await assert.rejects(f.controller.dispatch(apply),/modo de edição/);assert.equal((await f.client.getGameProject(p.id)).revision,1);
    f.host.canWrite=()=>true;f.host.approve=async()=>true;
    const applied=await f.controller.dispatch(apply) as GameStudioSnapshot;assert.equal(applied.project!.revision,2);
    assert.equal(applied.revision!.document.assets.find(asset=>asset.id==="sound")!.processing!.jobId,job.id);
    assert.equal(applied.quality!.ready,false);assert.equal((await f.client.getGameProject(other.id)).revision,1);
    await assert.rejects(f.controller.dispatch({...apply,requestId:"stale"}),/mudou/);
    await assert.rejects(f.controller.dispatch({...apply,product:"kidos"}));
    const build=await f.client.startGameBuild("build",p.id,2);await f.wait(build.id);
    await assert.rejects(f.controller.dispatch({action:"asset-result",projectId:p.id,jobId:build.id}),/candidato de mídia concluído/);
  }finally{await f.close();}
});

test("candidate export preserves immutable bytes, recipes and provenance without applying; corrupt downloads never replace existing files",async()=>{
  const f=await fixture();try{
    const p=await f.project(),other=await f.project("other");await f.client.selectGameProject(f.session.id,p.id);
    const output=`assets/${"a".repeat(200)}/${"b".repeat(188)}.wav`;assert.equal(output.length,400);
    const job=await f.client.processGameAsset("export-sound",p.id,1,{processorId:"local-media-v1",target:{id:"export-sound",role:"Candidate export fixture",placeholder:true},operation:{type:"audio.render",output,durationMs:100,sampleRate:22050,channels:1,clips:[],notes:[{waveform:"sine",frequency:440,startMs:0,durationMs:100,gain:.3,pan:0,attackMs:5,releaseMs:10,seed:1}]}});
    assert.equal((await f.wait(job.id)).state,"completed");const result=await f.client.getGameAssetResult(job.id);
    const parent=path.join(f.directory,"candidate-exports");await mkdir(parent);await writeFile(path.join(parent,"existing.txt"),"preserve");
    let calls=0,target="";f.host.exportAsset=async(id)=>{calls++;target=await exportGameDirectory({client:f.client,parent,candidate:{jobId:id}});return true;};
    f.host.canWrite=()=>false;f.host.approve=async()=>{throw new Error("Read-only export must not request mutation authority");};
    assert.deepEqual(await f.controller.dispatch({action:"export-asset",projectId:p.id,jobId:job.id}),{exported:true});assert.equal(calls,1);
    assert.deepEqual(JSON.parse(await readFile(path.join(target,"candidate.json"),"utf8")),result);
    for(const file of result.files)assert.deepEqual(await readFile(path.join(target,"candidate",file.path)),await f.client.downloadGameAssetFile(job.id,file.path));
    assert.match(await readFile(path.join(target,"README.txt"),"utf8"),/não o aplica/);
    assert.equal((await f.client.getGameProject(p.id)).revision,1);assert.equal((await f.client.getGameRevision(p.id)).document.assets.length,0);
    assert.equal((await f.client.listGameProduction(p.id)).jobs.length,1);assert.equal((await f.client.getGameQuality(p.id)).ready,false);
    await f.client.selectGameProject(f.session.id,other.id);
    await assert.rejects(f.controller.dispatch({action:"export-asset",projectId:p.id,jobId:job.id}),/selecionado mudou/);
    await assert.rejects(f.controller.dispatch({action:"export-asset",projectId:other.id,jobId:job.id}),/outro projeto/);assert.equal(calls,1);
    await f.client.selectGameProject(f.session.id,p.id);f.host.exportAsset=async()=>false;
    assert.deepEqual(await f.controller.dispatch({action:"export-asset",projectId:p.id,jobId:job.id}),{exported:false});
    await assert.rejects(f.controller.dispatch({action:"export-asset",projectId:p.id,jobId:job.id,parent:"/tmp/forged"}));
    const before=await readdir(parent),download=f.client.downloadGameAssetFile.bind(f.client);
    f.client.downloadGameAssetFile=async(...args)=>{const data=Buffer.from(await download(...args));data[0]=data[0]!^1;return data;};
    await assert.rejects(exportGameDirectory({client:f.client,parent,candidate:{jobId:job.id}}),/hash/);assert.deepEqual(await readdir(parent),before);
    assert.equal(await readFile(path.join(parent,"existing.txt"),"utf8"),"preserve");
    f.client.downloadGameAssetFile=download;const get=f.client.getGameAssetResult.bind(f.client);
    f.client.getGameAssetResult=async(id)=>{const invalid=structuredClone(await get(id));invalid.files[0]!.path="../escape";return invalid;};
    await assert.rejects(exportGameDirectory({client:f.client,parent,candidate:{jobId:job.id}}));assert.deepEqual(await readdir(parent),before);
    await assert.rejects(exportGameDirectory({client:f.client,parent,candidate:{jobId:job.id},source:{projectId:p.id,revision:1}}),/Escolha/);
  }finally{await f.close();}
});

test("directed image adjustment preserves source/authority boundaries and recovers lost acknowledgments without duplicate processing",async()=>{
  const f=await fixture();try{
    let p=await f.project();const other=await f.project("other");await f.client.selectGameProject(f.session.id,p.id);
    const png=new PNG({width:8,height:8});for(let i=0;i<png.data.length;i+=4)png.data.set([255,128,64,255],i);
    const source=await f.client.uploadGameFile("assets/source.png",PNG.sync.write(png),"image/png"),document=(await f.client.getGameRevision(p.id)).document;
    document.files.push(source);document.assets.push({id:"source",kind:"image",role:"Fixture source",files:[source.path],placeholder:true,origin:{kind:"procedural",source:"Local fixture",author:"Test",license:"Unverified fixture",referenceIds:[]}});
    p=await f.client.commitGameRevision(p.id,"source",1,document,"Register image fixture");
    const original=await f.client.processGameAsset("original-image",p.id,2,{processorId:"local-media-v1",target:{id:"variant",role:"Image variant fixture",placeholder:false},operation:{type:"image.compose",output:"assets/variant.png",width:8,height:8,background:"#00000000",layers:[{source:{assetId:"source",path:source.path},x:0,y:0,width:8,height:8,flipX:false,flipY:false,opacity:1,tint:"#ffffffff",filter:"bilinear"}]}});
    assert.equal((await f.wait(original.id)).state,"completed");const result=await f.client.getGameAssetResult(original.id);assert.equal(result.spec.operation.type,"image.compose");
    if(result.spec.operation.type!=="image.compose")throw new Error("Expected image fixture");
    const before=await f.client.downloadGameAssetFile(original.id,"assets/variant.png"),operation=structuredClone(result.spec.operation);
    operation.width=4;operation.height=4;operation.layers[0]={...operation.layers[0]!,width:4,height:4,opacity:.5,tint:"#80ffffff",flipX:true,crop:{x:0,y:0,width:8,height:8}};
    operation.pngEncoding="lossless-smallest";
    const command={action:"adjust-image",projectId:p.id,jobId:original.id,expectedRevision:2,requestId:"image-adjustment",operation};
    const rejected=async(input:unknown,pattern:RegExp)=>{const value=await f.controller.dispatch(input) as {imageAdjustmentRejected:boolean;message:string};assert.equal(value.imageAdjustmentRejected,true);assert.match(value.message,pattern);};
    f.host.canWrite=()=>false;await rejected(command,/modo de edição/);f.host.canWrite=()=>true;
    f.host.approve=async()=>false;assert.deepEqual(await f.controller.dispatch(command),{cancelled:true});
    let approvals=0;f.host.approve=async()=>{approvals++;return true;};
    assert.equal((await f.controller.snapshot()).canOptimizePng,true);
    const originalCall=f.client.call.bind(f.client);f.client.call=async(method,params)=>method==="engine.info"?{capabilities:[]} as never:originalCall(method,params);
    await rejected(command,/atualização.*codificação PNG/);assert.equal(approvals,0);f.client.call=originalCall;
    await rejected({...command,operation:{...operation,output:"assets/other.png"}},/preservar as fontes/);
    await rejected({...command,operation:{...operation,layers:[{...operation.layers[0],source:{assetId:"foreign",path:source.path}}]}},/preservar as fontes/);assert.equal(approvals,0);
    await assert.rejects(f.controller.dispatch({...command,operation:{...operation,shell:"forged"}}));
    f.host.approve=async()=>{await f.client.selectGameProject(f.session.id,other.id);return true;};await rejected(command,/projeto ou a revisão mudou/);
    await f.client.selectGameProject(f.session.id,p.id);f.host.approve=async()=>{f.host.canWrite=()=>false;return true;};await rejected(command,/modo de edição/);f.host.canWrite=()=>true;
    f.host.approve=async()=>{p=await f.client.commitGameRevision(p.id,"concurrent-title",2,{...document,title:"Concurrent title"},"Concurrent edit");return true;};await rejected(command,/revisão mudou/);
    assert.equal((await f.client.listGameProduction(p.id)).jobs.length,1);
    const request={...command,expectedRevision:3};f.host.approve=async()=>true;
    const process=f.client.processGameAsset.bind(f.client);f.client.processGameAsset=async(...args)=>{await process(...args);throw new Error("Lost processing acknowledgment");};
    await assert.rejects(f.controller.dispatch(request),/Lost processing acknowledgment/);assert.equal((await f.client.listGameProduction(p.id)).jobs.length,2);
    f.client.processGameAsset=process;
    const resumed=await f.controller.dispatch(request) as GameStudioSnapshot&{requestedAssetJobId:string};assert.ok(resumed.requestedAssetJobId);assert.equal(resumed.project!.revision,3);
    assert.equal((await f.wait(resumed.requestedAssetJobId)).state,"completed");assert.equal((await f.client.listGameProduction(p.id)).jobs.length,2);
    const variant=await f.client.getGameAssetResult(resumed.requestedAssetJobId);assert.equal(variant.asset.placeholder,true);assert.deepEqual(variant.spec.operation,operation);
    const image=PNG.sync.read(await f.client.downloadGameAssetFile(resumed.requestedAssetJobId,"assets/variant.png"));assert.equal(image.width,4);assert.equal(image.height,4);assert.ok(Math.abs(image.data[3]!-128)<=1);assert.ok(Math.abs(image.data[0]!-128)<=1);
    assert.deepEqual(await f.client.downloadGameAssetFile(original.id,"assets/variant.png"),before);assert.equal((await f.client.getGameProject(p.id)).revision,3);
    await assert.rejects(f.controller.dispatch({...request,operation:{...operation,background:"#ffffffff"}}),/different|outro conteúdo/);
    const applied=await f.controller.dispatch({action:"apply-asset",projectId:p.id,jobId:resumed.requestedAssetJobId,expectedRevision:3,requestId:"apply-adjusted"}) as GameStudioSnapshot;
    assert.equal(applied.project!.revision,4);assert.equal(applied.quality!.ready,false);
    const changed=structuredClone(applied.revision!.document);changed.assets.find(asset=>asset.id==="source")!.origin.license="Changed source declaration";
    await f.client.commitGameRevision(p.id,"source-changed",4,changed,"Source provenance changed");
    await rejected({...request,requestId:"changed-source",expectedRevision:5},/fonte do candidato mudou/);assert.equal((await f.client.listGameProduction(p.id)).jobs.length,2);
  }finally{await f.close();}
});

test("source/build exports preserve history and verified bytes in new directories; cancelled or failed exports do not overwrite existing data",async()=>{
  const f=await fixture();try{
    let p=await f.project();const old=await f.client.getGameRevision(p.id),doc=structuredClone(old.document),changed=await f.client.uploadGameFile("src/palette.ts",Buffer.from("export const color=0xff0000;"),"text/plain");
    doc.files=doc.files.map((file)=>file.path===changed.path?changed:file);
    const longPath=`assets/${"a".repeat(200)}/${"b".repeat(188)}.txt`;assert.equal(longPath.length,400);doc.files.push(await f.client.uploadGameFile(longPath,Buffer.from("portable long path"),"text/plain"));
    p=await f.client.commitGameRevision(p.id,"change",1,doc,"New palette");
    const parent=path.join(f.directory,"exports");await mkdir(parent);await writeFile(path.join(parent,"existing.txt"),"keep me");
    const source=await exportGameDirectory({client:f.client,parent,source:{projectId:p.id,revision:2}}),archive=JSON.parse(await readFile(path.join(source,"history.json"),"utf8"));assert.equal(archive.revisions.length,2);
    assert.equal(await readFile(path.join(source,"source/src/palette.ts"),"utf8"),"export const color=0xff0000;");
    assert.equal(await readFile(path.join(source,"source",longPath),"utf8"),"portable long path");
    const original=old.document.files.find((file)=>file.path===changed.path)!;assert.equal(await readFile(path.join(source,"blobs",original.sha256),"utf8"),"export const color = 0xf5c06a;");
    const build=await f.client.startGameBuild("build",p.id,2);await f.wait(build.id);const artifact=await f.client.getGameArtifact(build.id);
    const destination=await exportGameDirectory({client:f.client,parent,artifact});assert.match(await readFile(path.join(destination,"build/index.html"),"utf8"),/<canvas/);
    const before=await readdir(parent);await assert.rejects(exportGameDirectory({client:f.client,parent,source:{projectId:p.id,revision:1}}),/mudou/);assert.deepEqual(await readdir(parent),before);
    const corrupt=structuredClone(artifact);corrupt.files[0]!.path="../outside";await assert.rejects(exportGameDirectory({client:f.client,parent,artifact:corrupt}));assert.deepEqual(await readdir(parent),before);
    const originalRead=f.client.downloadGameFile.bind(f.client);let reads=0;f.client.downloadGameFile=async(...args)=>{if(++reads===2)throw new Error("Lost download");return originalRead(...args);};
    await assert.rejects(exportGameDirectory({client:f.client,parent,source:{projectId:p.id,revision:2}}),/Lost download/);assert.deepEqual(await readdir(parent),before);
    assert.equal(await readFile(path.join(parent,"existing.txt"),"utf8"),"keep me");
    const second=await f.client.startGameBuild("second-build",p.id,1);await f.wait(second.id);const page=await f.client.listGameProduction(p.id,0,1,"desc");assert.equal(page.jobs[0]!.id,second.id);assert.equal(page.hasMore,true);assert.equal((await f.client.listGameProduction(p.id,page.cursor,1,"desc")).jobs[0]!.id,build.id);
  }finally{await f.close();}
});


test("Studio restores preserve exact lost-commit identity, read-only recovery and later work; native consent rechecks project and revision",async()=>{
  const f=await fixture();
  try{
    const p=await f.project(),other=await f.project("restore-other");await f.client.selectGameProject(f.session.id,p.id);
    const first=await f.client.getGameRevision(p.id,1),edited=structuredClone(first.document);edited.title="Before restore";
    await f.client.commitGameRevision(p.id,"second",1,edited,"Existing work");
    const command={action:"restore",projectId:p.id,revision:1,expectedRevision:2,requestId:"frozen-restore"};
    const rejected=async(value=command)=>assert.equal((await f.controller.dispatch(value) as {restoreRejected:boolean}).restoreRejected,true);
    f.host.canWrite=()=>false;await rejected();
    f.host.canWrite=()=>true;f.host.approve=async()=>false;assert.deepEqual(await f.controller.dispatch(command),{cancelled:true});
    f.host.approve=async()=>{f.host.canWrite=()=>false;return true;};await rejected();
    f.host.canWrite=()=>true;f.host.approve=async()=>{await f.client.selectGameProject(f.session.id,other.id);return true;};await rejected();
    await f.client.selectGameProject(f.session.id,p.id);assert.equal((await f.client.getGameProject(p.id)).revision,2);
    f.host.approve=async()=>true;
    const commit=f.client.commitGameRevision.bind(f.client);let commits=0;
    f.client.commitGameRevision=async(...args)=>{commits++;await commit(...args);throw Error("Lost committed restore acknowledgment");};
    await assert.rejects(f.controller.dispatch(command),/Lost committed restore/);assert.equal((await f.client.getGameProject(p.id)).revision,3);assert.equal(commits,1);
    const later=structuredClone(edited);later.title="Later work after restore";await commit(p.id,"later-restore-work",3,later,"Preserve later work");
    f.host.canWrite=()=>false;f.host.approve=async()=>{throw Error("Receipt inspection must not request mutation consent");};
    const controller=new GameStudioController(f.client,f.session.id,f.host),resume={...command,action:"resume-restore"};
    const result=await controller.dispatch(resume) as {project:{revision:number};recoveredRestoreCommit:{revision:number}};
    assert.equal(result.recoveredRestoreCommit.revision,3);assert.equal(result.project.revision,4);assert.equal(commits,1);
    assert.equal((await f.client.getGameRevision(p.id)).document.title,later.title);
    assert.equal((await controller.dispatch({...resume,revision:2}) as {restoreRejected:boolean}).restoreRejected,true);
    const inspect=f.client.inspectGameMutation.bind(f.client);
    f.client.inspectGameMutation=async(...args)=>({...await inspect(...args),state:"acknowledged",bindingHash:"0".repeat(64),revision:3,contentHash:"0".repeat(64)});
    assert.equal((await controller.dispatch(resume) as {restoreRejected:boolean}).restoreRejected,true);
    f.client.inspectGameMutation=async(...args)=>{const receipt=await inspect(...args);return receipt.state==="acknowledged"?{...receipt,contentHash:"0".repeat(64)}:receipt;};
    assert.equal((await controller.dispatch(resume) as {restoreRejected:boolean}).restoreRejected,true,"acknowledged hash must match its immutable revision");f.client.inspectGameMutation=inspect;
    const info=f.client.call.bind(f.client);f.client.call=async(method,...args)=>{if(method==="engine.info")return {capabilities:[]} as never;return info(method,...args);};
    assert.equal((await controller.dispatch(resume) as {restoreRejected:boolean}).restoreRejected,true);f.client.call=info;
    assert.equal((await controller.dispatch({...resume,requestId:"unacknowledged-restore",expectedRevision:4}) as {restoreRejected:boolean}).restoreRejected,true);
    assert.equal(commits,1);assert.equal((await f.client.getGameProject(other.id)).revision,1);
    f.host.canWrite=()=>true;f.host.approve=async()=>{await commit(p.id,"concurrent-consent",4,later,"Changed during native consent");return true;};
    assert.equal((await controller.dispatch({...command,expectedRevision:4,requestId:"stale-after-consent"}) as {restoreRejected:boolean}).restoreRejected,true);
    assert.equal(commits,1);assert.equal((await f.client.getGameProject(p.id)).revision,5,"no restore may overwrite work committed during native consent");
  }finally{await f.close();}
});
