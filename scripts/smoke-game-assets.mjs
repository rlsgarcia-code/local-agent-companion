// End-to-end codec integration, not a finished game or human/audio acceptance.
import assert from "node:assert/strict";
import { spawn,execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp,mkdir,readFile,writeFile,rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { once } from "node:events";
import { PNG } from "pngjs";
import security from "../dist-tests/packages/agent-service/src/security.js";
import storage from "../dist-tests/packages/agent-service/src/store.js";
import sdk from "../dist-tests/packages/client-ts/src/index.js";
import fixtures from "../dist-tests/test/game-fixtures.js";

const state=await mkdtemp(path.join(tmpdir(),"companion-packaged-media-")),output=path.resolve("output/playwright/game-assets"),engine=path.resolve("engine-dist");
const registration={id:"game-assets-smoke",product:"companion-mac",profile:"fixture",workspace:"",providers:["ollama"],hostTools:[]};
const identity=await security.ensureIdentity(state),credential=await security.createClientCredential(state,registration);
const store=new storage.Store(path.join(state,"metadata.sqlite"));store.register(credential);store.close();
let child,client,failure="";
const pause=()=>new Promise((resolve)=>setTimeout(resolve,25));
async function boot(){
  failure="";child=spawn(path.join(engine,process.platform==="win32"?"node.exe":"node"),[path.join(engine,"service.cjs"),state],{stdio:["ignore","pipe","pipe"]});
  child.stdout.on("data",(data)=>{failure=(failure+data).slice(-100000);});child.stderr.on("data",(data)=>{failure=(failure+data).slice(-100000);});
  let ready=false;
  for(let i=0;i<600;i++){
    if(child.exitCode!==null)throw new Error(`Engine exited: ${failure}`);
    try{if(JSON.parse(await readFile(path.join(state,"runtime.json"),"utf8")).pid===child.pid){ready=true;break;}}catch{}await pause();
  }
  assert.ok(ready,"Packaged service did not start");client=new sdk.AgentClient({address:security.ipcPath(state),certificate:identity.cert,credential});await client.connect();
}
async function stop(){client?.close();if(child?.exitCode===null){const exited=once(child,"exit");child.kill("SIGTERM");await exited;}}
async function settled(id){for(let i=0;i<2400;i++){const job=await client.getGameProduction(id);if(!["running","queued","cancelling"].includes(job.state)){assert.equal(job.state,"completed",job.error);return job;}await pause();}throw new Error("Media/build job did not settle");}
async function save(name,bytes){const target=path.join(output,name);await mkdir(path.dirname(target),{recursive:true});await writeFile(target,bytes);}
const results=[];
try{
  await boot();const caps=await client.gameProductionCapabilities();assert.ok(caps.assetProcessors.some((item)=>item.id==="local-media-v1"&&item.available));
  assert.ok(caps.collectors.some((item)=>item.id==="web-browser-runtime-v1"&&item.available),"Qualified browser required for real atlas rendering");
  const image=new PNG({width:64,height:64});
  for(let y=0;y<64;y++)for(let x=0;x<64;x++)if((x-32)**2+(y-32)**2<24**2)image.data.set([70,210,150,255],(y*64+x)*4);
  const raw=await client.uploadGameFile("assets/raw.png",PNG.sync.write(image),"image/png"),document=fixtures.fixtureGameDocument();
  document.files=[raw];document.assets=[{id:"raw",kind:"sprite",role:"Procedural fixture shape",placeholder:true,files:[raw.path],origin:{kind:"procedural",source:"Integration fixture geometry, not final artwork",author:"Companion fixture",license:"Fixture generated locally; no external asset",referenceIds:[]}}];
  let project=await client.createGameProject("media-fixture",document);
  async function processAndApply(key,spec,restart=false){
    const before=project.revision,job=await client.processGameAsset(key,project.id,before,spec);await settled(job.id);
    assert.equal((await client.getGameProject(project.id)).revision,before);
    if(restart){await stop();await boot();}
    const candidate=await client.getGameAssetResult(job.id);for(const file of candidate.files)await save(`candidates/${key}/${file.path}`,await client.downloadGameAssetFile(job.id,file.path));
    project=await client.applyGameAsset(`apply-${key}`,job.id,before);assert.equal(project.revision,before+1);
    assert.deepEqual(await client.applyGameAsset(`apply-${key}`,job.id,before),project);results.push(candidate);return candidate;
  }
  await processAndApply("compose",{processorId:"local-media-v1",target:{id:"gold",role:"Tinted fixture shape",placeholder:true},operation:{type:"image.compose",output:"assets/gold.png",width:64,height:64,
    layers:[{source:{assetId:"raw",path:raw.path},x:0,y:0,width:64,height:64,tint:"#ffc060ff",filter:"nearest",flipX:true}]}},true);
  await processAndApply("atlas",{processorId:"local-media-v1",target:{id:"hero",role:"Fixture animation atlas",placeholder:true},operation:{type:"image.atlas",outputBase:"assets/hero",pageSize:256,
    frames:[{id:"green",source:{assetId:"raw",path:raw.path}},{id:"gold",source:{assetId:"gold",path:"assets/gold.png"}}],animations:[{id:"color",frames:["green","gold"],fps:6,loop:true}]}});
  await processAndApply("audio",{processorId:"local-media-v1",target:{id:"jump",role:"Fixture jump sound",placeholder:true},operation:{type:"audio.render",output:"assets/jump.wav",durationMs:350,sampleRate:48000,channels:2,normalizePeak:0.6,
    notes:[{waveform:"triangle",frequency:440,endFrequency:880,startMs:0,durationMs:350,gain:0.4,attackMs:5,releaseMs:120}]}});
  await processAndApply("mix",{processorId:"local-media-v1",target:{id:"mixed",role:"Resampled fixture sound",placeholder:true},operation:{type:"audio.render",output:"assets/mixed.wav",durationMs:350,sampleRate:22050,channels:2,normalizePeak:0.5,
    clips:[{source:{assetId:"jump",path:"assets/jump.wav"},startMs:0,durationMs:350,pan:-0.3,fadeInMs:10,fadeOutMs:100}]}});
  const current=(await client.getGameRevision(project.id)).document;
  const source=`import Phaser from 'phaser';
new Phaser.Game({type:Phaser.CANVAS,canvas:document.querySelector('#game'),width:640,height:360,backgroundColor:'#173b30',scene:{
 preload(){this.load.multiatlas('hero','assets/hero.atlas.json','assets/');this.load.audio('jump','assets/mixed.wav');},
 create(){const shape=this.add.sprite(280,180,'hero','green').setScale(2);let gold=false;
 this.input.keyboard.on('keydown-SPACE',()=>{gold=!gold;shape.setFrame(gold?'gold':'green');shape.x+=60;this.sound.play('jump',{volume:0.2});});}}});`;
  const files=new Map([["game.web.json",JSON.stringify({schemaVersion:1,engineVersion:"4.2.1",entry:"src/main.ts"})],["src/main.ts",source],
    ["data/playtests.json",JSON.stringify({schemaVersion:1,viewport:{width:640,height:360},scenarios:[{id:"actual-atlas-input",steps:[{action:"wait",ms:300},{action:"capture",selector:"canvas",name:"before"},{action:"press",key:"Space"},{action:"wait",ms:150},{action:"expect-image",selector:"canvas",baseline:"before",comparison:"changed",threshold:0.005}]}]})]]);
  for(const [name,text] of files)current.files.push(await client.uploadGameFile(name,Buffer.from(text),name.endsWith(".json")?"application/json":"text/plain"));
  project=await client.commitGameRevision(project.id,"fixture-game",project.revision,current,"Use processed media in the real Phaser runtime");
  const build=await client.startGameBuild("build",project.id,project.revision);await settled(build.id);const artifact=await client.getGameArtifact(build.id);
  for(const file of artifact.files)await save(`build/${file.path}`,await client.downloadGameArtifactFile(build.id,file.path));
  const observation=await client.startGameValidation("observe",build.id,"web-browser-runtime-v1");await settled(observation.id);const reports=await client.getGameReports(build.id);
  for(const report of reports){for(const check of report.checks)assert.equal(check.status,"passed",check.detail);for(const file of report.evidence??[])await save(`observations/${report.id}/${file.path}`,await client.downloadGameReportFile(report.id,file.path));}
  assert.ok(reports.some((report)=>report.testCase?.id==="actual-atlas-input"));
  const waveFile=path.join(output,"candidates/mix/assets/mixed.wav");
  if(process.platform!=="win32"){
    const independent=await promisify(execFile)("python3",["-I","-c","import sys,wave,struct\nwith wave.open(sys.argv[1],'rb') as w:\n assert w.getnchannels()==2 and w.getframerate()==22050 and w.getsampwidth()==2\n assert w.getnframes()==7718\n samples=struct.unpack('<'+str(w.getnframes()*2)+'h',w.readframes(w.getnframes()))\n assert max(abs(x) for x in samples)>16000\n print('INDEPENDENT_PCM_OK')",waveFile],{timeout:10000});assert.match(independent.stdout,/INDEPENDENT_PCM_OK/);
  }
  const quality=await client.getGameQuality(project.id);assert.equal(quality.ready,false);
  await save("integration-evidence.json",Buffer.from(JSON.stringify({purpose:"Real packaged codec/IPC/atlas rendering integration; not game, physical audio or human acceptance",manifest:JSON.parse(await readFile(path.join(engine,"manifest.json"),"utf8")),project,results,artifact,reports,quality},null,2)));
  console.log(`PACKAGED_MEDIA_OK ${results.length} processed/applied candidates, service restart, PCM inspection and real Phaser atlas ${output}`);
}finally{await stop();await rm(state,{recursive:true,force:true});}
